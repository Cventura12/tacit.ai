import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  return json({ isOwner: true });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
