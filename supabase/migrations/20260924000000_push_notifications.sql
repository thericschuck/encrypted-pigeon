-- Web Push notifications.
--
-- pigeon.push_subscriptions stores one row per browser/device subscription
-- (a user may have several — phone + laptop, etc). Delivery itself happens
-- in the "send-push-notification" edge function (VAPID web-push, no
-- Firebase); this migration only wires up *when* that function gets called.
--
-- Three triggers/jobs call it, matching the same pg_net + Vault pattern
-- already used by pigeon.trigger_start_pigeon_flight() (the
-- "pigeon_service_role_key" vault secret is reused, not re-created):
--   1. AFTER INSERT on pigeon.messages           -> "new message" push
--   2. AFTER UPDATE on pigeon.pigeon_flights,
--      status -> 'delivered'                     -> "arrived" push
--   3. a new per-minute cron job picks exactly one non-tailwind incident
--      per in-transit flight once its scheduled time has passed, writes it
--      to notified_incident_event, which the same AFTER UPDATE trigger
--      turns into an "incident" push. Writing that column exactly once is
--      what caps this at 1 incident push per flight (no spam), independent
--      of how many events the flight actually has.
--
-- IMPORTANT — manual steps this migration cannot do for you:
-- 1. Deploy the "send-push-notification" edge function
--    (supabase/functions/send-push-notification).
-- 2. Set its secrets: `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...`
--    (same keypair as NEXT_PUBLIC_VAPID_PUBLIC_KEY in the Next.js app's env).

-- ---------------------------------------------------------------------------
-- pigeon.push_subscriptions
-- ---------------------------------------------------------------------------
create table if not exists pigeon.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references pigeon.profiles (id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on pigeon.push_subscriptions (user_id);

grant select, insert, delete on pigeon.push_subscriptions to authenticated;
grant all on pigeon.push_subscriptions to service_role;

alter table pigeon.push_subscriptions enable row level security;

create policy "users can view their own push subscriptions"
  on pigeon.push_subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users can create their own push subscriptions"
  on pigeon.push_subscriptions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users can delete their own push subscriptions"
  on pigeon.push_subscriptions for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- pigeon.pigeon_flights: incident-notification bookkeeping
-- ---------------------------------------------------------------------------
alter table pigeon.pigeon_flights
  add column if not exists incident_notified_at timestamptz,
  add column if not exists notified_incident_event jsonb;

-- ---------------------------------------------------------------------------
-- Shared helper: call the send-push-notification edge function via pg_net,
-- authenticated with the service-role key from Vault. Fire-and-forget
-- (pg_net queues the request async) so it never blocks the triggering
-- write; failures are just a `raise warning`, never a failed insert/update.
-- ---------------------------------------------------------------------------
create or replace function pigeon.call_send_push_notification(payload jsonb)
returns void
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
    raise warning 'pigeon_service_role_key vault secret not set — skipping push notification %', payload;
    return;
  end if;

  perform net.http_post(
    url := 'https://jtxruiahjdgeuugapdsb.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := payload
  );
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default, and "pigeon" is an exposed
-- PostgREST schema — without this, any signed-in user could call
-- rpc('call_send_push_notification', ...) and spam pushes with an arbitrary
-- payload. Only the triggers below (running as the function owner) need it.
revoke execute on function pigeon.call_send_push_notification(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. New message -> push to the other participant(s).
-- ---------------------------------------------------------------------------
create or replace function pigeon.trigger_notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = pigeon
as $$
begin
  perform pigeon.call_send_push_notification(
    jsonb_build_object('event_type', 'message', 'message_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists notify_push_on_new_message on pigeon.messages;
create trigger notify_push_on_new_message
  after insert on pigeon.messages
  for each row execute function pigeon.trigger_notify_new_message();

-- ---------------------------------------------------------------------------
-- 2 & 3. Flight status flips to 'delivered', or an incident gets flagged by
-- the cron job below -> push to both sender and recipient.
-- ---------------------------------------------------------------------------
create or replace function pigeon.trigger_notify_flight_change()
returns trigger
language plpgsql
security definer
set search_path = pigeon
as $$
begin
  if new.status = 'delivered' and old.status is distinct from new.status then
    perform pigeon.call_send_push_notification(
      jsonb_build_object('event_type', 'arrived', 'message_id', new.message_id)
    );
  elsif new.notified_incident_event is not null and old.notified_incident_event is null then
    perform pigeon.call_send_push_notification(
      jsonb_build_object(
        'event_type', 'incident',
        'message_id', new.message_id,
        'event', new.notified_incident_event
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_push_on_flight_change on pigeon.pigeon_flights;
create trigger notify_push_on_flight_change
  after update on pigeon.pigeon_flights
  for each row execute function pigeon.trigger_notify_flight_change();

-- ---------------------------------------------------------------------------
-- Cron: once a minute, pick the earliest not-yet-notified, non-tailwind
-- event (tailwind is good news, not an "incident") whose scheduled time has
-- passed for each in-transit flight, and flag it. Writing
-- notified_incident_event (null -> value, exactly once) is what the trigger
-- above reacts to — this is the "max 1 incident push per flight" throttle.
-- Runs alongside the existing "deliver-pigeon-flights" cron job, untouched.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'notify-pigeon-incidents',
  '* * * * *',
  $$
  with candidate as (
    select
      f.id,
      (
        select e
        from jsonb_array_elements(f.events) as e
        where (e ->> 'type') <> 'tailwind'
          and f.departure_time + make_interval(secs => (e ->> 'timestamp_offset_seconds')::numeric) <= now()
        order by (e ->> 'timestamp_offset_seconds')::numeric asc
        limit 1
      ) as chosen_event
    from pigeon.pigeon_flights f
    where f.status = 'in_transit'
      and f.notified_incident_event is null
      and f.departure_time is not null
  )
  update pigeon.pigeon_flights f
  set notified_incident_event = c.chosen_event,
      incident_notified_at = now()
  from candidate c
  where f.id = c.id
    and c.chosen_event is not null;
  $$
);
