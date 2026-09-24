-- Pre-rollout RLS audit fixes. Only touches pigeon.* objects and the
-- storage.objects policies scoped to the pigeon-* buckets.

-- ---------------------------------------------------------------------------
-- 1. chat_participants / chats: no client-side membership changes.
--
-- The old INSERT policy allowed `auth.uid() = user_id` for ANY chat_id, i.e.
-- anyone who learned a chat id (it's in every chat URL and storage path)
-- could add themselves to that chat and read all of its messages, images
-- and voice notes. Chats and memberships are only ever created by
-- lib/auth/bootstrap.ts via the service-role client, which bypasses RLS, so
-- the client needs no INSERT rights here at all.
-- ---------------------------------------------------------------------------
drop policy if exists "users can add participants to their own chats" on pigeon.chat_participants;
drop policy if exists "authenticated users can create chats" on pigeon.chats;

-- ---------------------------------------------------------------------------
-- 2. pigeon_flights: server-authoritative only.
--
-- start-pigeon-flight (service role) upserts the row; deliver-pigeon-flights
-- (cron) flips it to delivered. Letting the sender INSERT/UPDATE meant they
-- could fast-forward their own flight or toggle status back and forth to
-- re-fire the "arrived" push trigger at the recipient.
-- ---------------------------------------------------------------------------
drop policy if exists "senders can create a flight for their own message" on pigeon.pigeon_flights;
drop policy if exists "senders can update the flight for their own message" on pigeon.pigeon_flights;

-- ---------------------------------------------------------------------------
-- 3. messages: attachment paths must live in the message's own chat folder,
-- so a message can't point its image_url/audio_url at another chat's object.
-- ---------------------------------------------------------------------------
drop policy if exists "users can send messages to their chats" on pigeon.messages;
create policy "users can send messages to their chats"
  on pigeon.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and pigeon.is_chat_participant(chat_id, auth.uid())
    and (image_url is null or image_url like chat_id::text || '/%')
    and (audio_url is null or audio_url like chat_id::text || '/%')
  );

-- ---------------------------------------------------------------------------
-- 4. profiles: only your own profile and the people you share a chat with
-- (was: every authenticated user could list every email address).
-- ---------------------------------------------------------------------------
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

drop policy if exists "profiles are readable by authenticated users" on pigeon.profiles;
create policy "users can read their own and their chat partners' profiles"
  on pigeon.profiles for select
  to authenticated
  using (id = auth.uid() or pigeon.shares_chat_with(id));

-- ---------------------------------------------------------------------------
-- 5. Function EXECUTE grants. Postgres grants EXECUTE to PUBLIC by default
-- and "pigeon" is an exposed PostgREST schema, so every function here is an
-- RPC endpoint unless revoked. The RLS helpers must stay callable by
-- `authenticated` (policies evaluate as the querying role); anon never.
-- ---------------------------------------------------------------------------
revoke execute on function pigeon.is_chat_participant(uuid, uuid) from public, anon;
grant execute on function pigeon.is_chat_participant(uuid, uuid) to authenticated;
revoke execute on function pigeon.shares_chat_with(uuid) from public, anon;
grant execute on function pigeon.shares_chat_with(uuid) to authenticated;
revoke execute on function pigeon.trigger_start_pigeon_flight() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Storage: an uploader could previously UPDATE (move/rename) their own
-- object into any folder, including another chat's. Re-check chat
-- membership for the target path, not just ownership.
-- ---------------------------------------------------------------------------
drop policy if exists "uploaders can overwrite/delete their own chat images" on storage.objects;
create policy "uploaders can overwrite/delete their own chat images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'pigeon-chat-images' and owner = auth.uid())
  with check (
    bucket_id = 'pigeon-chat-images'
    and owner = auth.uid()
    and pigeon.is_chat_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  );

drop policy if exists "uploaders can overwrite/delete their own voice messages" on storage.objects;
create policy "uploaders can overwrite/delete their own voice messages"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'pigeon-voice-messages' and owner = auth.uid())
  with check (
    bucket_id = 'pigeon-voice-messages'
    and owner = auth.uid()
    and pigeon.is_chat_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 7. Realtime for pigeon_flights. The chat's status badges and the flight
-- map subscribe to UPDATEs on this table, but it was never added to the
-- publication — so those events never arrived and badges only changed on
-- reload. RLS ("users can view flights for messages in their chats") still
-- decides who receives each change.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'pigeon'
      and tablename = 'pigeon_flights'
  ) then
    alter publication supabase_realtime add table pigeon.pigeon_flights;
  end if;
end
$$;
