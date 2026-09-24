// Storage bucket names for chat attachments, in a module without browser
// dependencies so server code (e.g. the admin's member deletion) can use
// them too. Must match the buckets created in
// supabase/migrations/20260922000000_chat_images_storage.sql,
// supabase/migrations/20260923010000_voice_messages_storage.sql and
// supabase/migrations/20260926010000_chat_videos_any_image.sql.
export const CHAT_IMAGE_BUCKET = "pigeon-chat-images";
export const CHAT_VOICE_BUCKET = "pigeon-voice-messages";
export const CHAT_VIDEO_BUCKET = "pigeon-chat-videos";
