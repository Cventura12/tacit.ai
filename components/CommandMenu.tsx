"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type MenuView = "root" | "documents" | "connectors" | "visitors" | "add_connector";
type Lane = "public" | "owner";

interface Connector {
  id: string;
  type: "builtin" | "mcp";
  name: string;
  description: string;
  tool_names: string[];
  enabled: boolean;
  lane: Lane;
  mcp_url?: string | null;
  credential_masked?: string | null;
  created_at: string;
}

interface Document {
  id: string;
  title: string;
  doc_type: string | null;
  page_count: number;
  created_at: string;
}

interface Visitor {
  id: string;
  created_at: string;
  session_id: string;
  gate_answer: string | null;
  first_message: string;
  action: string | null;
}

const GMAIL_CONNECTOR_ID = "00000000-0000-0000-0000-000000000003";

// ─── Icons (16 × 16, lucide-style 1.5 px stroke) ─────────────────────────────

const IcoUpload = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2v9M5 5l3-3 3 3M2 12v.5A1.5 1.5 0 003.5 14h9A1.5 1.5 0 0014 12.5V12"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoFile = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M9.5 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9.5 2z"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.5 2v4H13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoPlug = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5 2v3M11 2v3M4 5h8v2a4 4 0 01-4 4v0a4 4 0 01-4-4V5zM8 11v3"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoPlus = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const IcoUsers = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M11 13v-1a3 3 0 00-3-3H5a3 3 0 00-3 3v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="6.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M13 13v-1a3 3 0 00-2-2.83M10.5 3.17a2.5 2.5 0 010 4.66"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const IcoChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoChevronLeft = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoCheck = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <path d="M2.5 7l3 3L10.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoMail = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="4" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <path d="M1.5 5.5l6.5 4.5 6.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// ─── Primitives ───────────────────────────────────────────────────────────────

function Row({
  icon,
  label,
  right,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-2 h-[30px] px-2 rounded-[6px] text-left transition-colors hover:bg-ink/[0.07] disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className="text-ink/40 shrink-0 flex items-center">{icon}</span>
      <span className="flex-1 text-[13px] text-ink truncate leading-none">{label}</span>
      {right !== undefined && <span className="shrink-0 flex items-center ml-1">{right}</span>}
    </button>
  );
}

function Divider() {
  return <div className="my-1" style={{ borderTop: "0.5px solid var(--line)" }} />;
}

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="w-full flex items-center gap-2 h-[30px] px-2 rounded-[6px] transition-colors hover:bg-ink/[0.07]"
    >
      <span className="text-ink/40 flex items-center"><IcoChevronLeft /></span>
      <span className="text-[13px] text-gray-2 leading-none">Back</span>
    </button>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-[12px] text-gray-3">{children}</p>;
}

// ─── CommandMenu ──────────────────────────────────────────────────────────────

interface CommandMenuProps {
  onUploadClick: () => void;
  uploading: boolean;
  uploadError: string;
}

