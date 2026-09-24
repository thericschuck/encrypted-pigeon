-- ===========================================================================
-- Latest message per chat for the chat list (dashboard + sidebar).
--
-- Replaces loading the 300 newest messages across all chats and picking
-- the first per chat in the app: this returns exactly one row per chat,
-- each found with a single index probe on messages(chat_id, created_at).
--
-- SECURITY INVOKER on purpose: the messages RLS policy still applies, so
-- chats the caller isn't in return nothing and pigeon letters still in
-- flight to the caller are skipped (the previous readable message wins).
-- ===========================================================================
create or replace function pigeon.latest_messages_for_chats(p_chat_ids uuid[])
returns table (
  chat_id uuid,
  sender_id uuid,
  kind text,
  content text,
  image_url text,
  audio_url text,
  created_at timestamptz
)
language sql
security invoker
set search_path = pigeon
stable
as $$
  select latest.*
  from unnest(p_chat_ids) as c(id)
  cross join lateral (
    select m.chat_id, m.sender_id, m.kind, m.content, m.image_url, m.audio_url, m.created_at
    from pigeon.messages m
    where m.chat_id = c.id
    order by m.created_at desc
    limit 1
  ) as latest;
$$;

revoke execute on function pigeon.latest_messages_for_chats(uuid[]) from public, anon;
grant execute on function pigeon.latest_messages_for_chats(uuid[]) to authenticated;
