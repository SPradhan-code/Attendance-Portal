import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { consumeChallenge } from '@/lib/webauthn/challenge-store';
import { getRpId, getOrigin } from '@/lib/webauthn/config';
import { NextResponse } from 'next/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

/**
 * POST /api/webauthn/register/verify
 *
 * Verifies and saves passkey registration credentials directly to the
 * authenticated user's ID obtained from server session context.
 *
 * Handles both:
 *  - Direct credential payload: { credentialId, publicKey }
 *  - Standard WebAuthn attestation: { credential: RegistrationResponseJSON }
 */
export async function POST(req: Request) {
  try {
    const supabase = await createServerClient();
    let {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    // Fallback: Check Authorization Bearer header if cookie lookup missed
    if (!user) {
      const authHeader = req.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: tokenData, error: tokenErr } = await supabase.auth.getUser(token);
        if (tokenData?.user) {
          user = tokenData.user;
          authErr = null;
        } else if (tokenErr) {
          authErr = tokenErr;
        }
      }
    }

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    let credentialId: string | undefined =
      body.credentialId || body.credential_id;
    let publicKey: string | undefined =
      body.publicKey || body.public_key;
    let counter = 0;

    // Standard WebAuthn response verification if credential object is provided
    if (body.credential) {
      const credential = body.credential as RegistrationResponseJSON;
      const expectedChallenge = await consumeChallenge(user.id);
      if (!expectedChallenge) {
        return NextResponse.json(
          { error: 'Challenge expired or not found. Please try again.' },
          { status: 400 },
        );
      }

      const dynamicRpId = body.rpId || body.domain || getRpId(req);
      const dynamicOrigin = body.origin || getOrigin(req);

      const expectedRPIDs = Array.from(
        new Set(
          [
            dynamicRpId,
            getRpId(req),
            process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID,
            'attendance-portal-jade.vercel.app',
          ].filter(Boolean) as string[],
        ),
      );

      const expectedOrigins = Array.from(
        new Set(
          [
            dynamicOrigin,
            getOrigin(req),
            process.env.NEXT_PUBLIC_APP_URL,
            'https://attendance-portal-jade.vercel.app',
          ].filter(Boolean) as string[],
        ),
      );

      const verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: expectedRPIDs,
        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return NextResponse.json(
          { error: 'Biometric verification failed.' },
          { status: 400 },
        );
      }

      const { credential: regCred } = verification.registrationInfo;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      credentialId = isoBase64URL.fromBuffer(regCred.id as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      publicKey = isoBase64URL.fromBuffer(regCred.publicKey as any);
      counter = regCred.counter;
    }

    if (!credentialId || !publicKey) {
      return NextResponse.json(
        { error: 'Missing credentialId or publicKey in request body.' },
        { status: 400 },
      );
    }

    const adminDb = createAdminClient();

    const { error: insertErr } = await adminDb
      .from('passkeys')
      .upsert(
        {
          user_id: user.id,
          credential_id: credentialId,
          public_key: publicKey,
          counter: counter ?? 0,
        },
        { onConflict: 'credential_id' },
      );

    if (insertErr) {
      console.error('[webauthn/register/verify] Failed to save passkey:', insertErr);
      return NextResponse.json({ error: 'Failed to save passkey' }, { status: 500 });
    }

    // Best-effort update profiles table for backward compatibility
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminDb.from('profiles') as any).update({
        webauthn_credential: {
          id: credentialId,
          publicKey,
          counter: counter ?? 0,
          registeredAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }).eq('id', user.id);
    } catch {
      // Non-fatal if profiles update fails
    }

    return NextResponse.json({ success: true, verified: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error during verification.';
    console.error('[webauthn/register/verify] Unexpected error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
