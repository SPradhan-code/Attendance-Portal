'use client';

/**
 * AttendanceWebAuthn
 *
 * Student-facing component for biometric attendance verification.
 * The student is already logged in; this component adds a second
 * biometric gate before inserting the attendance record.
 *
 * Flow:
 *   1. Student taps "Mark Attendance"
 *   2. useWebAuthn.authenticate() → prompts Touch ID / Face ID
 *   3. Server verifies assertion (identityCheckOnly = true)
 *   4. Client POSTs to /api/attendance/mark with the classId
 *   5. Supabase RLS double-checks the time window server-side
 */

import { useState } from 'react';
import { useWebAuthn } from '@/hooks/useWebAuthn';

interface Props {
  classId: string;
  className: string;
  studentEmail: string;
  onSuccess?: () => void;
}

type Status = 'idle' | 'biometric' | 'submitting' | 'success' | 'error';

export function AttendanceWebAuthn({
  classId,
  className: courseName,
  studentEmail,
  onSuccess,
}: Props) {
  const { loading, authenticate } = useWebAuthn();
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string>('');

  const handleMarkAttendance = async () => {
    setStatus('biometric');
    setMessage('');

    // ── Step 1: Biometric verification ───────────────────────────
    const dynamicRpId = typeof window !== 'undefined' ? window.location.hostname : undefined;
    const dynamicOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
    const result = await authenticate(studentEmail, /* identityCheckOnly */ true, {
      rpId: dynamicRpId,
      domain: dynamicRpId,
      origin: dynamicOrigin,
    });

    if (!result.success) {
      setStatus('error');
      setMessage('Biometric verification failed. Please try again.');
      return;
    }

    // ── Step 2: Insert attendance record ─────────────────────────
    setStatus('submitting');

    try {
      const res = await fetch('/api/attendance/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: classId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to record attendance.');
      }

      setStatus('success');
      setMessage('Attendance recorded successfully! ✓');
      onSuccess?.();
    } catch (err: unknown) {
      setStatus('error');
      setMessage(
        err instanceof Error ? err.message : 'Could not record attendance.',
      );
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const isDisabled = loading || status === 'submitting' || status === 'success';

  return (
    <div className="space-y-3">
      <button
        id={`btn-attend-${classId}`}
        type="button"
        onClick={handleMarkAttendance}
        disabled={isDisabled}
        className="
          group relative w-full overflow-hidden rounded-xl
          bg-gradient-to-r from-emerald-600 to-teal-600
          px-4 py-2.5 text-sm font-semibold text-white
          shadow-lg shadow-emerald-600/20
          transition-all duration-200
          hover:from-emerald-500 hover:to-teal-500 hover:-translate-y-0.5
          disabled:opacity-60 disabled:cursor-not-allowed
        "
      >
        {/* Shimmer overlay */}
        <span
          aria-hidden="true"
          className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full"
        />

        <span className="relative flex items-center justify-center gap-2">
          {status === 'biometric' && (
            <>
              <FingerprintIcon className="h-4 w-4 animate-pulse" />
              Waiting for biometric…
            </>
          )}
          {status === 'submitting' && (
            <>
              <SpinnerIcon className="h-4 w-4" />
              Recording…
            </>
          )}
          {status === 'success' && '✓ Attendance Recorded'}
          {(status === 'idle' || status === 'error') && (
            <>
              <FingerprintIcon className="h-4 w-4" />
              Mark Attendance
            </>
          )}
        </span>
      </button>

      {/* Status message */}
      {message && (
        <p
          role="status"
          className={`text-xs text-center ${
            status === 'success' ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {message}
        </p>
      )}

      {/* Security label */}
      {status === 'idle' && (
        <p className="text-center text-[10px] text-gray-600">
          🔐 Biometric verification required · {courseName}
        </p>
      )}
    </div>
  );
}

// ── Small inline SVG icons ────────────────────────────────────────────────────

function FingerprintIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 1C7 1 3 5 3 10c0 4.5 2 8.5 5.5 11" />
      <path d="M12 1c5 0 9 4 9 9 0 4.5-2 8.5-5.5 11" />
      <path d="M12 6a4 4 0 0 1 4 4c0 3-1.5 5.5-4 7" />
      <path d="M12 6a4 4 0 0 0-4 4c0 3 1.5 5.5 4 7" />
      <line x1="12" y1="10" x2="12" y2="17" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}
