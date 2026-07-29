"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar, HamburgerButton } from "@/components/Sidebar";

const GMAIL_CONNECTOR_ID = "00000000-0000-0000-0000-000000000003";

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

// ── Icons ─────────────────────────────────────────────────────────────────────

const IcoMail = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="2" y="4.5" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2 6.5l7 5 7-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const IcoPlug = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5 2v3M11 2v3M4 5h8v2a4 4 0 01-4 4v0a4 4 0 01-4-4V5zM8 11v3"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoPlus = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const IcoCheck = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2 6.5l3 3L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={enabled}
      className="relative shrink-0 w-[30px] h-[17px] rounded-full transition-colors"
      style={{ background: enabled ? "var(--green)" : "var(--gray-3)" }}
    >
      <span
        className="absolute top-[2px] w-[13px] h-[13px] rounded-full bg-white transition-transform"
        style={{ transform: enabled ? "translateX(15px)" : "translateX(2px)" }}
      />
    </button>
  );
}

// ── Add connector form ─────────────────────────────────────────────────────────

interface AddFormState {
  name: string;
  mcp_url: string;
  credential: string;
  lane: Lane;
}

function AddConnectorForm({
  onAdded,
  onCancel,
}: {
  onAdded: (c: Connector) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AddFormState>({
    name: "",
    mcp_url: "",
    credential: "",
    lane: "owner",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [publicConfirmed, setPublicConfirmed] = useState(false);

  const valid =
    form.name.trim() &&
    form.mcp_url.trim() &&
    (form.lane === "owner" || publicConfirmed);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/owner/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          mcp_url: form.mcp_url.trim(),
          credential: form.credential || undefined,
          lane: form.lane,
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Failed to add connector");
      }
      const d = (await res.json()) as { connector: Connector };
      onAdded(d.connector);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add connector");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full px-3 py-2 rounded-lg text-[13px] text-ink bg-transparent border transition-colors outline-none";
  const inputStyle = {
    border: "0.5px solid var(--line)",
    background: "var(--bg)",
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--gray-2)" }}>
            Name
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="My connector"
            className={inputClass}
            style={inputStyle}
            required
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--gray-2)" }}>
            Lane
          </label>
          <select
            value={form.lane}
            onChange={(e) => setForm((f) => ({ ...f, lane: e.target.value as Lane, }))}
            className={inputClass}
            style={inputStyle}
          >
            <option value="owner">Owner only</option>
            <option value="public">Public (visitors)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--gray-2)" }}>
          MCP server URL
        </label>
        <input
          value={form.mcp_url}
          onChange={(e) => setForm((f) => ({ ...f, mcp_url: e.target.value }))}
          placeholder="https://mcp.example.com/sse"
          className={inputClass}
          style={inputStyle}
          type="url"
          required
        />
      </div>

      <div>
        <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--gray-2)" }}>
          Credential <span style={{ color: "var(--gray-3)" }}>(optional)</span>
        </label>
        <input
          value={form.credential}
          onChange={(e) => setForm((f) => ({ ...f, credential: e.target.value }))}
          placeholder="Bearer token or API key"
          className={inputClass}
          style={inputStyle}
          type="password"
          autoComplete="off"
        />
      </div>

      {form.lane === "public" && (
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={publicConfirmed}
            onChange={(e) => setPublicConfirmed(e.target.checked)}
            className="mt-[2px]"
          />
          <span className="text-[12px]" style={{ color: "var(--gray-2)" }}>
            I understand this connector will be visible to all site visitors.
          </span>
        </label>
      )}

      {error && <p className="text-[12px]" style={{ color: "#f87171" }}>{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!valid || submitting}
          className="px-4 py-2 rounded-lg text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--green)" }}
        >
          {submitting ? "Connecting…" : "Add connector"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-[13px] transition-colors"
          style={{ color: "var(--gray-2)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── ConnectionsView ──────────────────────────────────────────────────────────

export function ConnectionsView() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  const loadConnectors = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/connectors");
      if (!res.ok) return;
      const d = (await res.json()) as { connectors?: Connector[] };
      setConnectors(d.connectors ?? []);
    } catch { /* best-effort */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadConnectors(); }, [loadConnectors]);

  // Gmail state
  const gmailRow = connectors.find(
    (c) => c.id === GMAIL_CONNECTOR_ID || c.name?.toLowerCase().includes("gmail")
  );
  const gmailConnected = !!gmailRow?.credential_masked;

  // Other connectors (non-Gmail)
  const otherConnectors = connectors.filter(
    (c) => c.id !== GMAIL_CONNECTOR_ID && !c.name?.toLowerCase().includes("gmail")
  );

  async function disconnectGmail() {
    if (!confirm("Disconnect Gmail? The OAuth token will be removed. You can reconnect at any time.")) return;
    const res = await fetch(`/api/owner/connectors/${GMAIL_CONNECTOR_ID}`, { method: "DELETE" });
    if (res.ok) await loadConnectors();
  }

  async function toggleConnector(id: string, enabled: boolean) {
    setConnectors((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !enabled } : c))
    );
    const res = await fetch(`/api/owner/connectors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    if (!res.ok) {
      // Revert on failure
      setConnectors((prev) =>
        prev.map((c) => (c.id === id ? { ...c, enabled } : c))
      );
    }
  }

  async function removeConnector(id: string, name: string) {
    if (!confirm(`Remove "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/owner/connectors/${id}`, { method: "DELETE" });
    if (res.ok) setConnectors((prev) => prev.filter((c) => c.id !== id));
  }

  const sectionLabel = (text: string) => (
    <p
      className="font-mono text-[10px] tracking-[0.12em] uppercase mb-3"
      style={{ color: "var(--gray-3)" }}
    >
      {text}
    </p>
  );

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
            <h1 className="text-[17px] font-semibold text-ink">Connections</h1>
          </div>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition-colors"
              style={{
                border: "0.5px solid var(--line)",
                color: "var(--gray-2)",
                background: "var(--bg)",
              }}
            >
              <IcoPlus />
              Add connector
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-4 lg:px-8 py-6 max-w-2xl flex flex-col gap-8">
          {loading ? (
            <p className="text-[13px]" style={{ color: "var(--gray-2)" }}>Loading…</p>
          ) : (
            <>
              {/* ── Gmail section ──────────────────────────────────────────── */}
              <section>
                {sectionLabel("Gmail")}
                <div
                  className="rounded-xl p-5"
                  style={{ border: "0.5px solid var(--line)", background: "var(--bg)" }}
                >
                  <div className="flex items-start gap-4">
                    {/* Mail icon */}
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: gmailConnected ? "rgba(64,152,68,0.10)" : "rgba(0,0,0,0.04)" }}
                    >
                      <span style={{ color: gmailConnected ? "var(--green)" : "var(--gray-3)" }}>
                        <IcoMail />
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[14px] font-semibold text-ink">Gmail</p>
                        {gmailConnected ? (
                          <span
                            className="flex items-center gap-1 text-[11px] font-medium px-2 py-[2px] rounded-full"
                            style={{ background: "rgba(64,152,68,0.12)", color: "var(--green)" }}
                          >
                            <IcoCheck />
                            Read + send connected
                          </span>
                        ) : (
                          <span
                            className="text-[11px] font-medium px-2 py-[2px] rounded-full"
                            style={{ background: "rgba(0,0,0,0.05)", color: "var(--gray-2)" }}
                          >
                            Not connected
                          </span>
                        )}
                      </div>

                      <p className="text-[12px] leading-relaxed" style={{ color: "var(--gray-2)" }}>
                        Read your inbox and send owner-approved draft replies. OAuth — your token stays encrypted on this machine.
                      </p>

                      {gmailConnected && gmailRow?.credential_masked && (
                        <p className="text-[11px] mt-2 font-mono" style={{ color: "var(--gray-3)" }}>
                          Token: {gmailRow.credential_masked}
                        </p>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-3 mt-4">
                        {gmailConnected ? (
                          <>
                            {gmailRow && (
                              <div className="flex items-center gap-2">
                                <Toggle
                                  enabled={gmailRow.enabled}
                                  onChange={() => void toggleConnector(gmailRow.id, gmailRow.enabled)}
                                />
                                <span className="text-[12px]" style={{ color: "var(--gray-2)" }}>
                                  {gmailRow.enabled ? "Enabled" : "Disabled"}
                                </span>
                              </div>
                            )}
                            <a
                              href="/api/owner/gmail/connect"
                              className="text-[12px] font-medium transition-opacity hover:opacity-70"
                              style={{ color: "var(--green)" }}
                            >
                              Reconnect
                            </a>
                            <button
                              onClick={() => void disconnectGmail()}
                              className="text-[12px] transition-opacity hover:opacity-70"
                              style={{ color: "var(--gray-3)" }}
                            >
                              Disconnect
                            </button>
                          </>
                        ) : (
                          <a
                            href="/api/owner/gmail/connect"
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                            style={{ background: "var(--green)" }}
                          >
                            Connect Gmail
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* ── Other connectors ─────────────────────────────────────── */}
              {otherConnectors.length > 0 && (
                <section>
                  {sectionLabel("MCP connectors")}
                  <div
                    className="overflow-hidden"
                    style={{ border: "0.5px solid var(--line)", borderRadius: "10px" }}
                  >
                    {otherConnectors.map((c, i) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-4 px-5 py-4"
                        style={{ borderTop: i > 0 ? "0.5px solid var(--line)" : "none" }}
                      >
                        <span style={{ color: "var(--gray-3)", flexShrink: 0 }}>
                          <IcoPlug />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-ink truncate">{c.name}</p>
                          {c.mcp_url && (
                            <p className="text-[11px] mt-[2px] truncate font-mono" style={{ color: "var(--gray-3)" }}>
                              {c.mcp_url}
                            </p>
                          )}
                        </div>
                        <span
                          className="text-[10px] px-2 py-[2px] rounded-full shrink-0"
                          style={{
                            background: c.lane === "public" ? "rgba(0,0,0,0.05)" : "rgba(64,152,68,0.08)",
                            color: c.lane === "public" ? "var(--gray-2)" : "var(--green)",
                          }}
                        >
                          {c.lane}
                        </span>
                        <Toggle
                          enabled={c.enabled}
                          onChange={() => void toggleConnector(c.id, c.enabled)}
                        />
                        {c.type === "mcp" && (
                          <button
                            onClick={() => void removeConnector(c.id, c.name)}
                            className="text-[18px] leading-none transition-opacity hover:opacity-70"
                            style={{ color: "var(--gray-3)" }}
                            title="Remove"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Add connector form ────────────────────────────────────── */}
              {showAddForm && (
                <section>
                  {sectionLabel("New MCP connector")}
                  <div
                    className="rounded-xl p-5"
                    style={{ border: "0.5px solid var(--line)" }}
                  >
                    <AddConnectorForm
                      onAdded={(c) => {
                        setConnectors((prev) => [...prev, c]);
                        setShowAddForm(false);
                      }}
                      onCancel={() => setShowAddForm(false)}
                    />
                  </div>
                </section>
              )}

              {/* ── Empty state for other connectors ─────────────────────── */}
              {otherConnectors.length === 0 && !showAddForm && (
                <section>
                  {sectionLabel("MCP connectors")}
                  <div
                    className="rounded-xl px-5 py-8 flex flex-col items-center gap-2 text-center"
                    style={{ border: "0.5px solid var(--line)", borderStyle: "dashed" }}
                  >
                    <span style={{ color: "var(--gray-3)" }}><IcoPlug /></span>
                    <p className="text-[13px] font-medium text-ink">No MCP connectors yet</p>
                    <p className="text-[12px]" style={{ color: "var(--gray-2)" }}>
                      Connect an MCP server to give the agent access to external tools.
                    </p>
                    <button
                      onClick={() => setShowAddForm(true)}
                      className="mt-2 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors"
                      style={{ border: "0.5px solid var(--line)", color: "var(--gray-2)" }}
                    >
                      <IcoPlus />
                      Add connector
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
