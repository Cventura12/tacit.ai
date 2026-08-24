"use client";

// Tacit's main surface — replaces the old visitor-framed chat/gate UI.
// Calm by default: goal line + a quiet ambient status + a ready command line.
// The Read (fact + move, as one gesture) appears above the goal ONLY when
// something genuinely earns it — never manufactured to fill space. See the
// isEarned() threshold below for exactly what "earned" means today.

import { useState, useEffect } from "react";
import { Sidebar, HamburgerButton } from "./Sidebar";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PendingProposal {
  id: string;
  sender: string;
  subject: string;
  classification: string;
  created_at: string;
}

interface DocumentCitation {
  kind: "document";
  doc_id: string;
  title: string;
  page: number;
}

interface MemoryCitation {
  kind: "memory";
  claim: string;
  source_kind: string;
  source_id: string;
}

type Citation = DocumentCitation | MemoryCitation;

type AskResult =
  | { kind: "answered"; answer: string; citations: Citation[] }
  | { kind: "refused"; reason: string }
  | { kind: "error"; message: string };

// ── Fixed content ──────────────────────────────────────────────────────────────

const GOAL = "Found a frontier AI company. Run it.";

// A pending item only earns a proactive Read if it needs a real decision
// (needs_caleb) or has genuinely sat unresolved for a day — a brand-new
// actionable draft doesn't get the assertive treatment just for existing.
const EARNED_AGE_MS = 24 * 60 * 60 * 1000;

// ── Pure helpers ───────────────────────────────────────────────────────────────

function senderName(raw: string): string {
  const m = raw.match(/^"?([^"<]+)"?\s*<.*>$/);
  return (m ? m[1] : raw).trim();
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

