-- Voice message uploads: private storage bucket + RLS scoped to chat
-- participants. Structurally identical to
-- 20260922000000_chat_images_storage.sql (private bucket, signed-URL reads,
-- path = "{chat_id}/{message_id}.{ext}"), just a separate bucket/mime
-- allowlist for audio.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pigeon-voice-messages',
  'pigeon-voice-messages',
  false,
  15728640, -- 15 MB: comfortably covers several minutes of compressed voice audio
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/x-m4a']
)
on conflict (id) do nothing;

create policy "chat participants can upload voice messages"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pigeon-voice-messages'
    and exists (
      select 1
      from pigeon.chat_participants cp
      where cp.chat_id = (storage.foldername(name))[1]::uuid
        and cp.user_id = auth.uid()
    )
  );

create policy "chat participants can read voice messages"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pigeon-voice-messages'
    and exists (
      select 1
      from pigeon.chat_participants cp
      where cp.chat_id = (storage.foldername(name))[1]::uuid
        and cp.user_id = auth.uid()
    )
  );

create policy "uploaders can overwrite/delete their own voice messages"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'pigeon-voice-messages' and owner = auth.uid())
  with check (bucket_id = 'pigeon-voice-messages' and owner = auth.uid());

create policy "uploaders can delete their own voice messages"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'pigeon-voice-messages' and owner = auth.uid());
