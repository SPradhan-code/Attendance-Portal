import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AttendanceWebAuthn } from '@/components/AttendanceWebAuthn';
import { AdminSessionManager } from '@/components/AdminSessionManager';
import type { Class, Profile } from '@/types/database';

export default async function DashboardPage() {
  const supabase = await createClient();

  // ── Auth guard ────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // ── Fetch profile ─────────────────────────────────────────────
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .returns<Profile[]>()
    .single();
  const profile = profileRow as Profile | null;

  // ── Admin passkey guard ───────────────────────────────────────
  // Admins with no registered passkey are redirected to register one first.
  if (profile?.role === 'admin' && !profile.webauthn_credential) {
    redirect('/settings/passkey?reason=required');
  }

  // ── Fetch currently active classes ────────────────────────────
  const { data: activeClasses } = await supabase
    .from('active_classes')
    .select('*')
    .returns<Class[]>();

  // ── Fetch attendance history (students only) ──────────────────
  const { data: attendanceHistory } =
    profile?.role === 'student'
      ? await supabase
          .from('attendance')
          .select('*, classes(name, start_time, end_time)')
          .eq('student_id', user.id)
          .order('timestamp', { ascending: false })
          .limit(10)
      : { data: null };

  // ── Fetch all classes (admin view) ────────────────────────────
  const { data: allClasses } =
    profile?.role === 'admin'
      ? await supabase
          .from('classes')
          .select('*')
          .eq('professor_id', user.id)
          .order('start_time', { ascending: false })
          .limit(20)
          .returns<Class[]>()
      : { data: null };

  const hasPasskey = !!profile?.webauthn_credential;

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {profile?.role === 'admin' ? '🎓 Professor Dashboard' : '📋 My Dashboard'}
          </h1>
          <p className="text-sm text-gray-400">
            Welcome back,{' '}
            <span className="text-indigo-300">{profile?.name ?? user.email}</span>
            {profile?.role === 'admin' && (
              <span className="ml-2 rounded-full bg-indigo-600/30 px-2 py-0.5 text-xs font-medium text-indigo-300 border border-indigo-500/30">
                Admin
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {profile?.role === 'admin' && (
            <a
              href="/admin/students"
              className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/20"
            >
              👥 Student Management
            </a>
          )}

          {/* Passkey status chip */}
          <a
            href="/settings/passkey"
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition hover:-translate-y-0.5 ${
              hasPasskey
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}
          >
            {hasPasskey ? '🔐 Passkey Active' : '⚠️ No Passkey'}
          </a>

          {/* Sign out */}
          <form action="/auth/signout" method="post">
            <button
              id="btn-signout"
              type="submit"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 transition hover:bg-white/10"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* ── Passkey nudge for students ────────────────────────────── */}
      {profile?.role === 'student' && !hasPasskey && (
        <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-5 py-4">
          <p className="text-sm text-amber-300">
            <span className="font-semibold">No passkey registered.</span>{' '}
            You need a biometric passkey to mark attendance.{' '}
            <a
              href="/settings/passkey"
              className="underline underline-offset-2 hover:text-amber-200 transition"
            >
              Register one now →
            </a>
          </p>
        </div>
      )}

      {/* ── Active Classes ───────────────────────────────────────── */}
      <section aria-labelledby="active-classes-heading" className="mb-10">
        <h2
          id="active-classes-heading"
          className="mb-4 flex items-center gap-2 text-lg font-semibold text-white"
        >
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          Active Classes Right Now
        </h2>

        {activeClasses && activeClasses.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeClasses.map((cls) => (
              <div
                key={cls.id}
                className="glass rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1"
              >
                <h3 className="mb-1 font-semibold text-white">{cls.name}</h3>
                <p className="mb-0.5 text-xs text-gray-400">
                  🕐 {new Date(cls.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {' – '}
                  {new Date(cls.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="mb-4 text-xs text-gray-500">
                  📍 {Number(cls.latitude).toFixed(4)}, {Number(cls.longitude).toFixed(4)}
                  {' · '}
                  {cls.radius_meters}m radius
                  {cls.session_floor && ` · Floor ${cls.session_floor}`}
                </p>

                {/* Student: biometric attendance gate */}
                {profile?.role === 'student' && hasPasskey && (
                  <AttendanceWebAuthn
                    classId={cls.id}
                    className={cls.name}
                    studentEmail={user.email ?? ''}
                  />
                )}

                {/* Student: no passkey yet */}
                {profile?.role === 'student' && !hasPasskey && (
                  <a
                    href="/settings/passkey"
                    className="block w-full rounded-xl border border-amber-500/30 bg-amber-500/10 py-2 text-center text-xs text-amber-300 transition hover:bg-amber-500/20"
                  >
                    Register passkey to attend →
                  </a>
                )}

                {/* Admin: see class badge */}
                {profile?.role === 'admin' && (
                  <div className="rounded-xl bg-indigo-500/10 px-3 py-1.5 text-center text-xs text-indigo-300 border border-indigo-500/20">
                    In Session — Students can mark attendance
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="glass rounded-2xl p-8 text-center text-gray-500">
            No active classes at this time.
          </div>
        )}
      </section>

      {/* ── Admin: Live 3D Session & QR Projector ─────────────────── */}
      {profile?.role === 'admin' && allClasses && allClasses.length > 0 && (
        <section aria-labelledby="session-manager-heading" className="mb-10">
          <AdminSessionManager classes={allClasses} />
        </section>
      )}

      {/* ── Student: Attendance History ──────────────────────────── */}
      {profile?.role === 'student' && attendanceHistory && (
        <section aria-labelledby="history-heading">
          <h2
            id="history-heading"
            className="mb-4 text-lg font-semibold text-white"
          >
            📅 Recent Attendance
          </h2>
          <div className="glass overflow-hidden rounded-2xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="px-5 py-3 font-medium text-gray-400">Class</th>
                  <th className="px-5 py-3 font-medium text-gray-400">Date / Time</th>
                  <th className="px-5 py-3 font-medium text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {attendanceHistory.map((rec: any) => (
                  <tr key={rec.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-5 py-3 text-white">{rec.classes?.name ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-400">
                      {new Date(rec.timestamp).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={rec.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {attendanceHistory.length === 0 && (
              <p className="px-5 py-8 text-center text-gray-500">
                No attendance records yet.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Admin: All Classes ───────────────────────────────────── */}
      {profile?.role === 'admin' && allClasses && (
        <section aria-labelledby="admin-classes-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2
              id="admin-classes-heading"
              className="text-lg font-semibold text-white"
            >
              🗓 Your Classes
            </h2>
            <a
              href="/classes/new"
              className="rounded-xl bg-indigo-600/80 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
            >
              + New Class
            </a>
          </div>
          <div className="glass overflow-hidden rounded-2xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="px-5 py-3 font-medium text-gray-400">Class</th>
                  <th className="px-5 py-3 font-medium text-gray-400">Start</th>
                  <th className="px-5 py-3 font-medium text-gray-400">End</th>
                  <th className="px-5 py-3 font-medium text-gray-400">Location</th>
                </tr>
              </thead>
              <tbody>
                {allClasses.map((cls) => (
                  <tr key={cls.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-5 py-3 font-medium text-white">{cls.name}</td>
                    <td className="px-5 py-3 text-gray-400">
                      {new Date(cls.start_time).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-gray-400">
                      {new Date(cls.end_time).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs font-mono">
                      {Number(cls.latitude).toFixed(4)}, {Number(cls.longitude).toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allClasses.length === 0 && (
              <p className="px-5 py-8 text-center text-gray-500">
                You haven&apos;t created any classes yet.
              </p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    present: 'bg-emerald-500/20 text-emerald-300',
    late: 'bg-amber-500/20 text-amber-300',
    absent: 'bg-red-500/20 text-red-300',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-gray-500/20 text-gray-300'}`}
    >
      {status}
    </span>
  );
}
