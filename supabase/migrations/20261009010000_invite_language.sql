-- Language chosen by the admin when inviting someone; becomes the initial
-- profiles.language when the invited person first signs in.
alter table pigeon.invites
  add column if not exists language text,
  drop constraint if exists invites_language_check,
  add constraint invites_language_check check (language is null or language in ('de', 'en', 'fr', 'zh'));
