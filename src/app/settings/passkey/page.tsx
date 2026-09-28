'use client';

/**
 * /settings/passkey  –  Passkey management page
 *
 * Allows logged-in users (admin and student) to register their device
 * biometric as a WebAuthn passkey. Also shows the current credential
 * metadata (registration date, AAGUID) if one exists.
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { WebAuthnRegisterButton } from '@/components/WebAuthnButton';
import type { Profile, WebAuthnCredential } from '@/types/database';

function PasskeySettingsContent() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isRequired = searchParams.get('reason') === 'required';
  const isFirstTime = searchParams.get('first_time') === 'true';

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [justRegistered, setJustRegistered] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.push('/login');
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(data);
      setLoading(false);
    });
  }, [router, supabase]);

  const handleRegisterSuccess = async () => {
    // Reload profile to show updated credential
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    if (user.email) {
      try {
        localStorage.setItem('attendance_login_email', user.email);
      } catch {
        // ignore localStorage errors
      }
    }

    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    setProfile(data);
    setJustRegistered(true);
    setToast({
      type: 'success',
      text: 'Biometric passkey registered successfully! Redirecting to dashboard…',
    });

    // Automatically navigate to dashboard after successful registration
    setTimeout(() => {
      router.push('/dashboard');
    }, 1800);
  };

  const handleRegisterError = (message: string) => {
    setToast({ type: 'error', text: message });
    setTimeout(() => setToast(null), 6000);
  };

  const cred: WebAuthnCredential | null = profile?.webauthn_credential ?? null;
  const showBanner = (isRequired || isFirstTime || (profile?.role === 'admin' && !cred)) && !justRegistered;

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-lg">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-gray-500">
          <a href="/dashboard" className="hover:text-gray-300 transition">Dashboard</a>
          <span className="mx-2">/</span>
          <span className="text-gray-300">Passkey Settings</span>
        </nav>

        {/* Action Required Banner for First-Time / Unregistered Admins */}
        {showBanner && (
          <div className="mb-6 overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-amber-600/10 to-transparent p-6 shadow-xl shadow-amber-500/5 animate-fade-in-up">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 text-2xl border border-amber-500/30">
                ⚠️
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-amber-300">
                  Action Required: Register Biometrics
                </h2>
                <p className="mt-1 text-xs text-amber-200/80 leading-relaxed">
                  {profile?.role === 'admin'
                    ? 'Admin accounts require a registered biometric passkey (Face ID, Touch ID, or Windows Hello) to access the professor dashboard. Please click "Register Biometrics" below to complete setup.'
                    : 'Please register your biometric passkey to verify your identity and enable one-tap attendance.'}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 border border-amber-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                    Biometrics Pending
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="glass rounded-3xl p-8">
          {/* Header */}
          <div className="mb-8 flex items-start gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl shadow-lg shadow-indigo-600/30">
              🔐
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Biometric Passkey</h1>
              <p className="mt-0.5 text-sm text-gray-400">
                Register your device biometric (Touch ID, Face ID, Windows Hello) for
                passwordless sign-in and attendance verification.
              </p>
            </div>
          </div>

          {/* Current credential status */}
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-300 uppercase tracking-wider">
              Current Passkey
            </h2>
            {cred ? (
              <div className="space-y-2 text-sm">
                <StatusRow label="Status">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    Registered
                  </span>
                </StatusRow>
                <StatusRow label="Registered on">
                  <span className="text-gray-300">
                    {new Date(cred.registeredAt).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'long', day: 'numeric',
                    })}
                  </span>
                </StatusRow>
                {cred.aaguid && cred.aaguid !== '00000000-0000-0000-0000-000000000000' && (
                  <StatusRow label="Authenticator ID">
                    <span className="font-mono text-xs text-gray-400">{cred.aaguid}</span>
                  </StatusRow>
                )}
                <StatusRow label="Credential ID">
                  <span className="font-mono text-xs text-gray-400 truncate max-w-[160px]" title={cred.id}>
                    {cred.id.slice(0, 20)}…
                  </span>
                </StatusRow>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No passkey registered yet. Use the button below to add one.
              </p>
            )}
          </div>

          {/* Register button */}
          <WebAuthnRegisterButton
            label="Register Biometrics"
            onSuccess={handleRegisterSuccess}
            onError={handleRegisterError}
          />

          {cred && (
            <p className="mt-3 text-center text-xs text-gray-500">
              Registering again will <span className="text-amber-400">replace</span> your existing passkey.
            </p>
          )}

          {/* Toast / Redirect Callout */}
          {toast && (
            <div
              role="alert"
              className={`mt-4 rounded-xl px-4 py-3 text-sm border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                toast.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : 'bg-red-500/10 text-red-300 border-red-500/20'
              }`}
            >
              <span>{toast.text}</span>
              {toast.type === 'success' && (
                <button
                  type="button"
                  onClick={() => router.push('/dashboard')}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-500 self-start sm:self-auto"
                >
                  Go to Dashboard →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Security note */}
        <div className="mt-4 rounded-2xl border border-white/5 bg-white/5 px-5 py-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Security Note
          </h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            Your biometric data <strong className="text-gray-400">never leaves your device</strong>.
            WebAuthn stores only a public key on our server. Your fingerprint or face scan
            is handled exclusively by your device&apos;s secure enclave.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function PasskeySettingsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        </main>
      }
    >
      <PasskeySettingsContent />
    </Suspense>
  );
}

function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      {children}
    </div>
  );
}
