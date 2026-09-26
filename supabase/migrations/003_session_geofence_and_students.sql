-- ============================================================
--  Migration 003 – 3D Geofence Sessions, QR Code & Bulk Students
--  Run AFTER 001_schema.sql and 002_webauthn.sql
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1.  Add 3D Session Coordinates and Floor to classes table
-- ──────────────────────────────────────────────────────────────
alter table public.classes
  add column if not exists session_latitude numeric(10, 7),
  add column if not exists session_longitude numeric(10, 7),
  add column if not exists session_altitude numeric(7, 2),
  add column if not exists session_floor integer default 1,
  add column if not exists session_token_secret text,
  add column if not exists is_session_active boolean default false,
  add column if not exists session_started_at timestamptz;

-- ──────────────────────────────────────────────────────────────
-- 2.  Add roll_number to profiles table
-- ──────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists roll_number text unique;

create index if not exists idx_profiles_roll_number
  on public.profiles(roll_number);

-- ──────────────────────────────────────────────────────────────
-- 3.  Add 3D Geolocation verification telemetry to attendance
-- ──────────────────────────────────────────────────────────────
alter table public.attendance
  add column if not exists verified_latitude numeric(10, 7),
  add column if not exists verified_longitude numeric(10, 7),
  add column if not exists verified_altitude numeric(7, 2),
  add column if not exists distance_meters numeric(6, 2),
  add column if not exists altitude_diff_meters numeric(6, 2),
  add column if not exists verification_method text default 'webauthn_geofence_3d';

-- ──────────────────────────────────────────────────────────────
-- 4.  RLS update on classes table so professors can manage sessions
-- ──────────────────────────────────────────────────────────────
drop policy if exists "classes: professors can update own classes" on public.classes;
create policy "classes: professors can update own classes"
  on public.classes for update
  to authenticated
  using (
    professor_id = auth.uid() or
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "classes: authenticated can view active session coordinates" on public.classes;
create policy "classes: authenticated can view active session coordinates"
  on public.classes for select
  to authenticated
  using (true);

-- ──────────────────────────────────────────────────────────────
-- 5.  Update active_classes view to include session coordinates
-- ──────────────────────────────────────────────────────────────
create or replace view public.active_classes as
  select
    c.*,
    p.name as professor_name
  from public.classes c
  join public.profiles p on p.id = c.professor_id
  where (c.is_session_active = true)
     or (now() > c.start_time and now() < c.end_time);

grant select on public.active_classes to authenticated;
