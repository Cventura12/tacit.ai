"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Sidebar, HamburgerButton } from "@/components/Sidebar";

interface DocumentRow {
  id: string;
  title: string;
  doc_type: string | null;
  page_count: number;
  created_at: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return "Today";
  if (diff < 172800000) return "Yesterday";
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function DocumentsView() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/documents/list");
      if (!res.ok) return;
      const d = (await res.json()) as { documents?: DocumentRow[] };
      setDocs(d.documents ?? []);
    } catch { /* best-effort */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadDocs(); }, [loadDocs]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileRef.current) fileRef.current.value = "";
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/owner/documents/upload", { method: "POST", body: form });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Upload failed");
      await loadDocs();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4 lg:px-8 py-5"
          style={{ borderBottom: "0.5px solid var(--line)", background: "var(--bg)" }}
        >
          <div className="flex items-center gap-2">
            <HamburgerButton />
            <h1 className="text-[17px] font-semibold text-ink">Documents</h1>
          </div>
          <div className="flex items-center gap-3">
            {uploadError && (
              <p className="text-[12px]" style={{ color: "#f87171" }}>{uploadError}</p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-[7px] rounded-lg text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--green)" }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M6 8V1M3 4l3-3 3 3M1 10h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
              {uploading ? "Uploading…" : "Upload PDF"}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 lg:px-8 py-6 max-w-3xl">
          {loading ? (
            <p className="text-[13px]" style={{ color: "var(--gray-2)" }}>Loading…</p>
          ) : docs.length === 0 ? (
            /* Empty state */
            <div className="py-20 flex flex-col items-center gap-3 text-center">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ color: "var(--gray-3)" }} aria-hidden="true">
                <path d="M22 4H9a2 2 0 00-2 2v24a2 2 0 002 2h18a2 2 0 002-2V12L22 4z"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M22 4v8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M12 20h12M12 25h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <p className="text-[15px] font-medium text-ink">No documents yet</p>
              <p className="text-[13px]" style={{ color: "var(--gray-2)" }}>
                Upload a PDF so the agent has context to search when answering questions.
              </p>
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-3 px-4 py-2 rounded-lg text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--green)" }}
              >
                Upload your first document
              </button>
            </div>
          ) : (
            /* Document list */
            <div
              className="overflow-hidden"
              style={{ border: "0.5px solid var(--line)", borderRadius: "10px" }}
            >
              {docs.map((doc, i) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-4 px-5 py-4 transition-colors"
                  style={{
                    borderTop: i > 0 ? "0.5px solid var(--line)" : "none",
                    background: "var(--bg)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg)")}
                >
                  {/* Icon */}
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"
                    style={{ color: "var(--gray-3)", flexShrink: 0 }} aria-hidden="true">
                    <path d="M11 2H4.5A1.5 1.5 0 003 3.5v11A1.5 1.5 0 004.5 16h9a1.5 1.5 0 001.5-1.5V6L11 2z"
                      stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M11 2v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>

                  {/* Title + type */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-ink truncate">{doc.title}</p>
                    {doc.doc_type && (
                      <p className="text-[11px] mt-[2px] truncate" style={{ color: "var(--gray-3)" }}>
                        {doc.doc_type}
                      </p>
                    )}
                  </div>

                  {/* Indexed badge */}
                  <span
                    className="shrink-0 text-[10px] font-medium px-2 py-[3px] rounded-full"
                    style={{
                      background: "rgba(64,152,68,0.12)",
                      color: "var(--green)",
                    }}
                  >
                    Indexed
                  </span>

                  {/* Metadata */}
                  <div className="flex items-center gap-5 shrink-0">
                    <span className="text-[12px] font-mono tabular-nums" style={{ color: "var(--gray-2)" }}>
                      {doc.page_count}p
                    </span>
                    <span className="text-[12px]" style={{ color: "var(--gray-3)", minWidth: "60px", textAlign: "right" }}>
                      {formatDate(doc.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
