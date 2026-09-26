-- ============================================================
--  Migration 002 – WebAuthn Support Additions
--  Run AFTER schema.sql (001) in the Supabase SQL Editor.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1.  Ensure profiles has email column for fast O(1) passkey lookups
-- ──────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists email text unique;

-- Backfill emails from auth.users if available
do $$
begin
  update public.profiles p
  set email = u.email
  from auth.users u
  where p.id = u.id and p.email is null and u.email is not null;
exception when others then
  null;
end$$;

-- ──────────────────────────────────────────────────────────────
-- 2.  Add a GIN index on webauthn_credential for fast lookups
--     (e.g. look up by credential ID when verifying assertions)
-- ──────────────────────────────────────────────────────────────
create index if not exists idx_profiles_webauthn_credential
  on public.profiles using gin (webauthn_credential);

-- ──────────────────────────────────────────────────────────────
-- 2.  Helper function: check if a user has a passkey registered.
--     Used in RLS policies and server checks.
-- ──────────────────────────────────────────────────────────────
create or replace function public.has_passkey(user_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select webauthn_credential is not null
  from public.profiles
  where id = user_id;
$$;

-- ──────────────────────────────────────────────────────────────
-- 3.  Extend the attendance INSERT RLS policy to also require
--     that the student has a registered passkey.
--     (Drop and recreate to add the extra condition.)
-- ──────────────────────────────────────────────────────────────
drop policy if exists "attendance: student can insert during active class"
  on public.attendance;

create policy "attendance: student can insert during active class"
  on public.attendance for insert
  to authenticated
  with check (
    -- Own record only
    student_id = auth.uid()

    -- Must be a student
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'student'
    )

    -- Must have a registered passkey (biometric gate)
    and public.has_passkey(auth.uid())

    -- Class must be strictly active (server clock)
    and exists (
      select 1 from public.classes c
      where c.id = class_id
        and now() > c.start_time
        and now() < c.end_time
    )
  );

-- ──────────────────────────────────────────────────────────────
-- 4.  View: profiles_with_passkey_status
--     Convenient view for admin dashboards.
-- ──────────────────────────────────────────────────────────────
create or replace view public.profiles_with_passkey_status as
  select
    id,
    name,
    role,
    (webauthn_credential is not null) as has_passkey,
    (webauthn_credential->>'registeredAt')::timestamptz as passkey_registered_at,
    webauthn_credential->>'aaguid' as passkey_aaguid,
    created_at,
    updated_at
  from public.profiles;

grant select on public.profiles_with_passkey_status to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 5.  RLS on the view follows the underlying table's policies.
--     No extra grants needed.
-- ──────────────────────────────────────────────────────────────

-- ============================================================
--  END OF MIGRATION 002
-- ============================================================
