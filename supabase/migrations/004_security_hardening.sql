-- Restrict student updates on public.profiles to only their own name
revoke update on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Create non-recursive is_admin security definer function
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;
```[cite: 1]

#### 2. Class Sessions Isolation & RLS
```sql
-- Create class_sessions table to isolate active tokens & geofence metadata
create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  token_secret text not null,
  lat numeric(10,7) not null,
  lng numeric(10,7) not null,
  altitude numeric(7,2),
  started_at timestamptz default now(),
  ended_at timestamptz
);

alter table public.class_sessions enable row level security;
-- Note: No policies added = server-side (service_role) only access

alter table public.classes drop column if exists session_token_secret;
```[cite: 1]

#### 3. Restrict Attendance Writing & Passkey Table Migration
```sql
-- Attendance can only be recorded via server API (service role)
revoke insert on public.attendance from authenticated;
drop policy if exists "attendance: student can insert during active class" on public.attendance;

-- Add session reference and unique constraint to attendance
alter table public.attendance 
  add column if not exists session_id uuid references public.class_sessions(id) on delete cascade;

alter table public.attendance 
  add constraint unique_session_student unique (session_id, student_id);

-- Move passkey credentials to dedicated table with RLS on and no policies
create table if not exists public.passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint default 0,
  created_at timestamptz default now()
);

alter table public.passkeys enable row level security;
```[cite: 1]

---

### Key Backend Route Updates (Code Fixes)

1. **`lib/auth.ts` (Permission Helpers):**
   Implement `requireUser()` and `requireAdmin()` to validate user session and admin roles uniformly across routes[cite: 1].

2. **`app/api/attendance/check-in/route.ts` & Cleanup:**
   - Consolidate `/check-in/options` and `/check-in` into a unified passkey + GPS + token endpoint[cite: 1].
   - Remove body-based `user_id` injection (pull directly from cookie/JWT session)[cite: 1].
   - Delete obsolete endpoint `/api/attendance/mark/route.ts`[cite: 1].

3. **`lib/crypto/session-token.ts` & Fallbacks:**
   - Enforce time window step ±1[cite: 1].
   - Remove default secret fallback string (`'attendance-default-secret-key-32b'`) and fail loudly when missing[cite: 1].

4. **Security Headers (`next.config.ts`):**
   Add CSP, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Strict-Transport-Security` headers[cite: 1].
