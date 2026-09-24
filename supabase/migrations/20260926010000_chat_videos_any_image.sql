-- Video messages + any image format.
--
-- The client now downscales/re-encodes every picked image and video
-- before upload (src/lib/media/), so the buckets mainly act as a safety
-- net. Images the browser can't decode at all (e.g. an exotic RAW format)
-- are sent as-is, which is why the image bucket no longer restricts the
-- MIME type. 50 MB is the largest per-file limit every Supabase plan
-- allows.

-- ===========================================================================
-- 1. Buckets
-- ===========================================================================
update storage.buckets
set file_size_limit = 52428800, allowed_mime_types = null
where id = 'pigeon-chat-images';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pigeon-chat-videos',
  'pigeon-chat-videos',
  false,
  52428800, -- 50 MB; the client transcodes/compresses to stay below it
  array['video/*']
)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Same rules as the chat image bucket: objects are
-- "{chat_id}/{message_id}.{ext}", uploads only into a chat you're in,
-- reads for the uploader or anyone allowed to read the message.
drop policy if exists "chat participants can upload chat videos" on storage.objects;
create policy "chat participants can upload chat videos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pigeon-chat-videos'
    and pigeon.is_chat_participant(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  );

drop policy if exists "chat participants can read chat videos" on storage.objects;
create policy "chat participants can read chat videos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pigeon-chat-videos'
    and (owner = (select auth.uid()) or pigeon.can_read_attachment(name))
  );

drop policy if exists "uploaders can overwrite their own chat videos" on storage.objects;
create policy "uploaders can overwrite their own chat videos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'pigeon-chat-videos' and owner = (select auth.uid()))
  with check (
    bucket_id = 'pigeon-chat-videos'
    and owner = (select auth.uid())
    and pigeon.is_chat_participant(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  );

drop policy if exists "uploaders can delete their own chat videos" on storage.objects;
create policy "uploaders can delete their own chat videos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'pigeon-chat-videos' and owner = (select auth.uid()));

-- ===========================================================================
-- 2. messages.video_url
-- ===========================================================================
alter table pigeon.messages
  add column if not exists video_url text;

alter table pigeon.messages
  drop constraint if exists messages_has_payload;

alter table pigeon.messages
  add constraint messages_has_payload check (
    content is not null or image_url is not null or audio_url is not null or video_url is not null
  );

alter policy "users can send messages to their chats" on pigeon.messages
  with check (((sender_id = (select auth.uid())) AND pigeon.is_chat_participant(chat_id, (select auth.uid())) AND ((image_url IS NULL) OR (image_url ~~ ((chat_id)::text || '/%'::text))) AND ((audio_url IS NULL) OR (audio_url ~~ ((chat_id)::text || '/%'::text))) AND ((video_url IS NULL) OR (video_url ~~ ((chat_id)::text || '/%'::text)))));

-- ===========================================================================
-- 3. Chat list preview needs to know about videos too
-- ===========================================================================
drop function if exists pigeon.latest_messages_for_chats(uuid[]);
create function pigeon.latest_messages_for_chats(p_chat_ids uuid[])
returns table (
  chat_id uuid,
  sender_id uuid,
  kind text,
  content text,
  image_url text,
  audio_url text,
  video_url text,
  created_at timestamptz
)
language sql
security invoker
set search_path = pigeon
stable
as $$
  select latest.*
  from unnest(p_chat_ids) as c(id)
  cross join lateral (
    select m.chat_id, m.sender_id, m.kind, m.content, m.image_url, m.audio_url, m.video_url, m.created_at
    from pigeon.messages m
    where m.chat_id = c.id
    order by m.created_at desc
    limit 1
  ) as latest;
$$;

revoke execute on function pigeon.latest_messages_for_chats(uuid[]) from public, anon;
grant execute on function pigeon.latest_messages_for_chats(uuid[]) to authenticated;
