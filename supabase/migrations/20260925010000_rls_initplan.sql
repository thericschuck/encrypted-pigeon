-- ===========================================================================
-- RLS performance: evaluate auth.uid() / pigeon.is_member() once per query.
--
-- Called bare in a policy, Postgres re-evaluates them for every row it
-- checks. Wrapped in (select ...) they become an InitPlan, computed once
-- per statement (Supabase advisor lint 0003, auth_rls_initplan). Same
-- conditions as before -- only how often they are evaluated changes.
-- Generated from the live pg_policies definitions; ALTER POLICY keeps each
-- policy's command and roles as they are.
--
-- Per-row helpers with row arguments (is_chat_participant(chat_id, ...),
-- is_flight_delivered(id), can_read_attachment(name)) stay per row: their
-- result depends on the row.
-- ===========================================================================

alter policy "users can remove themselves from a chat" on pigeon.chat_participants
  using (((select auth.uid()) = user_id));

alter policy "users can view participant rows of their chats" on pigeon.chat_participants
  using (pigeon.is_chat_participant(chat_id, (select auth.uid())));

alter policy "users can view chats they participate in" on pigeon.chats
  using ((EXISTS ( SELECT 1
   FROM pigeon.chat_participants cp
  WHERE ((cp.chat_id = chats.id) AND (cp.user_id = (select auth.uid()))))));

alter policy "users can send messages to their chats" on pigeon.messages
  with check (((sender_id = (select auth.uid())) AND pigeon.is_chat_participant(chat_id, (select auth.uid())) AND ((image_url IS NULL) OR (image_url ~~ ((chat_id)::text || '/%'::text))) AND ((audio_url IS NULL) OR (audio_url ~~ ((chat_id)::text || '/%'::text)))));

alter policy "users can view messages in their chats" on pigeon.messages
  using ((pigeon.is_chat_participant(chat_id, (select auth.uid())) AND ((kind = 'chat'::text) OR (sender_id = (select auth.uid())) OR pigeon.is_flight_delivered(id))));

alter policy "chat participants can view flights in their chats" on pigeon.pigeon_flights
  using (pigeon.is_chat_participant(chat_id, (select auth.uid())));

alter policy "members can read all member profiles" on pigeon.profiles
  using ((select pigeon.is_member()));

alter policy "users can update their own profile" on pigeon.profiles
  using (((select auth.uid()) = id))
  with check (((select auth.uid()) = id));

alter policy "users can create their own push subscriptions" on pigeon.push_subscriptions
  with check (((select auth.uid()) = user_id));

alter policy "users can delete their own push subscriptions" on pigeon.push_subscriptions
  using (((select auth.uid()) = user_id));

alter policy "users can view their own push subscriptions" on pigeon.push_subscriptions
  using (((select auth.uid()) = user_id));

alter policy "chat participants can read chat images" on storage.objects
  using (((bucket_id = 'pigeon-chat-images'::text) AND ((owner = (select auth.uid())) OR pigeon.can_read_attachment(name))));

alter policy "chat participants can read voice messages" on storage.objects
  using (((bucket_id = 'pigeon-voice-messages'::text) AND ((owner = (select auth.uid())) OR pigeon.can_read_attachment(name))));

alter policy "chat participants can upload chat images" on storage.objects
  with check (((bucket_id = 'pigeon-chat-images'::text) AND (EXISTS ( SELECT 1
   FROM pigeon.chat_participants cp
  WHERE ((cp.chat_id = ((storage.foldername(objects.name))[1])::uuid) AND (cp.user_id = (select auth.uid())))))));

alter policy "chat participants can upload voice messages" on storage.objects
  with check (((bucket_id = 'pigeon-voice-messages'::text) AND (EXISTS ( SELECT 1
   FROM pigeon.chat_participants cp
  WHERE ((cp.chat_id = ((storage.foldername(objects.name))[1])::uuid) AND (cp.user_id = (select auth.uid())))))));

alter policy "members can delete their own avatar files" on storage.objects
  using (((bucket_id = 'pigeon-avatars'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

alter policy "members can see their own avatar files" on storage.objects
  using (((bucket_id = 'pigeon-avatars'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

alter policy "members can upload their own avatar" on storage.objects
  with check (((bucket_id = 'pigeon-avatars'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text) AND (select pigeon.is_member())));

alter policy "uploaders can delete their own chat images" on storage.objects
  using (((bucket_id = 'pigeon-chat-images'::text) AND (owner = (select auth.uid()))));

alter policy "uploaders can delete their own voice messages" on storage.objects
  using (((bucket_id = 'pigeon-voice-messages'::text) AND (owner = (select auth.uid()))));

alter policy "uploaders can overwrite/delete their own chat images" on storage.objects
  using (((bucket_id = 'pigeon-chat-images'::text) AND (owner = (select auth.uid()))))
  with check (((bucket_id = 'pigeon-chat-images'::text) AND (owner = (select auth.uid())) AND pigeon.is_chat_participant(((storage.foldername(name))[1])::uuid, (select auth.uid()))));

alter policy "uploaders can overwrite/delete their own voice messages" on storage.objects
  using (((bucket_id = 'pigeon-voice-messages'::text) AND (owner = (select auth.uid()))))
  with check (((bucket_id = 'pigeon-voice-messages'::text) AND (owner = (select auth.uid())) AND pigeon.is_chat_participant(((storage.foldername(name))[1])::uuid, (select auth.uid()))));
