import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      {/* Background decoration */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-indigo-600 opacity-10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-cyan-500 opacity-10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-4xl text-center animate-fade-in-up">
        {/* Badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-sm text-indigo-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          Powered by Supabase + WebAuthn
        </div>

        {/* Headline */}
        <h1 className="mb-6 text-5xl font-bold tracking-tight sm:text-7xl">
          <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
            Smart Attendance
          </span>
          <br />
          <span className="text-white">Portal</span>
        </h1>

        <p className="mx-auto mb-12 max-w-2xl text-lg text-gray-400 leading-relaxed">
          Location-aware, biometric attendance management for modern campuses.
          Students check in securely during active class windows — enforced at
          the database level.
        </p>

        {/* Feature cards */}
        <div className="mb-12 grid gap-4 sm:grid-cols-3 text-left">
          {[
            {
              icon: '🔐',
              title: 'WebAuthn Auth',
              desc: 'Passwordless biometric login — fingerprint or face ID.',
            },
            {
              icon: '📍',
              title: 'Geo-fenced Classes',
              desc: 'Students must be within 20 m of the classroom to mark attendance.',
            },
            {
              icon: '🛡️',
              title: 'RLS-Enforced Windows',
              desc: 'Supabase RLS blocks check-ins outside the class time window — server-side.',
            },
          ].map((f) => (
            <div
              key={f.title}
              className="glass rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:glow-primary"
            >
              <div className="mb-3 text-3xl">{f.icon}</div>
              <h2 className="mb-1 text-base font-semibold text-white">{f.title}</h2>
              <p className="text-sm text-gray-400">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* CTA buttons */}
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/login"
            className="rounded-xl bg-indigo-600 px-8 py-3 font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all duration-200 hover:bg-indigo-500 hover:shadow-indigo-500/40 hover:-translate-y-0.5"
          >
            Get Started →
          </Link>
          <Link
            href="https://supabase.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-white/10 bg-white/5 px-8 py-3 font-semibold text-white transition-all duration-200 hover:bg-white/10 hover:-translate-y-0.5"
          >
            Supabase Docs
          </Link>
        </div>
      </div>
    </main>
  );
}
