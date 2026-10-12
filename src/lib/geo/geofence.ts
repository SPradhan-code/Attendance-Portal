/**
 * src/lib/geo/geofence.ts
 *
 * 3D Geofence & Haversine Distance Utility
 *
 * Security design (fail-closed):
 *  - NaN / null / out-of-range coordinates → always reject
 *  - GPS accuracy > GEOFENCE_MAX_ACCURACY_METERS → always reject (inaccurate fix)
 *  - Distance check uses (distance - accuracy) to account for GPS drift:
 *      effective distance = raw_distance - reported_accuracy
 *      if effective_distance > maxDistance → reject
 *    This means we only allow the student in when even the worst-case position
 *    (accuracy bubble edge nearest the classroom) is still inside the fence.
 *  - Altitude checked when both student and session altitudes are available.
 */

import {
  GEOFENCE_MAX_HORIZONTAL_METERS,
  GEOFENCE_MAX_ALTITUDE_DIFF_METERS,
  GEOFENCE_MAX_ACCURACY_METERS,
} from '@/config/attendance';

// Re-export constants for backwards compatibility.
export { GEOFENCE_MAX_HORIZONTAL_METERS as MAX_HORIZONTAL_DISTANCE_METERS };
export { GEOFENCE_MAX_ALTITUDE_DIFF_METERS as MAX_ALTITUDE_DIFF_METERS };

// ── Haversine ─────────────────────────────────────────────────────────────────

/**
 * Calculates horizontal distance in metres between two GPS coordinates using
 * the Haversine formula.
 *
 * Returns `null` if any coordinate is NaN, Infinite, or out of valid range
 * (lat ∉ [-90, 90], lon ∉ [-180, 180]).
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number | null {
  // Validate inputs — fail closed on bad data
  if (
    !isFinite(lat1) || !isFinite(lon1) ||
    !isFinite(lat2) || !isFinite(lon2) ||
    lat1 < -90 || lat1 > 90 ||
    lat2 < -90 || lat2 > 90 ||
    lon1 < -180 || lon1 > 180 ||
    lon2 < -180 || lon2 > 180
  ) {
    return null;
  }

  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ── Result type ───────────────────────────────────────────────────────────────

export interface Geofence3DValidationResult {
  isValid: boolean;
  distanceMeters: number;
  /** Effective distance after subtracting reported GPS accuracy (accuracy margin). */
  effectiveDistanceMeters: number;
  altitudeDiffMeters: number | null;
  horizontalPass: boolean;
  altitudePass: boolean;
  /** Human-readable rejection reason; absent when isValid === true. */
  reason?: string;
}

// ── Main validator ────────────────────────────────────────────────────────────

/**
 * Validates a student's live 3D location against the active professor session.
 *
 * Rules (fail-closed on any invalid input):
 *  1. Student GPS accuracy must be ≤ `GEOFENCE_MAX_ACCURACY_METERS` (50 m).
 *  2. Effective horizontal distance = raw_distance − reported_accuracy must
 *     be ≤ `maxDistance` (15 m).  This guards against an inaccurate GPS fix
 *     appearing inside the fence by chance.
 *  3. Vertical altitude difference |alt_student − alt_session| ≤ `maxAltDiff`
 *     (3 m) when both altitudes are present.
 *  4. Any NaN / Infinite coordinate → rejected immediately.
 */
export function validate3DLocation({
  studentLat,
  studentLng,
  studentAlt,
  studentAccuracy,
  sessionLat,
  sessionLng,
  sessionAlt,
  maxDistance = GEOFENCE_MAX_HORIZONTAL_METERS,
  maxAltDiff = GEOFENCE_MAX_ALTITUDE_DIFF_METERS,
  maxAccuracy = GEOFENCE_MAX_ACCURACY_METERS,
}: {
  studentLat: number;
  studentLng: number;
  studentAlt?: number | null;
  /** Reported GPS horizontal accuracy in metres (from browser GeolocationCoordinates.accuracy). */
  studentAccuracy?: number | null;
  sessionLat: number;
  sessionLng: number;
  sessionAlt?: number | null;
  maxDistance?: number;
  maxAltDiff?: number;
  maxAccuracy?: number;
}): Geofence3DValidationResult {
  // ── 1. Hard-reject bad accuracy ──────────────────────────────────────────
  if (
    typeof studentAccuracy === 'number' &&
    isFinite(studentAccuracy) &&
    studentAccuracy > maxAccuracy
  ) {
    return {
      isValid: false,
      distanceMeters: NaN,
      effectiveDistanceMeters: NaN,
      altitudeDiffMeters: null,
      horizontalPass: false,
      altitudePass: true,
      reason: `GPS accuracy too low (±${studentAccuracy.toFixed(0)} m). Move to a location with a clearer sky view (required: ±${maxAccuracy} m or better).`,
    };
  }

  // ── 2. Compute distance (fail-closed on invalid coords) ─────────────────
  const rawDistance = calculateHaversineDistance(
    studentLat, studentLng,
    sessionLat, sessionLng,
  );

  if (rawDistance === null) {
    return {
      isValid: false,
      distanceMeters: NaN,
      effectiveDistanceMeters: NaN,
      altitudeDiffMeters: null,
      horizontalPass: false,
      altitudePass: true,
      reason: 'Invalid GPS coordinates — location could not be verified.',
    };
  }

  // ── 3. Accuracy-margin check: effective = distance − accuracy ────────────
  const accuracy =
    typeof studentAccuracy === 'number' && isFinite(studentAccuracy)
      ? studentAccuracy
      : 0;

  // Only apply margin when accuracy is available and positive.
  // When unknown we fall back to the raw distance (conservative but not
  // unnecessarily punitive for devices that don't report accuracy).
  const effectiveDistance = accuracy > 0
    ? Math.max(0, rawDistance - accuracy)
    : rawDistance;

  const horizontalPass = effectiveDistance <= maxDistance;

  // ── 4. Altitude check ────────────────────────────────────────────────────
  let altitudePass = true;
  let altitudeDiffMeters: number | null = null;

  if (
    typeof studentAlt === 'number' &&
    isFinite(studentAlt) &&
    typeof sessionAlt === 'number' &&
    isFinite(sessionAlt)
  ) {
    altitudeDiffMeters = Math.abs(studentAlt - sessionAlt);
    altitudePass = altitudeDiffMeters <= maxAltDiff;
  }

  // ── 5. Compose rejection reason ──────────────────────────────────────────
  let reason: string | undefined;
  if (!horizontalPass && !altitudePass) {
    reason =
      `Outside classroom perimeter (effective distance: ${effectiveDistance.toFixed(1)} m > ${maxDistance} m) ` +
      `and vertical floor mismatch (${altitudeDiffMeters?.toFixed(1)} m > ${maxAltDiff} m).`;
  } else if (!horizontalPass) {
    reason =
      `Outside classroom perimeter: ${effectiveDistance.toFixed(1)} m away ` +
      `(max allowed: ${maxDistance} m, raw: ${rawDistance.toFixed(1)} m).`;
  } else if (!altitudePass) {
    reason =
      `Vertical floor mismatch: altitude difference is ${altitudeDiffMeters?.toFixed(1)} m ` +
      `(max allowed: ${maxAltDiff} m). You appear to be on a different floor.`;
  }

  return {
    isValid: horizontalPass && altitudePass,
    distanceMeters: rawDistance,
    effectiveDistanceMeters: effectiveDistance,
    altitudeDiffMeters,
    horizontalPass,
    altitudePass,
    reason,
  };
}
