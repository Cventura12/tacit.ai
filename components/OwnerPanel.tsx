"use client";

import { useState, useEffect, useCallback } from "react";

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

// ─── Reusable primitives ─────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/30 ${
        checked ? "bg-green" : "bg-gray-3"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function LaneBadge({ lane }: { lane: Lane }) {
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full font-medium leading-none ${
        lane === "public"
          ? "text-[#3aaf78] bg-[#3aaf78]/10"
          : "text-[#7ea8f8] bg-[#2652c4]/20"
      }`}
    >
      {lane === "public" ? "Public" : "Owner-only"}
    </span>
  );
}

// ─── Add-connector form ───────────────────────────────────────────────────────

interface AddFormProps {
  onAdded: (c: Connector) => void;
  onCancel: () => void;
}

function AddConnectorForm({ onAdded, onCancel }: AddFormProps) {
  const [form, setForm] = useState({
    name: "",
    mcp_url: "",
    credential: "",
    lane: "owner" as Lane,
  });
  const [publicConfirmed, setPublicConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isValid =
    form.name.trim() &&
    form.mcp_url.trim() &&
    (form.lane === "owner" || publicConfirmed);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;
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
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Failed to add connector");
      }
      const d = await res.json() as { connector: Connector };
      onAdded(d.connector);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add connector");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-line rounded-xl p-5">
      <h3 className="text-sm font-medium text-ink mb-4">New MCP connector</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="text-xs text-gray-2 block mb-1">Display name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. GitHub, Notion, Linear"
            className="w-full border border-line rounded-lg px-3 py-2.5 text-sm text-ink bg-bg outline-none focus:border-gray-2 placeholder:text-gray-3 transition-colors"
            required
          />
        </div>

        <div>
          <label className="text-xs text-gray-2 block mb-1">MCP server URL</label>
          <input
            type="url"
            value={form.mcp_url}
            onChange={(e) => setForm((f) => ({ ...f, mcp_url: e.target.value }))}
            placeholder="https://mcp.example.com"
            className="w-full border border-line rounded-lg px-3 py-2.5 text-sm text-ink bg-bg outline-none focus:border-gray-2 placeholder:text-gray-3 transition-colors"
            required
          />
        </div>

        <div>
          <label className="text-xs text-gray-2 block mb-1">
            Auth token{" "}
            <span className="text-gray-3">(optional)</span>
          </label>
          <input
            type="password"
            value={form.credential}
            onChange={(e) => setForm((f) => ({ ...f, credential: e.target.value }))}
            placeholder="Bearer token or API key"
            autoComplete="off"
            className="w-full border border-line rounded-lg px-3 py-2.5 text-sm text-ink bg-bg outline-none focus:border-gray-2 placeholder:text-gray-3 transition-colors"
          />
          <p className="text-[11px] text-gray-3 mt-1">
            Encrypted at rest with AES-256-GCM. Never logged or returned after saving.
          </p>
        </div>

        <div>
          <label className="text-xs text-gray-2 block mb-1.5">Access lane</label>
          <div className="flex gap-2">
            {(["owner", "public"] as Lane[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => {
                  setForm((f) => ({ ...f, lane: l }));
                  if (l === "owner") setPublicConfirmed(false);
                }}
                className={`flex-1 text-sm py-2.5 rounded-lg border transition-colors ${
                  form.lane === l
                    ? "border-navy bg-navy text-white"
                    : "border-line bg-bg text-gray-1 hover:border-gray-2"
                }`}
              >
                {l === "owner" ? "Owner-only" : "Public"}
              </button>
            ))}
          </div>
        </div>

        {form.lane === "public" && (
          <div className="border border-amber-700/40 bg-amber-950/30 rounded-lg p-4">
            <p className="text-xs font-medium text-amber-400 mb-1.5">
              Public connector
            </p>
            <p className="text-xs text-amber-400/70 mb-3 leading-relaxed">
              Any visitor to your site will be able to trigger this connector&apos;s
              tools. Only mark a connector public if its worst-case action is harmless.
              Scope the credential to least-privilege permissions at the source.
            </p>
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={publicConfirmed}
                onChange={(e) => setPublicConfirmed(e.target.checked)}
                className="mt-0.5 accent-amber-500"
              />
              <span className="text-xs text-amber-400">
                I understand this connector is accessible to all visitors
              </span>
            </label>
          </div>
        )}

        {error && <p className="text-red-500 text-xs">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={!isValid || submitting}
            className="flex-1 bg-navy text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 transition-opacity"
          >
            {submitting ? "Connecting…" : "Add connector"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-5 text-sm text-gray-1 hover:text-ink transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

const GMAIL_CONNECTOR_ID = "00000000-0000-0000-0000-000000000003";

// ─── Visitor log types ────────────────────────────────────────────────────────

interface Visitor {
  id: string;
  created_at: string;
  session_id: string;
  gate_answer: string | null;
  first_message: string;
  action: string | null;
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function OwnerPanel() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [visitorsLoading, setVisitorsLoading] = useState(true);
  const [gmailToast, setGmailToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/connectors");
      if (!res.ok) throw new Error("Failed to load");
      const d = await res.json() as { connectors: Connector[] };
      setConnectors(d.connectors ?? []);
    } catch {
      setLoadError("Couldn't load connectors. Is Supabase configured?");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadVisitors = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/visitors");
      if (!res.ok) return;
      const d = await res.json() as { visitors: Visitor[] };
      setVisitors(d.visitors ?? []);
    } catch {
      // Visitor log is best-effort — don't surface errors for it
    } finally {
      setVisitorsLoading(false);
    }
  }, []);

  useEffect(() => { load(); loadVisitors(); }, [load, loadVisitors]);

  // Read ?gmail=connected / ?gmail=error from OAuth callback redirect, then clear.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get("gmail");
    if (gmail === "connected") {
      setGmailToast({ type: "success", text: "Gmail connected" });
    } else if (gmail === "error") {
      const reason = params.get("reason") ?? "unknown error";
      setGmailToast({ type: "error", text: `Gmail error: ${reason}` });
    }
    if (gmail) {
      params.delete("gmail");
      params.delete("reason");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);

  async function toggle(id: string, currentEnabled: boolean) {
    // Optimistic update
    setConnectors((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !currentEnabled } : c))
    );
    const res = await fetch(`/api/owner/connectors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !currentEnabled }),
    });
    if (!res.ok) {
      // Revert on failure
      setConnectors((prev) =>
        prev.map((c) => (c.id === id ? { ...c, enabled: currentEnabled } : c))
      );
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/owner/connectors/${id}`, { method: "DELETE" });
    if (res.ok) setConnectors((prev) => prev.filter((c) => c.id !== id));
  }

  function onAdded(connector: Connector) {
    setConnectors((prev) => [...prev, connector]);
    setShowAddForm(false);
  }

  const builtins = connectors.filter((c) => c.type === "builtin");
  const mcps = connectors.filter((c) => c.type === "mcp");

  return (
    <div className="px-6 py-8 sm:px-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-serif text-xl text-ink tracking-tight">Control panel</h1>
        <form action="/api/owner/logout" method="POST">
          <button
            type="submit"
            className="text-sm text-gray-1 hover:text-ink transition-colors"
          >
            Sign out
          </button>
        </form>
      </div>

      {loadError && (
        <div className="mb-6 text-sm text-red-400 border border-red-700/40 bg-red-950/30 rounded-lg px-4 py-3">
          {loadError}
        </div>
      )}

      {gmailToast && (
        <div className={`mb-6 flex items-center justify-between gap-4 text-sm rounded-lg px-4 py-3 border ${
          gmailToast.type === "success"
            ? "text-green border-green/30 bg-green/10"
            : "text-red-400 border-red-700/40 bg-red-950/30"
        }`}>
          <span>{gmailToast.text}</span>
          <button
            type="button"
            onClick={() => setGmailToast(null)}
            className="text-base leading-none opacity-60 hover:opacity-100 transition-opacity shrink-0"
          >
            ×
          </button>
        </div>
      )}

      {/* Built-in connectors */}
      <section className="mb-8">
        <p className="text-[11px] font-medium text-gray-2 uppercase tracking-wider mb-3">
          Built-in connectors
        </p>
        <div className="border border-line rounded-xl divide-y divide-line">
          {loading ? (
            <div className="px-5 py-4 text-sm text-gray-2">Loading…</div>
          ) : builtins.length === 0 ? (
            <div className="px-5 py-4 text-sm text-gray-2">
              No built-in connectors found. Run the Supabase schema migration first.
            </div>
          ) : (
            builtins.map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-sm font-medium text-ink">{c.name}</span>
                    <LaneBadge lane={c.lane} />
                  </div>
                  <p className="text-xs text-gray-2">{c.description}</p>
                  {c.id === GMAIL_CONNECTOR_ID && (
                    <div className="flex items-center gap-3 mt-1.5">
                      {c.enabled && c.credential_masked ? (
                        <span className="text-xs text-green">
                          Connected · <span className="font-mono">{c.credential_masked}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-3">Not connected</span>
                      )}
                      <a
                        href="/api/owner/gmail/connect"
                        className="text-xs text-navy hover:text-navy-soft transition-colors"
                      >
                        {c.enabled && c.credential_masked ? "Reconnect" : "Connect"}
                      </a>
                    </div>
                  )}
                </div>
                <Toggle
                  checked={c.enabled}
                  onChange={() => toggle(c.id, c.enabled)}
                />
              </div>
            ))
          )}
        </div>
      </section>

      {/* MCP connectors */}
      <section>
        <p className="text-[11px] font-medium text-gray-2 uppercase tracking-wider mb-3">
          MCP connectors
        </p>

        {mcps.length > 0 && (
          <div className="border border-line rounded-xl divide-y divide-line mb-3">
            {mcps.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-sm font-medium text-ink">{c.name}</span>
                    <LaneBadge lane={c.lane} />
                  </div>
                  <p className="text-xs text-gray-2 truncate">{c.mcp_url}</p>
                  {c.credential_masked && (
                    <p className="text-xs text-gray-3 font-mono mt-0.5">
                      {c.credential_masked}
                    </p>
                  )}
                  {c.tool_names?.length > 0 && (
                    <p className="text-xs text-gray-3 mt-0.5">
                      {c.tool_names.join(", ")}
                    </p>
                  )}
                </div>
                <Toggle
                  checked={c.enabled}
                  onChange={() => toggle(c.id, c.enabled)}
                />
                <button
                  type="button"
                  onClick={() => remove(c.id, c.name)}
                  title="Remove connector"
                  className="text-gray-3 hover:text-red-400 transition-colors text-base leading-none ml-1 shrink-0"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {mcps.length === 0 && !loading && !showAddForm && (
          <p className="text-sm text-gray-2 mb-3">
            No services connected yet.
          </p>
        )}

        {showAddForm ? (
          <AddConnectorForm
            onAdded={onAdded}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="text-sm text-gray-1 hover:text-ink transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span>
            <span>Add connector</span>
          </button>
        )}
      </section>

      {/* Recent visitors */}
      <section className="mt-10">
        <p className="text-[11px] font-medium text-gray-2 uppercase tracking-wider mb-3">
          Recent visitors
        </p>
        <div className="border border-line rounded-xl divide-y divide-line">
          {visitorsLoading ? (
            <div className="px-5 py-4 text-sm text-gray-2">Loading…</div>
          ) : visitors.length === 0 ? (
            <div className="px-5 py-4 text-sm text-gray-2">No visitors yet.</div>
          ) : (
            visitors.map((v) => (
              <div key={v.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3 mb-0.5">
                  <span className="text-xs text-gray-3">
                    {new Date(v.created_at).toLocaleString()}
                  </span>
                  {v.action && (
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-medium leading-none shrink-0 ${
                        v.action === "booked"
                          ? "text-[#7ea8f8] bg-[#2652c4]/20"
                          : "text-[#3aaf78] bg-[#3aaf78]/10"
                      }`}
                    >
                      {v.action}
                    </span>
                  )}
                </div>
                {v.gate_answer && (
                  <p className="text-xs text-gray-2 italic mb-0.5 truncate">
                    &ldquo;{v.gate_answer}&rdquo;
                  </p>
                )}
                <p className="text-xs text-ink truncate">{v.first_message}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
