/**
 * Server-side, in-memory WebAuthn challenge store.
 *
 * Each challenge is keyed by user ID (UUID), stored with a TTL,
 * and consumed (deleted) on first read to prevent replay attacks.
 *
 * ⚠️  Production note: Replace with Redis or a `webauthn_challenges`
 *     Supabase table when running multiple Next.js instances.
 */

interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
}

// Module-level singleton — survives between hot-reloads in dev via module cache.
const store = new Map<string, ChallengeEntry>();

/** Periodically evict expired entries so the Map doesn't grow unbounded. */
if (typeof globalThis.__webauthnCleanupRegistered === 'undefined') {
  globalThis.__webauthnCleanupRegistered = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.expiresAt) store.delete(key);
    }
  }, 5 * 60 * 1_000);
}

/**
 * Persist a challenge for a given user.
 * @param userId  – Supabase user UUID
 * @param challenge – base64url challenge string from SimpleWebAuthn
 * @param ttlMs   – time-to-live in milliseconds (default 60 s)
 */
export function storeChallenge(
  userId: string,
  challenge: string,
  ttlMs = 60_000,
): void {
  store.set(userId, { challenge, expiresAt: Date.now() + ttlMs });
}

/**
 * Retrieve and immediately destroy the challenge for a user.
 * Returns `null` if not found or expired (replay protection).
 */
export function consumeChallenge(userId: string): string | null {
  const entry = store.get(userId);
  store.delete(userId); // always delete — replay protection
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}
