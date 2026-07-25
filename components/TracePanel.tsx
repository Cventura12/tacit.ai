"use client";

import type { TraceStep } from "@/lib/types";

// ── Context items ──────────────────────────────────────────────────────────────

interface ContextItem {
  label: string;
  detail: string;
  active: boolean;
  icon: React.ReactNode;
}

const IcoDoc = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <path d="M8 1.5H3.5A.75.75 0 002.75 2.25v8.5A.75.75 0 003.5 11.5h6a.75.75 0 00.75-.75V4.5L8 1.5z"
      stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 1.5v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
);

const IcoStorage = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <rect x="1.5" y="3" width="10" height="3" rx="1" stroke="currentColor" strokeWidth="1.1" />
    <rect x="1.5" y="7" width="10" height="3" rx="1" stroke="currentColor" strokeWidth="1.1" />
    <circle cx="9.5" cy="4.5" r="0.75" fill="currentColor" />
    <circle cx="9.5" cy="8.5" r="0.75" fill="currentColor" />
  </svg>
);

const IcoMail = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <rect x="1.5" y="3" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.1" />
    <path d="M1.5 4.5l5 3.5 5-3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
);

const IcoActivity = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <path d="M1 6.5h2l1.5-4 2.5 7.5 2-5.5 1 2H12"
      stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoCheck = () => (
  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
    <path d="M1.5 4.5l2 2L7.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ── TracePanel ─────────────────────────────────────────────────────────────────

interface TracePanelProps {
  steps: TraceStep[];
  currentRunLabel?: string;
}

const CONTEXT_ITEMS: ContextItem[] = [
  {
    label: "Document index",
    detail: "local full-text search",
    active: true,
    icon: <IcoDoc />,
  },
  {
    label: "Local storage",
    detail: "files stay on this machine",
    active: true,
    icon: <IcoStorage />,
  },
  {
    label: "Gmail",
    detail: "connect flow not completed",
    active: false,
    icon: <IcoMail />,
  },
  {
    label: "Activity view",
    detail: "trace browser not built yet",
    active: false,
    icon: <IcoActivity />,
  },
];

export function TracePanel({ steps, currentRunLabel }: TracePanelProps) {
  const hasSteps = steps.length > 0;

  return (
    <aside
      className="hidden lg:flex flex-col w-[280px] shrink-0 h-dvh overflow-y-auto"
      style={{ borderLeft: "0.5px solid var(--line)", background: "var(--bg)" }}
    >
      {/* Retrieval trace header card */}
      <div className="p-4">
        <div
          className="rounded-xl p-4"
          style={{ background: "var(--forest)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <p
              className="font-mono text-[9px] tracking-[0.14em] uppercase leading-none"
              style={{ color: "var(--forest-muted)" }}
            >
              RETRIEVAL TRACE
            </p>
            <div className="flex items-center gap-1.5">
              <span
                className="w-[6px] h-[6px] rounded-full shrink-0"
                style={{ background: "#4ade80" }}
              />
              <span className="text-[9px]" style={{ color: "var(--forest-muted)" }}>
                Recorded
              </span>
            </div>
          </div>
          <p
            className="font-medium text-[14px] leading-snug"
            style={{ color: "var(--forest-text)" }}
          >
            {currentRunLabel ?? "No active request"}
          </p>
          <p
            className="text-[11px] mt-[6px] leading-relaxed"
            style={{ color: "var(--forest-muted)" }}
          >
            Candidate pages, selected evidence, and tool calls are logged locally.
          </p>
        </div>
      </div>

      {/* Current run steps */}
      {hasSteps && (
        <div className="px-4 pb-4">
          <p className="font-mono text-[9px] tracking-[0.12em] uppercase text-gray-2 mb-3">
            CURRENT RUN
          </p>
          <div className="flex flex-col gap-3">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2.5">
                {step.status === "done" ? (
                  <span
                    className="w-[16px] h-[16px] rounded-full flex items-center justify-center shrink-0 mt-[1px]"
                    style={{ background: "var(--green)" }}
                  >
                    <IcoCheck />
                  </span>
                ) : (
                  <span
                    className="w-[16px] h-[16px] rounded-full flex items-center justify-center shrink-0 mt-[1px]"
                    style={{ border: "2px solid #f59e0b" }}
                  >
                    <span
                      className="w-[5px] h-[5px] rounded-full"
                      style={{ background: "#f59e0b" }}
                    />
                  </span>
                )}
                <p
                  className="text-[12px] leading-tight pt-[1px]"
                  style={{ color: step.status === "done" ? "var(--ink)" : "#b45309" }}
                >
                  {step.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spacer before context */}
      <div className="flex-1" />

      {/* Context section */}
      <div className="px-4 pb-5 pt-3" style={{ borderTop: "0.5px solid var(--line)" }}>
        <p className="font-mono text-[9px] tracking-[0.12em] uppercase text-gray-2 mb-3">
          CONTEXT
        </p>
        <div className="flex flex-col gap-2">
          {CONTEXT_ITEMS.map((item) => (
            <div key={item.label} className="flex items-start gap-2.5">
              <span
                className="shrink-0 mt-[1px]"
                style={{ color: item.active ? "var(--green)" : "var(--gray-3)" }}
              >
                {item.icon}
              </span>
              <div className="min-w-0">
                <p
                  className="text-[12px] leading-tight"
                  style={{ color: item.active ? "var(--ink)" : "var(--gray-2)" }}
                >
                  {item.label}
                </p>
                <p className="text-[10px] leading-tight mt-[2px]" style={{ color: "var(--gray-3)" }}>
                  {item.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
