/**
 * src/lib/auth.ts
 *
 * Shared authentication / authorisation helpers for API route handlers.
 *
 * Usage patterns:
 *
 *   // 1. Guard: requires any authenticated user
 *   const { user, supabase, error } = await requireUser(request);
 *   if (error) return error; // already a NextResponse with correct status
 *
 *   // 2. Guard: requires admin role
 *   const { user, supabase, error } = await requireAdmin(request);
 *   if (error) return error;
 *
 *   // 3. Higher-order wrapper (eliminates try/catch boilerplate)
 *   export const POST = withAuth(async (req, { user, supabase }) => {
 *     return NextResponse.json({ ok: true });
 *   });
 *
 *   export const POST = withAuth(async (req, { user, supabase }) => { ... }, {
 *     requireRole: 'admin',
 *   });
 */

import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthContext {
  user: User;
  supabase: SupabaseClient<Database>;
}

export interface AuthResult {
  user: User;
  supabase: SupabaseClient<Database>;
  /** Present only on failure — return this directly from your route handler. */
  error?: never;
}

export interface AuthFailure {
  user?: never;
  supabase?: never;
  /** A ready-to-return NextResponse with the appropriate HTTP status. */
  error: NextResponse;
}

export type AuthGuardResult = AuthResult | AuthFailure;

export interface WithAuthOptions {
  /** If set, the user's profile role must match this value. */
  requireRole?: 'admin' | 'student';
}

// ── Guards ────────────────────────────────────────────────────────────────────

/**
 * Verifies the request carries a valid Supabase session.
 * Returns the authenticated user + supabase client on success,
 * or a ready-to-return 401 NextResponse on failure.
 */
export async function requireUser(request: Request): Promise<AuthGuardResult> {
  void request; // request not needed for cookie-based auth; kept for symmetry
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return {
      error: NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401 },
      ),
    };
  }

  return { user, supabase } as AuthResult;
}

/**
 * Verifies the request is from an authenticated admin.
 * Queries the `profiles` table to check the role.
 * Returns a 401 if unauthenticated, 403 if the role is not 'admin'.
 */
export async function requireAdmin(request: Request): Promise<AuthGuardResult> {
  const userResult = await requireUser(request);
  if (userResult.error) return userResult;

  const { user, supabase } = userResult as AuthResult;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = (profile as { role?: string } | null)?.role;
  if (!profile || role !== 'admin') {
    return {
      error: NextResponse.json(
        { error: 'Admin access required.' },
        { status: 403 },
      ),
    };
  }

  return { user, supabase } as AuthResult;
}

// ── Higher-order wrapper ───────────────────────────────────────────────────────

type RouteHandler = (
  request: Request,
  ctx: AuthContext,
) => Promise<Response>;

/**
 * Wraps a route handler with authentication + optional role check + top-level
 * error handling.  Eliminates boilerplate auth + try/catch from every route.
 *
 * @example
 * export const POST = withAuth(async (req, { user, supabase }) => {
 *   const body = await req.json();
 *   // ... your logic ...
 *   return NextResponse.json({ ok: true });
 * });
 */
export function withAuth(
  handler: RouteHandler,
  options: WithAuthOptions = {},
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const guardResult =
        options.requireRole === 'admin'
          ? await requireAdmin(request)
          : await requireUser(request);

      if (guardResult.error) return guardResult.error;

      // Role check when a non-admin role is explicitly required
      if (options.requireRole && options.requireRole !== 'admin') {
        const { supabase, user } = guardResult as AuthResult;
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        const role = (profile as { role?: string } | null)?.role;
        if (!profile || role !== options.requireRole) {
          return NextResponse.json(
            { error: `Role '${options.requireRole}' required.` },
            { status: 403 },
          );
        }
      }

      return await handler(request, guardResult as AuthResult);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Internal server error.';
      console.error('[withAuth] Unhandled error:', message, err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
