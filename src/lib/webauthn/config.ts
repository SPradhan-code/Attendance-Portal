/**
 * WebAuthn Relying Party (RP) configuration.
 *
 * RP_ID   – must match the domain of the page that called `startRegistration`.
 *            Use "localhost" for local dev, your bare domain in production
 *            (e.g. "myapp.com" — NOT "https://myapp.com").
 * ORIGIN  – The full https:// origin. Multiple origins can be passed as an
 *            array to `verifyRegistrationResponse` / `verifyAuthenticationResponse`.
 */
export const RP_NAME = 'Attendance Portal';

export const RP_ID: string =
  process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID ?? 'localhost';

export const ORIGIN: string =
  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

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
