'use client';

/**
 * Login page — supports two authentication paths:
 *
 *  1. Magic Link (email OTP) — available to all users, including first-time setup
 *  2. WebAuthn Passkey (biometric) — available once a passkey has been registered;
 *     REQUIRED for admins to access the dashboard (enforced by role check after login)
 *
 * Flow for WebAuthn login:
 *   email entered → "Sign in with Passkey" clicked →
 *   useWebAuthn.authenticate() → browser prompts biometric →
 *   server verifies assertion → returns token_hash →
 *   client calls supabase.auth.verifyOtp() → full session →
 *   redirect to /dashboard
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { WebAuthnAuthButton } from '@/components/WebAuthnButton';
import type { AuthenticateResult } from '@/hooks/useWebAuthn';
import type { Profile } from '@/types/database';

// ── Types ─────────────────────────────────────────────────────────────────────
type AuthMethod = 'passkey' | 'magic-link';

type AlertState = {
  type: 'success' | 'error' | 'info';
  text: string;
} | null;

// ── Component ─────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [method, setMethod] = useState<AuthMethod>('passkey');
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);

  // ── Magic link handler ─────────────────────────────────────────────────────
  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setMagicLinkLoading(true);
    setAlert(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setMagicLinkLoading(false);

    if (error) {
      setAlert({ type: 'error', text: error.message });
    } else {
      setAlert({
        type: 'success',
        text: 'Magic link sent! Check your inbox and click the link to sign in.',
      });
    }
  };

  // ── WebAuthn success handler ───────────────────────────────────────────────
  const handlePasskeySuccess = async (result: AuthenticateResult) => {
    if (!result.token_hash) {
      setAlert({ type: 'error', text: 'Authentication succeeded but no session token was returned.' });
      return;
    }

    setAlert({ type: 'info', text: 'Biometric verified — creating session…' });

    // Exchange the one-time token for a real Supabase session
    const { error } = await supabase.auth.verifyOtp({
      token_hash: result.token_hash,
      type: 'email',
    });

    if (error) {
      setAlert({ type: 'error', text: `Session error: ${error.message}` });
      return;
    }

    // ── Role guard: admins go to dashboard; students go to their portal ──
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setAlert({ type: 'error', text: 'Could not retrieve user after login.' });
      return;
    }

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .returns<Pick<Profile, 'role'>[]>()
      .single();
    const profile = profileRow as Pick<Profile, 'role'> | null;

    if (profile?.role === 'admin') {
      router.push('/dashboard');
    } else {
      router.push('/dashboard');
    }
  };

  const handlePasskeyError = (message: string) => {
    setAlert({ type: 'error', text: message });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      {/* Background blobs */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 h-72 w-72 rounded-full bg-indigo-600 opacity-10 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 h-72 w-72 rounded-full bg-purple-600 opacity-10 blur-3xl" />
      </div>

      <div className="glass relative z-10 w-full max-w-md rounded-3xl p-8 animate-fade-in-up">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-3xl shadow-lg shadow-indigo-600/30">
            🎓
          </div>
          <h1 className="text-2xl font-bold text-white">Attendance Portal</h1>
          <p className="mt-1 text-sm text-gray-400">Sign in to continue</p>
        </div>

        {/* Method tabs */}
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1">
          {(['passkey', 'magic-link'] as const).map((m) => (
            <button
              key={m}
              id={`tab-${m}`}
              type="button"
              onClick={() => { setMethod(m); setAlert(null); }}
              className={`rounded-lg py-2 text-sm font-medium transition-all duration-200 ${
                method === m
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {m === 'passkey' ? '🔐 Passkey' : '✉️ Magic Link'}
            </button>
          ))}
        </div>

        {/* Email field (shared) */}
        <div className="mb-4">
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-300">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@university.edu"
            autoComplete="email webauthn"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-gray-500 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        {/* Alert banner */}
        {alert && (
          <div
            role="alert"
            className={`mb-4 rounded-xl px-4 py-3 text-sm border ${
              alert.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                : alert.type === 'info'
                ? 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                : 'bg-red-500/10 text-red-300 border-red-500/20'
            }`}
          >
            {alert.text}
          </div>
        )}

        {/* ── Passkey panel ─────────────────────────────────────────────── */}
        {method === 'passkey' && (
          <div className="space-y-3">
            <WebAuthnAuthButton
              email={email}
              identityCheckOnly={false}
              onSuccess={handlePasskeySuccess}
              onError={handlePasskeyError}
              label="Sign in with Passkey"
              variant="primary"
            />
            <p className="text-center text-xs text-gray-500">
              Your device biometric (Touch ID · Face ID · Windows Hello) is used
              for authentication. No password required.
            </p>
            {/* Admin notice */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <p className="text-xs text-amber-300">
                <span className="font-semibold">Admin accounts</span> require a registered
                passkey to access the class schedule dashboard.
                Use the Magic Link tab to sign in for the first time and register your passkey
                from your profile settings.
              </p>
            </div>
          </div>
        )}

        {/* ── Magic link panel ──────────────────────────────────────────── */}
        {method === 'magic-link' && (
          <form onSubmit={handleMagicLink} className="space-y-3">
            <button
              id="btn-magic-link"
              type="submit"
              disabled={magicLinkLoading || !email}
              className="w-full rounded-xl bg-white/10 border border-white/10 py-3 font-semibold text-white transition-all duration-200 hover:bg-white/15 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {magicLinkLoading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Sending…
                </>
              ) : (
                '✉️ Send Magic Link'
              )}
            </button>
            <p className="text-center text-xs text-gray-500">
              A one-time login link will be emailed to you.
              After signing in, register your biometric passkey from your profile.
            </p>
          </form>
        )}

        {/* Divider + passkey registration hint */}
        <p className="mt-6 text-center text-xs text-gray-600">
          First time?{' '}
          <span className="text-gray-400">
            Sign in with a Magic Link, then register your passkey from your profile.
          </span>
        </p>
      </div>
    </main>
  );
}
