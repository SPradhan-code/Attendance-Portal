import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRotatingToken } from '@/lib/crypto/session-token';
import { validate3DLocation } from '@/lib/geo/geofence';
import { NextResponse } from 'next/server';

interface CheckInPayload {
  classId: string;
  token: string;
  latitude: number;
  longitude: number;
  altitude?: number | null;
}

/**
 * POST /api/attendance/check-in
 *
 * Verifies:
 * 1. Student authentication & passkey status
 * 2. Rotating cryptographic QR token validity
 * 3. 3D Geofence: horizontal distance <= 15m and vertical altitude <= 3m
 * 4. Records verified attendance in Supabase
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // ── 1. Authenticate student ───────────────────────────────────
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'You must be signed in to check in.' },
        { status: 401 },
      );
    }

    const body: CheckInPayload = await request.json();
    const { classId, token, latitude, longitude, altitude = null } = body;

    if (!classId || !token) {
      return NextResponse.json(
        { error: 'Class ID and QR token are required.' },
        { status: 400 },
      );
    }

    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      isNaN(latitude) ||
      isNaN(longitude)
    ) {
      return NextResponse.json(
        { error: 'Valid GPS coordinates (latitude, longitude) are required.' },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    // ── 2. Check student profile & passkey ────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (admin.from('profiles') as any)
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

    // ── 3. Fetch active class session coordinates ─────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: classRow, error: classErr } = await (admin.from('classes') as any)
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

    // ── Server Time-Lock Validation Safeguard ───────────────────────
    // Validates server clock against class start_time and end_time.
    const serverNow = new Date();
    const startTime = new Date(classRow.start_time);
    const endTime = new Date(classRow.end_time);

    if (serverNow < startTime) {
      return NextResponse.json(
        {
          error: `Class attendance has not opened yet. Scheduled start: ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Server clock: ${serverNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
          code: 'TIME_LOCK_PRE_CLASS',
        },
        { status: 403 },
      );
    }

    if (serverNow > endTime) {
      return NextResponse.json(
        {
          error: `Attendance window has closed. The class concluded at ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Server clock: ${serverNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
          code: 'TIME_LOCK_EXPIRED',
        },
        { status: 403 },
      );
    }

    // ── 4. Verify rotating cryptographic token ────────────────────
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

    // ── 5. Validate 3D Geofence (Haversine <= 15m, Altitude <= 3m) ─
    const sessionLat =
      Number(classRow.session_latitude) || Number(classRow.latitude);
    const sessionLng =
      Number(classRow.session_longitude) || Number(classRow.longitude);
    const sessionAlt =
      classRow.session_altitude != null
        ? Number(classRow.session_altitude)
        : null;

    const geoResult = validate3DLocation({
      studentLat: latitude,
      studentLng: longitude,
      studentAlt: altitude,
      sessionLat,
      sessionLng,
      sessionAlt,
      maxDistance: 15,
      maxAltDiff: 3,
    });

    if (!geoResult.isValid) {
      return NextResponse.json(
        {
          error: geoResult.reason,
          distanceMeters: geoResult.distanceMeters,
          altitudeDiffMeters: geoResult.altitudeDiffMeters,
          horizontalPass: geoResult.horizontalPass,
          altitudePass: geoResult.altitudePass,
        },
        { status: 403 },
      );
    }

    // ── 6. Record attendance in database ──────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: attendanceRow, error: insertErr } = await (admin.from('attendance') as any)
      .insert({
        class_id: classId,
        student_id: user.id,
        status: 'present',
        verified_latitude: latitude,
        verified_longitude: longitude,
        verified_altitude: altitude,
        distance_meters: Math.round(geoResult.distanceMeters * 100) / 100,
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
        distanceMeters: geoResult.distanceMeters.toFixed(2),
        altitudeDiffMeters: geoResult.altitudeDiffMeters?.toFixed(2) ?? 'N/A',
        studentFloor: classRow.session_floor,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[attendance/check-in]', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}
