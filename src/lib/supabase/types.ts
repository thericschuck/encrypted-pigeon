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
export type ScheduleCategory = "training" | "freizeit" | "schlafen" | "essen" | "unterwegs" | "sonstiges";
export type ScheduleAvailability = "available" | "limited" | "unavailable";

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
          // { [type]: false } switches a push type off (lib/push/notification-prefs.ts).
          notification_prefs: Record<string, boolean>;
          // Set for the ADMIN_EMAIL account by ensureMembership(); widens profiles RLS.
          is_admin: boolean;
          // IANA zone the member's Wochenplan is written in.
          timezone: string;
          // Plan readable by every member (set only via set_schedule_public()).
          schedule_public: boolean;
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
          notification_prefs?: Record<string, boolean>;
          is_admin?: boolean;
          timezone?: string;
          schedule_public?: boolean;
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
          notification_prefs?: Record<string, boolean>;
          is_admin?: boolean;
          timezone?: string;
          schedule_public?: boolean;
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
          // Written only via mark_chat_read() (20260926000000_unread_and_chat_presence.sql).
          last_read_at: string;
          viewing_until: string | null;
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
          video_url: string | null;
          kind: MessageKind;
          reply_to_id: string | null;
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
          video_url?: string | null;
          kind?: MessageKind;
          reply_to_id?: string | null;
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
          video_url?: string | null;
          kind?: MessageKind;
          reply_to_id?: string | null;
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
      // supabase/migrations/20260928000000_weekly_schedule.sql
      schedule_blocks: {
        Row: {
          id: string;
          owner_id: string;
          weekday: number | null;
          exception_day: string | null;
          start_minute: number;
          end_minute: number;
          category: ScheduleCategory;
          availability: ScheduleAvailability;
          label: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          weekday?: number | null;
          exception_day?: string | null;
          start_minute: number;
          end_minute: number;
          category: ScheduleCategory;
          availability: ScheduleAvailability;
          label?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          weekday?: number | null;
          exception_day?: string | null;
          start_minute?: number;
          end_minute?: number;
          category?: ScheduleCategory;
          availability?: ScheduleAvailability;
          label?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      schedule_exceptions: {
        Row: {
          owner_id: string;
          day: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          owner_id: string;
          day: string;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          owner_id?: string;
          day?: string;
          note?: string | null;
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
          video_url: string | null;
          created_at: string;
        }[];
      };
      // supabase/migrations/20260926000000_unread_and_chat_presence.sql
      unread_counts_for_chats: {
        Args: { p_chat_ids: string[] };
        Returns: { chat_id: string; unread: number }[];
      };
      mark_chat_read: {
        Args: { p_chat_id: string; p_viewing?: boolean };
        /** My unread total afterwards (app icon badge). */
        Returns: number;
      };
      // supabase/migrations/20260928000000_weekly_schedule.sql (admin only)
      set_schedule_public: {
        Args: { p_user_id: string; p_public: boolean };
        Returns: undefined;
      };
    };
  };
}
