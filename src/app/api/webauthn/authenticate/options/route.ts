import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { storeChallenge } from '@/lib/webauthn/challenge-store';
import { getRpId, CHALLENGE_TTL_MS } from '@/lib/webauthn/config';
import { NextResponse } from 'next/server';

/**
 * Generates WebAuthn / Passkey authentication options for a user.
 *
 * Parameters received via:
 *  - Request JSON body: { email, rpId?, domain?, origin? }
 *  - URL parameters: ?email=...&rpId=...
 *
 * Server-side lookup:
 *  - Uses Supabase Service Role client (SUPABASE_SERVICE_ROLE_KEY)
 *  - Resolves user_id from profiles or auth.users via email
 *  - Queries passkeys table for registered passkey credentials
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

    // Initialize Supabase Admin client (Service Role, bypassing RLS)
    const adminDb = createAdminClient();

    // 1. Get profile/user ID from email
    let { data: profile } = await adminDb
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (!profile && email.toLowerCase() !== email) {
      const { data: pLower } = await adminDb
        .from('profiles')
        .select('id')
        .eq('email', email.toLowerCase())
        .single();
      if (pLower) {
        profile = pLower;
      }
    }

    if (!profile) {
      // Resolve user_id from auth.users fallback via email
      try {
        const { data: listData } = await adminDb.auth.admin.listUsers();
        const found = listData?.users?.find(
          (u) => u.email?.trim().toLowerCase() === email.trim().toLowerCase()
        );
        if (found) {
          profile = { id: found.id };
        }
      } catch {
        // ignore
      }
    }

    if (!profile) {
      return NextResponse.json(
        { error: 'No passkey registered for this account. Please sign in and register a passkey first.' },
        { status: 404 }
      );
    }

    // 2. Fetch credentials from passkeys table
    const { data: userPasskeys } = await adminDb
      .from('passkeys')
      .select('credential_id, public_key, counter')
      .eq('user_id', profile.id);

    if (!userPasskeys || userPasskeys.length === 0) {
      return NextResponse.json(
        { error: 'No passkey registered for this account. Please sign in and register a passkey first.' },
        { status: 404 }
      );
    }

    // 3. Generate challenge using SimpleWebAuthn
    const options = await generateAuthenticationOptions({
      rpID: dynamicRpId,
      userVerification: 'required',
      allowCredentials: userPasskeys.map((pk) => ({
        id: pk.credential_id,
      })),
    });

    // 4. Store challenge keyed by userId
    await storeChallenge(profile.id, options.challenge, CHALLENGE_TTL_MS);

    // Return options + userId for the verify step
    return NextResponse.json({ ...options, _userId: profile.id });
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
