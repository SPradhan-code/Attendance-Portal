-- ============================================================
--  Migration 001 – Base Schema
--  Run this FIRST in the Supabase SQL Editor before 002_webauthn.sql.
--  All migrations are idempotent (safe to run multiple times).
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 0.  Extensions
-- ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ──────────────────────────────────────────────────────────────
-- 1.  Custom enum types
-- ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'student');
  end if;
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type public.attendance_status as enum ('present', 'late', 'absent');
  end if;
end$$;

-- ──────────────────────────────────────────────────────────────
-- 2.  profiles  (one row per auth.users entry)
-- ──────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                   uuid        primary key references auth.users(id) on delete cascade,
  role                 public.user_role not null default 'student',
  name                 text        not null default '',
  email                text        unique,
  -- JSONB blob that stores the single registered WebAuthn credential.
  -- Shape is defined by the WebAuthnCredential TypeScript interface.
  webauthn_credential  jsonb       default null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Auto-populate a profile row when a new user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(public.profiles.name, excluded.name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Auto-update updated_at on profile changes.
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.update_updated_at();

-- ──────────────────────────────────────────────────────────────
-- 3.  classes  (created by admins / professors)
-- ──────────────────────────────────────────────────────────────
create table if not exists public.classes (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null,
  -- GPS coordinates of the classroom.
  latitude       numeric(10, 7) not null,
  longitude      numeric(10, 7) not null,
  -- Students must be within this many metres to mark attendance.
  radius_meters  integer     not null default 20,
  start_time     timestamptz not null,
  end_time       timestamptz not null,
  professor_id   uuid        not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  constraint classes_time_check check (end_time > start_time)
);

create index if not exists idx_classes_professor on public.classes(professor_id);
create index if not exists idx_classes_time on public.classes(start_time, end_time);

-- ──────────────────────────────────────────────────────────────
-- 4.  attendance  (one row per student per class)
-- ──────────────────────────────────────────────────────────────
create table if not exists public.attendance (
  id          uuid               primary key default gen_random_uuid(),
  class_id    uuid               not null references public.classes(id) on delete cascade,
  student_id  uuid               not null references public.profiles(id) on delete cascade,
  timestamp   timestamptz        not null default now(),
  status      public.attendance_status not null default 'present',
  -- Each student can only submit one attendance record per class.
  unique (class_id, student_id)
);

create index if not exists idx_attendance_student on public.attendance(student_id);
create index if not exists idx_attendance_class   on public.attendance(class_id);

-- ──────────────────────────────────────────────────────────────
-- 5.  View: active_classes
--     Returns classes that are currently in session.
-- ──────────────────────────────────────────────────────────────
create or replace view public.active_classes as
  select *
  from public.classes
  where now() > start_time
    and now() < end_time;

grant select on public.active_classes to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 6.  Row Level Security (RLS)
-- ──────────────────────────────────────────────────────────────

-- profiles ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "profiles: user can read own" on public.profiles;
create policy "profiles: user can read own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "profiles: user can update own" on public.profiles;
create policy "profiles: user can update own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid());

-- Admin can read all profiles (for class roster / attendance reports).
drop policy if exists "profiles: admin can read all" on public.profiles;
create policy "profiles: admin can read all"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- classes ───────────────────────────────────────────────────────
alter table public.classes enable row level security;

-- Any authenticated user can see classes.
drop policy if exists "classes: authenticated can read" on public.classes;
create policy "classes: authenticated can read"
  on public.classes for select
  to authenticated
  using (true);

-- Only admins can create/modify/delete classes.
drop policy if exists "classes: admin can insert" on public.classes;
create policy "classes: admin can insert"
  on public.classes for insert
  to authenticated
  with check (
    professor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "classes: admin can update" on public.classes;
create policy "classes: admin can update"
  on public.classes for update
  to authenticated
  using (professor_id = auth.uid());

drop policy if exists "classes: admin can delete" on public.classes;
create policy "classes: admin can delete"
  on public.classes for delete
  to authenticated
  using (professor_id = auth.uid());

-- attendance ────────────────────────────────────────────────────
alter table public.attendance enable row level security;

-- Students can read their own records; admins can read all.
drop policy if exists "attendance: student can read own" on public.attendance;
create policy "attendance: student can read own"
  on public.attendance for select
  to authenticated
  using (
    student_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- Insert policy: enforced by 002_webauthn.sql (requires passkey).
-- Defined here as a placeholder — 002 will drop and replace it.
drop policy if exists "attendance: student can insert during active class" on public.attendance;
create policy "attendance: student can insert during active class"
  on public.attendance for insert
  to authenticated
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'student'
    )
    and exists (
      select 1 from public.classes c
      where c.id = class_id
        and now() > c.start_time
        and now() < c.end_time
    )
  );

-- ──────────────────────────────────────────────────────────────
-- 7.  Grant table-level access to the anon + authenticated roles
-- ──────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;

grant select on public.profiles    to authenticated;
grant update on public.profiles    to authenticated;
grant select on public.classes     to authenticated;
grant insert, update, delete on public.classes to authenticated;
grant select, insert on public.attendance to authenticated;

-- ============================================================
--  END OF MIGRATION 001
--  Next: run 002_webauthn.sql to add the passkey RLS gate.
-- ============================================================
