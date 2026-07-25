"use client";

import { useState } from "react";
import type { EmailProposal } from "@/lib/types";
import { PdfPanel } from "./PdfPanel";

// ── Icons ──────────────────────────────────────────────────────────────────────

const IcoMail = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <rect x="1.5" y="3" width="11" height="8" rx="1.25" stroke="currentColor" strokeWidth="1.2" />
    <path d="M1.5 5l5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const IcoLock = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <rect x="2.5" y="5.5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.1" />
    <path d="M4.5 5.5V4a2 2 0 014 0v1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    <circle cx="6.5" cy="8.5" r="0.75" fill="currentColor" />
  </svg>
);

const IcoCheck = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
    <path d="M2 5.5l2.5 2.5L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoShield = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M6 1L1.5 3v3.5C1.5 9.5 6 11 6 11s4.5-1.5 4.5-4.5V3L6 1z"
      stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 6l1.5 1.5L8 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ── Classification badge ───────────────────────────────────────────────────────

const BADGE: Record<
  EmailProposal["classification"],
  { dot: string; label: string; color: string }
> = {
  actionable:  { dot: "#22c55e", label: "Recommended action",  color: "var(--ink)" },
  needs_caleb: { dot: "#f59e0b", label: "Needs your call",     color: "var(--ink)" },
  ignore:      { dot: "var(--gray-3)", label: "No action suggested", color: "var(--gray-2)" },
};

// ── Types ──────────────────────────────────────────────────────────────────────

type PanelDoc = { docId: string; page: number; title: string; highlight?: string };

// ── EmailProposalCard ──────────────────────────────────────────────────────────

