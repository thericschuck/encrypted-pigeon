-- ===========================================================================
-- KI-Assistent: editable memory + instructions, both part of every system
-- prompt (src/lib/ai/context.ts).
--
-- ai_memories: single facts about the owner ("Ich lebe in Dengfeng").
-- The assistant may *suggest* one in an answer; it's only stored when the
-- owner confirms it in the UI — nothing is written behind their back.
-- ai_settings: free-form instructions on how to answer.
-- ===========================================================================

create table if not exists pigeon.ai_settings (
  owner_id uuid primary key references pigeon.profiles (id) on delete cascade,
  instructions text not null default '' check (char_length(instructions) <= 4000),
  updated_at timestamptz not null default now()
);

create table if not exists pigeon.ai_memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references pigeon.profiles (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists ai_memories_owner_created_idx on pigeon.ai_memories (owner_id, created_at);

alter table pigeon.ai_settings enable row level security;
alter table pigeon.ai_memories enable row level security;

drop policy if exists "owners manage their ai settings" on pigeon.ai_settings;
create policy "owners manage their ai settings"
  on pigeon.ai_settings for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select pigeon.is_member()));

drop policy if exists "owners manage their ai memories" on pigeon.ai_memories;
create policy "owners manage their ai memories"
  on pigeon.ai_memories for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select pigeon.is_member()));
