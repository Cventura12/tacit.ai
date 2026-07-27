import { NextResponse } from "next/server";
import { listRecentVisitors } from "@/lib/visitor-log";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  const visitors = await listRecentVisitors(50);
  return NextResponse.json({ visitors });
}