export function EmailProposalCard({ proposal }: { proposal: EmailProposal }) {
  const [draft, setDraft] = useState(proposal.draft_reply ?? "");
  const [cardStatus, setCardStatus] = useState<"pending" | "approved" | "skipped">("pending");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelDoc, setPanelDoc] = useState<PanelDoc | null>(null);

  const badge = BADGE[proposal.classification];
  const sourceCount = proposal.matched_documents.length;

  function openCitation(doc: EmailProposal["matched_documents"][number]) {
    if (!doc.doc_id) return;
    setPanelDoc({ docId: doc.doc_id, page: doc.page, title: doc.title, highlight: doc.highlight });
    setPanelOpen(true);
  }

  async function handleApprove() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/owner/email/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...proposal, draft_reply: draft }),
      });
      if (!res.ok) throw new Error("Request failed");
      setCardStatus("approved");
    } catch {
      setErr("couldn't log approval — try again");
    } finally {
      setLoading(false);
    }
  }

  if (cardStatus === "approved") {
    return (
      <div
        className="message-animate rounded-xl px-4 py-3 text-[13px] text-gray-1"
        style={{ border: "0.5px solid var(--line)", background: "var(--bubble)" }}
      >
        approved — logged to owner actions. no email sent.
      </div>
    );
  }

  if (cardStatus === "skipped") {
    return (
      <div
        className="message-animate rounded-xl px-4 py-3 text-[13px] text-gray-1"
        style={{ border: "0.5px solid var(--line)", background: "var(--bubble)" }}
      >
        skipped.
      </div>
    );
  }

  return (
    <div
      className="message-animate w-full rounded-xl overflow-hidden"
      style={{ border: "0.5px solid var(--line)", background: "var(--bg)" }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-2.5 px-4 py-3"
        style={{ borderBottom: "0.5px solid var(--line)" }}
      >
        <span className="text-gray-2 shrink-0"><IcoMail /></span>
        <p className="flex-1 text-[13px] font-medium text-ink leading-tight truncate">
          {proposal.draft_reply ? "Draft reply prepared" : "Email reviewed"}
        </p>
        {sourceCount > 0 && (
          <span
            className="font-mono text-[9px] tracking-[0.12em] uppercase px-2 py-[3px] rounded-full shrink-0"
            style={{ background: "var(--green-tint)", color: "var(--green-dark)" }}
          >
            GROUNDED DRAFT
          </span>
        )}
        <span className="text-gray-3 shrink-0"><IcoLock /></span>
      </div>

      {/* ── Two-column body ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[var(--line)]">

        {/* Left col: triage + draft */}
        <div className="px-4 py-4 flex flex-col gap-4">

          {/* Recommended action */}
          <div>
            <p className="font-mono text-[9px] tracking-[0.12em] uppercase text-gray-2 mb-2">
              RECOMMENDED ACTION
            </p>
            <div
              className="rounded-lg px-3 py-2.5"
              style={{ background: "var(--bubble)", border: "0.5px solid var(--line-2)" }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-[7px] h-[7px] rounded-full shrink-0"
                  style={{ background: badge.dot }}
                />
                <span className="text-[13px] font-medium" style={{ color: badge.color }}>
                  {badge.label}
                </span>
              </div>
              <p className="text-[12px] text-gray-1 leading-snug">{proposal.reason}</p>
            </div>
          </div>

          {/* Draft reply */}
          {proposal.draft_reply !== null && (
            <div className="flex flex-col flex-1 gap-1.5">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[9px] tracking-[0.12em] uppercase text-gray-2">
                  DRAFT REPLY
                </p>
                <button
                  onClick={() => setEditing((v) => !v)}
                  className="text-[11px] text-gray-2 hover:text-ink transition-colors"
                >
                  {editing ? "Done" : "Edit"}
                </button>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                readOnly={!editing}
                rows={7}
                className="w-full flex-1 resize-y rounded-lg px-3 py-2.5 text-[13px] text-ink leading-relaxed focus:outline-none transition-[box-shadow]"
                style={{
                  background: editing ? "var(--bg)" : "var(--bubble)",
                  border: `0.5px solid ${editing ? "var(--green)" : "var(--line-2)"}`,
                  boxShadow: editing ? "0 0 0 2px rgba(27,122,75,0.12)" : "none",
                }}
              />
            </div>
          )}

        </div>

        {/* Right col: sources + safety check */}
        <div className="px-4 py-4 flex flex-col gap-4">

          {/* Grounded sources */}
          {sourceCount > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-[9px] tracking-[0.12em] uppercase text-gray-2">
                  GROUNDED SOURCES
                </p>
                <span className="font-mono text-[9px] text-gray-2">
                  {sourceCount} source{sourceCount !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {proposal.matched_documents.map((d, i) => {
                  const clickable = !!d.doc_id;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => openCitation(d)}
                      disabled={!clickable}
                      className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg w-full text-left transition-colors"
                      style={{
                        border: "0.5px solid var(--line-2)",
                        background: "var(--bubble)",
                        cursor: clickable ? "pointer" : "default",
                      }}
                      onMouseEnter={(e) => {
                        if (clickable) (e.currentTarget as HTMLElement).style.borderColor = "var(--green)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--line-2)";
                      }}
                    >
                      <span
                        className="font-mono text-[10px] shrink-0 mt-[1px]"
                        style={{ color: "var(--green)", minWidth: "2.5rem" }}
                      >
                        p.{String(d.page).padStart(2, "0")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-[12px] font-medium leading-tight truncate"
                          style={{
                            color: clickable ? "var(--green-dark)" : "var(--ink)",
                            textDecoration: clickable ? "underline" : "none",
                            textDecorationColor: "var(--green)",
                            textUnderlineOffset: "2px",
                          }}
                        >
                          {d.title}
                        </p>
                        <p className="text-[10px] text-gray-2 mt-[2px]">
                          {i === 0 ? "Primary match" : "Supporting match"}
                        </p>
                      </div>
                      <span className="text-green shrink-0 mt-[1px]"><IcoCheck /></span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Safety check */}
          <div
            className="rounded-xl px-4 py-3 mt-auto"
            style={{ background: "var(--forest)" }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span style={{ color: "rgba(255,255,255,0.6)" }}><IcoShield /></span>
              <p
                className="font-mono text-[9px] tracking-[0.12em] uppercase"
                style={{ color: "rgba(255,255,255,0.6)" }}
              >
                SAFETY CHECK
              </p>
              <span className="ml-auto" style={{ color: "#4ade80" }}><IcoCheck /></span>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
              Tacit recommends; you decide. Every claim traces to a cited page. It surfaces
              conditions, not a verdict — it does not conclude your eligibility or legal status.
            </p>
          </div>

          {/* Suggested attachments */}
          {proposal.suggested_attachments.length > 0 && (
            <div>
              <p className="font-mono text-[9px] tracking-[0.12em] uppercase text-gray-2 mb-1.5">
                SUGGESTED ATTACHMENTS
              </p>
              <ul className="flex flex-col gap-[3px]">
                {proposal.suggested_attachments.map((title, i) => (
                  <li key={i} className="text-[12px] text-gray-1 flex items-center gap-1.5">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"
                      className="shrink-0 text-gray-3">
                      <path d="M1.5 9.5V2A.75.75 0 012.25 1.25h4.5L9.5 4.5V9.5a.75.75 0 01-.75.75h-6.5a.75.75 0 01-.75-.75Z"
                        stroke="currentColor" strokeWidth="1" />
                      <path d="M6.75 1.25v3.25H9.5" stroke="currentColor" strokeWidth="1" />
                    </svg>
                    {title}
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
      </div>

      {/* ── Footer ── */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderTop: "0.5px solid var(--line)" }}
      >
        <button
          onClick={() => void handleApprove()}
          disabled={loading}
          className="px-4 py-[7px] rounded-lg bg-green text-white text-[13px] font-medium hover:bg-navy-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Logging…" : "Approve draft"}
        </button>
        <button
          onClick={() => setEditing((v) => !v)}
          disabled={loading}
          className="text-[13px] text-gray-1 hover:text-ink transition-colors disabled:opacity-50"
        >
          {editing ? "Done editing" : "Edit"}
        </button>
        {err && <p className="text-[12px] text-red-600">{err}</p>}
        <p className="ml-auto text-[11px] text-gray-3 shrink-0">
          Approval logs only · sending not connected
        </p>
      </div>

      {/* PDF viewer panel — portaled to document.body */}
      {panelDoc !== null && (
        <PdfPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          docId={panelDoc.docId}
          page={panelDoc.page}
          title={panelDoc.title}
          highlight={panelDoc.highlight}
        />
      )}
    </div>
  );
}
