'use client';

/**
 * WebAuthnRegisterButton
 *
 * Drop-in button that prompts the user to register their device biometric
 * as a WebAuthn passkey. Requires an existing Supabase session.
 *
 * Props:
 *   onSuccess  – called when registration succeeds
 *   onError    – called with a user-friendly error string
 *   className  – optional extra CSS classes
 */

import { useWebAuthn } from '@/hooks/useWebAuthn';
import type { AuthenticateResult } from '@/hooks/useWebAuthn';

interface Props {
  onSuccess?: () => void;
  onError?: (message: string) => void;
  className?: string;
}

export function WebAuthnRegisterButton({ onSuccess, onError, className }: Props) {
  const { loading, register, clearError } = useWebAuthn();

  const handleClick = async () => {
    clearError();
    const result = await register();
    if (result.success) {
      onSuccess?.();
    } else if (result.error) {
      // Use result.error (synchronous return value) instead of the stale
      // hook error state, which may not have updated yet in this closure.
      onError?.(result.error);
    }
  };

  return (
    <button
      id="btn-webauthn-register"
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`
        group relative flex w-full items-center justify-center gap-3
        rounded-xl border border-indigo-500/30 bg-indigo-500/10
        px-6 py-3 font-semibold text-indigo-200
        transition-all duration-200
        hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:-translate-y-0.5
        disabled:opacity-60 disabled:cursor-not-allowed
        ${className ?? ''}
      `}
    >
      {loading ? (
        <>
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Waiting for biometric…
        </>
      ) : (
        <>
          {/* Fingerprint icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-indigo-300 transition group-hover:scale-110"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 1a9 9 0 0 1 9 9c0 5.5-3 10.5-9 13C6 20.5 3 15.5 3 10a9 9 0 0 1 9-9z" />
            <path d="M12 5a5 5 0 0 1 5 5c0 3-1.5 5.5-5 7-3.5-1.5-5-4-5-7a5 5 0 0 1 5-5z" />
            <line x1="12" y1="9" x2="12" y2="15" />
          </svg>
          Register Biometric Passkey
        </>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebAuthnAuthButton
 *
 * Prompts the user to authenticate with their registered passkey.
 *
 * Props:
 *   email            – the user's email (required to look up their credential)
 *   identityCheckOnly – when true, only verifies identity (no new session)
 *   onSuccess        – called with the token_hash (for login) or undefined (identity-check)
 *   onError          – called with error message
 *   label            – button label (default: "Sign in with Passkey")
 */

interface AuthProps {
  email: string;
  identityCheckOnly?: boolean;
  onSuccess?: (result: AuthenticateResult) => void;
  onError?: (message: string) => void;
  label?: string;
  variant?: 'primary' | 'ghost';
  className?: string;
}

export function WebAuthnAuthButton({
  email,
  identityCheckOnly = false,
  onSuccess,
  onError,
  label,
  variant = 'primary',
  className,
}: AuthProps) {
  const { loading, authenticate, clearError } = useWebAuthn();

  const handleClick = async () => {
    if (!email) {
      onError?.('Enter your email first.');
      return;
    }
    clearError();
    const result = await authenticate(email, identityCheckOnly);
    if (result.success) {
      onSuccess?.(result);
    } else if (result.error) {
      // Use result.error (synchronous return value) — not stale hook state.
      onError?.(result.error);
    }
  };

  const baseStyles = `
    group relative flex w-full items-center justify-center gap-3
    rounded-xl px-6 py-3 font-semibold
    transition-all duration-200
    hover:-translate-y-0.5
    disabled:opacity-60 disabled:cursor-not-allowed
  `;

  const variantStyles =
    variant === 'primary'
      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-600/30 hover:from-indigo-500 hover:to-purple-500'
      : 'border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10';

  return (
    <button
      id="btn-webauthn-auth"
      type="button"
      onClick={handleClick}
      disabled={loading || !email}
      className={`${baseStyles} ${variantStyles} ${className ?? ''}`}
    >
      {loading ? (
        <>
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Verifying biometric…
        </>
      ) : (
        <>
          {/* Touch ID / Face ID icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 transition group-hover:scale-110"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <path d="M3 17v1a3 3 0 0 0 3 3h1" />
            <path d="M7 3H6a3 3 0 0 0-3 3v1" />
          </svg>
          {label ?? (identityCheckOnly ? 'Verify Identity' : 'Sign in with Passkey')}
        </>
      )}
    </button>
  );
}
