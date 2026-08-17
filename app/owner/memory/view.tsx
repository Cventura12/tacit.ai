"use client";

import { useState } from "react";
import { Sidebar, HamburgerButton } from "@/components/Sidebar";

// ── Icons ──────────────────────────────────────────────────────────────────────

const IcoCheck = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
    <path d="M2 5.5l2.5 2.5L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoX = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// ── Types (mirror the API response shapes exactly) ────────────────────────────

interface Candidate {
  id: string;
  claim: string;
  reason: string;
}

interface AlreadyKnown {
  claim: string;
  reason: string;
  existing_id: string;
  existing_claim: string;
}

interface ExtractResponse {
  source_id: string;
  candidates: Candidate[];
  already_known: AlreadyKnown[];
  error?: string;
}

type ResolveOutcome = "confirmed" | "rejected";

export function MemoryView() {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [alreadyKnown, setAlreadyKnown] = useState<AlreadyKnown[]>([]);
  // Per-candidate id -> its final outcome, once resolved. Resolved candidates
  // stay visible (struck through) rather than disappearing, so it's clear
  // what was just decided.
  const [outcomes, setOutcomes] = useState<Record<string, ResolveOutcome>>({});
  const [resolving, setResolving] = useState<string | null>(null);

  async function handleExtract() {
    if (!text.trim() || extracting) return;
    setExtracting(true);
    setExtractError("");
    setCandidates([]);
    setAlreadyKnown([]);
    setOutcomes({});
    try {
      const res = await fetch("/api/owner/memory/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, label: label.trim() || undefined }),
      });
      const data = (await res.json()) as ExtractResponse;
      if (!res.ok) throw new Error(data.error ?? "Extraction failed");
      setCandidates(data.candidates);
      setAlreadyKnown(data.already_known);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function handleResolve(id: string, action: "confirm" | "reject") {
    if (resolving) return;
    setResolving(id);
    try {
      const res = await fetch("/api/owner/memory/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "confirm" ? { confirm: [id] } : { reject: [id] }),
      });
      const data = (await res.json()) as { confirmed: string[]; rejected: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Resolve failed");
      if (data.confirmed.includes(id)) setOutcomes((o) => ({ ...o, [id]: "confirmed" }));
      else if (data.rejected.includes(id)) setOutcomes((o) => ({ ...o, [id]: "rejected" }));
    } catch {
      // Best-effort — leave the candidate unresolved so the owner can retry.
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div
          className="sticky top-0 z-10 flex items-center gap-2 px-4 lg:px-8 py-5"
          style={{ borderBottom: "0.5px solid var(--line)", background: "var(--bg)" }}
        >
          <HamburgerButton />
          <h1 className="text-[17px] font-semibold text-ink">Memory</h1>
        </div>

        <div className="px-4 lg:px-8 py-6 max-w-2xl flex flex-col gap-6">
          {/* Paste form */}
          <div className="flex flex-col gap-2.5">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste a chunk of text — a session, notes, anything you'd say out loud — and Tacit will propose durable facts worth remembering."
              rows={10}
              className="w-full px-3.5 py-3 text-[13px] leading-relaxed rounded-lg resize-y outline-none"
              style={{ border: "0.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)" }}
            />
            <div className="flex items-center gap-2.5">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={'Label (optional) — e.g. "session 2026-08-17"'}
                className="flex-1 px-3 py-[7px] text-[13px] rounded-lg outline-none"
                style={{ border: "0.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)" }}
              />
              <button
                onClick={() => void handleExtract()}
                disabled={!text.trim() || extracting}
                className="px-4 py-[7px] rounded-lg text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--green)" }}
              >
                {extracting ? "Extracting…" : "Extract candidates"}
              </button>
            </div>
            {extractError && (
              <p className="text-[12px]" style={{ color: "#f87171" }}>{extractError}</p>
            )}
          </div>

          {/* Candidates */}
          {candidates.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[9px] tracking-[0.12em] uppercase" style={{ color: "var(--gray-2)" }}>
                Candidates — review, then confirm or reject
              </p>
              {candidates.map((c) => {
                const outcome = outcomes[c.id];
                return (
                  <div
                    key={c.id}
                    className="flex items-start gap-3 px-4 py-3.5 rounded-lg"
                    style={{
                      border: "0.5px solid var(--line)",
                      background: "var(--bg)",
                      opacity: outcome ? 0.5 : 1,
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[13px] leading-relaxed text-ink"
                        style={{ textDecoration: outcome ? "line-through" : "none" }}
                      >
                        {c.claim}
                      </p>
                      <p className="text-[11px] mt-1" style={{ color: "var(--gray-3)" }}>
                        {outcome ? `${outcome}` : c.reason}
                      </p>
                    </div>
                    {!outcome && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => void handleResolve(c.id, "confirm")}
                          disabled={resolving === c.id}
                          title="Confirm — this becomes a real memory"
                          className="w-7 h-7 flex items-center justify-center rounded-md text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                          style={{ background: "var(--green)" }}
                        >
                          <IcoCheck />
                        </button>
                        <button
                          onClick={() => void handleResolve(c.id, "reject")}
                          disabled={resolving === c.id}
                          title="Reject — discarded, not stored as fact"
                          className="w-7 h-7 flex items-center justify-center rounded-md transition-opacity hover:opacity-70 disabled:opacity-50"
                          style={{ border: "0.5px solid var(--line)", color: "var(--gray-2)" }}
                        >
                          <IcoX />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Already known */}
          {alreadyKnown.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[9px] tracking-[0.12em] uppercase" style={{ color: "var(--gray-2)" }}>
                Already known — matched an existing memory, not proposed again
              </p>
              {alreadyKnown.map((m, i) => (
                <div
                  key={i}
                  className="px-4 py-3 rounded-lg text-[12px] leading-relaxed"
                  style={{ background: "var(--bubble)", border: "0.5px solid var(--line-2)", color: "var(--gray-2)" }}
                >
                  &ldquo;{m.claim}&rdquo; matches an existing memory: &ldquo;{m.existing_claim}&rdquo;
                </div>
              ))}
            </div>
          )}

          {!extracting && candidates.length === 0 && alreadyKnown.length === 0 && !extractError && (
            <p className="text-[13px]" style={{ color: "var(--gray-3)" }}>
              Nothing extracted yet — paste something above and try it.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
