export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      allowed_reader_emails: {
        Row: {
          email: string;
          created_at: string;
        };
        Insert: {
          email: string;
          created_at?: string;
        };
        Update: {
          email?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      news_items: {
        Row: {
          id: string;
          external_id: string;
          digest_date: string;
          title: string;
          summary: string;
          source: string;
          source_url: string;
          category: string;
          importance_score: number | null;
          published_at: string | null;
          raw_payload: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          external_id: string;
          digest_date: string;
          title: string;
          summary: string;
          source: string;
          source_url: string;
          category: string;
          importance_score?: number | null;
          published_at?: string | null;
          raw_payload?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          external_id?: string;
          digest_date?: string;
          title?: string;
          summary?: string;
          source?: string;
          source_url?: string;
          category?: string;
          importance_score?: number | null;
          published_at?: string | null;
          raw_payload?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reader_item_states: {
        Row: {
          news_item_id: string;
          user_id: string;
          read_at: string | null;
          saved_at: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          news_item_id: string;
          user_id: string;
          read_at?: string | null;
          saved_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          news_item_id?: string;
          user_id?: string;
          read_at?: string | null;
          saved_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
