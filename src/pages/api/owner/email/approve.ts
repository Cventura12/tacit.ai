import type { APIRoute } from "astro";
import { logOwnerAction } from "@/lib/owner-actions";

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { classification, reason, draft_reply, suggested_attachments } =
    (body ?? {}) as Record<string, unknown>;

  await logOwnerAction("email_approved", {
    classification,
    reason,
    draft_reply: typeof draft_reply === "string" ? draft_reply.slice(0, 2000) : null,
    suggested_attachments,
  });

  return json({ ok: true });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
