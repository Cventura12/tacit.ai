import { NextResponse } from "next/server";
import { listRecentVisitors } from "@/lib/visitor-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const visitors = await listRecentVisitors(50);
  return NextResponse.json({ visitors });
}
