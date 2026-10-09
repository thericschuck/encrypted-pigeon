-- UI language per member (de / en / fr / zh). Mirrors theme: lives on the
-- profile so it follows the user across devices and lets the server send
-- push notifications and emails in their language.
alter table pigeon.profiles
  add column if not exists language text not null default 'de',
  drop constraint if exists profiles_language_check,
  add constraint profiles_language_check check (language in ('de', 'en', 'fr', 'zh'));

grant update (language) on pigeon.profiles to authenticated;