/**
 * src/lib/geo/__tests__/geofence.test.ts
 *
 * Unit tests for the 3D geofence / haversine utilities.
 * Coverage targets: calculateHaversineDistance, validate3DLocation
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHaversineDistance,
  validate3DLocation,
} from '../geofence';

// Known reference point: Eiffel Tower, Paris
const EIFFEL = { lat: 48.8584, lng: 2.2945 };
// ~349 m north of Eiffel Tower
const CHAMP_DE_MARS = { lat: 48.8613, lng: 2.2986 };

describe('calculateHaversineDistance', () => {
  it('returns 0 for identical coordinates', () => {
    expect(calculateHaversineDistance(48.8584, 2.2945, 48.8584, 2.2945)).toBeCloseTo(0, 1);
  });

  it('calculates known distance between two Paris landmarks (~440 m)', () => {
    const dist = calculateHaversineDistance(
      EIFFEL.lat, EIFFEL.lng,
      CHAMP_DE_MARS.lat, CHAMP_DE_MARS.lng,
    );
    expect(dist).not.toBeNull();
    expect(dist as number).toBeGreaterThan(350);
    expect(dist as number).toBeLessThan(550);
  });

  it('is symmetric (A→B == B→A)', () => {
    const d1 = calculateHaversineDistance(EIFFEL.lat, EIFFEL.lng, CHAMP_DE_MARS.lat, CHAMP_DE_MARS.lng);
    const d2 = calculateHaversineDistance(CHAMP_DE_MARS.lat, CHAMP_DE_MARS.lng, EIFFEL.lat, EIFFEL.lng);
    expect(d1).toBeCloseTo(d2 as number, 3);
  });

  it('returns null for NaN latitude', () => {
    expect(calculateHaversineDistance(NaN, 0, 0, 0)).toBeNull();
  });

  it('returns null for Infinity longitude', () => {
    expect(calculateHaversineDistance(0, Infinity, 0, 0)).toBeNull();
  });

  it('returns null for out-of-range latitude (>90)', () => {
    expect(calculateHaversineDistance(91, 0, 0, 0)).toBeNull();
  });

  it('returns null for out-of-range longitude (<-180)', () => {
    expect(calculateHaversineDistance(0, -181, 0, 0)).toBeNull();
  });
});

describe('validate3DLocation', () => {
  // Session at Eiffel Tower
  const session = { sessionLat: EIFFEL.lat, sessionLng: EIFFEL.lng };

  it('passes when student is within 15 m', () => {
    // ~10 m offset in latitude
    const studentLat = EIFFEL.lat + 0.00009; // ~10 m north
    const result = validate3DLocation({
      studentLat,
      studentLng: EIFFEL.lng,
      ...session,
    });
    expect(result.isValid).toBe(true);
    expect(result.horizontalPass).toBe(true);
  });

  it('fails when student is more than 15 m away', () => {
    const result = validate3DLocation({
      studentLat: CHAMP_DE_MARS.lat,
      studentLng: CHAMP_DE_MARS.lng,
      ...session,
    });
    expect(result.isValid).toBe(false);
    expect(result.horizontalPass).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('fails when GPS accuracy > 50 m (hard rejection)', () => {
    const result = validate3DLocation({
      studentLat: EIFFEL.lat + 0.00005,
      studentLng: EIFFEL.lng,
      studentAccuracy: 60, // exceeds 50 m threshold
      ...session,
    });
    expect(result.isValid).toBe(false);
    expect(result.reason).toMatch(/accuracy/i);
  });

  it('passes when GPS accuracy is exactly 50 m', () => {
    // A student 10 m away with exactly 50 m accuracy — effective = 10 - 50 = 0 (clamped)
    const studentLat = EIFFEL.lat + 0.00009; // ~10 m
    const result = validate3DLocation({
      studentLat,
      studentLng: EIFFEL.lng,
      studentAccuracy: 50,
      ...session,
    });
    // accuracy == limit (not > limit), so should not hard-reject on accuracy
    // effective distance = max(0, ~10 - 50) = 0, which is within 15 m → pass
    expect(result.isValid).toBe(true);
  });

  it('applies accuracy margin: student outside but effective distance inside', () => {
    // Student 20 m away, accuracy 10 m → effective = 20 - 10 = 10 m → within 15 m
    const studentLat = EIFFEL.lat + 0.00018; // ~20 m north
    const result = validate3DLocation({
      studentLat,
      studentLng: EIFFEL.lng,
      studentAccuracy: 10,
      ...session,
    });
    expect(result.effectiveDistanceMeters).toBeLessThanOrEqual(15);
    expect(result.horizontalPass).toBe(true);
  });

  it('fails altitude check when vertical difference > 3 m', () => {
    const studentLat = EIFFEL.lat + 0.00005; // ~5 m north (within fence)
    const result = validate3DLocation({
      studentLat,
      studentLng: EIFFEL.lng,
      studentAlt: 50,
      sessionAlt: 10, // 40 m difference
      ...session,
    });
    expect(result.isValid).toBe(false);
    expect(result.altitudePass).toBe(false);
    expect(result.reason).toMatch(/floor|altitude/i);
  });

  it('passes altitude check when difference <= 3 m', () => {
    const studentLat = EIFFEL.lat + 0.00005;
    const result = validate3DLocation({
      studentLat,
      studentLng: EIFFEL.lng,
      studentAlt: 12,
      sessionAlt: 10, // 2 m difference
      ...session,
    });
    expect(result.altitudePass).toBe(true);
  });

  it('skips altitude check when sessionAlt is missing', () => {
    const studentLat = EIFFEL.lat + 0.00005;
    const result = validate3DLocation({
      studentLat,
      studentLng: EIFFEL.lng,
      studentAlt: 100,
      // sessionAlt not provided
      ...session,
    });
    expect(result.altitudePass).toBe(true);
    expect(result.altitudeDiffMeters).toBeNull();
  });

  it('fails with invalid coordinates (NaN lat)', () => {
    const result = validate3DLocation({
      studentLat: NaN,
      studentLng: EIFFEL.lng,
      ...session,
    });
    expect(result.isValid).toBe(false);
    expect(result.reason).toMatch(/invalid|coordinates/i);
  });

  it('reports both failures when both horizontal and altitude fail', () => {
    const result = validate3DLocation({
      studentLat: CHAMP_DE_MARS.lat,
      studentLng: CHAMP_DE_MARS.lng,
      studentAlt: 100,
      sessionAlt: 10,
      ...session,
    });
    expect(result.isValid).toBe(false);
    expect(result.horizontalPass).toBe(false);
    expect(result.altitudePass).toBe(false);
  });

  it('respects custom maxDistance override', () => {
    // Student ~10 m away — fails with maxDistance=5, passes with maxDistance=15
    const studentLat = EIFFEL.lat + 0.00009;
    const fail = validate3DLocation({ studentLat, studentLng: EIFFEL.lng, ...session, maxDistance: 5 });
    const pass = validate3DLocation({ studentLat, studentLng: EIFFEL.lng, ...session, maxDistance: 15 });
    expect(fail.isValid).toBe(false);
    expect(pass.isValid).toBe(true);
  });
});
