/**
 * WebAuthn Relying Party (RP) configuration.
 *
 * Dynamically resolves rpId/domain and origin from the browser window (client-side)
 * or from request headers and environment variables (server-side).
 * No hardcoded localhost references remain.
 */

export const RP_NAME = 'Attendance Portal';

/**
 * Dynamically resolve the RP ID (domain name without port/protocol).
 * Client-side: returns `window.location.hostname`.
 * Server-side: checks request host header, environment variable, or fallback.
 */
export function getRpId(reqOrHost?: Request | string | null): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname;
  }

  if (reqOrHost) {
    if (typeof reqOrHost === 'string') {
      return reqOrHost.split(':')[0];
    }
    const host =
      reqOrHost.headers.get('x-forwarded-host') ||
      reqOrHost.headers.get('host');
    if (host) {
      return host.split(':')[0];
    }
  }

  if (process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID) {
    return process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID;
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      return new URL(process.env.NEXT_PUBLIC_APP_URL).hostname;
    } catch {
      // ignore
    }
  }

  if (process.env.VERCEL_URL) {
    return process.env.VERCEL_URL.split(':')[0];
  }

  return '';
}

/**
 * Dynamically resolve the Origin (protocol + host + port).
 * Client-side: returns `window.location.origin`.
 * Server-side: checks request origin/referer/proto+host headers, or environment variables.
 */
export function getOrigin(reqOrOrigin?: Request | string | null): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  if (reqOrOrigin) {
    if (typeof reqOrOrigin === 'string') {
      try {
        return new URL(reqOrOrigin).origin;
      } catch {
        return reqOrOrigin;
      }
    }

    const headerOrigin = reqOrOrigin.headers.get('origin');
    if (headerOrigin) return headerOrigin;

    const referer = reqOrOrigin.headers.get('referer');
    if (referer) {
      try {
        return new URL(referer).origin;
      } catch {
        // ignore
      }
    }

    const host =
      reqOrOrigin.headers.get('x-forwarded-host') ||
      reqOrOrigin.headers.get('host');
    const proto =
      reqOrOrigin.headers.get('x-forwarded-proto') || 'https';
    if (host) {
      return `${proto}://${host}`;
    }
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return '';
}

/**
 * Returns dynamic WebAuthn / Passkey configuration parameters.
 * - rpId & domain use window.location.hostname (or dynamic server host).
 * - origin uses window.location.origin (or dynamic server origin).
 */
export function getDynamicPasskeyConfig(reqOrHost?: Request | string | null) {
  const rpId = getRpId(reqOrHost);
  const origin = getOrigin(reqOrHost);
  return {
    rpId,
    domain: rpId,
    origin,
    rpOrigins: origin ? [origin] : [],
  };
}

/**
 * Dynamic getters for RP_ID and ORIGIN for backwards compatibility.
 * Dynamically resolves instead of hardcoding to localhost.
 */
export const RP_ID: string =
  typeof window !== 'undefined' && window.location?.hostname
    ? window.location.hostname
    : process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID ||
      (process.env.NEXT_PUBLIC_APP_URL
        ? (() => {
            try {
              return new URL(process.env.NEXT_PUBLIC_APP_URL).hostname;
            } catch {
              return '';
            }
          })()
        : '');

export const ORIGIN: string =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

/** How long (ms) a challenge is valid before it expires. */
export const CHALLENGE_TTL_MS = 60_000; // 60 seconds

/**
 * Authenticator selection criteria.
 * `platform`  → device biometrics (Touch ID, Face ID, Windows Hello).
 * `cross-platform` → security keys (YubiKey, etc.).
 */
export const AUTHENTICATOR_SELECTION = {
  authenticatorAttachment: 'platform',
  requireResidentKey: false,
  userVerification: 'required',
} as const;
