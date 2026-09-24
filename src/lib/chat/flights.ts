import type { PigeonFlightStatus } from "@/lib/supabase/types";

// Shape of pigeon_flights.events entries, as written by
// supabase/functions/start-pigeon-flight.
export interface FlightEvent {
  type: string;
  label: string;
  emoji: string;
  timestamp_offset_seconds: number;
  duration_impact_seconds: number;
}

// The subset of pigeon.pigeon_flights the chat UI reads. Loaded once per
// chat (and kept current by a single realtime channel) in <ChatRoom />,
// then handed down to <PigeonStatusBadge /> and <PigeonFlightMap /> as
// props — so a chat with N messages holds one subscription, not N.
//
// Only pigeon letters have a flight. The recipient sees the flight row
// (announcement + live map) before they're allowed to read the letter
// itself; chat_id/sender_id are on the flight precisely so that works
// without reading the message.
export interface FlightRow {
  id: string;
  message_id: string;
  chat_id: string | null;
  sender_id: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  duration_seconds: number | null;
  events: FlightEvent[] | null;
  status: PigeonFlightStatus;
}

export const FLIGHT_COLUMNS =
  "id, message_id, chat_id, sender_id, departure_time, arrival_time, duration_seconds, events, status";
