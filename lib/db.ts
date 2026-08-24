// Server-side Supabase client using the service role key.
// NEVER import this from a client component.
// NEVER expose SUPABASE_SERVICE_ROLE_KEY to the browser.

import { createClient } from "@supabase/supabase-js";

// Minimal schema types — keeps the query builder typed without running codegen.
export type Database = {
  public: {
    Tables: {
      connectors: {
        Row: {
          id: string;
          type: string;
          name: string;
          description: string;
          tool_names: string[];
          enabled: boolean;
          lane: string;
          mcp_url: string | null;
          credential_encrypted: string | null;
          credential_masked: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          type: string;
          name: string;
          description?: string;
          tool_names?: string[];
          enabled?: boolean;
          lane?: string;
          mcp_url?: string | null;
          credential_encrypted?: string | null;
          credential_masked?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          type?: string;
          name?: string;
          description?: string;
          tool_names?: string[];
          enabled?: boolean;
          lane?: string;
          mcp_url?: string | null;
          credential_encrypted?: string | null;
          credential_masked?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rate_limit_buckets: {
        Row: { key: string; count: number; window_start: string };
        Insert: { key: string; count?: number; window_start?: string };
        Update: { key?: string; count?: number; window_start?: string };
        Relationships: [];
      };
      owner_actions: {
        Row: { id: string; created_at: string; action: string; details: unknown };
        Insert: { id?: string; created_at?: string; action: string; details?: Record<string, unknown> };
        Update: { id?: string; created_at?: string; action?: string; details?: Record<string, unknown> };
        Relationships: [];
      };
      documents: {
        Row: { id: string; created_at: string; title: string; doc_type: string | null; storage_path: string; page_count: number };
        Insert: { id?: string; created_at?: string; title: string; doc_type?: string | null; storage_path: string; page_count?: number };
        Update: { id?: string; created_at?: string; title?: string; doc_type?: string | null; storage_path?: string; page_count?: number };
        Relationships: [];
      };
      document_pages: {
        Row: { id: string; doc_id: string; page_number: number; text: string; ocr_used: boolean };
        Insert: { id?: string; doc_id: string; page_number: number; text: string; ocr_used?: boolean };
        Update: { id?: string; doc_id?: string; page_number?: number; text?: string; ocr_used?: boolean };
        Relationships: [];
      };
      agent_runs: {
        Row: { id: string; created_at: string; user_query: string; response_text: string; duration_ms: number; tool_count: number; error: string | null };
        Insert: { id?: string; created_at?: string; user_query: string; response_text: string; duration_ms: number; tool_count?: number; error?: string | null };
        Update: { response_text?: string; duration_ms?: number; tool_count?: number; error?: string | null };
        Relationships: [];
      };
      tool_runs: {
        Row: { id: string; run_id: string; created_at: string; tool_name: string; input: Record<string, unknown>; output_summary: string; duration_ms: number; success: boolean; error: string | null; sequence: number };
        Insert: { id?: string; run_id: string; created_at?: string; tool_name: string; input: Record<string, unknown>; output_summary: string; duration_ms: number; success: boolean; error?: string | null; sequence: number };
        Update: Record<string, never>;
        Relationships: [];
      };
      retrieval_traces: {
        Row: { id: string; tool_run_id: string; doc_id: string; doc_title: string; page_number: number; score: number; returned: boolean };
        Insert: { id?: string; tool_run_id: string; doc_id: string; doc_title: string; page_number: number; score: number; returned: boolean };
        Update: Record<string, never>;
        Relationships: [];
      };
      pending_proposals: {
        Row: {
          id: string;
          gmail_message_id: string;
          sender: string;
          subject: string;
          classification: string;
          reason: string;
          draft_body: string | null;
          grounded_sources: unknown;
          suggested_attachments: unknown;
          thread_id: string | null;
          in_reply_to_id: string | null;
          status: string;
          created_at: string;
          source_received_at: string | null;
          source_received_at_inferred: boolean | null;
          detected_at: string | null;
          filtered_at: string | null;
          proposal_created_at: string | null;
          notification_attempted_at: string | null;
          notification_accepted_at: string | null;
          first_viewed_at: string | null;
          decision_at: string | null;
          sent_at: string | null;
          skipped_at: string | null;
          expired_at: string | null;
          outcome: string | null;
          content_completeness: string | null;
          locally_truncated: boolean | null;
          body_parts_failed: number | null;
          body_original_character_count: number | null;
          body_error_codes: string[] | null;
          // NULL on every row that predates migrations-12 (no DEFAULT, no
          // backfill — see that migration) — legacy/unknown, never true or
          // false. Only rows inserted after this column exists carry a real
          // value, written explicitly from the same handle_email result that
          // produced draft_reply.
          reply_required: boolean | null;
        };
        Insert: {
          id?: string;
          gmail_message_id: string;
          sender?: string;
          subject?: string;
          classification?: string;
          reason?: string;
          draft_body?: string | null;
          grounded_sources?: unknown;
          suggested_attachments?: unknown;
          thread_id?: string | null;
          in_reply_to_id?: string | null;
          status?: string;
          created_at?: string;
          source_received_at?: string | null;
          source_received_at_inferred?: boolean | null;
          detected_at?: string | null;
          filtered_at?: string | null;
          proposal_created_at?: string | null;
          notification_attempted_at?: string | null;
          notification_accepted_at?: string | null;
          first_viewed_at?: string | null;
          decision_at?: string | null;
          sent_at?: string | null;
          skipped_at?: string | null;
          expired_at?: string | null;
          outcome?: string | null;
          content_completeness?: string | null;
          locally_truncated?: boolean | null;
          body_parts_failed?: number | null;
          body_original_character_count?: number | null;
          body_error_codes?: string[] | null;
          reply_required?: boolean | null;
        };
        Update: {
          status?: string;
          draft_body?: string | null;
          grounded_sources?: unknown;
          notification_attempted_at?: string | null;
          notification_accepted_at?: string | null;
          first_viewed_at?: string | null;
          decision_at?: string | null;
          sent_at?: string | null;
          skipped_at?: string | null;
          expired_at?: string | null;
          outcome?: string | null;
        };
        Relationships: [];
      };
      filter_rejections: {
        Row: {
          id: string;
          gmail_message_id: string;
          source_domain: string;
          source_identifier: string;
          rejected_at: string;
          review_outcome: string;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          gmail_message_id: string;
          source_domain?: string;
          source_identifier?: string;
          rejected_at?: string;
          review_outcome?: string;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          review_outcome?: string;
          reviewed_at?: string | null;
        };
        Relationships: [];
      };
      proposal_events: {
        Row: {
          id: string;
          proposal_id: string;
          event_type: string;
          occurred_at: string;
          metadata: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          proposal_id: string;
          event_type: string;
          occurred_at?: string;
          metadata?: unknown;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      t002_observations: {
        Row: { proposal_id: string; enrolled_at: string };
        Insert: { proposal_id: string; enrolled_at?: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      memories: {
        Row: {
          id: string;
          owner_id: string;
          claim: string;
          memory_type: string;
          source_kind: string;
          source_id: string;
          source_locator: unknown;
          confidence: number | null;
          confirmation_status: string;
          valid_until: string | null;
          superseded_by: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          claim: string;
          memory_type: string;
          source_kind: string;
          source_id: string;
          source_locator?: unknown;
          confidence?: number | null;
          confirmation_status?: string;
          valid_until?: string | null;
          superseded_by?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          claim?: string;
          memory_type?: string;
          source_kind?: string;
          source_id?: string;
          source_locator?: unknown;
          confidence?: number | null;
          confirmation_status?: string;
          valid_until?: string | null;
          superseded_by?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      t002_enrollment_counter: {
        Row: { id: boolean; cap: number; enrolled_count: number; body_completeness_boundary_at: string | null };
        Insert: {
          id?: boolean;
          cap: number;
          enrolled_count?: number;
          body_completeness_boundary_at?: string | null;
        };
        // No app code updates cap/enrolled_count directly (both are mutated only
        // via the t002_try_enroll/t002_activate_body_completeness_boundary
        // functions), so Update stays empty on purpose — there is no supported
        // direct-write path for this table from the query builder.
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      check_rate_limit: {
        Args: { p_key: string; p_window_seconds: number; p_max: number };
        Returns: boolean;
      };
      search_document_pages: {
        Args: { q: string; lim?: number };
        Returns: { doc_id: string; title: string; doc_type: string | null; page_number: number; snippet: string; score: number }[];
      };
      search_document_pages_all: {
        Args: { q: string; lim?: number };
        Returns: { doc_id: string; title: string; doc_type: string | null; page_number: number; snippet: string; score: number }[];
      };
      t002_try_enroll: {
        Args: { p_proposal_id: string };
        Returns: boolean;
      };
      t002_expire_overdue: {
        Args: { p_hours: number };
        Returns: { proposal_id: string }[];
      };
      search_memories: {
        Args: { q: string; p_owner_id: string; lim?: number; p_include_stale?: boolean };
        Returns: {
          id: string;
          claim: string;
          memory_type: string;
          source_kind: string;
          source_id: string;
          source_locator: unknown;
          confidence: number | null;
          score: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let _client: ReturnType<typeof createClient<Database>> | null = null;

export function isDbConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getDb() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  _client = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
  return _client;
}
