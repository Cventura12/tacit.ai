"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Message, ApiMessage, TraceStep, RecentRun } from "@/lib/types";
import { getReply, ApiError } from "@/lib/getReply";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { Sidebar, HamburgerButton } from "./Sidebar";
import { TracePanel } from "./TracePanel";
import { TacitMark } from "./TacitMark";

type PageState = "gate" | "chat";

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildApiHistory(seed: ApiMessage | null, msgs: Message[]): ApiMessage[] {
  const history: ApiMessage[] = seed ? [seed] : [];
  for (const m of msgs) {
    if (m.isError) continue;
    history.push({
      role: m.role === "me" ? "user" : "assistant",
      content: m.text,
    });
  }
  return history;
}

function errorBubble(err: unknown): Message {
  const text =
    err instanceof ApiError && err.status === 429
      ? "ay you're going fast lol — give it a sec and ask again"
      : "ah something glitched on my end — try again in a sec";
  return { id: newId(), role: "them", text, isError: true };
}

function useSessionId(): string | undefined {
  const ref = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const KEY = "tacit_sid";
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(KEY, id);
    }
    ref.current = id;
    setReady(true);
  }, []);
  return ready ? ref.current : undefined;
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 90000) return "Now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return "Today";
  return "Yesterday";
}

