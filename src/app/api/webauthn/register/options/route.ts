import { generateRegistrationOptions } from '@simplewebauthn/server';
import { createClient } from '@/lib/supabase/server';
import { storeChallenge } from '@/lib/webauthn/challenge-store';
import {
  RP_ID,
  RP_NAME,
  CHALLENGE_TTL_MS,
  AUTHENTICATOR_SELECTION,
} from '@/lib/webauthn/config';
import { NextResponse } from 'next/server';
import type { Profile, WebAuthnCredential } from '@/types/database';

export async function POST() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        { error: 'You must be signed in to register a passkey.' },
        { status: 401 },
      );
    }

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
      rpID: RP_ID,
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
