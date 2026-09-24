-- Pulled into the repo from the live project's migration history (it was
-- applied directly via the Supabase MCP and never committed).
--
-- pigeon.chat_participants' own SELECT/INSERT policies checked membership by
-- querying chat_participants again, which re-triggers the same policy —
-- infinite recursion (42P17). A SECURITY DEFINER helper breaks the cycle: it
-- runs as the (table-owning) function owner, which bypasses RLS for this
-- internal check, so the recursion never restarts.
create or replace function pigeon.is_chat_participant(p_chat_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = pigeon
stable
as $$
  select exists (
    select 1
    from pigeon.chat_participants
    where chat_id = p_chat_id
      and user_id = p_user_id
  );
$$;

grant execute on function pigeon.is_chat_participant(uuid, uuid) to authenticated;

drop policy if exists "users can view participant rows of their chats" on pigeon.chat_participants;
create policy "users can view participant rows of their chats"
  on pigeon.chat_participants for select
  to authenticated
  using (pigeon.is_chat_participant(chat_id, auth.uid()));

drop policy if exists "users can add participants to their own chats" on pigeon.chat_participants;
create policy "users can add participants to their own chats"
  on pigeon.chat_participants for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or pigeon.is_chat_participant(chat_id, auth.uid())
  );
