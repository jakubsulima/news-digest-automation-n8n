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
      articles: {
        Row: {
          id: string;
          canonical_url: string;
          title: string;
          source: string;
          category: string;
          raw_summary: string;
          first_seen_at: string | null;
          last_seen_at: string | null;
          enrichment_status: string;
          enriched_title: string | null;
          enriched_description: string | null;
          enriched_text: string | null;
          enriched_word_count: number;
          enriched_fetched_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          canonical_url: string;
          title: string;
          source: string;
          category: string;
          raw_summary?: string;
          first_seen_at?: string | null;
          last_seen_at?: string | null;
          enrichment_status?: string;
          enriched_title?: string | null;
          enriched_description?: string | null;
          enriched_text?: string | null;
          enriched_word_count?: number;
          enriched_fetched_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          canonical_url?: string;
          title?: string;
          source?: string;
          category?: string;
          raw_summary?: string;
          first_seen_at?: string | null;
          last_seen_at?: string | null;
          enrichment_status?: string;
          enriched_title?: string | null;
          enriched_description?: string | null;
          enriched_text?: string | null;
          enriched_word_count?: number;
          enriched_fetched_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      digest_runs: {
        Row: {
          id: string;
          report_date: string;
          trigger_type: "manual" | "scheduled";
          status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
          started_by_user_id: string | null;
          started_at: string | null;
          finished_at: string | null;
          error_message: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          report_date: string;
          trigger_type: "manual" | "scheduled";
          status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
          started_by_user_id?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          report_date?: string;
          trigger_type?: "manual" | "scheduled";
          status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
          started_by_user_id?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      digest_summaries: {
        Row: {
          id: string;
          digest_run_id: string;
          digest_date: string;
          summary: string;
          highlights: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          digest_run_id: string;
          digest_date: string;
          summary: string;
          highlights?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          digest_run_id?: string;
          digest_date?: string;
          summary?: string;
          highlights?: Json;
          created_at?: string;
          updated_at?: string;
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
      pipeline_stage_runs: {
        Row: {
          id: string;
          digest_run_id: string;
          stage_name:
            | "source_fetch"
            | "article_normalization"
            | "story_clustering"
            | "enrichment"
            | "editorial_scoring"
            | "reader_publication"
            | "finalization";
          status: "queued" | "running" | "succeeded" | "failed" | "skipped";
          attempt_count: number;
          started_at: string | null;
          finished_at: string | null;
          error_message: string | null;
          metrics: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          digest_run_id: string;
          stage_name:
            | "source_fetch"
            | "article_normalization"
            | "story_clustering"
            | "enrichment"
            | "editorial_scoring"
            | "reader_publication"
            | "finalization";
          status: "queued" | "running" | "succeeded" | "failed" | "skipped";
          attempt_count?: number;
          started_at?: string | null;
          finished_at?: string | null;
          error_message?: string | null;
          metrics?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          digest_run_id?: string;
          stage_name?:
            | "source_fetch"
            | "article_normalization"
            | "story_clustering"
            | "enrichment"
            | "editorial_scoring"
            | "reader_publication"
            | "finalization";
          status?: "queued" | "running" | "succeeded" | "failed" | "skipped";
          attempt_count?: number;
          started_at?: string | null;
          finished_at?: string | null;
          error_message?: string | null;
          metrics?: Json;
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
      reader_sources: {
        Row: {
          id: string;
          name: string;
          category: string;
          feed_url: string;
          priority: number;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          category: string;
          feed_url: string;
          priority?: number;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          category?: string;
          feed_url?: string;
          priority?: number;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reader_digest_settings: {
        Row: {
          user_id: string;
          publish_top_n: number;
          summary_max_chars: number;
          minimum_importance_score: number;
          feed_targets: Json;
          preferred_keywords: Json;
          excluded_keywords: Json;
          require_major_security: boolean;
          use_ai_summaries: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          publish_top_n?: number;
          summary_max_chars?: number;
          minimum_importance_score?: number;
          feed_targets?: Json;
          preferred_keywords?: Json;
          excluded_keywords?: Json;
          require_major_security?: boolean;
          use_ai_summaries?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          publish_top_n?: number;
          summary_max_chars?: number;
          minimum_importance_score?: number;
          feed_targets?: Json;
          preferred_keywords?: Json;
          excluded_keywords?: Json;
          require_major_security?: boolean;
          use_ai_summaries?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reader_item_feedback: {
        Row: {
          news_item_id: string;
          user_id: string;
          sentiment: "more" | "less";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          news_item_id: string;
          user_id: string;
          sentiment: "more" | "less";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          news_item_id?: string;
          user_id?: string;
          sentiment?: "more" | "less";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      source_items: {
        Row: {
          id: string;
          digest_run_id: string;
          source_name: string;
          source_url: string;
          category: string;
          raw_payload: Json;
          normalized_url: string | null;
          published_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          digest_run_id: string;
          source_name: string;
          source_url: string;
          category: string;
          raw_payload: Json;
          normalized_url?: string | null;
          published_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          digest_run_id?: string;
          source_name?: string;
          source_url?: string;
          category?: string;
          raw_payload?: Json;
          normalized_url?: string | null;
          published_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      story_clusters: {
        Row: {
          id: string;
          story_key: string;
          category: string;
          canonical_title: string;
          canonical_url: string;
          source: string;
          latest_summary: string;
          first_seen_at: string | null;
          last_seen_at: string | null;
          latest_published_at: string | null;
          latest_scores: Json;
          latest_duplicate_count: number;
          confirmation_count: number;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          story_key: string;
          category: string;
          canonical_title: string;
          canonical_url: string;
          source: string;
          latest_summary?: string;
          first_seen_at?: string | null;
          last_seen_at?: string | null;
          latest_published_at?: string | null;
          latest_scores?: Json;
          latest_duplicate_count?: number;
          confirmation_count?: number;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          story_key?: string;
          category?: string;
          canonical_title?: string;
          canonical_url?: string;
          source?: string;
          latest_summary?: string;
          first_seen_at?: string | null;
          last_seen_at?: string | null;
          latest_published_at?: string | null;
          latest_scores?: Json;
          latest_duplicate_count?: number;
          confirmation_count?: number;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      story_snapshots: {
        Row: {
          id: string;
          digest_run_id: string;
          story_cluster_id: string;
          is_selected: boolean;
          editorial_score: number;
          impact_score: number;
          novelty_score: number;
          confirmation_score: number;
          scope_fit_score: number;
          urgency_score: number;
          duplicate_count: number;
          changed_fields: Json;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          digest_run_id: string;
          story_cluster_id: string;
          is_selected?: boolean;
          editorial_score?: number;
          impact_score?: number;
          novelty_score?: number;
          confirmation_score?: number;
          scope_fit_score?: number;
          urgency_score?: number;
          duplicate_count?: number;
          changed_fields?: Json;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          digest_run_id?: string;
          story_cluster_id?: string;
          is_selected?: boolean;
          editorial_score?: number;
          impact_score?: number;
          novelty_score?: number;
          confirmation_score?: number;
          scope_fit_score?: number;
          urgency_score?: number;
          duplicate_count?: number;
          changed_fields?: Json;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      enrichment_records: {
        Row: {
          id: string;
          digest_run_id: string;
          article_id: string;
          status: string;
          fetched_at: string | null;
          error_message: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          digest_run_id: string;
          article_id: string;
          status: string;
          fetched_at?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          digest_run_id?: string;
          article_id?: string;
          status?: string;
          fetched_at?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
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
