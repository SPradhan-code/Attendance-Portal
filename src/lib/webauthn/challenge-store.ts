/**
 * Server-side WebAuthn challenge store backed by Supabase `webauthn_challenges` table.
 *
 * Falls back transparently to the in-memory Map when the table doesn't exist yet,
 * so local dev works without running the migration.
 *
 * Production note: the `webauthn_challenges` table must exist for multi-instance
 * (Vercel serverless) deployments; see supabase/migrations/003_webauthn_challenges.sql.
 */

import { createAdminClient } from '@/lib/supabase/admin';

interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// In-memory fallback (dev / missing table)
// ---------------------------------------------------------------------------
const memStore = new Map<string, ChallengeEntry>();

if (typeof globalThis.__webauthnCleanupRegistered === 'undefined') {
  globalThis.__webauthnCleanupRegistered = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memStore.entries()) {
      if (now > entry.expiresAt) memStore.delete(key);
    }
  }, 5 * 60 * 1_000);
}

// ---------------------------------------------------------------------------
// Supabase-backed store
// ---------------------------------------------------------------------------
async function dbStore(
  userId: string,
  challenge: string,
  ttlMs: number,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from('webauthn_challenges') as any).upsert(
      { user_id: userId, challenge, expires_at: expiresAt },
      { onConflict: 'user_id' },
    );
    if (error) {
      // Table might not exist — fall back silently
      if ((error.code === '42P01') || error.message?.includes('does not exist')) return false;
      console.warn('[challenge-store] DB upsert warning:', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function dbConsume(userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.from('webauthn_challenges') as any)
      .select('challenge, expires_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if ((error.code === '42P01') || error.message?.includes('does not exist')) return null;
      console.warn('[challenge-store] DB select warning:', error.message);
      return null;
    }

    if (!data) return null;

    // Delete immediately (replay protection)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from('webauthn_challenges') as any).delete().eq('user_id', userId);

    if (new Date(data.expires_at).getTime() < Date.now()) return null;
    return data.challenge as string;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API — mirrors original in-memory API exactly
// ---------------------------------------------------------------------------

/**
 * Persist a challenge for a given user.
 * Tries Supabase first; falls back to in-memory if the table doesn't exist.
 */
export async function storeChallenge(
  userId: string,
  challenge: string,
  ttlMs = 60_000,
): Promise<void> {
  const saved = await dbStore(userId, challenge, ttlMs);
  // Always also write to memory so local dev / fallback works
  memStore.set(userId, { challenge, expiresAt: Date.now() + ttlMs });
  if (!saved) {
    console.debug('[challenge-store] Using in-memory fallback (Supabase table not available).');
  }
}

/**
 * Retrieve and immediately destroy the challenge for a user.
 * Returns `null` if not found or expired (replay protection).
 */
export async function consumeChallenge(userId: string): Promise<string | null> {
  // Try DB first (authoritative across serverless instances)
  const dbChallenge = await dbConsume(userId);
  if (dbChallenge) {
    memStore.delete(userId); // keep in sync
    return dbChallenge;
  }

  // Fall back to in-memory (local dev or table doesn't exist)
  const entry = memStore.get(userId);
  memStore.delete(userId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}
