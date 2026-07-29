"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar, HamburgerButton } from "@/components/Sidebar";
import { EmailProposalCard } from "@/components/EmailProposalCard";
import type { EmailProposal } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PendingProposal {
  id: string;
  gmail_message_id: string;
  sender: string;
  subject: string;
  classification: EmailProposal["classification"];
  reason: string;
  draft_body: string | null;
  grounded_sources: unknown;
  suggested_attachments: unknown;
  thread_id: string | null;
  in_reply_to_id: string | null;
  status: string;
  created_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toEmailProposal(p: PendingProposal): EmailProposal {
  const docs = (p.grounded_sources ?? []) as EmailProposal["matched_documents"];
  const attachmentTitles = (p.suggested_attachments ?? []) as string[];
  const replySubject = /^re:/i.test(p.subject.trim()) ? p.subject : `Re: ${p.subject}`;
  return {
    classification: p.classification,
    reason: p.reason,
    matched_documents: docs,
    draft_reply: p.draft_body,
    suggested_attachments: attachmentTitles,
    recipient: p.sender || undefined,
    reply_subject: replySubject || undefined,
    thread_id: p.thread_id ?? undefined,
    in_reply_to_id: p.in_reply_to_id ?? undefined,
    attachment_doc_ids: docs.map((d) => d.doc_id).filter((id): id is string => !!id),
    needs_approval: true,
  };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const CLASS_DOT: Record<string, string> = {
  actionable: "var(--green)",
  needs_caleb: "#f59e0b",
};

// ── ProposalRow ────────────────────────────────────────────────────────────────

function ProposalRow({
  proposal,
  expanded,
  onToggle,
  onSent,
  onSkipped,
}: {
  proposal: PendingProposal;
  expanded: boolean;
  onToggle: () => void;
  onSent: () => void;
  onSkipped: () => void;
}) {
  const emailProposal = toEmailProposal(proposal);
  const dotColor = CLASS_DOT[proposal.classification] ?? "var(--gray-3)";
  const classLabel = proposal.classification === "actionable" ? "Draft ready" : "Needs your call";

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ border: "0.5px solid var(--line)", background: "var(--bg)" }}
    >
      {/* Collapsed summary */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors"
        style={{ background: "var(--bg)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.02)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg)")}
      >
        <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: dotColor }} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-ink truncate">
            {proposal.subject || "(no subject)"}
          </p>
          <p className="text-[11px] truncate mt-[1px]" style={{ color: "var(--gray-2)" }}>
            {proposal.sender}
          </p>
        </div>
        <span
          className="font-mono text-[9px] tracking-[0.08em] uppercase px-2 py-[3px] rounded-full shrink-0"
          style={{ background: "var(--green-tint)", color: "var(--green-dark)" }}
        >
          {classLabel}
        </span>
        <span
          className="text-[11px] shrink-0"
          style={{ color: "var(--gray-3)", minWidth: "52px", textAlign: "right" }}
        >
          {fmtDate(proposal.created_at)}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          style={{
            color: "var(--gray-3)",
            flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
          }}
        >
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Expanded card */}
      {expanded && (
        <div
          className="px-4 pb-4 pt-3"
          style={{ borderTop: "0.5px solid var(--line)" }}
        >
          <EmailProposalCard
            proposal={emailProposal}
            onSent={onSent}
            onSkipped={onSkipped}
          />
        </div>
      )}
    </div>
  );
}

// ── InboxView ──────────────────────────────────────────────────────────────────

export function InboxView() {
  const [proposals, setProposals] = useState<PendingProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/owner/inbox");
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Failed to load inbox");
      }
      const d = (await res.json()) as { proposals?: PendingProposal[] };
      setProposals(d.proposals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function checkNow() {
    setChecking(true);
    setCheckMsg("");
    try {
      const res = await fetch("/api/owner/inbox", { method: "POST" });
      const d = (await res.json()) as { ok?: boolean; new_proposals?: number; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error ?? "Check failed");
      const n = d.new_proposals ?? 0;
      setCheckMsg(n > 0 ? `${n} new proposal${n > 1 ? "s" : ""}` : "No new proposals");
      if (n > 0) await load();
    } catch (err) {
      setCheckMsg(err instanceof Error ? err.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  async function markStatus(id: string, status: "sent" | "skipped") {
    try {
      await fetch(`/api/owner/inbox/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch { /* best-effort — card already shows confirmed state */ }
    setProposals((prev) => prev.filter((p) => p.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4 lg:px-8 py-5"
          style={{ borderBottom: "0.5px solid var(--line)", background: "var(--bg)" }}
        >
          <div className="flex items-center gap-2">
            <HamburgerButton />
            <h1 className="text-[17px] font-semibold text-ink">Inbox</h1>
          </div>
          <div className="flex items-center gap-3">
            {checkMsg && (
              <span className="text-[12px]" style={{ color: "var(--gray-2)" }}>
                {checkMsg}
              </span>
            )}
            <button
              onClick={() => void checkNow()}
              disabled={checking}
              className="px-3 py-[6px] rounded-lg text-[12px] font-medium transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{
                border: "0.5px solid var(--line)",
                color: "var(--ink)",
                background: "var(--bubble)",
              }}
            >
              {checking ? "Checking…" : "Check inbox"}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 lg:px-8 py-6 max-w-3xl">
          {loading ? (
            <p className="text-[13px]" style={{ color: "var(--gray-2)" }}>Loading…</p>
          ) : error ? (
            <div
              className="px-4 py-3 rounded-lg"
              style={{
                background: "rgba(248,113,113,0.08)",
                border: "0.5px solid rgba(248,113,113,0.2)",
              }}
            >
              <p className="text-[13px]" style={{ color: "#f87171" }}>{error}</p>
              <p className="text-[11px] mt-1" style={{ color: "var(--gray-3)" }}>
                The pending_proposals table may need to be created — run the SQL migration first.
              </p>
            </div>
          ) : proposals.length === 0 ? (
            <div className="py-20 flex flex-col items-center gap-3 text-center">
              <svg
                width="36"
                height="36"
                viewBox="0 0 36 36"
                fill="none"
                aria-hidden="true"
                style={{ color: "var(--gray-3)" }}
              >
                <path
                  d="M3 21h8.5a6.5 6.5 0 0013 0H33v8a1 1 0 01-1 1H4a1 1 0 01-1-1v-8z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M3 21L9 9h18l6 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="text-[15px] font-medium text-ink">Inbox clear</p>
              <p className="text-[13px]" style={{ color: "var(--gray-2)" }}>
                No pending proposals. Click "Check inbox" to scan for new emails.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[11px] mb-1" style={{ color: "var(--gray-3)" }}>
                {proposals.length} pending proposal{proposals.length !== 1 ? "s" : ""}
              </p>
              {proposals.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  expanded={expandedId === p.id}
                  onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  onSent={() => void markStatus(p.id, "sent")}
                  onSkipped={() => void markStatus(p.id, "skipped")}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
