-- ===========================================================================
-- Members only see the people they share a chat with.
--
-- Until now every member could read every member profile ("members can
-- read all member profiles") — which is what fed the dashboard's "Neue
-- Unterhaltung" list, letting anyone start a chat with anyone. Invited
-- friends now only see themselves and their chat partners (in practice:
-- the admin who invited them). The admin still sees everyone, so they can
-- start chats between themselves and any member.
--
-- The admin is marked in the database via profiles.is_admin, set by the
-- app's ensureMembership() for the ADMIN_EMAIL account (lib/auth/bootstrap.ts).
-- It's not in the column-level UPDATE grant, so members can't set it on
-- themselves.
-- ===========================================================================
alter table pigeon.profiles
  add column if not exists is_admin boolean not null default false;

-- SECURITY DEFINER: reads profiles / chat_participants without going
-- through their RLS (which would recurse into the policy below).
create or replace function pigeon.is_admin()
returns boolean
language sql
security definer
set search_path = pigeon
stable
as $$
  select coalesce((select p.is_admin from pigeon.profiles p where p.id = auth.uid()), false);
$$;

create or replace function pigeon.shares_chat_with(p_other_user_id uuid)
returns boolean
language sql
security definer
set search_path = pigeon
stable
as $$
  select exists (
    select 1
    from pigeon.chat_participants mine
    join pigeon.chat_participants theirs on theirs.chat_id = mine.chat_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_other_user_id
  );
$$;

revoke execute on function pigeon.is_admin() from public, anon;
grant execute on function pigeon.is_admin() to authenticated;
revoke execute on function pigeon.shares_chat_with(uuid) from public, anon;
grant execute on function pigeon.shares_chat_with(uuid) to authenticated;

drop policy if exists "members can read all member profiles" on pigeon.profiles;
drop policy if exists "users can read their own profile, their chat partners' and (admin) all" on pigeon.profiles;
create policy "users can read their own profile, their chat partners' and (admin) all"
  on pigeon.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select pigeon.is_admin())
    or pigeon.shares_chat_with(id)
  );
