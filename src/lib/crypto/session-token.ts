import crypto from 'crypto';

export const ROTATING_WINDOW_MS = 3000; // 3 seconds
export const ALLOWED_DRIFT_WINDOWS = 2; // Allow ±2 windows (up to 9 seconds) for scan/network delay

/**
 * Returns the current rotating time step (incremented every 3000ms)
 */
export function getCurrentTimeStep(timestamp = Date.now()): number {
  return Math.floor(timestamp / ROTATING_WINDOW_MS);
}

/**
 * Generates a rotating cryptographic token for a class session.
 * Recomputes every 3 seconds.
 */
export function generateRotatingToken(
  classId: string,
  secret: string,
  timestamp = Date.now(),
): { token: string; timeStep: number; expiresAt: number } {
  const timeStep = getCurrentTimeStep(timestamp);
  const data = `${classId}:${timeStep}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  const token = `${timeStep}.${signature}`;
  const expiresAt = (timeStep + 1) * ROTATING_WINDOW_MS;

  return { token, timeStep, expiresAt };
}

/**
 * Cryptographically verifies a rotating token for a class session.
 * Rejects expired tokens or mismatched signatures.
 */
export function verifyRotatingToken(
  classId: string,
  token: string,
  secret: string,
  maxWindowDrift = ALLOWED_DRIFT_WINDOWS,
  currentTimestamp = Date.now(),
): { valid: boolean; reason?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Missing or malformed token.' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'Invalid token format.' };
  }

  const [timeStepStr, providedSig] = parts;
  const tokenTimeStep = parseInt(timeStepStr, 10);

  if (isNaN(tokenTimeStep)) {
    return { valid: false, reason: 'Invalid token time step.' };
  }

  const currentStep = getCurrentTimeStep(currentTimestamp);
  const drift = Math.abs(currentStep - tokenTimeStep);

  if (drift > maxWindowDrift) {
    return {
      valid: false,
      reason: `QR code expired. The token is older than the allowed rotating window (${(drift * ROTATING_WINDOW_MS) / 1000}s old). Scan the fresh QR code on screen.`,
    };
  }

  // Recalculate HMAC for the claimed token time step
  const expectedData = `${classId}:${tokenTimeStep}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(expectedData)
    .digest('base64url');

  try {
    const isMatch = crypto.timingSafeEqual(
      Buffer.from(providedSig),
      Buffer.from(expectedSig),
    );

    if (!isMatch) {
      return { valid: false, reason: 'Cryptographic signature mismatch.' };
    }
  } catch {
    return { valid: false, reason: 'Cryptographic verification failed.' };
  }

  return { valid: true };
}
