-- Translator history (/translate): everything translated so far, per user,
-- searchable. Doubles as a cache — the exact same text into the same
-- language is answered from here instead of spending DeepL characters
-- again (unique on user + target + md5(text), so lookups are one index
-- probe and repeats don't pile up as duplicates).

create table if not exists pigeon.translations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references pigeon.profiles (id) on delete cascade,
  -- What DeepL detected (or was told), e.g. 'DE' / 'ZH'.
  source_lang text not null,
  target_lang text not null,
  source_text text not null,
  translated_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists translations_user_created_idx
  on pigeon.translations (user_id, created_at desc);

create unique index if not exists translations_user_target_text_key
  on pigeon.translations (user_id, target_lang, md5(source_text));

-- update: re-translating an entry moves it back to the top (created_at).
grant select, insert, update, delete on pigeon.translations to authenticated;
grant all on pigeon.translations to service_role;

alter table pigeon.translations enable row level security;

drop policy if exists "users manage their own translations" on pigeon.translations;
create policy "users manage their own translations"
  on pigeon.translations for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
