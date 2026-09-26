-- ============================================================
--  Attendance Portal – Supabase PostgreSQL Schema
--  Author : Senior Database Architect
--  Target : Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ──────────────────────────────────────────────
-- 0.  Extensions
-- ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;


-- ──────────────────────────────────────────────
-- 1.  ENUM: user_role
-- ──────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'student');
  end if;
end
$$;


-- ──────────────────────────────────────────────
-- 2.  ENUM: attendance_status
-- ──────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type public.attendance_status as enum ('present', 'late', 'absent');
  end if;
end
$$;


-- ============================================================
--  TABLE: profiles
--  One row per Supabase Auth user (mirrors auth.users).
-- ============================================================
create table if not exists public.profiles (
  id                  uuid        primary key references auth.users (id) on delete cascade,
  role                user_role   not null default 'student',
  name                text        not null,
  webauthn_credential jsonb       default null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Keep updated_at fresh automatically
create or replace function public.handle_profile_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_profile_updated_at();

-- Auto-create a profile row when a new Auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email, 'Unknown'),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'student')
  );
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ============================================================
--  TABLE: classes
-- ============================================================
create table if not exists public.classes (
  id             uuid           primary key default uuid_generate_v4(),
  name           text           not null,
  latitude       numeric(10, 7) not null,
  longitude      numeric(10, 7) not null,
  radius_meters  integer        not null default 20 check (radius_meters > 0),
  start_time     timestamptz    not null,
  end_time       timestamptz    not null,
  professor_id   uuid           not null references public.profiles (id) on delete cascade,
  created_at     timestamptz    not null default now(),

  constraint chk_class_time_order check (end_time > start_time)
);

create index if not exists idx_classes_professor_id on public.classes (professor_id);
create index if not exists idx_classes_time_window  on public.classes (start_time, end_time);


-- ============================================================
--  TABLE: attendance
-- ============================================================
create table if not exists public.attendance (
  id          uuid              primary key default uuid_generate_v4(),
  class_id    uuid              not null references public.classes (id) on delete cascade,
  student_id  uuid              not null references public.profiles (id) on delete cascade,
  timestamp   timestamptz       not null default now(),
  status      attendance_status not null default 'present',

  constraint uq_attendance_class_student unique (class_id, student_id)
);

create index if not exists idx_attendance_class_id   on public.attendance (class_id);
create index if not exists idx_attendance_student_id on public.attendance (student_id);


-- ============================================================
--  ROW LEVEL SECURITY (RLS)
-- ============================================================

-- ── profiles ────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "profiles: authenticated users can read"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles: owner can update"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

create policy "profiles: admins have full access"
  on public.profiles for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );


-- ── classes ─────────────────────────────────────────────────
alter table public.classes enable row level security;

create policy "classes: authenticated users can read"
  on public.classes for select
  to authenticated
  using (true);

create policy "classes: professor can insert"
  on public.classes for insert
  to authenticated
  with check (
    professor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "classes: professor can update"
  on public.classes for update
  to authenticated
  using (
    professor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "classes: professor can delete"
  on public.classes for delete
  to authenticated
  using (
    professor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );


-- ── attendance ───────────────────────────────────────────────
alter table public.attendance enable row level security;

-- ┌─────────────────────────────────────────────────────────────────────┐
-- │  CORE RLS POLICY                                                    │
-- │  Students can INSERT attendance ONLY when:                          │
-- │   1. student_id = auth.uid()   (marking their own record)          │
-- │   2. Their profile role = 'student'                                 │
-- │   3. now() STRICTLY > start_time  AND  now() STRICTLY < end_time   │
-- │      (server-side clock — cannot be spoofed by the client)          │
-- └─────────────────────────────────────────────────────────────────────┘
create policy "attendance: student can insert during active class"
  on public.attendance for insert
  to authenticated
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'student'
    )
    and exists (
      select 1 from public.classes c
      where c.id = class_id
        and now() > c.start_time
        and now() < c.end_time
    )
  );

create policy "attendance: student can read own records"
  on public.attendance for select
  to authenticated
  using (student_id = auth.uid());

create policy "attendance: professor can read class attendance"
  on public.attendance for select
  to authenticated
  using (
    exists (
      select 1 from public.classes c
      join public.profiles p on p.id = auth.uid()
      where c.id = class_id
        and c.professor_id = auth.uid()
        and p.role = 'admin'
    )
  );

create policy "attendance: admin full access"
  on public.attendance for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );


-- ============================================================
--  HELPER VIEW: active_classes  (server-time filtered)
-- ============================================================
create or replace view public.active_classes as
  select * from public.classes
  where now() > start_time and now() < end_time;


-- ============================================================
--  GRANTS
-- ============================================================
grant usage on schema public to anon, authenticated;

grant select          on public.active_classes        to authenticated;
grant select, insert  on public.attendance            to authenticated;
grant select          on public.classes               to authenticated;
grant insert, update, delete on public.classes        to authenticated;
grant select          on public.profiles              to authenticated;
grant update (name, webauthn_credential, updated_at)
                      on public.profiles              to authenticated;

-- ============================================================
--  END OF SCHEMA
-- ============================================================
