-- ===========================================================================
-- KI-Assistent: photos in questions ("was ist das für ein Produkt?").
--
-- Files live in the private bucket pigeon-ai-images under "{owner_id}/…";
-- ai_messages.images holds their paths. The server reads them with the
-- owner's session and sends them to DeepSeek's vision model inline, so
-- nothing is ever publicly reachable.
-- ===========================================================================

alter table pigeon.ai_messages
  add column if not exists images text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pigeon-ai-images',
  'pigeon-ai-images',
  false,
  10485760, -- 10 MB; the client already scales photos down before upload
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

drop policy if exists "members upload their own ai images" on storage.objects;
create policy "members upload their own ai images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pigeon-ai-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select pigeon.is_member())
  );

drop policy if exists "members read their own ai images" on storage.objects;
create policy "members read their own ai images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pigeon-ai-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "members delete their own ai images" on storage.objects;
create policy "members delete their own ai images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pigeon-ai-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
