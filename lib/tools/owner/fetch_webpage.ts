import type { ToolDefinition } from "../registry";
import { logOwnerAction } from "@/lib/owner-actions";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 8_000;

function isSafeUrl(raw: string): boolean {
  try {
    const { hostname, protocol } = new URL(raw);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (/^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/.test(hostname)) return false;
    if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)) return false;
    if (/^192\.168\.\d+\.\d+$/.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).trim() : "";
}

function extractReadableText(html: string): string {
  // Remove entire script/style/nav/boilerplate blocks
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ");

  // Block-level elements → line breaks
  s = s
    .replace(/<\/?(p|div|section|article|main|h[1-6]|li|dt|dd|tr|blockquote|pre)\b[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n");

  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, " ");

  // Decode entities and normalize whitespace
  s = decodeEntities(s);

  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1]!.length > 0))
    .join("\n")
    .trim();
}

export const fetch_webpage: ToolDefinition = {
  name: "fetch_webpage",
  description:
    "Fetches and reads a public web page — extracts readable text, strips nav/ads/boilerplate. " +
    "Use to read official pages (gov sites, school portals, program pages) found via search_web or provided by the user. " +
    "READ-ONLY: published pages only — not forms, login pages, or private URLs. " +
    "Returns the page text and source URL. ALWAYS cite the URL when using content from it. " +
    "Surface what the page says verbatim — do NOT add conclusions about eligibility or legal status. " +
    "If the page is unreachable or returns an error, say so and suggest the user visit the URL directly.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full URL of the public page to fetch (must be http:// or https://).",
      },
    },
    required: ["url"],
  },
  lane: "owner",
  statusLabel: "reading web page…",
  execute: async (input) => {
    const url = typeof input.url === "string" ? input.url.trim() : "";
    if (!url) return JSON.stringify({ error: "url is required" });
    // SSRF guard runs before any network access.
    if (!isSafeUrl(url)) {
      return JSON.stringify({ error: "URL must be a public http(s) address — private/internal addresses are not allowed" });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          // Present as a real desktop browser to avoid bot-detection 403s.
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
        },
      });

      clearTimeout(timer);

      // Distinguish each failure mode so the agent can report it accurately.
      if (res.status === 403) {
        return JSON.stringify({
          error: "Site blocked the request (403 Forbidden), even with browser headers. Contents could not be read.",
          url,
          status: 403,
        });
      }
      if (res.status === 404) {
        return JSON.stringify({
          error: "Page not found (404).",
          url,
          status: 404,
        });
      }
      if (!res.ok) {
        return JSON.stringify({
          error: `HTTP ${res.status} — page could not be fetched.`,
          url,
          status: res.status,
        });
      }

      // Only attempt HTML extraction on HTML responses.
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        return JSON.stringify({
          error: `URL returned a non-HTML resource (content-type: ${contentType || "unknown"}) — cannot extract readable text. Visit the URL directly to read it.`,
          url,
          status: res.status,
        });
      }

      const html = await res.text();
      const title = extractTitle(html);
      const text = extractReadableText(html);
      const truncated = text.length > MAX_TEXT_CHARS;
      const excerpt = truncated
        ? text.slice(0, MAX_TEXT_CHARS) + "\n\n[…content truncated — first 8,000 characters shown]"
        : text;

      void logOwnerAction("fetch_webpage", { url, title, char_count: text.length, truncated });

      return JSON.stringify({
        url,
        title: title || "(no title)",
        text: excerpt,
        char_count: text.length,
        truncated,
        note: "Content from a live web page. Cite the source URL for any fact you take from it. Surface what the page says — do not add conclusions about eligibility, legal status, or what it means for the user.",
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        return JSON.stringify({
          error: "Request timed out after 10s.",
          url,
        });
      }
      const message = err instanceof Error ? err.message : "Unknown fetch error";
      console.error("[fetch_webpage]", message);
      return JSON.stringify({ error: message, url });
    }
  },
};
