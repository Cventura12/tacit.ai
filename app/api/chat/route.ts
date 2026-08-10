import { type NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, OWNER_SYSTEM_PROMPT_EXTENSION } from "@/lib/knowledge";
import { TOOL_REGISTRY } from "@/lib/tools/registry";
import type { ToolDefinition } from "@/lib/tools/registry";
import type { TrustedGmailMessage } from "@/lib/gmail";
import type { StreamEvent, EmailProposal } from "@/lib/types";
import { getEnabledToolNames, getEnabledMcpConnectors } from "@/lib/connectors";
import { buildSafeToolLogSummary } from "@/lib/tools/tool-log-summary";
import { buildMcpTools } from "@/lib/mcp";
import { checkRateLimit } from "@/lib/ratelimit";
import { isDbConfigured, getDb } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { redactToolInput } from "@/lib/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGES = 50;
const MAX_CONTENT_LEN = 4000;

// Above this length, a user message is assumed to be a pasted document (e.g.
// a full email body) rather than a typed instruction, and agent_runs.user_query
// stores a length marker instead of the content. Short typed instructions are
// kept verbatim — that's the observability this table exists for.
const USER_QUERY_LOG_MAX_CHARS = 300;

function redactUserQueryForLog(query: string): string {
  if (query.length <= USER_QUERY_LOG_MAX_CHARS) return query;
  return `[redacted — ${query.length} chars]`;
}

type SimpleMessage = { role: "user" | "assistant"; content: string };

interface ParsedBody {
  messages: SimpleMessage[];
  sessionId?: string;
}

function parseBody(body: unknown): ParsedBody | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const { messages, sessionId } = b;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  if (messages.length > MAX_MESSAGES) return null;
  for (const m of messages) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" || content.length === 0) return null;
    if (content.length > MAX_CONTENT_LEN) return null;
  }
  return {
    messages: messages as SimpleMessage[],
    sessionId: typeof sessionId === "string" ? sessionId.slice(0, 64) : undefined,
  };
}

const MAX_HISTORY = 20;

function trimHistory(messages: SimpleMessage[]): SimpleMessage[] {
  if (messages.length <= MAX_HISTORY) return messages;
  return [messages[0], ...messages.slice(-(MAX_HISTORY - 1))];
}

type PageCandidate = { doc_id: string; title: string; page_number: number; score: number };

const enc = new TextEncoder();

