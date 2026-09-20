// Hand-written types matching supabase/migrations/20260920000000_init_schema.sql.
// Replace with `supabase gen types typescript` output once the project is linked.

export type PigeonFlightStatus = "encrypting" | "in_transit" | "delivered";

export interface Database {
  pigeon: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
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
      };
      messages: {
        Row: {
          id: string;
          chat_id: string;
          sender_id: string;
          content: string | null;
          image_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          chat_id: string;
          sender_id: string;
          content?: string | null;
          image_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          chat_id?: string;
          sender_id?: string;
          content?: string | null;
          image_url?: string | null;
          created_at?: string;
        };
      };
      pigeon_flights: {
        Row: {
          id: string;
          message_id: string;
          departure_time: string | null;
          arrival_time: string | null;
          duration_seconds: number | null;
          events: unknown;
          status: PigeonFlightStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          departure_time?: string | null;
          arrival_time?: string | null;
          duration_seconds?: number | null;
          events?: unknown;
          status?: PigeonFlightStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          message_id?: string;
          departure_time?: string | null;
          arrival_time?: string | null;
          duration_seconds?: number | null;
          events?: unknown;
          status?: PigeonFlightStatus;
          created_at?: string;
        };
      };
    };
  };
}
