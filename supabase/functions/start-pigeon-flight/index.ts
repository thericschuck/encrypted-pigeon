import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PIGEON_EVENT_POOL, type PigeonEventTemplate } from "../_shared/pigeon-events.ts";

/**
 * Called (via a pg_net trigger on pigeon.messages, see the
 * start_pigeon_flight_on_message migration) right after a new message is
 * inserted. Rolls a flight duration + 2-5 random events, upserts the
 * authoritative pigeon.pigeon_flights row for that message, and sets
 * status = 'in_transit'.
 *
 * Runs with the service-role key so it doesn't depend on any RLS grant for
 * the message's sender — this is server-authoritative simulation state, not
 * something a client should be able to author directly.
 */

interface RequestBody {
  message_id: string;
}

interface FlightEvent {
  type: string;
  label: string;
  emoji: string;
  timestamp_offset_seconds: number;
  duration_impact_seconds: number;
}

// Weighted toward 10-20 min, with shorter and much-longer flights rarer.
const DURATION_BUCKETS: { minMinutes: number; maxMinutes: number; weight: number }[] = [
  { minMinutes: 5, maxMinutes: 10, weight: 15 },
  { minMinutes: 10, maxMinutes: 20, weight: 55 },
  { minMinutes: 20, maxMinutes: 30, weight: 20 },
  { minMinutes: 30, maxMinutes: 45, weight: 10 },
];

// Events can shave minutes off (tailwind); never let a flight resolve
// near-instantly.
const MIN_TOTAL_DURATION_SECONDS = 3 * 60;

function pickWeightedDurationSeconds(): number {
  const totalWeight = DURATION_BUCKETS.reduce((sum, b) => sum + b.weight, 0);
  let roll = Math.random() * totalWeight;
  const bucket =
    DURATION_BUCKETS.find((b) => {
      if (roll < b.weight) return true;
      roll -= b.weight;
      return false;
    }) ?? DURATION_BUCKETS[1];
  const minutes = bucket.minMinutes + Math.random() * (bucket.maxMinutes - bucket.minMinutes);
  return Math.round(minutes * 60);
}

function pickRandomEvents(): PigeonEventTemplate[] {
  const count = 2 + Math.floor(Math.random() * 4); // 2-5 inclusive
  const pool = [...PIGEON_EVENT_POOL];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function randomInRange([min, max]: [number, number]): number {
  return Math.round(min + Math.random() * (max - min));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { message_id } = body;
  if (!message_id) {
    return new Response(JSON.stringify({ error: "message_id is required" }), { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "pigeon" }, auth: { persistSession: false } }
  );

  // Base duration first, events then deviate from it — matches "Gesamtdauer
  // inkl. aller Verzögerungen" (events are deltas on top of a base flight).
  let totalDurationSeconds = pickWeightedDurationSeconds();
  const chosen = pickRandomEvents().map((template) => {
    const impact = randomInRange(template.durationImpactRange);
    totalDurationSeconds += impact;
    return { template, impact };
  });

  totalDurationSeconds = Math.max(totalDurationSeconds, MIN_TOTAL_DURATION_SECONDS);

  // Spread events across the middle of the flight (5%-85% of duration) so
  // none land right at departure or arrival, then sort chronologically.
  const events: FlightEvent[] = chosen
    .map(({ template, impact }) => ({
      type: template.type,
      label: template.label,
      emoji: template.emoji,
      timestamp_offset_seconds: Math.round(totalDurationSeconds * (0.05 + Math.random() * 0.8)),
      duration_impact_seconds: impact,
    }))
    .sort((a, b) => a.timestamp_offset_seconds - b.timestamp_offset_seconds);

  const departureTime = new Date();
  const arrivalTime = new Date(departureTime.getTime() + totalDurationSeconds * 1000);

  const { error } = await supabase.from("pigeon_flights").upsert(
    {
      message_id,
      departure_time: departureTime.toISOString(),
      arrival_time: arrivalTime.toISOString(),
      duration_seconds: totalDurationSeconds,
      events,
      status: "in_transit",
    },
    { onConflict: "message_id" }
  );

  if (error) {
    console.error("Failed to upsert pigeon flight:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({
      message_id,
      duration_seconds: totalDurationSeconds,
      arrival_time: arrivalTime.toISOString(),
      event_count: events.length,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
