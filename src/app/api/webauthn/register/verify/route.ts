import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
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
 * to `profiles.webauthn_credential` (and `user_passkeys` if present).
 *
 * Ensures active session / auth.uid() is retrieved and logs detailed errors.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // ── 1. Authenticate the caller & retrieve auth.uid() ──────────
    let user = null;
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    user = userData?.user ?? null;

    // Fallback: Check Authorization Bearer header if cookie lookup missed
    if (!user) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: tokenData, error: tokenErr } = await supabase.auth.getUser(token);
        if (tokenData?.user) {
          user = tokenData.user;
          console.log('[webauthn/register/verify] Successfully authenticated via Bearer token:', user.id);
        } else if (tokenErr) {
          console.error('[webauthn/register/verify] Bearer token verification failed:', tokenErr.message);
        }
      }
    }

    if (!user || !user.id) {
      console.error(
        '[webauthn/register/verify] Unauthorized: No active Supabase session (auth.uid()) found:',
        userErr?.message || 'Missing user in session'
      );
      return NextResponse.json(
        { error: 'Unauthorized: Active Supabase session (auth.uid()) is required to register a passkey.' },
        { status: 401 }
      );
    }

    const userId = user.id;
    console.log('[webauthn/register/verify] Active session confirmed for auth.uid():', userId);

    // ── 2. Parse body ──────────────────────────────────────────────
    const body: {
      credential: RegistrationResponseJSON;
      rpId?: string;
      domain?: string;
      origin?: string;
    } = await request.json();

    if (!body.credential) {
      console.error('[webauthn/register/verify] Missing credential in request body.');
      return NextResponse.json({ error: 'Missing credential in request body.' }, { status: 400 });
    }

    // ── 3. Consume the stored challenge (replay protection) ────────
    const expectedChallenge = consumeChallenge(userId);
    if (!expectedChallenge) {
      console.error('[webauthn/register/verify] Challenge expired or not found for user:', userId);
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
      console.error('[webauthn/register/verify] Biometric cryptographic verification failed.');
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

    // ── 6. Persist credential to DB with try/catch & error logging ──
    let saveSuccess = false;
    let lastError: unknown = null;

    // A. Update public.profiles table (JSONB column: webauthn_credential)
    try {
      console.log(`[webauthn/register/verify] Updating profiles table for auth.uid(): ${userId}...`);
      
      // 1. Try with user's authenticated Supabase client (enforcing RLS)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: profileUpdateError } = await (supabase.from('profiles') as any)
        .update({
          webauthn_credential: storedCredential,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (profileUpdateError) {
        console.error(
          '[webauthn/register/verify] profiles update via session client failed:',
          profileUpdateError.message || profileUpdateError,
          profileUpdateError
        );
        lastError = profileUpdateError;

        // 2. Fallback to admin service-role client (bypasses RLS)
        try {
          const admin = createAdminClient();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: adminUpdateError } = await (admin.from('profiles') as any)
            .update({
              webauthn_credential: storedCredential,
              updated_at: new Date().toISOString(),
            })
            .eq('id', userId);

          if (adminUpdateError) {
            console.error(
              '[webauthn/register/verify] profiles update via admin client failed:',
              adminUpdateError.message || adminUpdateError,
              adminUpdateError
            );
            lastError = adminUpdateError;
          } else {
            console.log('[webauthn/register/verify] Successfully updated profiles.webauthn_credential via admin client.');
            saveSuccess = true;
          }
        } catch (adminClientErr: unknown) {
          console.error('[webauthn/register/verify] admin client error on profiles:', adminClientErr);
        }
      } else {
        console.log('[webauthn/register/verify] Successfully updated profiles.webauthn_credential via session client.');
        saveSuccess = true;
      }
    } catch (err: unknown) {
      console.error(
        '[webauthn/register/verify] Exception while updating profiles table:',
        err
      );
      lastError = err;
    }

    // B. Check/Insert into user_passkeys table (if present in database)
    try {
      console.log(`[webauthn/register/verify] Checking/inserting into user_passkeys for auth.uid(): ${userId}...`);
      const passkeyRecord = {
        user_id: userId,
        id: storedCredential.id,
        credential_id: storedCredential.id,
        public_key: storedCredential.publicKey,
        counter: storedCredential.counter,
        transports: storedCredential.transports,
        aaguid: storedCredential.aaguid,
        created_at: storedCredential.registeredAt,
      };

      // Try with user's authenticated Supabase client
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: userPasskeysError } = await (supabase.from('user_passkeys') as any)
        .upsert(passkeyRecord, { onConflict: 'id' });

      if (userPasskeysError) {
        console.error(
          '[webauthn/register/verify] user_passkeys upsert via session client failed:',
          userPasskeysError.message || userPasskeysError,
          userPasskeysError
        );

        // Try with admin service-role client
        try {
          const admin = createAdminClient();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: adminPasskeysError } = await (admin.from('user_passkeys') as any)
            .upsert(passkeyRecord, { onConflict: 'id' });

          if (adminPasskeysError) {
            console.error(
              '[webauthn/register/verify] user_passkeys upsert via admin client failed:',
              adminPasskeysError.message || adminPasskeysError,
              adminPasskeysError
            );
          } else {
            console.log('[webauthn/register/verify] Successfully saved to user_passkeys table via admin client.');
            saveSuccess = true;
          }
        } catch (adminClientErr: unknown) {
          console.error('[webauthn/register/verify] admin client error on user_passkeys:', adminClientErr);
        }
      } else {
        console.log('[webauthn/register/verify] Successfully saved to user_passkeys table via session client.');
        saveSuccess = true;
      }
    } catch (passkeyErr: unknown) {
      console.log(
        '[webauthn/register/verify] Note: user_passkeys insert check skipped or table does not exist:',
        passkeyErr
      );
    }

    if (!saveSuccess) {
      const errObj = lastError as { message?: string; error_description?: string; details?: string };
      const errorMessage =
        errObj?.message || errObj?.error_description || errObj?.details || 'Database update failed.';
      console.error(
        '[webauthn/register/verify] FAILED TO SAVE CREDENTIAL. Exact error message:',
        errorMessage,
        lastError
      );
      return NextResponse.json(
        {
          error: `Failed to save credential: ${errorMessage}`,
          details: lastError,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ verified: true });
  } catch (err: unknown) {
    console.error('[webauthn/register/verify] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error during verification.' },
      { status: 500 },
    );
  }
}
