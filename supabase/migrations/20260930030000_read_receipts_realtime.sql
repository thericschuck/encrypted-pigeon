-- Read receipts (✓✓ gelesen): the chat listens to the partner's
-- chat_participants row, whose last_read_at mark_chat_read() moves
-- forward while they have the chat open. Realtime still applies the
-- SELECT policy ("participant rows of their chats"), so nobody receives
-- rows of chats they're not in.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'pigeon'
      and tablename = 'chat_participants'
  ) then
    alter publication supabase_realtime add table pigeon.chat_participants;
  end if;
end;
$$;
