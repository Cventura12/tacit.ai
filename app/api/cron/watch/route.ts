import { type NextRequest, NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { runInboxWatch } from "@/lib/inbox-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  try {
    const result = await runInboxWatch();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/watch] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Watch failed" },
      { status: 500 }
    );
  }
}
