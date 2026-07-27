import { type NextRequest, NextResponse } from "next/server";
import { getDocumentUrl } from "@/lib/documents";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await requireOwner();
  if (!check.ok) return check.response;
  const { searchParams } = new URL(request.url);
  const docId = searchParams.get("docId");
  const page = parseInt(searchParams.get("page") ?? "1", 10);

  if (!docId) return NextResponse.json({ error: "docId is required" }, { status: 400 });
  if (isNaN(page) || page < 1) return NextResponse.json({ error: "invalid page" }, { status: 400 });

  try {
    const url = await getDocumentUrl(docId, page);
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get document URL";
    console.error("[documents/url]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
