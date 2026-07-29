import type { ToolDefinition } from "../registry";
import { logOwnerAction } from "@/lib/owner-actions";

const BRAVE_API = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
  error?: { code?: string; message?: string };
}

export const search_web: ToolDefinition = {
  name: "search_web",
  description:
    "Searches the web (via Brave Search) and returns top results — title, URL, snippet. " +
    "Use for current external information not in the user's documents: recent policy changes, program pages, official gov announcements, school portals. " +
    "WORKFLOW: search_web finds pages → fetch_webpage reads the most relevant one(s) → cite URL(s) in response. " +
    "Always include source URL when citing a result. " +
    "Surface what pages say — do NOT conclude eligibility, legal status, or what results mean for the user. " +
    "Prefer the user's uploaded documents for questions about their personal case; use web tools for looking up external official information.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Web search query. Be specific — e.g. 'USCIS special immigrant juvenile requirements 2024' or 'Tennessee community college in-state tuition undocumented students'.",
      },
      count: {
        type: "number",
        description: `Number of results to return (default ${DEFAULT_COUNT}, max ${MAX_COUNT}).`,
      },
    },
    required: ["query"],
  },
  lane: "owner",
  statusLabel: "searching the web…",
  execute: async (input) => {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      return JSON.stringify({
        error: "BRAVE_SEARCH_API_KEY is not set — add it to your Vercel environment variables to enable web search.",
      });
    }

    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) return JSON.stringify({ error: "query is required" });

    const count =
      typeof input.count === "number"
        ? Math.min(Math.max(1, Math.floor(input.count)), MAX_COUNT)
        : DEFAULT_COUNT;

    const url = new URL(BRAVE_API);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    url.searchParams.set("text_decorations", "false");
    url.searchParams.set("spellcheck", "false");

    try {
      const res = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return JSON.stringify({
          error: `Brave Search returned HTTP ${res.status}`,
          detail: body.slice(0, 200),
        });
      }

      const data = (await res.json()) as BraveResponse;

      if (data.error) {
        return JSON.stringify({
          error: `Brave Search error: ${data.error.message ?? data.error.code ?? "unknown"}`,
        });
      }

      const results = (data.web?.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
      }));

      void logOwnerAction("search_web", { query, count, result_count: results.length });

      if (results.length === 0) {
        return JSON.stringify({
          query,
          results: [],
          note: "No results found. Try different search terms.",
        });
      }

      return JSON.stringify({
        query,
        results,
        note: "Search result snippets only — use fetch_webpage on the most relevant URL(s) to read the full content. Always cite the source URL when using information from a result.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[search_web]", message);
      return JSON.stringify({ error: message });
    }
  },
};
