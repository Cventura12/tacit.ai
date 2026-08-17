"use client";

import { useState } from "react";
import { Sidebar, HamburgerButton } from "@/components/Sidebar";

// ── Types (mirror the API response shapes exactly) ────────────────────────────

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

interface AnsweredResponse {
  status: "answered";
  answer: string;
  citations: Citation[];
}

interface RefusedResponse {
  status: "refused";
  answer: null;
  reason: string;
  citations: [];
}

interface ErrorResponse {
  error: string;
}

type AskResult =
  | { kind: "answered"; answer: string; citations: Citation[] }
  | { kind: "refused"; reason: string }
  | { kind: "error"; message: string };

export function AskView() {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);

  async function handleAsk() {
    if (!question.trim() || asking) return;
    setAsking(true);
    setResult(null);
    try {
      const res = await fetch("/api/owner/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json()) as AnsweredResponse | RefusedResponse | ErrorResponse;
      if (!res.ok || "error" in data) {
        setResult({ kind: "error", message: "error" in data ? data.error : "Something went wrong." });
      } else if (data.status === "answered") {
        setResult({ kind: "answered", answer: data.answer, citations: data.citations });
      } else {
        setResult({ kind: "refused", reason: data.reason });
      }
    } catch {
      setResult({ kind: "error", message: "Could not reach the server." });
    } finally {
      setAsking(false);
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
          <h1 className="text-[17px] font-semibold text-ink">Ask</h1>
        </div>

        <div className="px-4 lg:px-8 py-6 max-w-2xl flex flex-col gap-6">
          {/* Question form */}
          <div className="flex flex-col gap-2.5">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask something grounded in your documents and remembered facts."
              rows={4}
              className="w-full px-3.5 py-3 text-[13px] leading-relaxed rounded-lg resize-y outline-none"
              style={{ border: "0.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)" }}
            />
            <div className="flex justify-end">
              <button
                onClick={() => void handleAsk()}
                disabled={!question.trim() || asking}
                className="px-4 py-[7px] rounded-lg text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--green)" }}
              >
                {asking ? "Asking…" : "Ask"}
              </button>
            </div>
          </div>

          {/* Answered */}
          {result?.kind === "answered" && (
            <div className="flex flex-col gap-3">
              <div
                className="px-4 py-3.5 rounded-lg text-[13px] leading-relaxed text-ink"
                style={{ border: "0.5px solid var(--line)", background: "var(--bg)" }}
              >
                {result.answer}
              </div>
              {result.citations.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="font-mono text-[9px] tracking-[0.12em] uppercase" style={{ color: "var(--gray-2)" }}>
                    Citations
                  </p>
                  {result.citations.map((c, i) => (
                    <div
                      key={i}
                      className="px-3.5 py-2.5 rounded-lg text-[12px] leading-relaxed"
                      style={{ background: "var(--bubble)", border: "0.5px solid var(--line-2)", color: "var(--gray-2)" }}
                    >
                      {c.kind === "document" ? (
                        <span>{c.title} — page {c.page}</span>
                      ) : (
                        <span>&ldquo;{c.claim}&rdquo; — {c.source_kind}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Refused — calm, success-shaped, never styled as an error */}
          {result?.kind === "refused" && (
            <div
              className="px-4 py-3.5 rounded-lg text-[13px] leading-relaxed"
              style={{ border: "0.5px solid var(--line-2)", background: "var(--bubble)", color: "var(--gray-2)" }}
            >
              <p className="font-mono text-[9px] tracking-[0.12em] uppercase mb-1.5" style={{ color: "var(--gray-3)" }}>
                Not covered
              </p>
              {result.reason}
            </div>
          )}

          {/* Error — visibly distinct from a refusal */}
          {result?.kind === "error" && (
            <div
              className="px-4 py-3.5 rounded-lg text-[13px] leading-relaxed"
              style={{ border: "0.5px solid #f87171", background: "rgba(248,113,113,0.08)", color: "#dc2626" }}
            >
              <p className="font-mono text-[9px] tracking-[0.12em] uppercase mb-1.5" style={{ color: "#dc2626" }}>
                Error
              </p>
              {result.message}
            </div>
          )}

          {!asking && !result && (
            <p className="text-[13px]" style={{ color: "var(--gray-3)" }}>
              Nothing asked yet — type a question above and try it.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
