'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useWebAuthn } from '@/hooks/useWebAuthn';
import { calculateHaversineDistance } from '@/lib/geo/geofence';
import type { Class, Profile } from '@/types/database';

function CheckInContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const classId = searchParams.get('classId');
  const token = searchParams.get('token');

  const [studentProfile, setStudentProfile] = useState<Profile | null>(null);
  const [classInfo, setClassInfo] = useState<Class | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [locating, setLocating] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Student GPS state
  const [studentCoords, setStudentCoords] = useState<{
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;
  } | null>(null);

  // Computed 3D telemetry
  const [telemetry, setTelemetry] = useState<{
    distanceMeters: number;
    altitudeDiffMeters: number | null;
    horizontalPass: boolean;
    altitudePass: boolean;
  } | null>(null);

  const [checkInResult, setCheckInResult] = useState<{
    success: boolean;
    timestamp: string;
    distanceMeters: string;
    altitudeDiffMeters: string;
  } | null>(null);

  const { authenticate, loading: isWebAuthnLoading } = useWebAuthn();

  // 1. Initial auth & class session load
  useEffect(() => {
    async function init() {
      if (!classId || !token) {
        setErrorMsg('Invalid QR code scan. Missing class ID or rotating token.');
        setLoading(false);
        return;
      }

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        // Redirect to login preserving check-in URL
        const currentUrl = window.location.pathname + window.location.search;
        router.push(`/login?redirectTo=${encodeURIComponent(currentUrl)}`);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profile } = await (supabase.from('profiles') as any)
        .select('*')
        .eq('id', user.id)
        .single();

      setStudentProfile(profile as Profile);

      // Fetch active class session coordinates
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: cls, error: clsErr } = await (supabase.from('classes') as any)
        .select('*')
        .eq('id', classId)
        .single();

      if (clsErr || !cls) {
        setErrorMsg('Class not found.');
        setLoading(false);
        return;
      }

      if (!cls.is_session_active) {
        setErrorMsg('The professor has not yet started or has ended this class session.');
        setLoading(false);
        return;
      }

      setClassInfo(cls as Class);
      setLoading(false);
    }

    init();
  }, [classId, token, router]);

  // 2. Request student's live location
  const captureLocation = useCallback(() => {
    if (!classInfo) return;
    setErrorMsg(null);
    setLocating(true);

    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported by your browser.');
      setLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude, altitude, accuracy } = pos.coords;

        setStudentCoords({
          latitude,
          longitude,
          altitude: altitude != null ? altitude : null,
          accuracy,
        });

        // Compute Haversine horizontal distance
        const sessionLat = Number(classInfo.session_latitude ?? classInfo.latitude);
        const sessionLng = Number(classInfo.session_longitude ?? classInfo.longitude);
        const sessionAlt = classInfo.session_altitude != null ? Number(classInfo.session_altitude) : null;

        const distanceMeters = calculateHaversineDistance(
          latitude,
          longitude,
          sessionLat,
          sessionLng,
        );

        const horizontalPass = distanceMeters <= 15;

        // Compute vertical altitude difference
        let altitudePass = true;
        let altitudeDiffMeters: number | null = null;

        if (altitude != null && sessionAlt != null) {
          altitudeDiffMeters = Math.abs(altitude - sessionAlt);
          altitudePass = altitudeDiffMeters <= 3.0; // 3 meters max allowed floor diff
        }

        setTelemetry({
          distanceMeters,
          altitudeDiffMeters,
          horizontalPass,
          altitudePass,
        });
      },
      (err) => {
        setLocating(false);
        setErrorMsg(
          `Location access denied (${err.message}). High accuracy GPS is required to verify physical attendance.`,
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  }, [classInfo]);

  // Automatically trigger location capture once class info is loaded
  useEffect(() => {
    if (classInfo && !studentCoords && !locating) {
      captureLocation();
    }
  }, [classInfo, studentCoords, locating, captureLocation]);

  // 3. Trigger WebAuthn Biometric & Record Attendance
  const handleBiometricCheckIn = async () => {
    if (!studentProfile || !classInfo || !studentCoords || !telemetry) return;
    if (!telemetry.horizontalPass || !telemetry.altitudePass) return;

    setErrorMsg(null);
    setSubmitting(true);

    try {
      // Prompt device biometric authentication via WebAuthn hook
      const biometricRes = await authenticate(studentProfile.email ?? '', true);

      if (!biometricRes.success) {
        throw new Error(
          biometricRes.error ||
            'Biometric verification was cancelled or failed. Please authenticate with your fingerprint or passkey.',
        );
      }

      // Send telemetry and token to backend for server-side verification and attendance insert
      const res = await fetch('/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: classInfo.id,
          token,
          latitude: studentCoords.latitude,
          longitude: studentCoords.longitude,
          altitude: studentCoords.altitude,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to record attendance.');
      }

      setCheckInResult({
        success: true,
        timestamp: data.telemetry?.timestamp || new Date().toISOString(),
        distanceMeters: data.telemetry?.distanceMeters || telemetry.distanceMeters.toFixed(2),
        altitudeDiffMeters:
          data.telemetry?.altitudeDiffMeters ||
          (telemetry.altitudeDiffMeters != null ? telemetry.altitudeDiffMeters.toFixed(2) : 'N/A'),
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error during check-in.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mb-4" />
        <p className="text-sm text-gray-300">Validating class session and security token...</p>
      </div>
    );
  }

  // Success view
  if (checkInResult) {
    return (
      <div className="mx-auto max-w-md p-4 sm:p-6">
        <div className="rounded-3xl border border-emerald-500/30 bg-gradient-to-b from-emerald-950/40 via-gray-950 to-black p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-500/40 text-4xl shadow-lg shadow-emerald-500/20">
            ✓
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">Attendance Verified!</h2>
          <p className="text-xs text-emerald-400 mb-6 font-medium">
            3D Geofence & Biometric Verification Successful
          </p>

          <div className="mb-6 space-y-3 rounded-2xl border border-white/5 bg-white/5 p-4 text-left text-xs">
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-gray-400">Class:</span>
              <span className="font-semibold text-white">{classInfo?.name}</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-gray-400">Student:</span>
              <span className="font-semibold text-indigo-300">
                {studentProfile?.name} ({studentProfile?.roll_number ?? studentProfile?.email})
              </span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-gray-400">Horizontal Distance:</span>
              <span className="font-mono text-emerald-300">{checkInResult.distanceMeters} m (≤ 15m)</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-gray-400">Altitude Difference:</span>
              <span className="font-mono text-sky-300">{checkInResult.altitudeDiffMeters} m (≤ 3m)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Verified At:</span>
              <span className="text-gray-300">
                {new Date(checkInResult.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>

          <a
            href="/dashboard"
            className="inline-block w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3 text-sm font-semibold text-white shadow-lg transition hover:scale-[1.02]"
          >
            Go to My Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-gray-900 via-gray-950 to-black p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-2xl">
            📡
          </div>
          <h1 className="text-2xl font-bold text-white">3D Geofence Check-In</h1>
          <p className="mt-1 text-sm text-indigo-300 font-medium">{classInfo?.name}</p>
          <p className="text-xs text-gray-400">Floor {classInfo?.session_floor ?? 1}</p>
        </div>

        {errorMsg && (
          <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
            <span className="font-bold">Check-In Error:</span> {errorMsg}
          </div>
        )}

        {/* 3D Telemetry Radar Visualizer */}
        <div className="mb-6 rounded-2xl border border-white/5 bg-black/40 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            3D Proximity Telemetry
          </h3>

          <div className="space-y-4">
            {/* Horizontal distance meter */}
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-gray-300">Horizontal Distance (Haversine)</span>
                <span
                  className={`font-mono font-bold ${
                    telemetry
                      ? telemetry.horizontalPass
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                      : 'text-gray-500'
                  }`}
                >
                  {telemetry ? `${telemetry.distanceMeters.toFixed(1)} m` : 'Calculating...'}
                  {' '}(Limit: 15m)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
                <div
                  className={`h-full transition-all duration-500 ${
                    telemetry
                      ? telemetry.horizontalPass
                        ? 'bg-emerald-500'
                        : 'bg-rose-500'
                      : 'bg-indigo-500'
                  }`}
                  style={{
                    width: telemetry
                      ? `${Math.min(100, (telemetry.distanceMeters / 15) * 100)}%`
                      : '0%',
                  }}
                />
              </div>
            </div>

            {/* Vertical altitude / floor meter */}
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-gray-300">Vertical Altitude Delta (Floor Check)</span>
                <span
                  className={`font-mono font-bold ${
                    telemetry
                      ? telemetry.altitudeDiffMeters != null
                        ? telemetry.altitudePass
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                        : 'text-sky-300'
                      : 'text-gray-500'
                  }`}
                >
                  {telemetry
                    ? telemetry.altitudeDiffMeters != null
                      ? `${telemetry.altitudeDiffMeters.toFixed(1)} m`
                      : 'Matching Session Floor'
                    : 'Calculating...'}
                  {' '}(Limit: 3m)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
                <div
                  className={`h-full transition-all duration-500 ${
                    telemetry
                      ? telemetry.altitudeDiffMeters != null
                        ? telemetry.altitudePass
                          ? 'bg-emerald-500'
                          : 'bg-rose-500'
                        : 'bg-sky-500'
                      : 'bg-indigo-500'
                  }`}
                  style={{
                    width: telemetry
                      ? telemetry.altitudeDiffMeters != null
                        ? `${Math.min(100, (telemetry.altitudeDiffMeters / 3) * 100)}%`
                        : '100%'
                      : '0%',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Location refresh trigger */}
          <div className="mt-3 flex justify-between items-center text-[11px] text-gray-500">
            <span>
              {studentCoords
                ? `GPS accuracy: ±${studentCoords.accuracy.toFixed(0)}m`
                : 'Awaiting device location...'}
            </span>
            <button
              onClick={captureLocation}
              disabled={locating}
              className="text-indigo-400 underline hover:text-indigo-300"
            >
              {locating ? 'Acquiring...' : 'Refresh Location'}
            </button>
          </div>
        </div>

        {/* Validation Status message */}
        {telemetry && (
          <div className="mb-6">
            {telemetry.horizontalPass && telemetry.altitudePass ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                <span>✓</span>
                <span>
                  Within classroom perimeter on the correct floor. Ready for biometric check!
                </span>
              </div>
            ) : !telemetry.horizontalPass ? (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                <span>⚠️</span>
                <span>
                  Outside classroom perimeter ({telemetry.distanceMeters.toFixed(1)}m away).
                  Please walk into the classroom to mark attendance.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                <span>⚠️</span>
                <span>
                  Vertical altitude mismatch ({telemetry.altitudeDiffMeters?.toFixed(1)}m).
                  You must be on Floor {classInfo?.session_floor} to mark attendance.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Biometric Check-In Button */}
        <button
          onClick={handleBiometricCheckIn}
          disabled={
            !telemetry ||
            !telemetry.horizontalPass ||
            !telemetry.altitudePass ||
            submitting ||
            isWebAuthnLoading
          }
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 py-4 text-base font-bold text-white shadow-xl transition-all duration-200 hover:scale-[1.02] hover:brightness-110 disabled:opacity-40 disabled:hover:scale-100"
        >
          {submitting || isWebAuthnLoading ? (
            <>
              <svg className="h-5 w-5 animate-spin text-white" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Verifying Biometrics...
            </>
          ) : (
            <>
              <span>👆</span>
              <span>Verify Biometric & Mark Attendance</span>
            </>
          )}
        </button>

        <p className="mt-4 text-center text-xs text-gray-500">
          Uses native device WebAuthn (Touch ID, Face ID, or Windows Hello) + 3D GPS verification.
        </p>
      </div>
    </div>
  );
}

export default function CheckInPage() {
  return (
    <main className="min-h-screen py-10 px-4 flex items-center justify-center">
      <Suspense
        fallback={
          <div className="text-center text-gray-400">Loading check-in gateway...</div>
        }
      >
        <CheckInContent />
      </Suspense>
    </main>
  );
}
