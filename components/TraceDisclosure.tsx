"use client";

import { useState } from "react";
import type { RunDetail, ToolRunDetail, RetrievalTrace } from "@/lib/types";

// ── Formatting helpers ─────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

const TOOL_LABELS: Record<string, string> = {
  search_documents: "Search documents",
  cross_reference: "Cross-reference",
  handle_email: "Handle email",
  read_gmail: "Read Gmail",
  get_connector_status: "Connector status",
  toggle_connector: "Toggle connector",
  list_mcp_connectors: "List MCP connectors",
  set_connector_lane: "Set connector lane",
  toggle_mcp_connector: "Toggle MCP connector",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

function inputPreview(tool_name: string, input: Record<string, unknown>): string {
  if ((tool_name === "search_documents") && typeof input.query === "string") {
    return `"${input.query.slice(0, 55)}${input.query.length > 55 ? "…" : ""}"`;
  }
  if (tool_name === "cross_reference" && typeof input.question === "string") {
    return `"${input.question.slice(0, 55)}${input.question.length > 55 ? "…" : ""}"`;
  }
  if (tool_name === "handle_email") {
    const subj = typeof input.subject === "string" ? input.subject : "";
    return subj ? `subject: "${subj.slice(0, 55)}"` : "pasted email";
  }
  return "";
}

const RETRIEVAL_TOOLS = new Set(["search_documents", "cross_reference", "handle_email"]);

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className="font-mono text-[10px] tabular-nums shrink-0"
      style={{ color: "var(--gray-3)" }}
    >
      {score.toFixed(3)}
    </span>
  );
}

function RetrievalTable({ traces }: { traces: RetrievalTrace[] }) {
  if (traces.length === 0) return null;

  const returned = traces.filter((t) => t.returned);
  const candidates = traces.filter((t) => !t.returned);

  return (
    <div className="mt-[6px] ml-[10px] flex flex-col gap-[3px]">
      {returned.map((t) => (
        <div key={t.id} className="flex items-baseline gap-[6px]">
          <span
            className="text-[11px] truncate min-w-0"
            style={{ color: "var(--gray-1)", maxWidth: "160px" }}
          >
            {t.doc_title}
          </span>
          <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--gray-2)" }}>
            p.{t.page_number}
          </span>
          <ScoreBadge score={t.score} />
        </div>
      ))}
      {candidates.map((t) => (
        <div key={t.id} className="flex items-baseline gap-[6px] opacity-40">
          <span
            className="text-[11px] truncate min-w-0"
            style={{ color: "var(--gray-2)", maxWidth: "160px" }}
          >
            {t.doc_title}
          </span>
          <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--gray-3)" }}>
            p.{t.page_number}
          </span>
          <ScoreBadge score={t.score} />
        </div>
      ))}
    </div>
  );
}

function ToolRow({ tr }: { tr: ToolRunDetail }) {
  const preview = inputPreview(tr.tool_name, tr.input);
  const hasRetrieval = RETRIEVAL_TOOLS.has(tr.tool_name) && tr.retrieval_traces.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2">
        {tr.success ? (
          <span
            className="w-[5px] h-[5px] rounded-full shrink-0"
            style={{ background: "var(--green)" }}
          />
        ) : (
          <span
            className="w-[5px] h-[5px] rounded-full shrink-0"
            style={{ background: "#ef4444" }}
          />
        )}
        <span className="text-[12px]" style={{ color: "var(--gray-1)" }}>
          {toolLabel(tr.tool_name)}
        </span>
        <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--gray-3)" }}>
          {fmtMs(tr.duration_ms)}
        </span>
        {preview && (
          <span
            className="text-[10px] truncate min-w-0"
            style={{ color: "var(--gray-3)" }}
          >
            {preview}
          </span>
        )}
      </div>
      {hasRetrieval && <RetrievalTable traces={tr.retrieval_traces} />}
      {!tr.success && tr.error && (
        <p className="text-[10px] mt-[3px] ml-[11px]" style={{ color: "#ef4444" }}>
          {tr.error.slice(0, 120)}
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  runId: string;
}

type FetchState = "idle" | "loading" | "done" | "error";

export function TraceDisclosure({ runId }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState>("idle");
  const [detail, setDetail] = useState<RunDetail | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (state === "idle") {
      setState("loading");
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as RunDetail;
        setDetail(data);
        setState("done");
      } catch {
        setState("error");
      }
    }
  }

  const stepCount = detail?.tool_runs.length ?? detail?.tool_count ?? 0;
  const durationLabel = detail ? fmtMs(detail.duration_ms) : null;

  const summaryLabel =
    state === "done" && detail
      ? `${stepCount} ${stepCount === 1 ? "step" : "steps"} · ${durationLabel}`
      : "trace";

  return (
    <div className="mt-[10px]" style={{ borderTop: "0.5px solid var(--line-2)" }}>
      <button
        onClick={() => void toggle()}
        className="flex items-center gap-[5px] pt-[8px] pb-[2px] group"
        style={{ cursor: "pointer" }}
        aria-expanded={open}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-[0.08em] transition-colors"
          style={{ color: open ? "var(--gray-1)" : "var(--gray-3)" }}
        >
          {summaryLabel}
        </span>
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          aria-hidden="true"
          style={{
            color: "var(--gray-3)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
            flexShrink: 0,
          }}
        >
          <path d="M1.5 3L4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="pt-[6px] pb-[4px]">
          {state === "loading" && (
            <p className="font-mono text-[10px]" style={{ color: "var(--gray-3)" }}>
              loading…
            </p>
          )}
          {state === "error" && (
            <p className="font-mono text-[10px]" style={{ color: "var(--gray-3)" }}>
              couldn't load trace
            </p>
          )}
          {state === "done" && detail && (
            <div className="flex flex-col gap-[8px]">
              {detail.tool_runs.map((tr) => (
                <ToolRow key={tr.id} tr={tr} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
