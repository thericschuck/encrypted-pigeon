-- Enable Supabase Realtime (postgres_changes) for pigeon.messages.
--
-- New migration file rather than editing the initial one in place: since
-- .env.local now has real project credentials, the first migration may
-- already have been applied by hand — treat it as immutable from here on.
--
-- This is the full SQL equivalent of toggling a table under
-- Database -> Replication -> supabase_realtime in the dashboard. No manual
-- dashboard step is needed; the checkbox there just runs this same
-- "alter publication ... add table" underneath. RLS on pigeon.messages
-- (already in place) is what Realtime uses to decide who each change gets
-- delivered to — the publication membership only decides whether the table
-- is watched at all.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'pigeon'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table pigeon.messages;
  end if;
end
$$;
