import type { APIRoute } from "astro";
import { listDocuments } from "@/lib/documents";

export const GET: APIRoute = async () => {
  try {
    const documents = await listDocuments();
    return json({ documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list documents";
    console.error("[documents/list]", message);
    return json({ error: message }, 500);
  }
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
