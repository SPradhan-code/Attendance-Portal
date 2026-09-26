'use client';

/**
 * useWebAuthn
 *
 * Reusable React hook that wraps @simplewebauthn/browser to provide:
 *   - `register()`     → prompts device biometrics for passkey registration
 *   - `authenticate()` → prompts device biometrics for login or identity check
 *
 * The hook calls the server-side API routes to generate challenges and
 * verify responses. All cryptographic heavy-lifting happens server-side.
 *
 * Usage:
 *   const { loading, error, register, authenticate, clearError } = useWebAuthn();
 */

import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WebAuthnState {
  loading: boolean;
  error: string | null;
}

export interface RegisterResult {
  success: boolean;
  /** User-friendly error message on failure. */
  error?: string;
}

export interface AuthenticateResult {
  success: boolean;
  /** token_hash returned by the verify route — exchange with verifyOtp() */
  token_hash?: string;
  /** User-friendly error message on failure. */
  error?: string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWebAuthn() {
  const [state, setState] = useState<WebAuthnState>({
    loading: false,
    error: null,
  });

  /** Convert native browser / network errors into user-friendly messages. */
  const friendlyError = (err: unknown): string => {
    if (err instanceof Error) {
      switch (err.name) {
        case 'NotAllowedError':
          return 'Biometric authentication was cancelled or not permitted.';
        case 'SecurityError':
          return 'Security error — make sure you are on a secure (HTTPS) origin.';
        case 'InvalidStateError':
          return 'A passkey is already registered on this device.';
        case 'AbortError':
          return 'The operation was aborted.';
        default:
          return err.message || 'An unknown WebAuthn error occurred.';
      }
    }
    return 'An unexpected error occurred.';
  };

  // ── register ──────────────────────────────────────────────────────────────

  /**
   * Register the current user's biometric as a passkey.
   * The user must already have a Supabase session.
   *
   * @returns RegisterResult with success flag and optional error message.
   */
  const register = useCallback(async (): Promise<RegisterResult> => {
    setState({ loading: true, error: null });

    try {
      // Step 1 — Fetch PublicKeyCredentialCreationOptions from server
      const optRes = await fetch('/api/webauthn/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!optRes.ok) {
        const { error } = await optRes.json().catch(() => ({}));
        throw new Error(error ?? 'Failed to get registration options.');
      }

      const options = await optRes.json();

      // Step 2 — Prompt native biometric (Touch ID, Face ID, Windows Hello…)
      const credential = await startRegistration({ optionsJSON: options });

      // Step 3 — Verify the attestation server-side
      const verifyRes = await fetch('/api/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });

      if (!verifyRes.ok) {
        const { error } = await verifyRes.json().catch(() => ({}));
        throw new Error(error ?? 'Passkey verification failed.');
      }

      setState({ loading: false, error: null });
      return { success: true };
    } catch (err) {
      const message = friendlyError(err);
      setState({ loading: false, error: message });
      return { success: false, error: message };
    }
  }, []);

  // ── authenticate ──────────────────────────────────────────────────────────

  /**
   * Verify identity using an existing passkey.
   *
   * @param email            The user's email address
   * @param identityCheckOnly If `true`, the server only verifies identity and
   *                          does NOT generate a new Supabase session token.
   *                          Use `true` for student attendance, `false` for login.
   * @returns AuthenticateResult with success, optional token_hash, and optional error.
   */
  const authenticate = useCallback(
    async (
      email: string,
      identityCheckOnly = false,
    ): Promise<AuthenticateResult> => {
      setState({ loading: true, error: null });

      try {
        // Step 1 — Fetch PublicKeyCredentialRequestOptions from server
        const optRes = await fetch('/api/webauthn/authenticate/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });

        if (!optRes.ok) {
          const { error } = await optRes.json().catch(() => ({}));
          throw new Error(error ?? 'Failed to get authentication options.');
        }

        const { _userId, ...options } = await optRes.json();

        // Step 2 — Prompt native biometric
        const credential = await startAuthentication({ optionsJSON: options });

        // Step 3 — Verify assertion server-side
        const verifyRes = await fetch('/api/webauthn/authenticate/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential, _userId, identityCheckOnly }),
        });

        if (!verifyRes.ok) {
          const { error } = await verifyRes.json().catch(() => ({}));
          throw new Error(error ?? 'Biometric authentication failed.');
        }

        const data = await verifyRes.json();
        setState({ loading: false, error: null });

        return { success: true, token_hash: data.token_hash };
      } catch (err) {
        const message = friendlyError(err);
        setState({ loading: false, error: message });
        return { success: false, error: message };
      }
    },
    [],
  );

  const clearError = useCallback(
    () => setState((s) => ({ ...s, error: null })),
    [],
  );

  return { ...state, register, authenticate, clearError };
}
