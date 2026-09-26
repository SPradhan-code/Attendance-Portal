/**
 * 3D Geofence & Haversine Distance Utility
 *
 * Implements:
 * 1. Haversine distance calculation for horizontal proximity (max 15 meters)
 * 2. Vertical altitude difference validation (max 3 meters / 1 floor)
 */

export const MAX_HORIZONTAL_DISTANCE_METERS = 15;
export const MAX_ALTITUDE_DIFF_METERS = 3;

/**
 * Calculates horizontal distance in meters between two GPS coordinates using the Haversine formula.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth radius in meters
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

export interface Geofence3DValidationResult {
  isValid: boolean;
  distanceMeters: number;
  altitudeDiffMeters: number | null;
  horizontalPass: boolean;
  altitudePass: boolean;
  reason?: string;
}

/**
 * Validates a student's live 3D location against the active professor session coordinates.
 *
 * Requirements:
 *  - Horizontal distance d <= 15 meters
 *  - Vertical altitude difference |alt_student - alt_session| <= 3 meters (if altitude is available)
 */
export function validate3DLocation({
  studentLat,
  studentLng,
  studentAlt,
  sessionLat,
  sessionLng,
  sessionAlt,
  maxDistance = MAX_HORIZONTAL_DISTANCE_METERS,
  maxAltDiff = MAX_ALTITUDE_DIFF_METERS,
}: {
  studentLat: number;
  studentLng: number;
  studentAlt?: number | null;
  sessionLat: number;
  sessionLng: number;
  sessionAlt?: number | null;
  maxDistance?: number;
  maxAltDiff?: number;
}): Geofence3DValidationResult {
  const distanceMeters = calculateHaversineDistance(
    studentLat,
    studentLng,
    sessionLat,
    sessionLng,
  );
  const horizontalPass = distanceMeters <= maxDistance;

  let altitudePass = true;
  let altitudeDiffMeters: number | null = null;

  if (
    typeof studentAlt === 'number' &&
    !isNaN(studentAlt) &&
    typeof sessionAlt === 'number' &&
    !isNaN(sessionAlt)
  ) {
    altitudeDiffMeters = Math.abs(studentAlt - sessionAlt);
    altitudePass = altitudeDiffMeters <= maxAltDiff;
  }

  let reason: string | undefined;
  if (!horizontalPass && !altitudePass) {
    reason = `Outside classroom perimeter (${distanceMeters.toFixed(1)}m > ${maxDistance}m) and vertical floor mismatch (${altitudeDiffMeters?.toFixed(1)}m > ${maxAltDiff}m).`;
  } else if (!horizontalPass) {
    reason = `Outside classroom perimeter: ${distanceMeters.toFixed(1)}m away (max allowed: ${maxDistance}m).`;
  } else if (!altitudePass) {
    reason = `Vertical floor mismatch: altitude difference is ${altitudeDiffMeters?.toFixed(1)}m (max allowed: ${maxAltDiff}m). You appear to be on a different floor.`;
  }

  return {
    isValid: horizontalPass && altitudePass,
    distanceMeters,
    altitudeDiffMeters,
    horizontalPass,
    altitudePass,
    reason,
  };
}
