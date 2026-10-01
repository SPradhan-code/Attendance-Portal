'use client';

/**
 * useWebAuthn
 *
 * Reusable React hook and helper functions that wrap @simplewebauthn/browser to provide:
 *   - `register()`     → prompts device biometrics for passkey registration
 *   - `authenticate()` → prompts device biometrics for login or identity check
 *
 * Uses window.location.hostname dynamically for rpId/domain and window.location.origin
 * dynamically for origin. No hardcoded localhost references remain.
 */

import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PasskeyCustomOptions {
  rpId?: string;
  domain?: string;
  origin?: string;
}

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

// ── Passkey / WebAuthn Helper Functions ────────────────────────────────────────

/**
 * Dynamically retrieves browser passkey configuration (rpId, domain, origin).
 * Uses window.location.hostname and window.location.origin.
 */
export function getPasskeyBrowserConfig() {
  const hostname =
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : '';
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';

  return {
    rpId: hostname,
    domain: hostname,
    origin,
    rpOrigins: origin ? [origin] : [],
  };
}

/** Convert native browser / network errors into user-friendly messages. */
export function friendlyWebAuthnError(err: unknown): string {
  if (err instanceof Error) {
    switch (err.name) {
      case 'NotAllowedError':
        return 'Biometric authentication was cancelled or not permitted.';
      case 'SecurityError':
        return 'Security error — make sure you are on a secure (HTTPS) origin or supported domain.';
      case 'InvalidStateError':
        return 'A passkey is already registered on this device.';
      case 'AbortError':
        return 'The operation was aborted.';
      default:
        return err.message || 'An unknown WebAuthn error occurred.';
    }
  }
  return 'An unexpected error occurred.';
}

/**
 * Helper to register a passkey using dynamic rpId/domain & origin.
 */
export async function registerWebAuthnPasskey(
  customOptions?: PasskeyCustomOptions,
): Promise<RegisterResult> {
  const config = getPasskeyBrowserConfig();
  const targetRpId = customOptions?.rpId || customOptions?.domain || config.rpId;
  const targetOrigin = customOptions?.origin || config.origin;

  // Retrieve active Supabase session to pass Bearer token in headers
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.access_token) {
    authHeaders['Authorization'] = `Bearer ${session.access_token}`;
  }

  // Step 1 — Fetch PublicKeyCredentialCreationOptions from server
  const optRes = await fetch('/api/webauthn/register/options', {
    method: 'POST',
    headers: authHeaders,
    credentials: 'include',
    body: JSON.stringify({
      rpId: targetRpId,
      domain: targetRpId,
      origin: targetOrigin,
    }),
  });

  if (!optRes.ok) {
    const errorData = await optRes.json().catch(() => ({}));
    throw new Error(errorData.error ?? 'Failed to get registration options.');
  }

  const options = await optRes.json();

  // Ensure rp.id dynamically uses window.location.hostname
  if (targetRpId && options.rp) {
    options.rp.id = targetRpId;
  }

  // Step 2 — Prompt native biometric (Touch ID, Face ID, Windows Hello…)
  const credential = await startRegistration({ optionsJSON: options });

  // Step 3 — Verify the attestation server-side and persist credential
  const verifyRes = await fetch('/api/webauthn/register/verify', {
    method: 'POST',
    headers: authHeaders,
    credentials: 'include',
    body: JSON.stringify({
      credential,
      rpId: targetRpId,
      domain: targetRpId,
      origin: targetOrigin,
    }),
  });

  if (!verifyRes.ok) {
    const errorData = await verifyRes.json().catch(() => ({}));
    const message = errorData.error || errorData.message || 'Passkey verification failed.';
    console.error('[useWebAuthn] Verification failed with server response:', message, errorData);
    throw new Error(message);
  }

  return { success: true };
}

/**
 * Helper to authenticate with a passkey using dynamic rpId/domain & origin.
 */
export async function authenticateWebAuthnPasskey(
  email: string,
  identityCheckOnly = false,
  customOptions?: PasskeyCustomOptions,
): Promise<AuthenticateResult> {
  const config = getPasskeyBrowserConfig();
  const targetRpId = customOptions?.rpId || customOptions?.domain || config.rpId;
  const targetOrigin = customOptions?.origin || config.origin;

  // Step 1 — Fetch PublicKeyCredentialRequestOptions from server
  const optRes = await fetch('/api/webauthn/authenticate/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      rpId: targetRpId,
      domain: targetRpId,
      origin: targetOrigin,
    }),
  });

  if (!optRes.ok) {
    const { error } = await optRes.json().catch(() => ({}));
    throw new Error(error ?? 'Failed to get authentication options.');
  }

  const { _userId, ...options } = await optRes.json();

  // Ensure rpId dynamically uses window.location.hostname
  if (targetRpId) {
    options.rpId = targetRpId;
  }

  // Step 2 — Prompt native biometric
  const credential = await startAuthentication({ optionsJSON: options });

  // Step 3 — Verify assertion server-side
  const verifyRes = await fetch('/api/webauthn/authenticate/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credential,
      _userId,
      identityCheckOnly,
      rpId: targetRpId,
      domain: targetRpId,
      origin: targetOrigin,
    }),
  });

  if (!verifyRes.ok) {
    const { error } = await verifyRes.json().catch(() => ({}));
    throw new Error(error ?? 'Biometric authentication failed.');
  }

  const data = await verifyRes.json();
  return { success: true, token_hash: data.token_hash };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWebAuthn() {
  const [state, setState] = useState<WebAuthnState>({
    loading: false,
    error: null,
  });

  // ── register ──────────────────────────────────────────────────────────────
  const register = useCallback(
    async (customOptions?: PasskeyCustomOptions): Promise<RegisterResult> => {
      setState({ loading: true, error: null });

      try {
        const result = await registerWebAuthnPasskey(customOptions);
        setState({ loading: false, error: null });
        return result;
      } catch (err) {
        const message = friendlyWebAuthnError(err);
        setState({ loading: false, error: message });
        return { success: false, error: message };
      }
    },
    [],
  );

  // ── authenticate ──────────────────────────────────────────────────────────
  const authenticate = useCallback(
    async (
      email: string,
      identityCheckOnly = false,
      customOptions?: PasskeyCustomOptions,
    ): Promise<AuthenticateResult> => {
      setState({ loading: true, error: null });

      try {
        const result = await authenticateWebAuthnPasskey(
          email,
          identityCheckOnly,
          customOptions,
        );
        setState({ loading: false, error: null });
        return result;
      } catch (err) {
        const message = friendlyWebAuthnError(err);
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
