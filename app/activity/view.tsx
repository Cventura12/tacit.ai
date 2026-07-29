"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";

interface AgentRun {
  id: string;
  created_at: string;
  user_query: string;
  duration_ms: number;
  tool_count: number;
  error: string | null;
}

interface ToolRunDetail {
  id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output_summary: string;
  duration_ms: number;
  success: boolean;
  error: string | null;
  sequence: number;
}

interface RunDetail extends AgentRun {
  tool_runs: ToolRunDetail[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Run row ───────────────────────────────────────────────────────────────────

function RunRow({ run, isFirst }: { run: AgentRun; isFirst?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function toggle() {
    if (!expanded && !detail) {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/runs/${run.id}`);
        if (res.ok) {
          const d = (await res.json()) as RunDetail;
          setDetail(d);
        }
      } catch { /* best-effort */ }
      finally { setDetailLoading(false); }
    }
    setExpanded((v) => !v);
  }

  return (
    <div style={{ borderTop: isFirst ? "none" : "0.5px solid var(--line)" }}>
      {/* Summary row */}
      <button
        type="button"
        onClick={() => void toggle()}
        className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors"
        style={{ background: "var(--bg)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.02)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg)")}
      >
        {/* Status dot */}
        <span
          className="w-[7px] h-[7px] rounded-full shrink-0"
          style={{ background: run.error ? "#f87171" : "var(--green)" }}
        />

        {/* Query */}
        <p className="flex-1 text-[13px] text-ink truncate text-left">{run.user_query}</p>

        {/* Meta */}
        <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--gray-3)" }}>
          {run.tool_count}T
        </span>
        <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--gray-3)", minWidth: "36px", textAlign: "right" }}>
          {formatDuration(run.duration_ms)}
        </span>
        <span className="text-[11px] shrink-0" style={{ color: "var(--gray-3)", minWidth: "52px", textAlign: "right" }}>
          {formatDate(run.created_at)}
        </span>

        {/* Expand chevron */}
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          style={{
            color: "var(--gray-3)",
            flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
          }}
          aria-hidden="true"
        >
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Tool detail */}
      {expanded && (
        <div
          className="px-5 pb-4"
          style={{ background: "rgba(0,0,0,0.02)" }}
        >
          {detailLoading ? (
            <p className="text-[12px] py-2" style={{ color: "var(--gray-3)" }}>Loading…</p>
          ) : detail?.tool_runs?.length ? (
            <div className="flex flex-col gap-2 pt-2">
              {detail.tool_runs
                .sort((a, b) => a.sequence - b.sequence)
                .map((t) => (
                  <div key={t.id} className="flex items-start gap-3">
                    <span
                      className="text-[10px] font-mono shrink-0 mt-[1px]"
                      style={{ color: t.success ? "var(--green)" : "#f87171" }}
                    >
                      {t.sequence}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-ink font-mono">{t.tool_name}</span>
                        <span className="text-[11px] font-mono" style={{ color: "var(--gray-3)" }}>
                          {formatDuration(t.duration_ms)}
                        </span>
                      </div>
                      {t.output_summary && (
                        <p className="text-[11px] mt-[2px] leading-relaxed" style={{ color: "var(--gray-2)" }}>
                          {t.output_summary}
                        </p>
                      )}
                      {t.error && (
                        <p className="text-[11px] mt-[2px]" style={{ color: "#f87171" }}>{t.error}</p>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-[12px] py-2" style={{ color: "var(--gray-3)" }}>No tool details available.</p>
          )}

          {run.error && (
            <div
              className="mt-3 px-3 py-2 rounded-lg"
              style={{ background: "rgba(248,113,113,0.08)", border: "0.5px solid rgba(248,113,113,0.2)" }}
            >
              <p className="text-[11px] font-medium" style={{ color: "#f87171" }}>Run error</p>
              <p className="text-[11px] mt-1" style={{ color: "var(--gray-2)" }}>{run.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ActivityView ──────────────────────────────────────────────────────────────

export function ActivityView() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/runs");
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Failed to load runs");
      }
      const d = (await res.json()) as { runs?: AgentRun[] };
      setRuns(d.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-8 py-5"
          style={{ borderBottom: "0.5px solid var(--line)", background: "var(--bg)" }}
        >
          <h1 className="text-[17px] font-semibold text-ink">Activity</h1>
          <button
            onClick={() => { setLoading(true); setError(""); void loadRuns(); }}
            className="text-[12px] transition-opacity hover:opacity-70"
            style={{ color: "var(--gray-2)" }}
          >
            Refresh
          </button>
        </div>

        {/* Content */}
        <div className="px-8 py-6 max-w-3xl">
          {loading ? (
            <p className="text-[13px]" style={{ color: "var(--gray-2)" }}>Loading…</p>
          ) : error ? (
            <div
              className="px-4 py-3 rounded-lg"
              style={{ background: "rgba(248,113,113,0.08)", border: "0.5px solid rgba(248,113,113,0.2)" }}
            >
              <p className="text-[13px]" style={{ color: "#f87171" }}>{error}</p>
              <p className="text-[11px] mt-1" style={{ color: "var(--gray-3)" }}>
                The agent_runs table may not be available yet — run a request first.
              </p>
            </div>
          ) : runs.length === 0 ? (
            /* Empty state */
            <div className="py-20 flex flex-col items-center gap-3 text-center">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ color: "var(--gray-3)" }} aria-hidden="true">
                <path d="M2 18h5l4-11 5 20 4-13 3 4H34"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-[15px] font-medium text-ink">No activity yet</p>
              <p className="text-[13px]" style={{ color: "var(--gray-2)" }}>
                Agent runs will appear here once you start asking questions in the workspace.
              </p>
            </div>
          ) : (
            /* Runs list */
            <div>
              {/* Column headers */}
              <div className="flex items-center gap-4 px-5 pb-2">
                <span className="w-[7px] shrink-0" />
                <p className="flex-1 text-[10px] font-mono uppercase tracking-wide" style={{ color: "var(--gray-3)" }}>
                  Query
                </p>
                <span className="text-[10px] font-mono uppercase tracking-wide shrink-0" style={{ color: "var(--gray-3)" }}>
                  Tools
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wide shrink-0 min-w-[36px] text-right" style={{ color: "var(--gray-3)" }}>
                  Time
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wide shrink-0 min-w-[52px] text-right" style={{ color: "var(--gray-3)" }}>
                  When
                </span>
                <span className="w-[12px] shrink-0" />
              </div>

              <div
                className="overflow-hidden"
                style={{ border: "0.5px solid var(--line)", borderRadius: "10px" }}
              >
                {runs.map((run, i) => (
                  <RunRow key={run.id} run={run} isFirst={i === 0} />
                ))}
              </div>

              <p className="text-[11px] mt-3 text-center" style={{ color: "var(--gray-3)" }}>
                Showing {runs.length} most recent run{runs.length !== 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
