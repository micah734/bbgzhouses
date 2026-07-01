create extension if not exists pgcrypto;

create table if not exists public.hd_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'teacher' check (role in ('admin', 'teacher')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hd_user_invites (
  email text primary key,
  role text not null check (role in ('admin', 'teacher')),
  invited_by uuid references public.hd_profiles(id) on delete set null,
  invited_user_id uuid references public.hd_profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hd_students (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  grade integer not null default 0,
  family_id text,
  house text not null check (house in ('Red', 'Blue', 'Yellow', 'Green')),
  points integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hd_point_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.hd_students(id) on delete cascade,
  points integer not null,
  category text not null,
  reason text not null default '',
  teacher_id uuid references public.hd_profiles(id) on delete set null,
  teacher_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.hd_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.hd_profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.hd_term_archives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  snapshot jsonb not null,
  archived_by uuid references public.hd_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.hd_profiles enable row level security;
alter table public.hd_user_invites enable row level security;
alter table public.hd_students enable row level security;
alter table public.hd_point_transactions enable row level security;
alter table public.hd_audit_events enable row level security;
alter table public.hd_term_archives enable row level security;

drop policy if exists "Profiles can read signed-in profiles" on public.hd_profiles;
create policy "Profiles can read signed-in profiles"
on public.hd_profiles for select
to authenticated
using (true);

drop policy if exists "Users can insert own profile" on public.hd_profiles;
create policy "Users can insert own profile"
on public.hd_profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "Users can update own profile" on public.hd_profiles;
create policy "Users can update own profile"
on public.hd_profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Admins can read invites" on public.hd_user_invites;
create policy "Admins can read invites"
on public.hd_user_invites for select
to authenticated
using (
  exists (
    select 1
    from public.hd_profiles
    where id = (select auth.uid()) and role = 'admin'
  )
);

drop policy if exists "Invitees can read own invite" on public.hd_user_invites;
create policy "Invitees can read own invite"
on public.hd_user_invites for select
to authenticated
using (lower(email) = lower(coalesce(auth.jwt()->>'email', '')));

drop policy if exists "Admins can insert invites" on public.hd_user_invites;
create policy "Admins can insert invites"
on public.hd_user_invites for insert
to authenticated
with check (
  exists (
    select 1
    from public.hd_profiles
    where id = (select auth.uid()) and role = 'admin'
  )
);

drop policy if exists "Admins can update invites" on public.hd_user_invites;
create policy "Admins can update invites"
on public.hd_user_invites for update
to authenticated
using (
  exists (
    select 1
    from public.hd_profiles
    where id = (select auth.uid()) and role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.hd_profiles
    where id = (select auth.uid()) and role = 'admin'
  )
);

drop policy if exists "Invitees can accept own invite" on public.hd_user_invites;
create policy "Invitees can accept own invite"
on public.hd_user_invites for update
to authenticated
using (
  lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
  and accepted_at is null
)
with check (
  lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
  and invited_user_id = (select auth.uid())
  and accepted_at is not null
);

drop policy if exists "Signed-in users can read students" on public.hd_students;
create policy "Signed-in users can read students"
on public.hd_students for select
to authenticated
using (true);

drop policy if exists "Signed-in users can add students" on public.hd_students;
create policy "Signed-in users can add students"
on public.hd_students for insert
to authenticated
with check (true);

drop policy if exists "Signed-in users can update students" on public.hd_students;
create policy "Signed-in users can update students"
on public.hd_students for update
to authenticated
using (true)
with check (true);

drop policy if exists "Signed-in users can read transactions" on public.hd_point_transactions;
create policy "Signed-in users can read transactions"
on public.hd_point_transactions for select
to authenticated
using (true);

drop policy if exists "Signed-in users can add transactions" on public.hd_point_transactions;
create policy "Signed-in users can add transactions"
on public.hd_point_transactions for insert
to authenticated
with check (true);

drop policy if exists "Signed-in users can read audit" on public.hd_audit_events;
create policy "Signed-in users can read audit"
on public.hd_audit_events for select
to authenticated
using (true);

drop policy if exists "Signed-in users can add audit" on public.hd_audit_events;
create policy "Signed-in users can add audit"
on public.hd_audit_events for insert
to authenticated
with check (true);

drop policy if exists "Signed-in users can read archives" on public.hd_term_archives;
create policy "Signed-in users can read archives"
on public.hd_term_archives for select
to authenticated
using (true);

drop policy if exists "Signed-in users can add archives" on public.hd_term_archives;
create policy "Signed-in users can add archives"
on public.hd_term_archives for insert
to authenticated
with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.hd_profiles to authenticated;
grant select, insert, update on public.hd_user_invites to authenticated;
grant select, insert, update on public.hd_students to authenticated;
grant select, insert on public.hd_point_transactions to authenticated;
grant select, insert on public.hd_audit_events to authenticated;
grant select, insert on public.hd_term_archives to authenticated;
