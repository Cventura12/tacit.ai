import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  return NextResponse.json({ isOwner: true, userId: check.userId });
}