// Deterministic, non-model prioritization — never hallucinated. Prefers a
// proposal that needs the owner's own judgment over one that's just a draft
// waiting to be sent, then the oldest within that tier.
function pickMove(proposals: PendingProposal[]): PendingProposal | null {
  if (proposals.length === 0) return null;
  const sorted = [...proposals].sort((a, b) => {
    const pa = a.classification === "needs_caleb" ? 0 : 1;
    const pb = b.classification === "needs_caleb" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
  return sorted[0];
}

function isEarned(proposals: PendingProposal[]): boolean {
  const now = Date.now();
  return proposals.some(
    (p) =>
      p.classification === "needs_caleb" ||
      now - new Date(p.created_at).getTime() >= EARNED_AGE_MS
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function Surface() {
  // null = not loaded yet — kept distinct from [] so the quiet-state status
  // line never briefly claims "inbox quiet" before the real count is known.
  const [proposals, setProposals] = useState<PendingProposal[] | null>(null);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askedText, setAskedText] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/owner/inbox")
      .then((r) => (r.ok ? r.json() : { proposals: [] }))
      .then((data: { proposals?: unknown }) => {
        if (!cancelled) {
          setProposals(Array.isArray(data.proposals) ? (data.proposals as PendingProposal[]) : []);
        }
      })
      .catch(() => {
        // Best-effort, ambient signal only — a failed fetch means the calm
        // default holds, never an error state on the home surface itself.
        if (!cancelled) setProposals([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAsk() {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskedText(q);
    setResult(null);
    setQuestion("");
    try {
      const res = await fetch("/api/owner/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || typeof data.error === "string") {
        setResult({
          kind: "error",
          message: typeof data.error === "string" ? data.error : "Something went wrong.",
        });
      } else if (data.status === "answered") {
        setResult({
          kind: "answered",
          answer: data.answer as string,
          citations: (data.citations as Citation[]) ?? [],
        });
      } else {
        setResult({ kind: "refused", reason: data.reason as string });
      }
    } catch {
      setResult({ kind: "error", message: "Could not reach the server." });
    } finally {
      setAsking(false);
    }
  }

  const move = proposals ? pickMove(proposals) : null;
  const showRead = proposals !== null && move !== null && isEarned(proposals);
  const pendingCount = proposals?.length ?? 0;

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar alwaysCollapsed />

      <main className="flex-1 overflow-y-auto flex justify-center">
        <div className="w-full flex flex-col min-h-full px-5" style={{ maxWidth: "440px" }}>
          <header className="flex items-center gap-2 pt-5 pb-2 shrink-0">
            <HamburgerButton />
            <span
              className="font-mono text-[10px] tracking-[0.14em] uppercase"
              style={{ color: "var(--gray-3)" }}
            >
              Tacit
            </span>
          </header>

          <div className="flex-1 flex flex-col justify-center gap-7 py-8">
            {showRead && move && (
              <div
                className="flex flex-col gap-2 px-4 py-3.5 rounded-lg"
                style={{ borderLeft: "2px solid var(--green)", background: "var(--bubble)" }}
              >
                <p
                  className="font-mono text-[9px] tracking-[0.12em] uppercase"
                  style={{ color: "var(--gray-2)" }}
                >
                  Read
                </p>
                <p className="text-[13px] leading-relaxed text-ink">
                  {pendingCount} {pendingCount === 1 ? "item" : "items"} waiting in your inbox
                  — oldest from {senderName(move.sender)}, {ageLabel(move.created_at)}.
                </p>
                <p className="text-[13px] leading-relaxed italic" style={{ color: "var(--green-dark)" }}>
                  the move — {move.classification === "needs_caleb" ? "needs your call" : "draft ready"}:{" "}
                  &ldquo;{move.subject || "(no subject)"}&rdquo;
                </p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <p
                className="font-mono text-[9px] tracking-[0.12em] uppercase"
                style={{ color: "var(--gray-2)" }}
              >
                Goal
              </p>
              <p className="text-[16px] leading-snug font-medium text-ink">{GOAL}</p>
              {!showRead && proposals !== null && (
                <p className="text-[12px] mt-1" style={{ color: "var(--gray-3)" }}>
                  {pendingCount === 0 ? "· inbox quiet" : `· ${pendingCount} in the inbox, nothing urgent yet`}
                </p>
              )}
            </div>

            {askedText && (
              <div className="flex flex-col gap-2.5">
                <p className="text-[12px]" style={{ color: "var(--gray-2)" }}>
                  &ldquo;{askedText}&rdquo;
                </p>
                {asking && (
                  <p className="text-[13px]" style={{ color: "var(--gray-3)" }}>
                    thinking…
                  </p>
                )}
                {!asking && result?.kind === "answered" && (
                  <div className="flex flex-col gap-2.5">
                    <div
                      className="px-4 py-3.5 rounded-lg text-[13px] leading-relaxed text-ink"
                      style={{ border: "0.5px solid var(--line)" }}
                    >
                      {result.answer}
                    </div>
                    {result.citations.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        {result.citations.map((c, i) => (
                          <div
                            key={i}
                            className="px-3 py-2 rounded-md text-[11px] leading-relaxed"
                            style={{ background: "var(--bubble)", color: "var(--gray-2)" }}
                          >
                            {c.kind === "document"
                              ? `${c.title} — p.${c.page}`
                              : `"${c.claim}" — ${c.source_kind}`}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {!asking && result?.kind === "refused" && (
                  <div
                    className="px-4 py-3 rounded-lg text-[13px] leading-relaxed"
                    style={{ background: "var(--bubble)", color: "var(--gray-2)" }}
                  >
                    {result.reason}
                  </div>
                )}
                {!asking && result?.kind === "error" && (
                  <div
                    className="px-4 py-3 rounded-lg text-[13px]"
                    style={{ border: "0.5px solid #f87171", color: "#dc2626" }}
                  >
                    {result.message}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 pb-5 pt-2">
            <div
              className="rounded-xl overflow-hidden flex items-end gap-2 px-3.5 py-2.5"
              style={{ border: "0.5px solid var(--line)" }}
            >
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleAsk();
                  }
                }}
                placeholder="ask anything grounded in what you know"
                rows={1}
                className="flex-1 resize-none bg-transparent text-[14px] leading-relaxed outline-none"
                style={{ color: "var(--ink)", maxHeight: "100px" }}
              />
              <button
                onClick={() => void handleAsk()}
                disabled={!question.trim() || asking}
                aria-label="Send"
                className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green focus-visible:outline-offset-2"
                style={{ background: "var(--green)" }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M2 8h12M9 3.5l4.5 4.5L9 12.5"
                    stroke="white"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
