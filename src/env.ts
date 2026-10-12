/**
 * src/env.ts
 *
 * Centralised, Zod-validated environment variable access.
 *
 * - Fails fast at startup (not lazily at runtime) if required vars are missing.
 * - Provides typed, named exports so all files import from here, never from
 *   `process.env` directly.
 * - NEXT_PUBLIC_* vars are safe to reference in both server and client bundles.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // ── Supabase ──────────────────────────────────────────────────────────────
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required (server-only)')
    .optional(),

  // ── WebAuthn / Passkeys ───────────────────────────────────────────────────
  NEXT_PUBLIC_WEBAUTHN_RP_ID: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // ── Session token ─────────────────────────────────────────────────────────
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters')
    .optional(),

  // ── Runtime ──────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // ── Vercel deployment (optional) ──────────────────────────────────────────
  VERCEL_URL: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Parsed, type-safe environment variables. */
function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(
      `\n[env] Invalid environment variables:\n${errors}\n\nCheck your .env.local file.\n`,
    );
  }

  return result.data;
}

// Evaluate once; throw at import time rather than deep inside a request handler.
export const env = parseEnv();

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/** True if running inside Node.js (server-side). */
export const isServer = typeof window === 'undefined';

/** True in production. */
export const isProd = env.NODE_ENV === 'production';
