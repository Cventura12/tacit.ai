import type { ToolDefinition } from "../registry";
import { logOwnerAction } from "@/lib/owner-actions";

const TAVILY_API = "https://api.tavily.com/search";
const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export const search_web: ToolDefinition = {
  name: "search_web",
  description:
    "Searches the web (via Tavily) and returns top results — title, URL, snippet. " +
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
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return JSON.stringify({
        error: "TAVILY_API_KEY is not set — add it to your Vercel environment variables to enable web search.",
      });
    }

    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) return JSON.stringify({ error: "query is required" });

    const count =
      typeof input.count === "number"
        ? Math.min(Math.max(1, Math.floor(input.count)), MAX_COUNT)
        : DEFAULT_COUNT;

    try {
      const res = await fetch(TAVILY_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: count,
          include_answer: false,
          include_raw_content: false,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return JSON.stringify({
          error: `Tavily returned HTTP ${res.status}`,
          detail: body.slice(0, 200),
        });
      }

      const data = (await res.json()) as TavilyResponse;

      const results = (data.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
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
