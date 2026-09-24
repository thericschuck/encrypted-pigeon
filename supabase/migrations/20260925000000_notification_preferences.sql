-- ===========================================================================
-- Per-user choice of which push notifications to get.
--
-- notification_prefs maps a notification type to false to switch it off;
-- a missing key means "on", so new types start enabled for everyone.
-- Types (see supabase/functions/send-push-notification and
-- src/lib/push/notification-prefs.ts):
--   chat            new chat message
--   letter_incoming a pigeon letter is on its way to me
--   letter_arrived  a letter to me has landed (with preview)
--   own_arrived     my own pigeon has delivered its letter
--   incident        something happened during a flight
--
-- Filtering happens server-side in the edge function: browsers require
-- every received push to show a notification, so dropping unwanted ones
-- in the service worker isn't an option.
-- ===========================================================================
alter table pigeon.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- profiles only has column-level UPDATE grants (see
-- 20260924020000_dashboard_and_pigeon_letters.sql); the existing "own row"
-- update policy then limits it to the caller's profile.
grant update (notification_prefs) on pigeon.profiles to authenticated;
