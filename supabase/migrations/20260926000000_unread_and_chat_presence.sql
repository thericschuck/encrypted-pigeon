-- ===========================================================================
-- Unread messages + "is looking at this chat right now".
--
-- chat_participants.last_read_at   up to when this person has seen the chat.
--                                  Defaults to now(), so everything that
--                                  exists when this migration runs counts
--                                  as read (no flood of old "unread").
-- chat_participants.viewing_until  set while the chat is open and visible
--                                  on one of their devices (heartbeat from
--                                  the app, see lib/chat/use-chat-read-state.ts).
--                                  send-push-notification skips people who
--                                  are looking at that very chat.
--
-- Both are written only through pigeon.mark_chat_read() — chat_participants
-- still has no UPDATE grant/policy for users.
-- ===========================================================================

alter table pigeon.chat_participants
  add column if not exists last_read_at timestamptz not null default now(),
  add column if not exists viewing_until timestamptz;

-- ---------------------------------------------------------------------------
-- unread_counts_for_chats: unread messages per chat for the chat list.
--
-- SECURITY INVOKER on purpose: the messages RLS policy still applies, so
-- pigeon letters still in flight to the caller don't count. A letter
-- counts from the moment it lands (arrival_time), not from when it was
-- sent — it may have been sent before the chat was last read.
-- ---------------------------------------------------------------------------
create or replace function pigeon.unread_counts_for_chats(p_chat_ids uuid[])
returns table (chat_id uuid, unread integer)
language sql
security invoker
set search_path = pigeon
stable
as $$
  select cp.chat_id, count(m.id)::integer as unread
  from pigeon.chat_participants cp
  join pigeon.messages m
    on m.chat_id = cp.chat_id
   and m.sender_id <> cp.user_id
  left join pigeon.pigeon_flights f
    on f.message_id = m.id
  where cp.user_id = (select auth.uid())
    and cp.chat_id = any (p_chat_ids)
    and (
      (m.kind = 'chat' and m.created_at > cp.last_read_at)
      or (m.kind = 'pigeon' and coalesce(f.arrival_time, m.created_at) > cp.last_read_at)
    )
  group by cp.chat_id;
$$;

revoke execute on function pigeon.unread_counts_for_chats(uuid[]) from public, anon;
grant execute on function pigeon.unread_counts_for_chats(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- unread_total_for_user: the number on the app icon, sent along with each
-- push. Service role only (the edge function) — it takes any user id;
-- mark_chat_read() below calls it for the caller.
-- Letters still in the air don't count (same rule as the RLS policy).
-- ---------------------------------------------------------------------------
create or replace function pigeon.unread_total_for_user(p_user_id uuid)
returns integer
language sql
security definer
set search_path = pigeon
stable
as $$
  select count(m.id)::integer
  from pigeon.chat_participants cp
  join pigeon.messages m
    on m.chat_id = cp.chat_id
   and m.sender_id <> cp.user_id
  left join pigeon.pigeon_flights f
    on f.message_id = m.id
  where cp.user_id = p_user_id
    and (
      (m.kind = 'chat' and m.created_at > cp.last_read_at)
      or (
        m.kind = 'pigeon'
        and f.status = 'delivered'
        and coalesce(f.arrival_time, m.created_at) > cp.last_read_at
      )
    );
$$;

revoke execute on function pigeon.unread_total_for_user(uuid) from public, anon, authenticated;
grant execute on function pigeon.unread_total_for_user(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- mark_chat_read: "I've seen this chat up to now" + presence heartbeat.
-- p_viewing = true  -> still open and visible (valid for 45 s, renewed by
--                      the app every 20 s)
-- p_viewing = false -> left the chat / app went to the background
-- Returns my unread total afterwards, for the number on the app icon.
-- ---------------------------------------------------------------------------
create or replace function pigeon.mark_chat_read(p_chat_id uuid, p_viewing boolean default true)
returns integer
language plpgsql
security definer
set search_path = pigeon
as $$
begin
  update pigeon.chat_participants
  set last_read_at = greatest(last_read_at, now()),
      viewing_until = case when p_viewing then now() + interval '45 seconds' else null end
  where chat_id = p_chat_id
    and user_id = (select auth.uid());

  return pigeon.unread_total_for_user((select auth.uid()));
end;
$$;

revoke execute on function pigeon.mark_chat_read(uuid, boolean) from public, anon;
grant execute on function pigeon.mark_chat_read(uuid, boolean) to authenticated;
