import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { consumeChallenge } from '@/lib/webauthn/challenge-store';
import { getRpId, getOrigin } from '@/lib/webauthn/config';
import { NextResponse } from 'next/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { WebAuthnCredential } from '@/types/database';

/**
 * POST /api/webauthn/authenticate/verify
 *
 * Body: {
 *   credential: AuthenticationResponseJSON;
 *   _userId: string;
 *   identityCheckOnly?: boolean;
 *   rpId?: string;
 *   domain?: string;
 *   origin?: string;
 * }
 *
 * Verifies the assertion response, updates the counter, and either:
 *  - Returns a Supabase one-time token (login flow)
 *  - Returns { verified: true } (identity-check for attendance)
 *
 * Dynamically resolves rpId/domain and origin.
 */
export async function POST(request: Request) {
  try {
    const body: {
      credential: AuthenticationResponseJSON;
      _userId: string;
      identityCheckOnly?: boolean;
      rpId?: string;
      domain?: string;
      origin?: string;
    } = await request.json();

    const { credential, _userId: userId, identityCheckOnly = false } = body;

    if (!credential || !userId) {
      return NextResponse.json(
        { error: 'Missing credential or userId.' },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    // ── 1. Fetch stored credential ─────────────────────────────────
    let storedCred: WebAuthnCredential | null = null;

    // Check passkeys table first
    const { data: passkeyRow } = await admin
      .from('passkeys')
      .select('credential_id, public_key, counter, created_at')
      .eq('user_id', userId)
      .eq('credential_id', credential.id)
      .maybeSingle();

    if (passkeyRow) {
      storedCred = {
        id: passkeyRow.credential_id,
        publicKey: passkeyRow.public_key,
        counter: Number(passkeyRow.counter ?? 0),
        registeredAt: passkeyRow.created_at || new Date().toISOString(),
      };
    } else {
      // Fallback: check profiles table
      const { data: profileRow } = await admin
        .from('profiles')
        .select('webauthn_credential')
        .eq('id', userId)
        .maybeSingle();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      storedCred = (profileRow as any)?.webauthn_credential ?? null;
    }

    if (!storedCred) {
      return NextResponse.json(
        { error: 'Credential not found.' },
        { status: 404 },
      );
    }

    // ── 2. Consume the challenge (replay protection) ───────────────
    const expectedChallenge = await consumeChallenge(userId);
    if (!expectedChallenge) {
      return NextResponse.json(
        { error: 'Challenge expired or not found. Please try again.' },
        { status: 400 },
      );
    }

    // ── 3. Cryptographic verification ─────────────────────────────
    const dynamicRpId = body.rpId || body.domain || getRpId(request);
    const dynamicOrigin = body.origin || getOrigin(request);

    const expectedRPIDs = Array.from(
      new Set(
        [
          dynamicRpId,
          getRpId(request),
          process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID,
          'attendance-portal-jade.vercel.app',
        ].filter(Boolean) as string[],
      ),
    );

    const expectedOrigins = Array.from(
      new Set(
        [
          dynamicOrigin,
          getOrigin(request),
          process.env.NEXT_PUBLIC_APP_URL,
          'https://attendance-portal-jade.vercel.app',
        ].filter(Boolean) as string[],
      ),
    );

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: expectedRPIDs,
      requireUserVerification: true,
      credential: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: isoBase64URL.toBuffer(storedCred.id) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        publicKey: isoBase64URL.toBuffer(storedCred.publicKey) as any,
        counter: storedCred.counter,
        transports: storedCred.transports,
      },
    });

    const { verified, authenticationInfo } = verification;

    if (!verified) {
      return NextResponse.json(
        { error: 'Biometric verification failed.' },
        { status: 401 },
      );
    }

    // ── 4. Update counter (prevents cloned-authenticator attacks) ──
    const updatedCred: WebAuthnCredential = {
      ...storedCred,
      counter: authenticationInfo.newCounter,
    };

    // Update in passkeys table
    try {
      await admin
        .from('passkeys')
        .update({ counter: authenticationInfo.newCounter })
        .eq('user_id', userId)
        .eq('credential_id', credential.id);
    } catch (passkeyUpdateErr) {
      console.warn('[webauthn/authenticate/verify] passkeys counter update warning:', passkeyUpdateErr);
    }

    // Also update profiles table
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from('profiles') as any)
        .update({ webauthn_credential: updatedCred })
        .eq('id', userId);
    } catch {
      // Non-fatal
    }

    // ── 5a. Identity-check only (e.g. student attendance) ──────────
    if (identityCheckOnly) {
      return NextResponse.json({ verified: true });
    }

    // ── 5b. Login flow: mint a Supabase session via one-time link ──
    const { data: userData } = await admin.auth.admin.getUserById(userId);
    const email = userData?.user?.email;

    if (!email) {
      return NextResponse.json(
        { error: 'Could not determine user email.' },
        { status: 500 },
      );
    }

    const redirectOrigin = dynamicOrigin || getOrigin(request);

    const { data: linkData, error: linkErr } =
      await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo: `${redirectOrigin}/auth/callback`,
        },
      });

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error('[webauthn/authenticate/verify] generateLink failed:', linkErr);
      return NextResponse.json(
        { error: 'Failed to create session token.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      verified: true,
      token_hash: linkData.properties.hashed_token,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err || 'Internal server error during authentication.');
    console.error('[webauthn/authenticate/verify]', msg, err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
