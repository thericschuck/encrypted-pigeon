-- Replies ("Antworten" like in WhatsApp): a message can quote an earlier
-- message of the same chat.
--
-- The composite foreign key (reply_to_id, chat_id) -> (id, chat_id) is
-- what keeps a reply inside its own chat — no insert-policy change needed,
-- and it can't be used to probe message ids of other chats. If the quoted
-- message ever goes away, only reply_to_id is cleared (chat_id stays).
--
-- Reading the quoted message still goes through the normal messages RLS:
-- a reply to a pigeon letter the partner can't read yet just shows a
-- placeholder on their side until the letter lands.

alter table pigeon.messages
  drop constraint if exists messages_id_chat_id_key,
  add constraint messages_id_chat_id_key unique (id, chat_id);

alter table pigeon.messages
  add column if not exists reply_to_id uuid;

alter table pigeon.messages
  drop constraint if exists messages_reply_to_fkey,
  add constraint messages_reply_to_fkey
    foreign key (reply_to_id, chat_id)
    references pigeon.messages (id, chat_id)
    on delete set null (reply_to_id);

create index if not exists messages_reply_to_id_idx
  on pigeon.messages (reply_to_id)
  where reply_to_id is not null;
