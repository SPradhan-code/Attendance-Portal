'use client';

/**
 * Login page — supports three authentication paths:
 *
 *  1. Password (default) — standard email + password via supabase.auth.signInWithPassword.
 *     Checks whether an admin has a registered biometric passkey on first login and
 *     redirects to /settings/passkey to register device biometrics if needed.
 *  2. WebAuthn Passkey (biometric) — instant one-touch login with Face ID / Touch ID / Windows Hello
 *     once registered.
 *  3. Magic Link (email OTP) — alternative email OTP path.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { WebAuthnAuthButton } from '@/components/WebAuthnButton';
import type { AuthenticateResult } from '@/hooks/useWebAuthn';
import type { Profile } from '@/types/database';

// ── Types ─────────────────────────────────────────────────────────────────────
type AuthMethod = 'password' | 'passkey' | 'magic-link';

type AlertState = {
  type: 'success' | 'error' | 'info';
  text: string;
} | null;

// ── Component ─────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [method, setMethod] = useState<AuthMethod>('password');
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);

  // Restore remembered email on initial mount
  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem('attendance_login_email');
      if (savedEmail) {
        setEmail(savedEmail);
      }
    } catch {
      // ignore localStorage restrictions
    }
  }, []);

  // ── Password handler (Default active) ──────────────────────────────────────
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setPasswordLoading(true);
    setAlert(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setPasswordLoading(false);

    if (error) {
      setAlert({ type: 'error', text: error.message });
      return;
    }

    try {
      localStorage.setItem('attendance_login_email', email);
    } catch {
      // ignore
    }

    // ── Check if user has a passkey registered ────────────────────────────────
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setAlert({ type: 'error', text: 'Could not retrieve user after login.' });
      return;
    }

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('role, webauthn_credential')
      .eq('id', user.id)
      .single();
    const profile = profileRow as (Pick<Profile, 'role' | 'webauthn_credential'>) | null;

    let hasPasskey = !!profile?.webauthn_credential;

    // Fallback check on user_passkeys table if present
    if (!hasPasskey) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: passkeys } = await (supabase.from('user_passkeys') as any)
          .select('id')
          .eq('user_id', user.id)
          .limit(1);
        if (passkeys && passkeys.length > 0) {
          hasPasskey = true;
        }
      } catch {
        // user_passkeys table might not exist
      }
    }

    // ── First-Time Admin Redirect ─────────────────────────────────────────────
    if (profile?.role === 'admin') {
      if (!hasPasskey) {
        // First-time admin with no passkey: immediately redirect to register biometrics
        router.push('/settings/passkey?reason=required&first_time=true');
      } else {
        router.push('/dashboard');
      }
    } else {
      router.push('/dashboard');
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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setAlert({ type: 'error', text: 'Could not retrieve user after login.' });
      return;
    }

    if (user.email) {
      try {
        localStorage.setItem('attendance_login_email', user.email);
      } catch {
        // ignore
      }
    }

    // Successful biometric login routes directly to dashboard
    router.push('/dashboard');
  };

  const handlePasskeyError = (message: string) => {
    setAlert({ type: 'error', text: message });
  };

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

        {/* Method tabs: Password default first */}
        <div className="mb-6 grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">
          {(['password', 'passkey', 'magic-link'] as const).map((m) => (
            <button
              key={m}
              id={`tab-${m}`}
              type="button"
              onClick={() => { setMethod(m); setAlert(null); }}
              className={`rounded-lg py-2 text-xs font-medium transition-all duration-200 ${
                method === m
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {m === 'password' ? '🔑 Password' : m === 'passkey' ? '🔐 Passkey' : '✉️ Magic Link'}
            </button>
          ))}
        </div>

        {/* Email field (shared across all methods) */}
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

        {/* ── Password panel (Default Active) ────────────────────────────── */}
        {method === 'password' && (
          <form onSubmit={handlePasswordLogin} className="space-y-3">
            <div className="relative">
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-300">
                Password
              </label>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-12 text-white placeholder-gray-500 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 bottom-3 text-gray-400 hover:text-gray-200 transition-colors"
              >
                {showPassword ? (
                  // Eye-off icon
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  // Eye icon
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <button
              id="btn-password-login"
              type="submit"
              disabled={passwordLoading || !email || !password}
              className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white transition-all duration-200 hover:bg-indigo-500 hover:-translate-y-0.5 shadow-lg shadow-indigo-600/30 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {passwordLoading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Signing in…
                </>
              ) : (
                '🔑 Sign in with Password'
              )}
            </button>
            <p className="text-center text-xs text-gray-500">
              Sign in with your email and password. First-time admins will be guided to set up biometric passkey.
            </p>
          </form>
        )}

        {/* ── Passkey panel (Future Biometric Logins) ────────────────────── */}
        {method === 'passkey' && (
          <div className="space-y-3">
            <WebAuthnAuthButton
              email={email}
              identityCheckOnly={false}
              rpId={typeof window !== 'undefined' ? window.location.hostname : undefined}
              domain={typeof window !== 'undefined' ? window.location.hostname : undefined}
              origin={typeof window !== 'undefined' ? window.location.origin : undefined}
              onSuccess={handlePasskeySuccess}
              onError={handlePasskeyError}
              label="Sign in with Passkey"
              variant="primary"
            />
            <p className="text-center text-xs text-gray-400">
              Instant login using your device biometric (Touch ID · Face ID · Windows Hello). No password required.
            </p>
            {!email && (
              <p className="text-center text-xs text-amber-400/90">
                Please enter your email above to authenticate with your registered passkey.
              </p>
            )}
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
            </p>
          </form>
        )}

        {/* First-time guidance */}
        <p className="mt-6 text-center text-xs text-gray-600">
          First time?{' '}
          <span className="text-gray-400">
            Sign in with Password, then register your biometric passkey.
          </span>
        </p>
      </div>
    </main>
  );
}
