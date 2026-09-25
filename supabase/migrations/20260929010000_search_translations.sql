-- Search + paging for the translator history in one call. strpos() on
-- lower() instead of ilike: the search text is taken literally (no
-- escaping of % and _ needed) and works the same for Chinese.
-- SECURITY INVOKER, so RLS ("own translations only") still applies; the
-- user_id filter is there for the index.

create or replace function pigeon.search_translations(
  p_query text default null,
  p_before timestamptz default null,
  p_limit integer default 50
)
returns setof pigeon.translations
language sql
stable
security invoker
set search_path = pigeon
as $$
  select t.*
  from pigeon.translations t
  where t.user_id = (select auth.uid())
    and (
      coalesce(p_query, '') = ''
      or strpos(lower(t.source_text), lower(p_query)) > 0
      or strpos(lower(t.translated_text), lower(p_query)) > 0
    )
    and (p_before is null or t.created_at < p_before)
  order by t.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke execute on function pigeon.search_translations(text, timestamptz, integer) from public, anon;
grant execute on function pigeon.search_translations(text, timestamptz, integer) to authenticated;
