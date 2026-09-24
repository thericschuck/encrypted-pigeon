-- Dashboard, chats between all members, per-user settings, and the split
-- into instant chat messages vs. pigeon letters. Only touches pigeon.* and
-- storage policies/buckets scoped to pigeon-* buckets.

-- ===========================================================================
-- 1. Membership: invites
--
-- Until now, anyone who could get a Supabase session (the auth.users table
-- is shared with an unrelated old project, and the login page's magic link
-- would create accounts on demand) got a profile and a chat on first
-- login. Now only invited emails (plus the admin) become members; a
-- pigeon.profiles row IS membership, and only the server creates one.
-- ===========================================================================
create table if not exists pigeon.invites (
  email text primary key check (email = lower(email)),
  invited_by uuid references pigeon.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

alter table pigeon.invites enable row level security;
-- Service-role only (dashboard reads it server-side): no policies, no grants.
revoke all on pigeon.invites from anon, authenticated;
grant all on pigeon.invites to service_role;

-- Everyone who is already a member counts as invited + accepted.
insert into pigeon.invites (email, accepted_at)
select lower(email), created_at from pigeon.profiles
on conflict (email) do nothing;

create or replace function pigeon.is_member()
returns boolean
language sql
security definer
set search_path = pigeon
stable
as $$
  select exists (select 1 from pigeon.profiles where id = auth.uid());
$$;

revoke execute on function pigeon.is_member() from public, anon;
grant execute on function pigeon.is_member() to authenticated;

-- ===========================================================================
-- 2. Profiles: settings columns, visibility, write rules
-- ===========================================================================
alter table pigeon.profiles
  add column if not exists theme text not null default 'system',
  add column if not exists accent_color text,
  add column if not exists pigeon_name text;

alter table pigeon.profiles
  drop constraint if exists profiles_theme_check,
  add constraint profiles_theme_check check (theme in ('system', 'light', 'dark')),
  drop constraint if exists profiles_accent_color_check,
  add constraint profiles_accent_color_check check (accent_color is null or accent_color ~ '^#[0-9a-f]{6}$'),
  drop constraint if exists profiles_display_name_check,
  add constraint profiles_display_name_check check (display_name is null or char_length(display_name) between 1 and 40),
  drop constraint if exists profiles_pigeon_name_check,
  add constraint profiles_pigeon_name_check check (pigeon_name is null or char_length(pigeon_name) between 1 and 30),
  -- avatar_url holds a path inside the pigeon-avatars bucket, always in
  -- the owner's own folder — never an arbitrary external URL.
  drop constraint if exists profiles_avatar_path_check,
  add constraint profiles_avatar_path_check check (avatar_url is null or avatar_url like id::text || '/%');

-- "Everyone can chat with everyone": members see all members' profiles
-- (and nobody else does).
drop policy if exists "users can read their own and their chat partners' profiles" on pigeon.profiles;
drop policy if exists "profiles are readable by authenticated users" on pigeon.profiles;
create policy "members can read all member profiles"
  on pigeon.profiles for select
  to authenticated
  using (pigeon.is_member());

-- Creating a profile = becoming a member, so only the server may do it.
drop policy if exists "users can insert their own profile" on pigeon.profiles;

-- Own row only, and only the personalizable columns (not id/email).
revoke insert, update, delete on pigeon.profiles from authenticated;
grant update (display_name, avatar_url, theme, accent_color, pigeon_name) on pigeon.profiles to authenticated;

-- shares_chat_with() was only used by the replaced profiles policy.
drop function if exists pigeon.shares_chat_with(uuid);

-- ===========================================================================
-- 3. Messages: instant chat vs. pigeon letter
-- ===========================================================================
alter table pigeon.messages
  add column if not exists kind text not null default 'chat';

alter table pigeon.messages
  drop constraint if exists messages_kind_check,
  add constraint messages_kind_check check (kind in ('chat', 'pigeon'));

-- ===========================================================================
-- 4. Flights: denormalize chat_id + sender_id
--
-- The recipient must see an incoming pigeon (announcement + live map)
-- while the letter itself is still hidden from them. So the flight row
-- has to be authorizable and filterable (realtime: chat_id=eq.X) without
-- reading the message — which also removes the flights -> messages policy
-- dependency that would otherwise recurse with the new messages policy.
-- ===========================================================================
alter table pigeon.pigeon_flights
  add column if not exists chat_id uuid references pigeon.chats (id) on delete cascade,
  add column if not exists sender_id uuid references pigeon.profiles (id) on delete cascade;

update pigeon.pigeon_flights f
set chat_id = m.chat_id, sender_id = m.sender_id
from pigeon.messages m
where m.id = f.message_id and (f.chat_id is null or f.sender_id is null);

create index if not exists pigeon_flights_chat_id_idx on pigeon.pigeon_flights (chat_id);

create or replace function pigeon.set_flight_chat_and_sender()
returns trigger
language plpgsql
security definer
set search_path = pigeon
as $$
begin
  select m.chat_id, m.sender_id into new.chat_id, new.sender_id
  from pigeon.messages m
  where m.id = new.message_id;
  return new;
end;
$$;

revoke execute on function pigeon.set_flight_chat_and_sender() from public, anon, authenticated;

drop trigger if exists set_flight_chat_and_sender on pigeon.pigeon_flights;
create trigger set_flight_chat_and_sender
  before insert on pigeon.pigeon_flights
  for each row execute function pigeon.set_flight_chat_and_sender();

drop policy if exists "users can view flights for messages in their chats" on pigeon.pigeon_flights;
create policy "chat participants can view flights in their chats"
  on pigeon.pigeon_flights for select
  to authenticated
  using (pigeon.is_chat_participant(chat_id, auth.uid()));

-- Only pigeon letters fly now; chat messages are delivered instantly.
drop trigger if exists start_pigeon_flight_on_message on pigeon.messages;
create trigger start_pigeon_flight_on_message
  after insert on pigeon.messages
  for each row
  when (new.kind = 'pigeon')
  execute function pigeon.trigger_start_pigeon_flight();

-- ===========================================================================
-- 5. Letter visibility: hidden from the recipient until the pigeon lands
-- ===========================================================================
create or replace function pigeon.is_flight_delivered(p_message_id uuid)
returns boolean
language sql
security definer
set search_path = pigeon
stable
as $$
  select exists (
    select 1 from pigeon.pigeon_flights
    where message_id = p_message_id and status = 'delivered'
  );
$$;

revoke execute on function pigeon.is_flight_delivered(uuid) from public, anon;
grant execute on function pigeon.is_flight_delivered(uuid) to authenticated;

drop policy if exists "users can view messages in their chats" on pigeon.messages;
create policy "users can view messages in their chats"
  on pigeon.messages for select
  to authenticated
  using (
    pigeon.is_chat_participant(chat_id, auth.uid())
    and (
      kind = 'chat'
      or sender_id = auth.uid()
      or pigeon.is_flight_delivered(id)
    )
  );

-- Same rule for attachments: "{chat_id}/{message_id}.{ext}" is readable
-- once the message itself is. The flight row exposes message_id to the
-- recipient, so without this the attachment path of an in-flight letter
-- would be guessable. Uploaders can always read their own objects (needed
-- for x-upsert retries before the message row exists).
create or replace function pigeon.can_read_attachment(p_name text)
returns boolean
language plpgsql
security definer
set search_path = pigeon
stable
as $$
declare
  v_chat_id uuid;
  v_message_id uuid;
  v_folder text := (storage.foldername(p_name))[1];
  v_file_stem text := split_part(storage.filename(p_name), '.', 1);
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_folder !~ uuid_pattern or v_file_stem !~ uuid_pattern then
    return false;
  end if;
  v_chat_id := v_folder::uuid;
  v_message_id := v_file_stem::uuid;

  return exists (
    select 1
    from pigeon.messages m
    where m.id = v_message_id
      and m.chat_id = v_chat_id
      and pigeon.is_chat_participant(m.chat_id, auth.uid())
      and (m.kind = 'chat' or m.sender_id = auth.uid() or pigeon.is_flight_delivered(m.id))
  );
end;
$$;

revoke execute on function pigeon.can_read_attachment(text) from public, anon;
grant execute on function pigeon.can_read_attachment(text) to authenticated;

drop policy if exists "chat participants can read chat images" on storage.objects;
create policy "chat participants can read chat images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pigeon-chat-images'
    and (owner = auth.uid() or pigeon.can_read_attachment(name))
  );

drop policy if exists "chat participants can read voice messages" on storage.objects;
create policy "chat participants can read voice messages"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pigeon-voice-messages'
    and (owner = auth.uid() or pigeon.can_read_attachment(name))
  );

-- ===========================================================================
-- 6. Avatars bucket
--
-- Public read (avatars appear in every chat list; a signed URL per avatar
-- per render isn't worth it for a profile picture), but object names are
-- random per upload and listing is limited to your own folder, so nobody
-- can enumerate them. Writes only into your own "{user_id}/" folder.
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pigeon-avatars',
  'pigeon-avatars',
  true,
  2097152, -- 2 MB; the client resizes to 256px before upload
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "members can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pigeon-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and pigeon.is_member()
  );

create policy "members can see their own avatar files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pigeon-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "members can delete their own avatar files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pigeon-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
