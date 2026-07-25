import type { ToolDefinition } from "../registry";
import { search } from "@/lib/documents";
import { logOwnerAction } from "@/lib/owner-actions";

export const search_documents: ToolDefinition = {
  name: "search_documents",
  description:
    "RETRIEVES AND CITES passages from your uploaded documents — it does NOT draw conclusions. " +
    "Every claim made from document content MUST be accompanied by the document title and page number. " +
    "Do not infer eligibility, legal status, or decisions beyond what is literally written on the cited page.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Full-text search query. Supports phrases, AND/OR/NOT operators (PostgreSQL websearch syntax).",
      },
      limit: {
        type: "number",
        description: "Max results to return (default 8, max 20).",
      },
    },
    required: ["query"],
  },
  lane: "owner",
  statusLabel: "searching your documents…",
  execute: async (input) => {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) return JSON.stringify({ error: "query is required" });

    const limit =
      typeof input.limit === "number" ? Math.min(input.limit, 20) : 8;

    try {
      const { hits, candidates } = await search(query, limit);
      void logOwnerAction("search_documents", { query, limit, count: hits.length });

      if (hits.length === 0) {
        return JSON.stringify({
          note: `No passages matched "${query}". Try different keywords or check that the relevant document has been uploaded.`,
          hits: [],
          _candidates: candidates,
        });
      }

      // _candidates is stripped by the agent loop before the model sees the result.
      return JSON.stringify({ hits, _candidates: candidates });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[search_documents]", message);
      return JSON.stringify({ error: message });
    }
  },
};
