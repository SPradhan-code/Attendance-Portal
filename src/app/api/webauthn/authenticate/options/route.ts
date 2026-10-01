import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { storeChallenge } from '@/lib/webauthn/challenge-store';
import { getRpId, CHALLENGE_TTL_MS } from '@/lib/webauthn/config';
import { NextResponse } from 'next/server';
import type { WebAuthnCredential } from '@/types/database';

/**
 * POST /api/webauthn/authenticate/options
 *
 * Body: { email: string, rpId?: string, domain?: string, origin?: string }
 *
 * Looks up the user's stored WebAuthn credential and returns
 * PublicKeyCredentialRequestOptions for the browser to use with
 * `startAuthentication()`.
 *
 * Dynamically resolves rpId/domain from client or request header.
 *
 * Used for both:
 *  - Admin login (before a Supabase session exists)
 *  - Student attendance biometric check (existing session)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'email is required.' }, { status: 400 });
    }

    const dynamicRpId = body.rpId || body.domain || getRpId(request);

    const admin = createAdminClient();

    const normalizedEmail = email.trim().toLowerCase();

    // ── 1. Look up the user's credential ───────────────────────────
    // Fast path: Try querying profiles by email if stored
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profileByEmail } = await (admin.from('profiles') as any)
      .select('id, webauthn_credential')
      .eq('email', normalizedEmail)
      .maybeSingle();

    let userId: string | null = profileByEmail?.id ?? null;
    let cred: WebAuthnCredential | null =
      (profileByEmail as any)?.webauthn_credential ?? null;

    // Fallback path: search auth.users via listUsers across pages
    if (!userId) {
      let page = 1;
      const perPage = 50;
      while (true) {
        const { data: listData, error: listErr } = await admin.auth.admin.listUsers({
          page,
          perPage,
        });

        if (listErr || !listData?.users?.length) {
          break;
        }

        const found = listData.users.find(
          (u) => u.email?.trim().toLowerCase() === normalizedEmail,
        );

        if (found) {
          userId = found.id;
          // Backfill email into profiles table so future lookups are O(1)
          await (admin.from('profiles') as any)
            .update({ email: normalizedEmail })
            .eq('id', found.id);
          break;
        }

        if (listData.users.length < perPage) {
          break;
        }
        page++;
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'No passkey found for this account. Register a passkey first.' },
        { status: 404 },
      );
    }

    // If credential was not retrieved in profile-by-email lookup, query profiles by userId
    if (!cred) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profileRow } = await (admin.from('profiles') as any)
        .select('webauthn_credential')
        .eq('id', userId)
        .maybeSingle();

      cred = (profileRow as any)?.webauthn_credential ?? null;
    }

    if (!cred) {
      return NextResponse.json(
        { error: 'No passkey registered for this account.' },
        { status: 404 },
      );
    }

    // ── 3. Generate challenge ──────────────────────────────────────
    const options = await generateAuthenticationOptions({
      rpID: dynamicRpId,
      userVerification: 'required',
      allowCredentials: [
        {
          id: cred.id, // base64url string — SimpleWebAuthn v10+ accepts this
          transports: cred.transports,
        },
      ],
    });

    // ── 4. Store challenge keyed by userId ─────────────────────────
    storeChallenge(userId, options.challenge, CHALLENGE_TTL_MS);

    // Return options + userId for the verify step.
    return NextResponse.json({ ...options, _userId: userId });
  } catch (err) {
    console.error('[webauthn/authenticate/options]', err);
    return NextResponse.json(
      { error: 'Failed to generate authentication options.' },
      { status: 500 },
    );
  }
}