export default function ChatPage() {
  const sessionId = useSessionId();

  const [pageState, setPageState] = useState<PageState>("gate");
  const [gateInput, setGateInput] = useState("");
  const gateTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [apiSeed, setApiSeed] = useState<ApiMessage | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [hasSentMessage, setHasSentMessage] = useState(false);

  // Trace panel state — accumulated from SSE status events during the current run
  const [traceSteps, setTraceSteps] = useState<TraceStep[]>([]);
  const [currentRunLabel, setCurrentRunLabel] = useState<string | undefined>(undefined);

  // Sidebar recent runs — one entry per completed proposal
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  // Track timestamps for relative-time display
  const runTimestampsRef = useRef<Map<string, Date>>(new Map());

  const isGate = pageState === "gate";

  // Called by both gate submit and message send to accumulate trace steps
  const handleStatus = useCallback((label: string) => {
    setToolStatus(label);
    setTraceSteps((prev) => {
      const updated = prev.map((s) =>
        s.status === "active" ? { ...s, status: "done" as const } : s
      );
      return [...updated, { label, status: "active" as const }];
    });
  }, []);

  // Reset trace for a new request
  function beginNewRun(label: string) {
    setTraceSteps([]);
    setCurrentRunLabel(label);
  }

  // Mark all steps done after a run completes
  function finalizeTrace() {
    setTraceSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
  }

  // Add a completed run to the sidebar list
  function addRecentRun(label: string) {
    const id = newId();
    const now = new Date();
    runTimestampsRef.current.set(id, now);
    setRecentRuns((prev) => [
      { id, label, relativeTime: "Now", isCurrent: true },
      ...prev
        .slice(0, 4)
        .map((r) => ({
          ...r,
          isCurrent: false,
          relativeTime: relativeTime(runTimestampsRef.current.get(r.id) ?? new Date()),
        })),
    ]);
  }

  // ── Gate submit ──────────────────────────────────────────────────────────────

  const handleGateSubmit = async () => {
    const trimmed = gateInput.trim();
    if (!trimmed) return;

    const seed: ApiMessage = {
      role: "user",
      content:
        `[The visitor was asked "how do you know me?" and replied with the following. ` +
        `Greet them warmly in character, gauging who they are from it, then invite their question.]\n\n` +
        trimmed,
    };

    setGateInput("");
    if (gateTextareaRef.current) gateTextareaRef.current.style.height = "auto";
    setApiSeed(seed);
    setPageState("chat");
    setIsTyping(true);
    beginNewRun("Visitor greeting");

    try {
      const { text: reply, runId, proposal } = await getReply(
        [seed],
        handleStatus,
        { sessionId, gateAnswer: trimmed }
      );
      setToolStatus(null);
      finalizeTrace();
      setMessages([{ id: newId(), role: "them", text: reply, runId, proposal }]);
    } catch (err) {
      setToolStatus(null);
      finalizeTrace();
      setMessages([errorBubble(err)]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleGateKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleGateSubmit();
    }
  };

  const handleGateTextareaInput = () => {
    const el = gateTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // ── Chat message send ────────────────────────────────────────────────────────

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;

    const base = messages.filter((m) => !m.isError);
    const userMsg: Message = { id: newId(), role: "me", text };
    const next = [...base, userMsg];

    setMessages(next);
    setHasSentMessage(true);
    setIsTyping(true);

    // Use first 40 chars of the user's message as the run label
    const runLabel = text.length > 40 ? text.slice(0, 38) + "…" : text;
    beginNewRun(runLabel);

    try {
      const { text: reply, runId, proposal } = await getReply(
        buildApiHistory(apiSeed, next),
        handleStatus,
        { sessionId }
      );
      setToolStatus(null);
      finalizeTrace();

      if (proposal) {
        addRecentRun(runLabel);
      }

      setMessages((prev) => [
        ...prev.filter((m) => !m.isError),
        { id: newId(), role: "them", text: reply, runId, proposal },
      ]);
    } catch (err) {
      setToolStatus(null);
      finalizeTrace();
      setMessages((prev) => [
        ...prev.filter((m) => !m.isError),
        errorBubble(err),
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // ── New request (sidebar CTA) ────────────────────────────────────────────────

  const handleNewRequest = () => {
    setMessages([]);
    setApiSeed(null);
    setHasSentMessage(false);
    setTraceSteps([]);
    setCurrentRunLabel(undefined);
    setToolStatus(null);
    setPageState("gate");
    setGateInput("");
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-dvh overflow-hidden">

      {/* ── LEFT SIDEBAR ──────────────────────────────────────────────────────── */}
      <Sidebar recentRuns={recentRuns} onNewRequest={handleNewRequest} />

      {/* ── CENTER PANEL ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Top bar */}
        <header
          className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 bg-bg/95 backdrop-blur-sm z-10"
          style={{ borderBottom: "0.5px solid var(--line)" }}
        >
          <div className="flex items-center gap-2.5">
            <HamburgerButton />
            <TacitMark size={30} />
            <div>
              <p className="text-[13px] font-medium text-ink leading-none mb-[3px]">
                {currentRunLabel ?? "TACIT"}
              </p>
              <div className="flex items-center gap-[5px]">
                <span className="w-[5px] h-[5px] rounded-full bg-green shrink-0" aria-hidden="true" />
                <span className="text-[11px] text-gray-2 leading-none">
                  {isGate ? "evidence agent" : "active run"}
                </span>
              </div>
            </div>
          </div>

          {!isGate && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full"
              style={{ border: "0.5px solid var(--line-2)", background: "var(--bubble)" }}
            >
              <span className="w-[6px] h-[6px] rounded-full bg-green shrink-0" />
              <span className="font-mono text-[10px] text-gray-1 uppercase tracking-[0.1em]">
                ACTIVE
              </span>
            </div>
          )}
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {isGate ? (
            <div className="flex flex-col min-h-full px-4 sm:px-8 pt-12 sm:pt-14 pb-5">
              <div>
                <p className="font-mono text-[9px] tracking-[0.12em] uppercase text-gray-2 mb-4">
                  Current request
                </p>
                <p className="text-[12px] text-gray-2 max-w-[400px] mb-2 leading-relaxed">
                  Tacit retrieves and cites. You decide what the evidence means.
                </p>
                <h1 className="font-serif text-[26px] sm:text-[31px] text-ink leading-[1.25] max-w-[460px] mb-6">
                  Review the evidence before you act.
                </h1>
                <p className="text-[11px] text-gray-2 uppercase tracking-[0.08em]">
                  How do you know me?
                </p>
              </div>
            </div>
          ) : (
            <MessageList messages={messages} isTyping={isTyping} toolStatus={toolStatus} traceSteps={traceSteps} />
          )}
        </main>

        {/* Composer dock */}
        {isGate ? (
          <div
            className="shrink-0 px-4 sm:px-6 py-3 bg-bg/95 backdrop-blur-sm"
            style={{ borderTop: "0.5px solid var(--line)" }}
          >
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: "0.5px solid var(--line)" }}
            >
              <label htmlFor="gate-input" className="sr-only">
                How do you know me?
              </label>
              <textarea
                id="gate-input"
                ref={gateTextareaRef}
                value={gateInput}
                onChange={(e) => setGateInput(e.target.value)}
                onInput={handleGateTextareaInput}
                onKeyDown={handleGateKeyDown}
                placeholder="a follower, a friend, someone new..."
                rows={2}
                className="
                  w-full resize-none bg-bg px-4 pt-3 pb-2
                  text-[14px] text-ink placeholder:text-gray-2 leading-relaxed
                  overflow-y-auto focus:outline-none
                "
                style={{ maxHeight: "120px" }}
              />
              {/* Bottom toolbar */}
              <div
                className="flex items-center justify-between px-3 py-2"
                style={{ borderTop: "0.5px solid var(--line-2)" }}
              >
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-2 font-mono px-2 py-1 rounded-md"
                    style={{ border: "0.5px solid var(--line)" }}>
                    ⊕ Grounded mode
                  </span>
                </div>
                <button
                  onClick={() => void handleGateSubmit()}
                  aria-label="Send"
                  className="
                    w-[34px] h-[34px] rounded-lg bg-green shrink-0
                    flex items-center justify-center
                    hover:bg-navy-soft transition-colors
                    focus-visible:outline focus-visible:outline-2 focus-visible:outline-green focus-visible:outline-offset-2
                  "
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M2 8h12M9 3.5l4.5 4.5L9 12.5"
                      stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <Composer
            onSend={(text) => void handleSendMessage(text)}
            disabled={isTyping}
            showChips={!hasSentMessage}
          />
        )}

      </div>

      {/* ── RIGHT TRACE PANEL ─────────────────────────────────────────────────── */}
      <TracePanel steps={traceSteps} currentRunLabel={currentRunLabel} />

    </div>
  );
}
