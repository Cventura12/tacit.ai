import type { APIRoute } from "astro";
import { getDocumentUrl } from "@/lib/documents";

export const GET: APIRoute = async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const docId = searchParams.get("docId");
  const page = parseInt(searchParams.get("page") ?? "1", 10);

  if (!docId) return json({ error: "docId is required" }, 400);
  if (isNaN(page) || page < 1) return json({ error: "invalid page" }, 400);

  try {
    const url = await getDocumentUrl(docId, page);
    return json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get document URL";
    console.error("[documents/url]", message);
    return json({ error: message }, 500);
  }
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
