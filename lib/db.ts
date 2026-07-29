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
      visitor_log: {
        Row: {
          id: string;
          created_at: string;
          session_id: string;
          gate_answer: string | null;
          first_message: string;
          action: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          session_id: string;
          gate_answer?: string | null;
          first_message: string;
          action?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          session_id?: string;
          gate_answer?: string | null;
          first_message?: string;
          action?: string | null;
        };
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
        };
        Update: {
          status?: string;
          draft_body?: string | null;
          grounded_sources?: unknown;
        };
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
