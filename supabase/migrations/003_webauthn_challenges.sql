-- ============================================================
--  Migration 003 – WebAuthn Challenge Store
--  Run AFTER 002_webauthn.sql in the Supabase SQL Editor.
--
--  Persists challenges in the database so they survive across
--  serverless cold starts (Vercel edge / lambda invocations).
-- ============================================================

create table if not exists public.webauthn_challenges (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  challenge  text        not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Auto-purge stale rows older than 5 minutes via a periodic cron job in the
-- application, or simply let the app ignore expired rows (it checks expires_at).

-- Service-role only: no direct browser access.
alter table public.webauthn_challenges enable row level security;

-- No policies: only service-role key (bypass RLS) can read/write.
-- The challenge-store helper always uses createAdminClient().
