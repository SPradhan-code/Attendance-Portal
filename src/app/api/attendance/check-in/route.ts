/**
 * POST /api/attendance/check-in
 *
 * Verifies:
 * 1. Student authentication (via withAuth)
 * 2. Rotating cryptographic QR token validity
 * 3. 3D Geofence: horizontal effective distance ≤ 15 m, altitude ≤ 3 m
 * 4. Records verified attendance in Supabase
 *
 * Security: student_id is always taken from the server session — never the body.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRotatingToken } from '@/lib/crypto/session-token';
import { validate3DLocation } from '@/lib/geo/geofence';
import { withAuth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const checkInSchema = z.object({
  classId: z.string().uuid('classId must be a UUID'),
  token: z.string().min(1, 'token is required'),
  latitude: z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
  altitude: z.number().finite().nullable().optional(),
  accuracy: z.number().positive().nullable().optional(),
});

export const POST = withAuth(async (request, { user }) => {
  // ── Parse & validate body ─────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = checkInSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((e) => e.message).join('; ');
    return NextResponse.json({ error: issues }, { status: 400 });
  }

  const {
    classId,
    token,
    latitude,
    longitude,
    altitude = null,
    accuracy = null,
  } = parsed.data;

  const admin = createAdminClient();

  // ── Check student profile & passkey ──────────────────────────────────────
  const { data: profile } = await admin
    .from('profiles')
    .select('id, name, role, webauthn_credential')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
  }

  if (!profile.webauthn_credential) {
    return NextResponse.json(
      {
        error:
          'Biometric passkey required. Please register a passkey before checking in.',
      },
      { status: 403 },
    );
  }

  // ── Fetch active class session ────────────────────────────────────────────
  const { data: classRow, error: classErr } = await admin
    .from('classes')
    .select('*')
    .eq('id', classId)
    .single();

  if (classErr || !classRow) {
    return NextResponse.json({ error: 'Class not found.' }, { status: 404 });
  }

  if (!classRow.is_session_active) {
    return NextResponse.json(
      { error: 'Attendance session is not active for this class.' },
      { status: 400 },
    );
  }

  // ── Server time-lock validation ───────────────────────────────────────────
  const serverNow = new Date();
  const startTime = new Date(classRow.start_time);
  const endTime = new Date(classRow.end_time);

  if (serverNow < startTime) {
    return NextResponse.json(
      {
        error: `Class attendance has not opened yet. Scheduled start: ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        code: 'TIME_LOCK_PRE_CLASS',
      },
      { status: 403 },
    );
  }

  if (serverNow > endTime) {
    return NextResponse.json(
      {
        error: `Attendance window has closed. The class concluded at ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        code: 'TIME_LOCK_EXPIRED',
      },
      { status: 403 },
    );
  }

  // ── Verify rotating QR token ──────────────────────────────────────────────
  const secret =
    classRow.session_token_secret ||
    process.env.SESSION_SECRET ||
    'attendance-default-secret-key-32b';

  const tokenVerification = verifyRotatingToken(classId, token, secret);
  if (!tokenVerification.valid) {
    return NextResponse.json(
      {
        error:
          tokenVerification.reason ||
          'QR code token is invalid or expired. Please scan the current code.',
      },
      { status: 400 },
    );
  }

  // ── Validate 3D geofence ──────────────────────────────────────────────────
  const sessionLat =
    Number(classRow.session_latitude) || Number(classRow.latitude);
  const sessionLng =
    Number(classRow.session_longitude) || Number(classRow.longitude);
  const sessionAlt =
    classRow.session_altitude != null ? Number(classRow.session_altitude) : null;

  const geoResult = validate3DLocation({
    studentLat: latitude,
    studentLng: longitude,
    studentAlt: altitude,
    studentAccuracy: accuracy,
    sessionLat,
    sessionLng,
    sessionAlt,
  });

  if (!geoResult.isValid) {
    return NextResponse.json(
      {
        error: geoResult.reason,
        distanceMeters: geoResult.distanceMeters,
        effectiveDistanceMeters: geoResult.effectiveDistanceMeters,
        altitudeDiffMeters: geoResult.altitudeDiffMeters,
        horizontalPass: geoResult.horizontalPass,
        altitudePass: geoResult.altitudePass,
      },
      { status: 403 },
    );
  }

  // ── Record attendance ─────────────────────────────────────────────────────
  const { data: attendanceRow, error: insertErr } = await admin
    .from('attendance')
    .insert({
      class_id: classId,
      student_id: user.id,
      status: 'present',
      verified_latitude: latitude,
      verified_longitude: longitude,
      verified_altitude: altitude,
      distance_meters:
        isFinite(geoResult.distanceMeters)
          ? Math.round(geoResult.distanceMeters * 100) / 100
          : null,
      altitude_diff_meters:
        geoResult.altitudeDiffMeters != null
          ? Math.round(geoResult.altitudeDiffMeters * 100) / 100
          : null,
      verification_method: 'webauthn_geofence_3d',
    })
    .select()
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json(
        {
          error: 'You have already marked attendance for this class session.',
          alreadyMarked: true,
        },
        { status: 409 },
      );
    }
    console.error('[attendance/check-in] Insert failed:', insertErr);
    return NextResponse.json(
      { error: 'Failed to record attendance.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Attendance recorded successfully!',
    attendance: attendanceRow,
    telemetry: {
      distanceMeters: isFinite(geoResult.distanceMeters)
        ? geoResult.distanceMeters.toFixed(2)
        : null,
      effectiveDistanceMeters: isFinite(geoResult.effectiveDistanceMeters)
        ? geoResult.effectiveDistanceMeters.toFixed(2)
        : null,
      altitudeDiffMeters: geoResult.altitudeDiffMeters?.toFixed(2) ?? 'N/A',
      sessionFloor: classRow.session_floor,
      timestamp: new Date().toISOString(),
    },
  });
});