function sse(event: StreamEvent): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(event)}\n\n`);
}

const CONNECTOR_MANAGED_TOOLS = new Set([
  "get_availability",
  "create_scheduling_link",
  "leave_message",
]);

const MAX_ITER = 5;

async function runAgentLoop(
  initialMessages: SimpleMessage[],
  ip: string,
  sessionId: string | undefined,
  ctrl: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const turnStart = Date.now();
  const userQuery = initialMessages[initialMessages.length - 1]?.content ?? "";
  let runId: string | undefined;
  let toolSeq = 0;
  let responseText = "";
  let loopError: string | undefined;

  // Request-scoped, trusted store binding gmail_message_id to the EXACT text
  // that was fetched plus its provenance (never provenance alone — see
  // lib/gmail.ts:resolveTrustedEmailContent for why): written only by
  // read_gmail_message's execute() after a genuine fetch, keyed by
  // gmail_message_id; read only by handle_email's execute(), which uses the
  // cached text itself (never the model's own email_text argument) whenever a
  // cache entry exists. The SAME Map reference is passed to every tool call in
  // this loop, so a read_gmail_message call earlier in the conversation turn
  // is visible to a handle_email call later in the same turn — and a fresh Map
  // is created per request/turn (this function is invoked once per POST), so
  // nothing here is ever shared across requests or owners. Never derived from
  // or exposed to the model's own tool-call JSON.
  const gmailTrustedMessageCache = new Map<string, TrustedGmailMessage>();

  if (isDbConfigured()) {
    try {
      const { data } = await getDb()
        .from("agent_runs")
        .insert({ user_query: redactUserQueryForLog(userQuery), response_text: "", duration_ms: 0 })
        .select("id")
        .single();
      runId = data?.id ?? undefined;
      if (runId) ctrl.enqueue(sse({ type: "run_id", id: runId }));
    } catch (e) {
      console.warn("[runLog] agent_runs insert failed:", e);
    }
  }

  try {
    let enabledConnectorTools: Set<string>;
    let mcpConnectors: Awaited<ReturnType<typeof getEnabledMcpConnectors>> = [];
    try {
      [enabledConnectorTools, mcpConnectors] = await Promise.all([
        getEnabledToolNames(),
        getEnabledMcpConnectors(),
      ]);
    } catch (err) {
      console.warn("[agent] Connector DB unavailable, using defaults:", err);
      enabledConnectorTools = new Set(CONNECTOR_MANAGED_TOOLS);
    }

    const allowedBuiltins = TOOL_REGISTRY.filter((t) => {
      if (CONNECTOR_MANAGED_TOOLS.has(t.name)) return enabledConnectorTools.has(t.name);
      return true;
    });

    let mcpTools: ToolDefinition[] = [];
    if (mcpConnectors.length > 0) {
      const arrays = await Promise.all(
        mcpConnectors.map((c) =>
          buildMcpTools(c, "owner").catch((err) => {
            console.error(`[agent] MCP "${c.name}" failed:`, err);
            return [] as ToolDefinition[];
          })
        )
      );
      mcpTools = arrays.flat();
    }

    const allAllowedTools: ToolDefinition[] = [...allowedBuiltins, ...mcpTools];
    const allowedNames = new Set(allAllowedTools.map((t) => t.name));

    const toolDefs: Anthropic.Tool[] = allAllowedTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const messages: Anthropic.MessageParam[] = initialMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    for (let i = 0; i < MAX_ITER; i++) {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM_PROMPT + "\n\n" + OWNER_SYSTEM_PROMPT_EXTENSION,
        tools: toolDefs,
        messages,
      });

      console.log(
        `[agent] iter=${i} stop_reason="${response.stop_reason}" tools=[${allAllowedTools.map((t) => t.name).join(",")}]`
      );

      if (response.stop_reason === "end_turn") {
        responseText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        ctrl.enqueue(sse({ type: "text", content: responseText }));
        return;
      }

      if (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );

        messages.push({
          role: "assistant",
          content: response.content as unknown as Anthropic.ContentBlockParam[],
        });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const tu of toolUseBlocks) {
          // Keys only — tu.input may carry email bodies, sender/subject, or
          // other visitor-submitted content that must never reach logs.
          const inputKeys = Object.keys((tu.input as Record<string, unknown>) ?? {});
          console.log(`[agent] tool_use: name="${tu.name}" id="${tu.id}" input_keys=[${inputKeys.join(",")}]`);

          if (!allowedNames.has(tu.name)) {
            console.warn(`[agent] BLOCKED — tool "${tu.name}" not in allowed set`);
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: `Error: tool "${tu.name}" is not available.`,
              is_error: true,
            });
            continue;
          }

          const seq = toolSeq++;
          const tool = allAllowedTools.find((t) => t.name === tu.name)!;
          ctrl.enqueue(sse({ type: "status", label: tool.statusLabel }));

          const toolStart = Date.now();
          let result: string;
          let toolSuccess = true;
          let toolErr: string | undefined;
          // Set only for content-bearing tools (read_gmail_message, read_gmail);
          // undefined for every other tool, which keeps its existing slice-based
          // logging at both use sites below.
          let safeLogSummary: string | undefined;

          try {
            result = await tool.execute(tu.input as Record<string, unknown>, {
              ip,
              sessionId,
              onStatus: (label: string) => ctrl.enqueue(sse({ type: "status", label })),
              gmailTrustedMessageCache,
            });
            // Content-bearing tools (read_gmail_message, read_gmail) get a
            // safe, fixed-field summary instead of a slice of the raw JSON —
            // see lib/tools/tool-log-summary.ts. Every other tool keeps its
            // prior slice-based logging, unchanged.
            safeLogSummary = buildSafeToolLogSummary(tu.name, result);
            // Length only when no safe summary exists — result may otherwise
            // carry email/document content (e.g. handle_email's draft reply).
            console.log(
              `[agent] "${tool.name}" succeeded:`,
              safeLogSummary ?? `result_length=${result.length}`
            );
          } catch (err) {
            console.error(`[agent] "${tool.name}" threw:`, err);
            toolSuccess = false;
            toolErr = err instanceof Error ? err.message : "tool failed";
            result = `Error: ${toolErr}`;
          }

          const toolDuration = Date.now() - toolStart;

          let traceableCandidates: PageCandidate[] | undefined;
          if (tu.name === "search_documents") {
            try {
              const parsed = JSON.parse(result) as Record<string, unknown>;
              if (Array.isArray(parsed._candidates)) {
                traceableCandidates = parsed._candidates as PageCandidate[];
                delete parsed._candidates;
                result = JSON.stringify(parsed);
              }
            } catch {
              // malformed JSON — leave as-is
            }
          }

          if (tu.name === "handle_email") {
            try {
              const parsed = JSON.parse(result) as Record<string, unknown>;
              if (parsed._proposal && typeof parsed._proposal === "object") {
                const proposal = parsed._proposal as EmailProposal;
                ctrl.enqueue(sse({ type: "proposal", data: proposal }));
                delete parsed._proposal;
                result = JSON.stringify(parsed);
              }
            } catch {
              // malformed JSON — leave as-is
            }
          }

          let toolRunId: string | undefined;
          if (runId) {
            try {
              const { data: trData } = await getDb()
                .from("tool_runs")
                .insert({
                  run_id: runId,
                  tool_name: tu.name,
                  input: redactToolInput(tool.loggableInputKeys, tu.input as Record<string, unknown>),
                  output_summary: safeLogSummary ?? result.slice(0, 500),
                  duration_ms: toolDuration,
                  success: toolSuccess,
                  error: toolErr ?? null,
                  sequence: seq,
                })
                .select("id")
                .single();
              toolRunId = trData?.id ?? undefined;
            } catch (e) {
              console.warn("[runLog] tool_runs insert failed:", e);
            }
          }

          if (traceableCandidates && traceableCandidates.length > 0 && toolRunId) {
            try {
              const returnedHits = (
                JSON.parse(result) as { hits?: { doc_id: string; page_number: number }[] }
              ).hits ?? [];
              const hitKey = new Set(returnedHits.map((h) => `${h.doc_id}:${h.page_number}`));
              const rows = traceableCandidates.map((c) => ({
                tool_run_id: toolRunId!,
                doc_id: c.doc_id,
                doc_title: c.title,
                page_number: c.page_number,
                score: c.score,
                returned: hitKey.has(`${c.doc_id}:${c.page_number}`),
              }));
              await getDb().from("retrieval_traces").insert(rows);
            } catch (e) {
              console.warn("[runLog] retrieval_traces insert failed:", e);
            }
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: result,
          });
        }

        messages.push({ role: "user", content: toolResults });
        continue;
      }

      break;
    }

    loopError = "max iterations reached";
    ctrl.enqueue(
      sse({ type: "error", message: "ah something took too long on my end — try again in a sec" })
    );
  } catch (err) {
    loopError = err instanceof Error ? err.message : "unknown error";
    throw err;
  } finally {
    if (runId) {
      try {
        await getDb()
          .from("agent_runs")
          .update({
            response_text: responseText.slice(0, 10000),
            duration_ms: Date.now() - turnStart,
            tool_count: toolSeq,
            error: loopError ?? null,
          })
          .eq("id", runId);
      } catch (e) {
        console.warn("[runLog] agent_runs final update failed:", e);
      }
    }
  }
}

export async function POST(request: NextRequest) {
  const check = await requireOwner();
  if (!check.ok) return check.response;

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

  const allowed = await checkRateLimit(`${ip}:chat`, 60, 20);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = parseBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { messages: rawMessages, sessionId } = parsed;
  const messages = trimHistory(rawMessages);

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      try {
        await runAgentLoop(messages, ip, sessionId, ctrl);
      } catch (err) {
        console.error("[/api/chat] Agent loop error:", err);
        ctrl.enqueue(
          sse({ type: "error", message: "ah something glitched on my end — try again in a sec" })
        );
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
