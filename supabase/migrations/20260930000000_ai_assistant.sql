-- ===========================================================================
-- KI-Assistent (/ai, admin only): conversations with DeepSeek.
--
-- The DeepSeek call itself runs server-side (src/app/api/ai/chat/route.ts),
-- which is also where "admin only" is enforced. RLS here just keeps every
-- conversation private to its owner.
-- ===========================================================================

create table if not exists pigeon.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references pigeon.profiles (id) on delete cascade,
  title text not null check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_owner_updated_idx
  on pigeon.ai_conversations (owner_id, updated_at desc);

create table if not exists pigeon.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references pigeon.ai_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- The reasoner model's chain of thought (shown collapsed, never sent back).
  reasoning text,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_created_idx
  on pigeon.ai_messages (conversation_id, created_at);

alter table pigeon.ai_conversations enable row level security;
alter table pigeon.ai_messages enable row level security;

drop policy if exists "owners manage their ai conversations" on pigeon.ai_conversations;
create policy "owners manage their ai conversations"
  on pigeon.ai_conversations for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select pigeon.is_member()));

drop policy if exists "owners manage messages of their ai conversations" on pigeon.ai_messages;
create policy "owners manage messages of their ai conversations"
  on pigeon.ai_messages for all
  to authenticated
  using (exists (
    select 1 from pigeon.ai_conversations c
    where c.id = conversation_id and c.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from pigeon.ai_conversations c
    where c.id = conversation_id and c.owner_id = (select auth.uid())
  ));
