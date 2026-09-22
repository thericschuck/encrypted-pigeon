-- Chat image uploads: private storage bucket + RLS scoped to chat participants.
--
-- Bucket name "pigeon-chat-images" is deliberately unique/prefixed to avoid
-- colliding with buckets already in this shared Supabase project from the
-- unrelated prior project.
--
-- Objects are stored as "{chat_id}/{message_id}.{ext}" so RLS can authorize
-- by chat participancy from the first path segment,
-- (storage.foldername(name))[1]::uuid. The bucket is NOT public: the app
-- resolves images via short-lived signed URLs (see
-- src/app/chat/[chatId]/chat-room.tsx), since a public bucket would let
-- anyone with a leaked URL view an image forever, not just current chat
-- participants.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pigeon-chat-images',
  'pigeon-chat-images',
  false,
  10485760, -- 10 MB; client already compresses/resizes before upload
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

create policy "chat participants can upload chat images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pigeon-chat-images'
    and exists (
      select 1
      from pigeon.chat_participants cp
      where cp.chat_id = (storage.foldername(name))[1]::uuid
        and cp.user_id = auth.uid()
    )
  );

create policy "chat participants can read chat images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pigeon-chat-images'
    and exists (
      select 1
      from pigeon.chat_participants cp
      where cp.chat_id = (storage.foldername(name))[1]::uuid
        and cp.user_id = auth.uid()
    )
  );

-- Lets a sender re-upload (retry) under the same message id (see x-upsert in
-- the client) and clean up if they delete their own message later.
create policy "uploaders can overwrite/delete their own chat images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'pigeon-chat-images' and owner = auth.uid())
  with check (bucket_id = 'pigeon-chat-images' and owner = auth.uid());

create policy "uploaders can delete their own chat images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'pigeon-chat-images' and owner = auth.uid());
