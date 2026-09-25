-- ===========================================================================
-- Wochenplan: a recurring week per member, plus per-date exceptions.
--
-- Times are stored as wall-clock minutes in the owner's time zone
-- (profiles.timezone), never as UTC instants: a block "Mo 05:30–07:00" in
-- Asia/Shanghai must stay 05:30 there while Germany switches between CEST
-- and CET. Viewers convert in the browser (src/lib/schedule/).
--
-- A block either belongs to the weekly template (weekday set) or to one
-- exception day (exception_day set, replacing the template for that
-- date). end_minute < start_minute means the block runs past midnight
-- into the next day (e.g. sleep 22:00–05:30).
--
-- Visibility (RLS): everyone reads their own plan, everyone reads plans
-- marked schedule_public (the admin's), the admin reads all plans. Only
-- the owner writes. schedule_public is set only via
-- set_schedule_public(), which only the admin may call.
-- ===========================================================================

alter table pigeon.profiles
  add column if not exists timezone text not null default 'Europe/Berlin',
  add column if not exists schedule_public boolean not null default false;

-- Check constraints must be immutable, and pg_timezone_names isn't: validate
-- in a trigger instead, so a typo can't break every viewer's conversion.
create or replace function pigeon.validate_profile_timezone()
returns trigger
language plpgsql
set search_path = pigeon, pg_catalog
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function pigeon.validate_profile_timezone() from public, anon, authenticated;

drop trigger if exists validate_profile_timezone on pigeon.profiles;
create trigger validate_profile_timezone
  before insert or update of timezone on pigeon.profiles
  for each row execute function pigeon.validate_profile_timezone();

-- Members may change their own plan's time zone (not schedule_public).
grant update (timezone) on pigeon.profiles to authenticated;

-- The admin is in Dengfeng, and their plan is the one everybody sees.
update pigeon.profiles
  set timezone = 'Asia/Shanghai', schedule_public = true
  where is_admin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists pigeon.schedule_exceptions (
  owner_id uuid not null references pigeon.profiles (id) on delete cascade,
  day date not null,
  note text check (note is null or char_length(note) <= 80),
  created_at timestamptz not null default now(),
  primary key (owner_id, day)
);

create table if not exists pigeon.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references pigeon.profiles (id) on delete cascade,
  -- ISO weekday, 1 = Monday … 7 = Sunday. Set for template blocks.
  weekday smallint check (weekday between 1 and 7),
  -- Set for blocks of an exception day instead.
  exception_day date,
  start_minute smallint not null check (start_minute between 0 and 1425 and start_minute % 15 = 0),
  end_minute smallint not null check (end_minute between 0 and 1425 and end_minute % 15 = 0),
  category text not null check (category in ('training', 'freizeit', 'schlafen', 'essen', 'unterwegs', 'sonstiges')),
  availability text not null check (availability in ('available', 'limited', 'unavailable')),
  label text check (label is null or char_length(label) <= 60),
  created_at timestamptz not null default now(),
  constraint schedule_blocks_template_or_exception check ((weekday is null) <> (exception_day is null)),
  constraint schedule_blocks_nonempty check (start_minute <> end_minute),
  constraint schedule_blocks_exception_fkey
    foreign key (owner_id, exception_day)
    references pigeon.schedule_exceptions (owner_id, day)
    on delete cascade
);

create index if not exists schedule_blocks_owner_idx on pigeon.schedule_blocks (owner_id);

alter table pigeon.schedule_blocks enable row level security;
alter table pigeon.schedule_exceptions enable row level security;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: reads profiles without going through their RLS.
create or replace function pigeon.can_view_schedule(p_owner_id uuid)
returns boolean
language sql
security definer
set search_path = pigeon
stable
as $$
  select p_owner_id = auth.uid()
    or coalesce((select p.is_admin from pigeon.profiles p where p.id = auth.uid()), false)
    or coalesce((select p.schedule_public from pigeon.profiles p where p.id = p_owner_id), false);
$$;
revoke execute on function pigeon.can_view_schedule(uuid) from public, anon;
grant execute on function pigeon.can_view_schedule(uuid) to authenticated;

drop policy if exists "members read visible schedules" on pigeon.schedule_blocks;
create policy "members read visible schedules"
  on pigeon.schedule_blocks for select
  to authenticated
  using ((select pigeon.is_member()) and pigeon.can_view_schedule(owner_id));

drop policy if exists "owners manage their schedule blocks" on pigeon.schedule_blocks;
create policy "owners manage their schedule blocks"
  on pigeon.schedule_blocks for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select pigeon.is_member()));

drop policy if exists "members read visible schedule exceptions" on pigeon.schedule_exceptions;
create policy "members read visible schedule exceptions"
  on pigeon.schedule_exceptions for select
  to authenticated
  using ((select pigeon.is_member()) and pigeon.can_view_schedule(owner_id));

drop policy if exists "owners manage their schedule exceptions" on pigeon.schedule_exceptions;
create policy "owners manage their schedule exceptions"
  on pigeon.schedule_exceptions for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select pigeon.is_member()));

-- ---------------------------------------------------------------------------
-- Admin switch: whose plan every member may see.
-- ---------------------------------------------------------------------------
create or replace function pigeon.set_schedule_public(p_user_id uuid, p_public boolean)
returns void
language plpgsql
security definer
set search_path = pigeon
as $$
begin
  if not pigeon.is_admin() then
    raise exception 'Only the admin can change who sees a schedule' using errcode = '42501';
  end if;
  update pigeon.profiles set schedule_public = p_public where id = p_user_id;
end;
$$;
revoke execute on function pigeon.set_schedule_public(uuid, boolean) from public, anon;
grant execute on function pigeon.set_schedule_public(uuid, boolean) to authenticated;
