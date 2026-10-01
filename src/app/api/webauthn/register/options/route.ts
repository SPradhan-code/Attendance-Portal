import { generateRegistrationOptions } from '@simplewebauthn/server';
import { createClient } from '@/lib/supabase/server';
import { storeChallenge } from '@/lib/webauthn/challenge-store';
import {
  getRpId,
  RP_NAME,
  CHALLENGE_TTL_MS,
  AUTHENTICATOR_SELECTION,
} from '@/lib/webauthn/config';
import { NextResponse } from 'next/server';
import type { Profile, WebAuthnCredential } from '@/types/database';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    let user = null;
    const {
      data: { user: cookieUser },
      error: userErr,
    } = await supabase.auth.getUser();
    user = cookieUser;

    if (!user) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: tokenData } = await supabase.auth.getUser(token);
        if (tokenData?.user) {
          user = tokenData.user;
        }
      }
    }

    if (!user) {
      return NextResponse.json(
        { error: 'You must be signed in to register a passkey.' },
        { status: 401 },
      );
    }

    let body: { rpId?: string; domain?: string; origin?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional
    }

    // Dynamically resolve rpID from client payload or request host
    const dynamicRpId = body.rpId || body.domain || getRpId(request);

    // Fetch existing credential to exclude (prevent duplicate registration)
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('webauthn_credential, name')
      .eq('id', user.id)
      .returns<Pick<Profile, 'webauthn_credential' | 'name'>[]>()
      .single();

    const cred: WebAuthnCredential | null = profileRow?.webauthn_credential ?? null;

    const excludeCredentials = cred ? [{ id: cred.id, transports: cred.transports }] : [];

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: dynamicRpId,
      userID: new TextEncoder().encode(user.id),
      userName: user.email ?? user.id,
      userDisplayName: profileRow?.name ?? user.email ?? 'User',
      attestationType: 'none',
      authenticatorSelection: AUTHENTICATOR_SELECTION,
      excludeCredentials,
    });

    storeChallenge(user.id, options.challenge, CHALLENGE_TTL_MS);

    return NextResponse.json(options);
  } catch (err) {
    console.error('[webauthn/register/options]', err);
    return NextResponse.json(
      { error: 'Failed to generate registration options.' },
      { status: 500 },
    );
  }
}
