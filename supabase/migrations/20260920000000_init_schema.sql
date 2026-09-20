-- Encrypted Pigeon: initial schema
-- profiles, chats (1:1 for now), chat_participants, messages, pigeon_flights
--
-- Everything lives in its own "pigeon" schema, not "public", because this
-- Supabase project is shared with an unrelated prior project's tables.
--
-- IMPORTANT — manual step this migration cannot do for you:
-- PostgREST (the API Supabase-js talks to) only serves schemas listed under
-- Project Settings -> API -> Data API -> "Exposed schemas". Add "pigeon"
-- there (dashboard, or the Management API) or every request will fail with
-- "The schema must be one of the following: public, graphql_public".

create schema if not exists pigeon;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- pigeon.profiles
-- ---------------------------------------------------------------------------
create table if not exists pigeon.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- pigeon.chats
-- 1:1 for now, but modeled so it can grow into group chats later.
-- ---------------------------------------------------------------------------
create table if not exists pigeon.chats (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- pigeon.chat_participants
-- ---------------------------------------------------------------------------
create table if not exists pigeon.chat_participants (
  chat_id uuid not null references pigeon.chats (id) on delete cascade,
  user_id uuid not null references pigeon.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create index if not exists chat_participants_user_id_idx
  on pigeon.chat_participants (user_id);

-- ---------------------------------------------------------------------------
-- pigeon.messages
-- ---------------------------------------------------------------------------
create table if not exists pigeon.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references pigeon.chats (id) on delete cascade,
  sender_id uuid not null references pigeon.profiles (id) on delete cascade,
  content text,
  image_url text,
  created_at timestamptz not null default now(),
  constraint messages_content_or_image check (
    content is not null or image_url is not null
  )
);

create index if not exists messages_chat_id_created_at_idx
  on pigeon.messages (chat_id, created_at);

-- ---------------------------------------------------------------------------
-- pigeon.pigeon_flights
-- one flight per message: the "encryption + carrier pigeon delivery" state
-- machine that drives the map animation.
-- ---------------------------------------------------------------------------
create table if not exists pigeon.pigeon_flights (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references pigeon.messages (id) on delete cascade,
  departure_time timestamptz,
  arrival_time timestamptz,
  duration_seconds integer,
  events jsonb not null default '[]'::jsonb,
  status text not null default 'encrypting'
    check (status in ('encrypting', 'in_transit', 'delivered')),
  created_at timestamptz not null default now()
);

create index if not exists pigeon_flights_status_idx
  on pigeon.pigeon_flights (status);

-- ---------------------------------------------------------------------------
-- Schema-level grants
-- RLS narrows things down further below, but PostgREST first checks plain
-- SQL privileges — without these grants every request 42501s regardless of
-- policy. This is the part that's easy to forget for a non-"public" schema,
-- since Supabase sets these up for you automatically only for "public".
-- ---------------------------------------------------------------------------
grant usage on schema pigeon to authenticated, service_role;

grant select, insert, update, delete on all tables in schema pigeon to authenticated;
grant all on all tables in schema pigeon to service_role;

alter default privileges in schema pigeon
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema pigeon
  grant all on tables to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table pigeon.profiles enable row level security;
alter table pigeon.chats enable row level security;
alter table pigeon.chat_participants enable row level security;
alter table pigeon.messages enable row level security;
alter table pigeon.pigeon_flights enable row level security;

-- profiles ------------------------------------------------------------------
-- Any authenticated user can look up a profile (needed to render chat
-- partner names/avatars); only the owner can change their own row.
create policy "profiles are readable by authenticated users"
  on pigeon.profiles for select
  to authenticated
  using (true);

create policy "users can insert their own profile"
  on pigeon.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "users can update their own profile"
  on pigeon.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- chats -----------------------------------------------------------------
create policy "users can view chats they participate in"
  on pigeon.chats for select
  to authenticated
  using (
    exists (
      select 1
      from pigeon.chat_participants cp
      where cp.chat_id = chats.id
        and cp.user_id = auth.uid()
    )
  );

create policy "authenticated users can create chats"
  on pigeon.chats for insert
  to authenticated
  with check (true);

-- chat_participants -----------------------------------------------------
create policy "users can view participant rows of their chats"
  on pigeon.chat_participants for select
  to authenticated
  using (
    exists (
      select 1
      from pigeon.chat_participants cp
      where cp.chat_id = chat_participants.chat_id
        and cp.user_id = auth.uid()
    )
  );

-- A user may add themselves to a chat (e.g. right after creating it), or add
-- someone else to a chat they are already part of (inviting a friend).
create policy "users can add participants to their own chats"
  on pigeon.chat_participants for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or exists (
      select 1
      from pigeon.chat_participants cp
      where cp.chat_id = chat_participants.chat_id
        and cp.user_id = auth.uid()
    )
  );

create policy "users can remove themselves from a chat"
  on pigeon.chat_participants for delete
  to authenticated
  using (auth.uid() = user_id);

-- messages ----------------------------------------------------------------
create policy "users can view messages in their chats"
  on pigeon.messages for select
  to authenticated
  using (
    exists (
      select 1
      from pigeon.chat_participants cp
      where cp.chat_id = messages.chat_id
        and cp.user_id = auth.uid()
    )
  );

create policy "users can send messages to their chats"
  on pigeon.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1
      from pigeon.chat_participants cp
      where cp.chat_id = messages.chat_id
        and cp.user_id = auth.uid()
    )
  );

-- pigeon_flights ------------------------------------------------------------
-- Visible to anyone who can see the underlying message; only the sender can
-- create/update the flight record (client simulates the journey; a
-- server-side job could take this over later without changing the policy
-- shape).
create policy "users can view flights for messages in their chats"
  on pigeon.pigeon_flights for select
  to authenticated
  using (
    exists (
      select 1
      from pigeon.messages m
      join pigeon.chat_participants cp on cp.chat_id = m.chat_id
      where m.id = pigeon_flights.message_id
        and cp.user_id = auth.uid()
    )
  );

create policy "senders can create a flight for their own message"
  on pigeon.pigeon_flights for insert
  to authenticated
  with check (
    exists (
      select 1
      from pigeon.messages m
      where m.id = pigeon_flights.message_id
        and m.sender_id = auth.uid()
    )
  );

create policy "senders can update the flight for their own message"
  on pigeon.pigeon_flights for update
  to authenticated
  using (
    exists (
      select 1
      from pigeon.messages m
      where m.id = pigeon_flights.message_id
        and m.sender_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from pigeon.messages m
      where m.id = pigeon_flights.message_id
        and m.sender_id = auth.uid()
    )
  );
