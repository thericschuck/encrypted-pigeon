-- Pulled into the repo from the live project's migration history (it was
-- applied directly via the Supabase MCP and never committed).
--
-- pigeon flight simulation: server-authoritative duration + random events,
-- triggered off new messages, auto-delivered by a scheduled job. All
-- time-based and independent of whether any client has the chat open.
--
-- NOTE: this migration intentionally does NOT create the
-- 'pigeon_service_role_key' vault secret the trigger function below reads --
-- that's a separate step since it means writing a live secret value into
-- the database.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function pigeon.trigger_start_pigeon_flight()
returns trigger
language plpgsql
security definer
set search_path = pigeon
as $$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'pigeon_service_role_key';

  if service_key is null then
    raise warning 'pigeon_service_role_key vault secret not set — skipping start-pigeon-flight call for message %', new.id;
    return new;
  end if;

  perform net.http_post(
    url := 'https://jtxruiahjdgeuugapdsb.supabase.co/functions/v1/start-pigeon-flight',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object('message_id', new.id)
  );

  return new;
end;
$$;

drop trigger if exists start_pigeon_flight_on_message on pigeon.messages;
create trigger start_pigeon_flight_on_message
  after insert on pigeon.messages
  for each row
  execute function pigeon.trigger_start_pigeon_flight();

-- Auto-delivery: server-side, runs regardless of any open chat. 1-minute
-- granularity is plenty given flights run 3-45 minutes.
select cron.schedule(
  'deliver-pigeon-flights',
  '* * * * *',
  $$ update pigeon.pigeon_flights set status = 'delivered' where status = 'in_transit' and arrival_time <= now(); $$
);
