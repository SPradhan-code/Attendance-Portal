import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { storeChallenge } from '@/lib/webauthn/challenge-store';
import { getRpId, CHALLENGE_TTL_MS } from '@/lib/webauthn/config';
import { NextResponse } from 'next/server';
import type { AuthenticatorTransportFuture, WebAuthnCredential } from '@/types/database';

/**
 * Generates WebAuthn / Passkey authentication options for a user.
 *
 * Parameters received via:
 *  - Request JSON body: { email, rpId?, domain?, origin? }
 *  - URL parameters: ?email=...&rpId=...
 *
 * Server-side lookup:
 *  - Uses Supabase Service Role key (SUPABASE_SERVICE_ROLE_KEY)
 *  - Queries profiles table and auth.admin to find the user
 *  - Queries user's registered passkey credentials (profiles & user_passkeys)
 *  - Wraps in try/catch and returns explicit JSON error messages ({ error: err.message })
 */
async function handleGenerateOptions(request: Request) {
  try {
    let email = '';
    let rpId: string | undefined;
    let domain: string | undefined;
    let origin: string | undefined;

    // 1. Extract parameters from URL searchParams
    try {
      const url = new URL(request.url);
      const queryEmail = url.searchParams.get('email');
      if (queryEmail) email = queryEmail.trim();
      if (url.searchParams.get('rpId')) rpId = url.searchParams.get('rpId')!;
      if (url.searchParams.get('domain')) domain = url.searchParams.get('domain')!;
      if (url.searchParams.get('origin')) origin = url.searchParams.get('origin')!;
    } catch {
      // Ignore URL parsing errors
    }

    // 2. Extract parameters from JSON body if present (e.g. POST requests)
    if (request.method !== 'GET') {
      try {
        const body = await request.json();
        if (body && typeof body === 'object') {
          if (body.email && typeof body.email === 'string') {
            email = body.email.trim();
          }
          if (body.rpId && typeof body.rpId === 'string') rpId = body.rpId.trim();
          if (body.domain && typeof body.domain === 'string') domain = body.domain.trim();
          if (body.origin && typeof body.origin === 'string') origin = body.origin.trim();
        }
      } catch {
        // Body is optional or empty when passed as URL search params
      }
    }

    if (!email) {
      return NextResponse.json(
        { error: 'Email address is required to get authentication options.' },
        { status: 400 },
      );
    }

    const dynamicRpId = rpId || domain || getRpId(request);

    // 3. Initialize Supabase Admin client with SUPABASE_SERVICE_ROLE_KEY
    let admin;
    try {
      admin = createAdminClient();
    } catch (clientErr: unknown) {
      const msg = clientErr instanceof Error ? clientErr.message : String(clientErr);
      console.error('[webauthn/authenticate/options] Admin client init error:', msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const normalizedEmail = email.toLowerCase();

    // 4. Look up user by email server-side
    let userId: string | null = null;
    let cred: WebAuthnCredential | null = null;

    // Fast path: Check profiles table by email
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profileByEmail, error: profileErr } = await (admin.from('profiles') as any)
        .select('id, webauthn_credential')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (profileErr) {
        console.warn(
          '[webauthn/authenticate/options] profiles query warning:',
          profileErr.message,
        );
      } else if (profileByEmail) {
        userId = profileByEmail.id;
        cred = (profileByEmail as any)?.webauthn_credential ?? null;
      }
    } catch (err) {
      console.warn('[webauthn/authenticate/options] profiles lookup exception:', err);
    }

    // Fallback path: search auth.users via admin.auth.admin.listUsers across pages
    if (!userId) {
      let page = 1;
      const perPage = 50;
      while (page <= 20) {
        const { data: listData, error: listErr } = await admin.auth.admin.listUsers({
          page,
          perPage,
        });

        if (listErr) {
          throw new Error(`Failed to query user accounts: ${listErr.message}`);
        }

        if (!listData?.users?.length) {
          break;
        }

        const found = listData.users.find(
          (u) => u.email?.trim().toLowerCase() === normalizedEmail,
        );

        if (found) {
          userId = found.id;
          // Best-effort backfill email into profiles table so future lookups are O(1)
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin.from('profiles') as any)
              .update({ email: normalizedEmail })
              .eq('id', found.id);
          } catch {
            // Non-fatal if update fails
          }
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
        { error: 'No account found with this email. Please check your email or sign in with password.' },
        { status: 404 },
      );
    }

    // 5. Look up user's registered passkey credentials
    if (!cred) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: profileRow, error: pRowErr } = await (admin.from('profiles') as any)
          .select('webauthn_credential')
          .eq('id', userId)
          .maybeSingle();

        if (!pRowErr && profileRow) {
          cred = (profileRow as any)?.webauthn_credential ?? null;
        }
      } catch (err) {
        console.warn('[webauthn/authenticate/options] profiles by userId exception:', err);
      }
    }

    const allowCredentials: Array<{
      id: string;
      transports?: AuthenticatorTransportFuture[];
    }> = [];

    if (cred && cred.id) {
      allowCredentials.push({
        id: cred.id,
        transports: cred.transports,
      });
    }

    // Check user_passkeys table as well (if present)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: passkeys } = await (admin.from('user_passkeys') as any)
        .select('id, credential_id, transports')
        .eq('user_id', userId);

      if (passkeys && Array.isArray(passkeys)) {
        for (const pk of passkeys) {
          const credId = pk.credential_id || pk.id;
          if (credId && !allowCredentials.some((c) => c.id === credId)) {
            allowCredentials.push({
              id: credId,
              transports: pk.transports as AuthenticatorTransportFuture[] | undefined,
            });
          }
        }
      }
    } catch {
      // user_passkeys table might not exist in database, non-fatal
    }

    if (allowCredentials.length === 0) {
      return NextResponse.json(
        { error: 'No passkey registered for this account. Please sign in and register a passkey first.' },
        { status: 404 },
      );
    }

    // 6. Generate challenge using SimpleWebAuthn
    const options = await generateAuthenticationOptions({
      rpID: dynamicRpId,
      userVerification: 'required',
      allowCredentials: allowCredentials.map((c) => ({
        id: c.id,
        transports: c.transports,
      })),
    });

    // 7. Store challenge keyed by userId
    await storeChallenge(userId, options.challenge, CHALLENGE_TTL_MS);

    // Return options + userId for the verify step
    return NextResponse.json({ ...options, _userId: userId });
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err || 'Failed to generate authentication options.');

    console.error('[webauthn/authenticate/options] Error generating options:', errorMessage, err);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleGenerateOptions(request);
}

export async function POST(request: Request) {
  return handleGenerateOptions(request);
}
