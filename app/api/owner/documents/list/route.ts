import { NextResponse } from "next/server";
import { listDocuments } from "@/lib/documents";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  try {
    const documents = await listDocuments();
    return NextResponse.json({ documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list documents";
    console.error("[documents/list]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
