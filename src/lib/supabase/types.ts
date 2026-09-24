// Hand-written types matching supabase/migrations/ (init schema + later migrations).
// Replace with `supabase gen types typescript` output once the project is linked.
//
// Every table needs `Relationships` and every schema needs `Views`/`Functions`
// (even if empty) — @supabase/supabase-js's SupabaseClient generic requires
// Database[SchemaName] to satisfy GenericSchema from @supabase/postgrest-js,
// or it silently resolves to `never` and every .from(...) call collapses to
// `never` with no error at the call site, only at every usage downstream.

export type PigeonFlightStatus = "encrypting" | "in_transit" | "delivered";
export type MessageKind = "chat" | "pigeon";
export type ThemePreference = "system" | "light" | "dark";

export interface Database {
  pigeon: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          // Path inside the pigeon-avatars bucket ("{id}/{file}"), not a URL.
          avatar_url: string | null;
          theme: ThemePreference;
          accent_color: string | null;
          pigeon_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          avatar_url?: string | null;
          theme?: ThemePreference;
          accent_color?: string | null;
          pigeon_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          theme?: ThemePreference;
          accent_color?: string | null;
          pigeon_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      chats: {
        Row: {
          id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      chat_participants: {
        Row: {
          chat_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          chat_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          chat_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          chat_id: string;
          sender_id: string;
          content: string | null;
          image_url: string | null;
          audio_url: string | null;
          audio_duration_seconds: number | null;
          kind: MessageKind;
          created_at: string;
        };
        Insert: {
          id?: string;
          chat_id: string;
          sender_id: string;
          content?: string | null;
          image_url?: string | null;
          audio_url?: string | null;
          audio_duration_seconds?: number | null;
          kind?: MessageKind;
          created_at?: string;
        };
        Update: {
          id?: string;
          chat_id?: string;
          sender_id?: string;
          content?: string | null;
          image_url?: string | null;
          audio_url?: string | null;
          audio_duration_seconds?: number | null;
          kind?: MessageKind;
          created_at?: string;
        };
        Relationships: [];
      };
      pigeon_flights: {
        Row: {
          id: string;
          message_id: string;
          chat_id: string | null;
          sender_id: string | null;
          departure_time: string | null;
          arrival_time: string | null;
          duration_seconds: number | null;
          events: unknown;
          status: PigeonFlightStatus;
          incident_notified_at: string | null;
          notified_incident_event: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          chat_id?: string | null;
          sender_id?: string | null;
          departure_time?: string | null;
          arrival_time?: string | null;
          duration_seconds?: number | null;
          events?: unknown;
          status?: PigeonFlightStatus;
          incident_notified_at?: string | null;
          notified_incident_event?: unknown;
          created_at?: string;
        };
        Update: {
          id?: string;
          message_id?: string;
          chat_id?: string | null;
          sender_id?: string | null;
          departure_time?: string | null;
          arrival_time?: string | null;
          duration_seconds?: number | null;
          events?: unknown;
          status?: PigeonFlightStatus;
          incident_notified_at?: string | null;
          notified_incident_event?: unknown;
          created_at?: string;
        };
        Relationships: [];
      };
      invites: {
        Row: {
          email: string;
          invited_by: string | null;
          created_at: string;
          accepted_at: string | null;
        };
        Insert: {
          email: string;
          invited_by?: string | null;
          created_at?: string;
          accepted_at?: string | null;
        };
        Update: {
          email?: string;
          invited_by?: string | null;
          created_at?: string;
          accepted_at?: string | null;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          keys: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          keys: unknown;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          keys?: unknown;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // supabase/migrations/20260924030000_latest_message_per_chat.sql
      latest_messages_for_chats: {
        Args: { p_chat_ids: string[] };
        Returns: {
          chat_id: string;
          sender_id: string;
          kind: MessageKind;
          content: string | null;
          image_url: string | null;
          audio_url: string | null;
          created_at: string;
        }[];
      };
    };
  };
}
