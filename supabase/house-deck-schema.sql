create extension if not exists pgcrypto;

create table if not exists public.hd_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'teacher' check (role in ('admin', 'teacher')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hd_profiles
  add column if not exists approval_status text not null default 'pending';

alter table public.hd_profiles
  drop constraint if exists hd_profiles_approval_status_check;

alter table public.hd_profiles
  add constraint hd_profiles_approval_status_check
  check (approval_status in ('pending', 'approved'));

update public.hd_profiles
set approval_status = 'approved'
where approval_status is null;

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

create or replace function public.hd_is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hd_profiles
    where id = auth.uid()
      and approval_status = 'approved'
  );
$$;

create or replace function public.hd_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hd_profiles
    where id = auth.uid()
      and role = 'admin'
      and approval_status = 'approved'
  );
$$;

create or replace function public.hd_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at = now();
    return new;
  end if;

  if auth.role() = 'service_role' then
    new.updated_at = now();
    return new;
  end if;

  if auth.uid() is null then
    new.updated_at = now();
    return new;
  end if;

  if old.id <> auth.uid() and not public.hd_is_admin() then
    raise exception 'Only admins can update other profiles.';
  end if;

  if not public.hd_is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only admins can change roles.';
    end if;

    if new.approval_status is distinct from old.approval_status then
      raise exception 'Only admins can approve accounts.';
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hd_profiles_guard_trigger on public.hd_profiles;
create trigger hd_profiles_guard_trigger
before insert or update on public.hd_profiles
for each row
execute function public.hd_profiles_guard();

drop policy if exists "Profiles can read signed-in profiles" on public.hd_profiles;
create policy "Profiles can read signed-in profiles"
on public.hd_profiles for select
to authenticated
using (
  id = auth.uid()
  or public.hd_is_admin()
  or (public.hd_is_approved() and approval_status = 'approved')
);

drop policy if exists "Users can insert own profile" on public.hd_profiles;
create policy "Users can insert own profile"
on public.hd_profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "Users can update own profile" on public.hd_profiles;
create policy "Users can update own profile"
on public.hd_profiles for update
to authenticated
using ((select auth.uid()) = id or public.hd_is_admin())
with check ((select auth.uid()) = id or public.hd_is_admin());

drop policy if exists "Admins can read invites" on public.hd_user_invites;
create policy "Admins can read invites"
on public.hd_user_invites for select
to authenticated
using (
  public.hd_is_admin()
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
  public.hd_is_admin()
);

drop policy if exists "Admins can update invites" on public.hd_user_invites;
create policy "Admins can update invites"
on public.hd_user_invites for update
to authenticated
using (
  public.hd_is_admin()
)
with check (
  public.hd_is_admin()
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
using (public.hd_is_approved());

drop policy if exists "Signed-in users can add students" on public.hd_students;
create policy "Signed-in users can add students"
on public.hd_students for insert
to authenticated
with check (public.hd_is_approved());

drop policy if exists "Signed-in users can update students" on public.hd_students;
create policy "Signed-in users can update students"
on public.hd_students for update
to authenticated
using (public.hd_is_approved())
with check (public.hd_is_approved());

drop policy if exists "Signed-in users can read transactions" on public.hd_point_transactions;
create policy "Signed-in users can read transactions"
on public.hd_point_transactions for select
to authenticated
using (public.hd_is_approved());

drop policy if exists "Signed-in users can add transactions" on public.hd_point_transactions;
create policy "Signed-in users can add transactions"
on public.hd_point_transactions for insert
to authenticated
with check (public.hd_is_approved());

drop policy if exists "Signed-in users can read audit" on public.hd_audit_events;
create policy "Signed-in users can read audit"
on public.hd_audit_events for select
to authenticated
using (public.hd_is_approved());

drop policy if exists "Signed-in users can add audit" on public.hd_audit_events;
create policy "Signed-in users can add audit"
on public.hd_audit_events for insert
to authenticated
with check (public.hd_is_approved());

drop policy if exists "Signed-in users can read archives" on public.hd_term_archives;
create policy "Signed-in users can read archives"
on public.hd_term_archives for select
to authenticated
using (public.hd_is_approved());

drop policy if exists "Signed-in users can add archives" on public.hd_term_archives;
create policy "Signed-in users can add archives"
on public.hd_term_archives for insert
to authenticated
with check (public.hd_is_approved());

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.hd_profiles to authenticated;
grant select, insert, update on public.hd_user_invites to authenticated;
grant select, insert, update on public.hd_students to authenticated;
grant select, insert on public.hd_point_transactions to authenticated;
grant select, insert on public.hd_audit_events to authenticated;
grant select, insert on public.hd_term_archives to authenticated;
