"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PageViewport } from "pdfjs-dist";

// pdfjs-dist v5 no longer exports TextItem from the package root; define the
// full shape so the type predicate on getTextContent().items is compatible.
type TextItem = {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
};

interface PdfPanelProps {
  open: boolean;
  onClose: () => void;
  docId: string;
  page: number;
  title: string;
  highlight?: string;
}

// ── Highlight algorithm ────────────────────────────────────────────────────────
// Joins item strings with spaces, finds the needle, maps back to items, and
// returns bounding rects in canvas pixel coordinates.

function drawHighlights(
  ctx: CanvasRenderingContext2D,
  items: TextItem[],
  needle: string,
  viewport: PageViewport
) {
  const trimmed = needle.replace(/\s+/g, " ").trim().toLowerCase();
  if (!trimmed) return;

  // Build a flat string from all items joined by spaces so indexOf works.
  const joint = items.map((it) => it.str).join(" ");
  const haystack = joint.toLowerCase();

  const matchStart = haystack.indexOf(trimmed);
  if (matchStart === -1) return; // graceful fallback — page still shows

  const matchEnd = matchStart + trimmed.length;

  // Walk items and find those whose range overlaps [matchStart, matchEnd].
  let cursor = 0;
  ctx.save();
  ctx.fillStyle = "rgba(253, 224, 71, 0.45)"; // yellow-300 @ 45%

  for (const item of items) {
    const itemStart = cursor;
    const itemEnd = cursor + item.str.length;
    cursor = itemEnd + 1; // +1 for the joining space

    if (itemEnd <= matchStart || itemStart >= matchEnd) continue;
    if (!item.str.trim()) continue;

    // convert PDF user-space position to canvas pixels
    const [vx, vy] = viewport.convertToViewportPoint(
      item.transform[4],
      item.transform[5]
    ) as [number, number];

    const w = item.width * viewport.scale;
    const h = Math.abs(item.height) * viewport.scale || 10;

    // vy is the text baseline in canvas space (y increases downward after
    // viewport transform); the visible glyph sits above the baseline.
    ctx.fillRect(Math.round(vx), Math.round(vy - h), Math.round(w), Math.round(h * 1.2));
  }

  ctx.restore();
}

// ── Component ──────────────────────────────────────────────────────────────────

type Status = "idle" | "loading" | "done" | "error";

export function PdfPanel({ open, onClose, docId, page, title, highlight }: PdfPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [mounted, setMounted] = useState(false);

  // Portal mount guard — createPortal needs document to exist.
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setStatus("loading");

      try {
        // 1. Fetch signed URL from our server endpoint.
        const res = await fetch(
          `/api/owner/documents/url?docId=${encodeURIComponent(docId)}&page=${page}`
        );
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const { url, error } = await res.json() as { url?: string; error?: string };
        if (error || !url) throw new Error(error ?? "No URL returned");
        if (cancelled) return;

        // 2. Load pdfjs dynamically (browser-only, code-split).
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        if (cancelled) return;

        // 3. Load the PDF document (strip #page=N — pdfjs doesn't use it).
        const pdfUrl = url.split("#")[0]!;
        const pdf = await pdfjs.getDocument({ url: pdfUrl }).promise;
        if (cancelled) return;

        // 4. Get the requested page (clamped to valid range).
        const pageNum = Math.min(Math.max(page, 1), pdf.numPages);
        const pdfPage = await pdf.getPage(pageNum);
        if (cancelled) return;

        // 5. Fit the page width to the panel container.
        const containerW = containerRef.current?.clientWidth ?? 480;
        const naturalViewport = pdfPage.getViewport({ scale: 1 });
        const scale = (containerW - 32) / naturalViewport.width; // 16px padding each side
        const viewport = pdfPage.getViewport({ scale });

        const canvas = canvasRef.current!;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        // Fix CSS size so overlay coords match canvas pixels exactly.
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;

        const ctx = canvas.getContext("2d")!;

        // 6. Render page content.
        await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;

        // 7. Find and highlight matching text span.
        if (highlight?.trim()) {
          const textContent = await pdfPage.getTextContent();
          const textItems = textContent.items.filter(
            (it): it is TextItem => "str" in it
          );
          drawHighlights(ctx, textItems, highlight, viewport);
        }

        if (!cancelled) setStatus("done");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Failed to load PDF");
        setStatus("error");
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [open, docId, page, highlight]);

  if (!mounted) return null;

  const panel = (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={onClose}
          style={{ background: "rgba(0,0,0,0.18)" }}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        role="dialog"
        aria-label={`PDF viewer — ${title}`}
        className="fixed right-0 top-0 h-dvh z-50 flex flex-col"
        style={{
          width: "min(540px, 92vw)",
          background: "var(--bg)",
          borderLeft: "0.5px solid var(--line)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease",
          willChange: "transform",
        }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center gap-3 px-4 py-3"
          style={{ borderBottom: "0.5px solid var(--line)" }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-ink truncate">{title}</p>
            <p className="font-mono text-[10px] text-gray-2 mt-[1px]">
              p.{String(page).padStart(2, "0")}
              {highlight && (
                <span className="ml-2 text-gray-3">· {highlight.slice(0, 48)}{highlight.length > 48 ? "…" : ""}</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close PDF panel"
            className="shrink-0 text-gray-2 hover:text-ink transition-colors p-1 rounded"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div ref={containerRef} className="flex-1 overflow-auto p-4">
          {status === "loading" && (
            <div className="flex items-center justify-center pt-16">
              <p className="text-[12px] text-gray-2 font-mono">Loading document…</p>
            </div>
          )}
          {status === "error" && (
            <div className="flex items-center justify-center pt-16 px-4">
              <p className="text-[12px] text-gray-2 text-center leading-relaxed">{errorMsg}</p>
            </div>
          )}
          {/* Canvas is always in DOM so the ref is stable; hidden until done */}
          <canvas
            ref={canvasRef}
            style={{
              display: status === "done" ? "block" : "none",
              maxWidth: "100%",
              boxShadow: "0 1px 8px rgba(0,0,0,0.08)",
            }}
          />
        </div>
      </div>
    </>
  );

  return createPortal(panel, document.body);
}