export function CommandMenu({ onUploadClick, uploading, uploadError }: CommandMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>("root");

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [connLoading, setConnLoading] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [visitorsLoading, setVisitorsLoading] = useState(false);

  const [addForm, setAddForm] = useState({ name: "", mcp_url: "", credential: "", lane: "owner" as Lane });
  const [addError, setAddError] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [publicConfirmed, setPublicConfirmed] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // ── Data loaders ─────────────────────────────────────────────────────────

  const loadConnectors = useCallback(async () => {
    setConnLoading(true);
    try {
      const res = await fetch("/api/owner/connectors");
      if (!res.ok) return;
      const d = (await res.json()) as { connectors: Connector[] };
      setConnectors(d.connectors ?? []);
    } catch { /* best-effort */ }
    finally { setConnLoading(false); }
  }, []);

  const loadDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await fetch("/api/owner/documents/list");
      if (!res.ok) return;
      const d = (await res.json()) as { documents: Document[] };
      setDocuments(d.documents ?? []);
    } catch { /* best-effort */ }
    finally { setDocsLoading(false); }
  }, []);

  const loadVisitors = useCallback(async () => {
    setVisitorsLoading(true);
    try {
      const res = await fetch("/api/owner/visitors");
      if (!res.ok) return;
      const d = (await res.json()) as { visitors: Visitor[] };
      setVisitors(d.visitors ?? []);
    } catch { /* best-effort */ }
    finally { setVisitorsLoading(false); }
  }, []);

  // ── Open / close ─────────────────────────────────────────────────────────

  function openMenu() {
    setView("root");
    setOpen(true);
    void loadConnectors();
    void loadDocuments();
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // ── Actions ──────────────────────────────────────────────────────────────

  async function toggleConnector(id: string, currentEnabled: boolean) {
    setConnectors((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !currentEnabled } : c)));
    const res = await fetch(`/api/owner/connectors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !currentEnabled }),
    });
    if (!res.ok) {
      setConnectors((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: currentEnabled } : c)));
    }
  }

  async function removeConnector(id: string, name: string) {
    if (!confirm(`Remove "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/owner/connectors/${id}`, { method: "DELETE" });
    if (res.ok) setConnectors((prev) => prev.filter((c) => c.id !== id));
  }

  async function disconnectGmail() {
    if (!confirm("Disconnect Gmail? You'll need to reconnect to read or send Gmail.")) return;
    const res = await fetch(`/api/owner/connectors/${GMAIL_CONNECTOR_ID}`, { method: "DELETE" });
    if (res.ok) setConnectors((prev) => prev.filter((c) => c.id !== GMAIL_CONNECTOR_ID));
  }

  async function handleAddConnector(e: React.FormEvent) {
    e.preventDefault();
    if (addSubmitting) return;
    setAddSubmitting(true);
    setAddError("");
    try {
      const res = await fetch("/api/owner/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          mcp_url: addForm.mcp_url.trim(),
          credential: addForm.credential || undefined,
          lane: addForm.lane,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Failed to add connector");
      }
      const d = (await res.json()) as { connector: Connector };
      setConnectors((prev) => [...prev, d.connector]);
      setAddForm({ name: "", mcp_url: "", credential: "", lane: "owner" });
      setPublicConfirmed(false);
      setView("connectors");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add connector");
    } finally {
      setAddSubmitting(false);
    }
  }

  const addFormValid =
    addForm.name.trim() &&
    addForm.mcp_url.trim() &&
    (addForm.lane === "owner" || publicConfirmed);

  const gmailConnector = connectors.find(
    (c) =>
      (c.id === GMAIL_CONNECTOR_ID || c.name?.toLowerCase().includes("gmail")) &&
      !!c.credential_masked
  );
  const otherConnectors = connectors.filter(
    (c) => c.id !== GMAIL_CONNECTOR_ID && !c.name?.toLowerCase().includes("gmail")
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-label="Open menu"
        aria-expanded={open}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-2 hover:text-ink hover:bg-ink/[0.07] transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Popover */}
      <div
        role="menu"
        className="absolute left-0 z-50 w-[230px] rounded-[10px] p-[6px] overflow-y-auto"
        style={{
          bottom: "calc(100% + 8px)",
          maxHeight: "70vh",
          backgroundColor: "var(--bubble)",
          border: "0.5px solid var(--line)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.05)",
          opacity: open ? 1 : 0,
          transform: open ? "translateY(0)" : "translateY(2px)",
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 100ms ease, transform 100ms ease",
          transformOrigin: "bottom left",
        }}
      >
        {/* ── ROOT ─────────────────────────────────────────────────────── */}
        {view === "root" && (
          <>
            <Row
              icon={<IcoUpload />}
              label={uploading ? "Uploading…" : "Upload PDF"}
              disabled={uploading}
              onClick={() => { onUploadClick(); setOpen(false); }}
            />
            <Row
              icon={<IcoFile />}
              label="Documents"
              right={<span className="text-ink/30"><IcoChevronRight /></span>}
              onClick={() => setView("documents")}
            />

            <Divider />

            <Row
              icon={<IcoPlug />}
              label="Connectors"
              right={<span className="text-ink/30"><IcoChevronRight /></span>}
              onClick={() => setView("connectors")}
            />
            <Row
              icon={<IcoPlus />}
              label="Add connector"
              onClick={() => {
                setAddForm({ name: "", mcp_url: "", credential: "", lane: "owner" });
                setAddError("");
                setPublicConfirmed(false);
                setView("add_connector");
              }}
            />

            <Divider />

            <Row
              icon={<IcoUsers />}
              label="Recent visitors"
              right={<span className="text-ink/30"><IcoChevronRight /></span>}
              onClick={() => { setView("visitors"); void loadVisitors(); }}
            />

            {uploadError && (
              <p className="px-2 pt-1 text-[11px] text-red-400 truncate">{uploadError}</p>
            )}
          </>
        )}

        {/* ── DOCUMENTS ────────────────────────────────────────────────── */}
        {view === "documents" && (
          <>
            <BackRow onBack={() => setView("root")} />
            <Divider />
            {docsLoading ? (
              <EmptyNote>Loading…</EmptyNote>
            ) : documents.length === 0 ? (
              <EmptyNote>No documents yet.</EmptyNote>
            ) : (
              documents.map((doc) => (
                <Row
                  key={doc.id}
                  icon={<IcoFile />}
                  label={doc.title}
                  right={<span className="text-[11px] text-gray-3">{doc.page_count}p</span>}
                />
              ))
            )}
          </>
        )}

        {/* ── CONNECTORS ───────────────────────────────────────────────── */}
        {view === "connectors" && (
          <>
            <BackRow onBack={() => setView("root")} />
            <Divider />
            {connLoading ? (
              <EmptyNote>Loading…</EmptyNote>
            ) : (
              <>
                {/* Gmail — always shown; row exists only after OAuth completes */}
                {gmailConnector ? (
                  <div className="group flex items-center rounded-[6px] hover:bg-ink/[0.07] transition-colors">
                    <button
                      type="button"
                      onClick={() => void toggleConnector(gmailConnector.id, gmailConnector.enabled)}
                      className="flex-1 flex items-center gap-2 h-[30px] px-2 text-left min-w-0"
                    >
                      <span className="text-ink/40 shrink-0 flex items-center"><IcoMail /></span>
                      <span className="flex-1 text-[13px] text-ink truncate leading-none">{gmailConnector.name}</span>
                      {gmailConnector.enabled && (
                        <span className="text-green flex items-center shrink-0"><IcoCheck /></span>
                      )}
                    </button>
                    <a
                      href="/api/owner/gmail/connect"
                      className="text-[11px] text-ink/30 hover:text-green shrink-0 pr-1 transition-colors"
                    >
                      Reconnect
                    </a>
                    <button
                      type="button"
                      onClick={() => void disconnectGmail()}
                      className="opacity-0 group-hover:opacity-100 text-gray-3 hover:text-red-400 transition-all px-2 h-[30px] flex items-center shrink-0 text-base leading-none"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center rounded-[6px] hover:bg-ink/[0.07] transition-colors">
                    <div className="flex-1 flex items-center gap-2 h-[30px] px-2 min-w-0">
                      <span className="text-ink/40 shrink-0 flex items-center"><IcoMail /></span>
                      <span className="flex-1 text-[13px] text-ink/60 truncate leading-none">Gmail</span>
                    </div>
                    <a
                      href="/api/owner/gmail/connect"
                      className="text-[11px] text-green/70 hover:text-green shrink-0 pr-2 transition-colors"
                    >
                      Connect
                    </a>
                  </div>
                )}

                {/* MCP and other non-Gmail connectors */}
                {otherConnectors.length > 0 && <Divider />}
                {otherConnectors.map((c) => (
                  <div key={c.id} className="group flex items-center rounded-[6px] hover:bg-ink/[0.07] transition-colors">
                    <button
                      type="button"
                      onClick={() => void toggleConnector(c.id, c.enabled)}
                      className="flex-1 flex items-center gap-2 h-[30px] px-2 text-left min-w-0"
                    >
                      <span className="text-ink/40 shrink-0 flex items-center"><IcoPlug /></span>
                      <span className="flex-1 text-[13px] text-ink truncate leading-none">{c.name}</span>
                      {c.enabled && (
                        <span className="text-green flex items-center shrink-0"><IcoCheck /></span>
                      )}
                    </button>
                    {c.type === "mcp" && (
                      <button
                        type="button"
                        onClick={() => void removeConnector(c.id, c.name)}
                        className="opacity-0 group-hover:opacity-100 text-gray-3 hover:text-red-400 transition-all px-2 h-[30px] flex items-center shrink-0 text-base leading-none"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── VISITORS ─────────────────────────────────────────────────── */}
        {view === "visitors" && (
          <>
            <BackRow onBack={() => setView("root")} />
            <Divider />
            {visitorsLoading ? (
              <EmptyNote>Loading…</EmptyNote>
            ) : visitors.length === 0 ? (
              <EmptyNote>No visitors yet.</EmptyNote>
            ) : (
              visitors.map((v) => (
                <div key={v.id} className="px-2 py-1.5 rounded-[6px]">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-[11px] text-gray-3 truncate">
                      {new Date(v.created_at).toLocaleDateString()}
                    </span>
                    {v.action && (
                      <span className="text-[11px] text-gray-3 shrink-0">{v.action}</span>
                    )}
                  </div>
                  {v.gate_answer && (
                    <p className="text-[11px] text-gray-3 italic truncate mb-0.5">
                      &ldquo;{v.gate_answer}&rdquo;
                    </p>
                  )}
                  <p className="text-[12px] text-ink truncate">{v.first_message}</p>
                </div>
              ))
            )}
          </>
        )}

        {/* ── ADD CONNECTOR ────────────────────────────────────────────── */}
        {view === "add_connector" && (
          <>
            <BackRow onBack={() => setView("root")} />
            <Divider />
            <form onSubmit={handleAddConnector} className="flex flex-col gap-2 px-1 pb-1">
              <input
                type="text"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Name"
                className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-ink bg-bg placeholder:text-gray-2 outline-none focus:ring-1 focus:ring-green/40 transition-shadow"
                style={{ border: "1px solid var(--line)" }}
                required
              />
              <input
                type="url"
                value={addForm.mcp_url}
                onChange={(e) => setAddForm((f) => ({ ...f, mcp_url: e.target.value }))}
                placeholder="MCP server URL"
                className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-ink bg-bg placeholder:text-gray-2 outline-none focus:ring-1 focus:ring-green/40 transition-shadow"
                style={{ border: "1px solid var(--line)" }}
                required
              />
              <input
                type="password"
                value={addForm.credential}
                onChange={(e) => setAddForm((f) => ({ ...f, credential: e.target.value }))}
                placeholder="Auth token (optional)"
                autoComplete="off"
                className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-ink bg-bg placeholder:text-gray-2 outline-none focus:ring-1 focus:ring-green/40 transition-shadow"
                style={{ border: "1px solid var(--line)" }}
              />
              <div className="flex gap-1.5">
                {(["owner", "public"] as Lane[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => { setAddForm((f) => ({ ...f, lane: l })); if (l === "owner") setPublicConfirmed(false); }}
                    className="flex-1 text-[12px] py-1.5 rounded-md transition-colors"
                    style={{
                      border: "0.5px solid var(--line)",
                      background: addForm.lane === l ? "var(--green)" : "transparent",
                      color: addForm.lane === l ? "white" : "var(--gray-2)",
                    }}
                  >
                    {l === "owner" ? "Owner" : "Public"}
                  </button>
                ))}
              </div>
              {addForm.lane === "public" && (
                <label className="flex items-start gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={publicConfirmed}
                    onChange={(e) => setPublicConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-[11px] text-gray-2 leading-tight">
                    Any visitor can trigger this connector
                  </span>
                </label>
              )}
              {addError && <p className="text-[11px] text-red-400">{addError}</p>}
              <button
                type="submit"
                disabled={!addFormValid || addSubmitting}
                className="w-full bg-green text-white text-[12px] py-1.5 rounded-md disabled:opacity-40 transition-opacity hover:bg-navy-soft"
              >
                {addSubmitting ? "Adding…" : "Add connector"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
