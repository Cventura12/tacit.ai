import type { APIRoute } from "astro";
import { listRecentVisitors } from "@/lib/visitor-log";

export const GET: APIRoute = async () => {
  const visitors = await listRecentVisitors(50);
  return json({ visitors });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
