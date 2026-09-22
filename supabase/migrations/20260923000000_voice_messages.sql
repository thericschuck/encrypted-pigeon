-- Voice messages: audio_url (storage path, mirrors image_url) plus
-- audio_duration_seconds so the player can show a duration before the
-- audio's metadata has loaded.

alter table pigeon.messages
  add column if not exists audio_url text,
  add column if not exists audio_duration_seconds numeric;

-- Widen the "must have a payload" constraint to also accept an audio-only
-- message (same idea as image_url: a voice note has no text content).
alter table pigeon.messages
  drop constraint if exists messages_content_or_image;

alter table pigeon.messages
  add constraint messages_has_payload check (
    content is not null or image_url is not null or audio_url is not null
  );
