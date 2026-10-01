import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { createClient } from '@/lib/supabase/server';
import { consumeChallenge } from '@/lib/webauthn/challenge-store';
import { getRpId, getOrigin } from '@/lib/webauthn/config';
import { NextResponse } from 'next/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { WebAuthnCredential } from '@/types/database';

/**
 * POST /api/webauthn/register/verify
 *
 * Body: { credential: RegistrationResponseJSON, rpId?: string, domain?: string, origin?: string }
 *
 * Verifies the attestation from the browser and saves the credential
 * to `profiles.webauthn_credential`. Requires an existing session.
 * Dynamically verifies rpId and origin without hardcoded localhost.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // ── 1. Authenticate the caller ────────────────────────────────
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    // ── 2. Parse body ──────────────────────────────────────────────
    const body: {
      credential: RegistrationResponseJSON;
      rpId?: string;
      domain?: string;
      origin?: string;
    } = await request.json();

    if (!body.credential) {
      return NextResponse.json({ error: 'Missing credential.' }, { status: 400 });
    }

    // ── 3. Consume the stored challenge (replay protection) ────────
    const expectedChallenge = consumeChallenge(user.id);
    if (!expectedChallenge) {
      return NextResponse.json(
        { error: 'Challenge expired or not found. Please try again.' },
        { status: 400 },
      );
    }

    // ── 4. Cryptographic verification ─────────────────────────────
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

    const verification = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: expectedRPIDs,
      requireUserVerification: true,
    });

    const { verified, registrationInfo } = verification;

    if (!verified || !registrationInfo) {
      return NextResponse.json(
        { error: 'Biometric verification failed.' },
        { status: 400 },
      );
    }

    // ── 5. Serialize credential for JSONB storage ─────────────────
    const { credential: regCred, aaguid } = registrationInfo;
    const storedCredential: WebAuthnCredential = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      id: isoBase64URL.fromBuffer(regCred.id as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      publicKey: isoBase64URL.fromBuffer(regCred.publicKey as any),
      counter: regCred.counter,
      transports: body.credential.response.transports as WebAuthnCredential['transports'],
      aaguid,
      registeredAt: new Date().toISOString(),
    };

    // ── 6. Persist to profiles ────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase.from('profiles') as any)
      .update({ webauthn_credential: storedCredential })
      .eq('id', user.id);

    if (updateError) {
      console.error('[webauthn/register/verify] DB update failed:', updateError);
      return NextResponse.json(
        { error: 'Failed to save credential.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ verified: true });
  } catch (err) {
    console.error('[webauthn/register/verify]', err);
    return NextResponse.json(
      { error: 'Internal server error during verification.' },
      { status: 500 },
    );
  }
}
