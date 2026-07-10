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
  student_id uuid references public.hd_students(id) on delete cascade,
  house text check (house in ('Red', 'Blue', 'Yellow', 'Green')),
  points integer not null,
  category text not null,
  reason text not null default '',
  teacher_id uuid references public.hd_profiles(id) on delete set null,
  teacher_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.hd_point_transactions
  add column if not exists house text;

alter table public.hd_point_transactions
  alter column student_id drop not null;

alter table public.hd_point_transactions
  drop constraint if exists hd_point_transactions_house_check;

alter table public.hd_point_transactions
  add constraint hd_point_transactions_house_check
  check (house in ('Red', 'Blue', 'Yellow', 'Green') or house is null);

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

create or replace function public.hd_award_points(
  p_student_id uuid,
  p_points integer,
  p_category text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student public.hd_students;
  v_transaction public.hd_point_transactions;
  v_teacher public.hd_profiles;
begin
  if auth.uid() is null or not public.hd_is_approved() then
    raise exception 'Only approved staff can award points.' using errcode = '42501';
  end if;

  if p_points = 0 then
    raise exception 'Point value cannot be zero.' using errcode = '22023';
  end if;

  select * into v_teacher from public.hd_profiles where id = auth.uid();

  update public.hd_students
  set points = points + p_points,
      updated_at = now()
  where id = p_student_id and active = true
  returning * into v_student;

  if not found then
    raise exception 'Student not found or inactive.' using errcode = 'P0002';
  end if;

  insert into public.hd_point_transactions (
    student_id, points, category, reason, teacher_id, teacher_name
  )
  values (
    p_student_id,
    p_points,
    nullif(trim(p_category), ''),
    coalesce(nullif(trim(p_reason), ''), 'No note'),
    auth.uid(),
    coalesce(v_teacher.full_name, '')
  )
  returning * into v_transaction;

  return jsonb_build_object(
    'student', jsonb_build_object(
      'id', v_student.id,
      'first_name', v_student.first_name,
      'last_name', v_student.last_name,
      'grade', v_student.grade,
      'family_id', v_student.family_id,
      'house', v_student.house,
      'points', v_student.points
    ),
    'transaction', jsonb_build_object(
      'id', v_transaction.id,
      'student_id', v_transaction.student_id,
      'house', v_transaction.house,
      'points', v_transaction.points,
      'category', v_transaction.category,
      'reason', v_transaction.reason,
      'teacher_name', v_transaction.teacher_name,
      'created_at', v_transaction.created_at
    )
  );
end;
$$;

revoke execute on function public.hd_award_points(uuid, integer, text, text) from public, anon;
grant execute on function public.hd_award_points(uuid, integer, text, text) to authenticated;

create or replace function public.hd_award_points_bulk(
  p_student_ids uuid[],
  p_points integer,
  p_category text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id uuid;
  v_award jsonb;
  v_result jsonb := '{"students": [], "transactions": []}'::jsonb;
begin
  if auth.uid() is null or not public.hd_is_approved() then
    raise exception 'Only approved staff can award points.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_student_ids, 1), 0) = 0 or array_length(p_student_ids, 1) > 100 then
    raise exception 'Choose between 1 and 100 students.' using errcode = '22023';
  end if;

  foreach v_student_id in array p_student_ids loop
    v_award := public.hd_award_points(v_student_id, p_points, p_category, p_reason);
    v_result := jsonb_set(
      v_result,
      '{students}',
      (v_result->'students') || (v_award->'student')
    );
    v_result := jsonb_set(
      v_result,
      '{transactions}',
      (v_result->'transactions') || (v_award->'transaction')
    );
  end loop;
  return v_result;
end;
$$;

revoke execute on function public.hd_award_points_bulk(uuid[], integer, text, text) from public, anon;
grant execute on function public.hd_award_points_bulk(uuid[], integer, text, text) to authenticated;

revoke execute on function public.hd_is_admin() from public, anon, authenticated;
revoke execute on function public.hd_is_approved() from public, anon, authenticated;
revoke execute on function public.hd_profiles_guard() from public, anon, authenticated;

create index if not exists hd_students_active_name_idx
  on public.hd_students (active, last_name, first_name);
create index if not exists hd_students_active_house_name_idx
  on public.hd_students (active, house, last_name, first_name);
create index if not exists hd_point_transactions_created_at_idx
  on public.hd_point_transactions (created_at desc);
create index if not exists hd_point_transactions_student_created_at_idx
  on public.hd_point_transactions (student_id, created_at desc);
create index if not exists hd_point_transactions_house_created_at_idx
  on public.hd_point_transactions (house, created_at desc)
  where house is not null;
