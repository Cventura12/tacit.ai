"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar, HamburgerButton } from "@/components/Sidebar";
import type { T002Metrics, CanaryState } from "@/lib/t002";

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 48) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function fmtPct(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

// Every source-completeness group is shown as numerator / total enrolled —
// never a bare count, so a reader can always see what it's a fraction of.
function fmtGroup(count: number, denominator: number): string {
  return `${count} / ${denominator}`;
}

// The canary's pass/fail/no-data classification comes entirely from
// computeInstrumentationCanary's `state` field — never re-derived here from the
// rate, so a zero-decisions state can never render as "within threshold."
const CANARY_LABEL: Record<CanaryState, string> = {
  no_data: "No decisions yet",
  within_threshold: "Within threshold",
  breached: "Breached — never-viewed counts unreliable",
};

// ── Small display primitives ──────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{ background: "var(--bubble)", border: "0.5px solid var(--line-2)" }}
    >
      <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--gray-2)" }}>
        {label}
      </p>
      <p className="text-[16px] font-medium text-ink">{value}</p>
      {sub && <p className="text-[11px] mt-[2px]" style={{ color: "var(--gray-3)" }}>{sub}</p>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <h2 className="text-[13px] font-medium text-ink">{title}</h2>
        {note && <p className="text-[11px] mt-[2px]" style={{ color: "var(--gray-3)" }}>{note}</p>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">{children}</div>
    </div>
  );
}

function MedianStat({
  label,
  result,
  note,
}: {
  label: string;
  result: { medianMs: number | null; n: number; insufficientData: boolean };
  note?: string;
}) {
  const value = result.insufficientData
    ? `Insufficient data (n=${result.n})`
    : fmtDuration(result.medianMs ?? 0);
  return (
    <Stat
      label={label}
      value={value}
      sub={result.insufficientData ? note : `among resolved items only · n=${result.n}`}
    />
  );
}

// ── T002View ───────────────────────────────────────────────────────────────────

export function T002View() {
  const [metrics, setMetrics] = useState<T002Metrics | null>(null);
  const [observationHours, setObservationHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/owner/experiments/t002");
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Failed to load metrics");
      }
      const d = (await res.json()) as { metrics: T002Metrics; observationHours: number };
      setMetrics(d.metrics);
      setObservationHours(d.observationHours);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4 lg:px-8 py-5"
          style={{ borderBottom: "0.5px solid var(--line)", background: "var(--bg)" }}
        >
          <div className="flex items-center gap-2">
            <HamburgerButton />
            <h1 className="text-[17px] font-semibold text-ink">T-002 — Routing baseline</h1>
          </div>
          <button
            onClick={() => void load()}
            className="px-3 py-[6px] rounded-lg text-[12px] font-medium transition-opacity hover:opacity-70"
            style={{ border: "0.5px solid var(--line)", color: "var(--ink)", background: "var(--bubble)" }}
          >
            Refresh
          </button>
        </div>

        <div className="px-4 lg:px-8 py-6 max-w-4xl flex flex-col gap-6">

          {/* Required disclaimers — always shown, regardless of data state */}
          <div
            className="rounded-lg px-4 py-3 flex flex-col gap-1"
            style={{ background: "var(--bubble)", border: "0.5px solid var(--line-2)" }}
          >
            <p className="text-[12px] font-medium text-ink">Early observational data — not causal evidence.</p>
            <p className="text-[11px]" style={{ color: "var(--gray-2)" }}>
              Phase one measures responsiveness to successfully routed items.
            </p>
            <p className="text-[11px]" style={{ color: "var(--gray-2)" }}>
              Notification-to-view latency is conditioned on owner availability.
            </p>
            <p className="text-[11px]" style={{ color: "var(--gray-2)" }}>
              Total system latency includes polling cadence and owner availability.
            </p>
            <p className="text-[11px]" style={{ color: "var(--gray-2)" }}>
              Rejected-item audit is a separate forward-only measurement stream.
            </p>
          </div>

          {loading ? (
            <p className="text-[13px]" style={{ color: "var(--gray-2)" }}>Loading…</p>
          ) : error ? (
            <div
              className="px-4 py-3 rounded-lg"
              style={{ background: "rgba(248,113,113,0.08)", border: "0.5px solid rgba(248,113,113,0.2)" }}
            >
              <p className="text-[13px]" style={{ color: "#f87171" }}>{error}</p>
            </div>
          ) : metrics ? (
            <>
              {/* Deployment boundary state — must never imply T-002 has begun
                  while the boundary is null. */}
              <div
                className="rounded-lg px-4 py-3"
                style={{ background: "var(--bubble)", border: "0.5px solid var(--line-2)" }}
              >
                {metrics.bodyCompletenessBoundaryAt === null ? (
                  <p className="text-[12px] font-medium text-ink">
                    Enrollment paused — body-completeness deployment boundary has not been activated.
                  </p>
                ) : (
                  <>
                    <p className="text-[12px] font-medium text-ink">
                      Body-completeness deployment boundary activated: {metrics.bodyCompletenessBoundaryAt}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: "var(--gray-2)" }}>
                      Only proposals created on or after that instant can enroll.
                    </p>
                  </>
                )}
              </div>

              <Section title="Enrollment">
                <Stat label="Enrolled" value={`${metrics.enrolledCount} / ${metrics.cap}`} />
                <Stat label="Pending" value={metrics.statusCounts.pending} />
                <Stat label="Sent" value={metrics.statusCounts.sent} />
                <Stat label="Skipped" value={metrics.statusCounts.skipped} />
                <Stat label="Expired" value={metrics.statusCounts.expired} />
                <Stat label="Failed" value={metrics.statusCounts.failed} />
              </Section>

              {/* Source completeness — provenance, never conflated with outcomes. */}
              <div
                className="rounded-lg px-4 py-3"
                style={{ background: "rgba(245,158,11,0.08)", border: "0.5px solid rgba(245,158,11,0.25)" }}
              >
                <p className="text-[12px] font-medium text-ink">
                  Response metrics are not evidence of correct routing or correct proposal content. Source
                  completeness must be reported alongside outcomes. Decisions made from partial, snippet-only,
                  fetch-failed, locally truncated, or legacy-unknown content may not support conclusions about
                  Tacit&apos;s substantive accuracy.
                </p>
              </div>

              <Section
                title="Source completeness"
                note="Raw dimensions (independent, orthogonal) and derived presentation groups (full/partial × truncation only — never a stored combined value). Every count is numerator / total enrolled."
              >
                <Stat
                  label="Full"
                  value={fmtGroup(metrics.provenance.fullCount, metrics.enrolledCount)}
                  sub="raw dimension"
                />
                <Stat
                  label="Partial"
                  value={fmtGroup(metrics.provenance.partialCount, metrics.enrolledCount)}
                  sub="raw dimension"
                />
                <Stat
                  label="Snippet-only"
                  value={fmtGroup(metrics.provenance.snippetOnlyCount, metrics.enrolledCount)}
                  sub="raw dimension = derived group"
                />
                <Stat
                  label="Fetch-failed"
                  value={fmtGroup(metrics.provenance.fetchFailedCount, metrics.enrolledCount)}
                  sub="raw dimension = derived group"
                />
                <Stat
                  label="Locally truncated"
                  value={fmtGroup(metrics.provenance.locallyTruncatedCount, metrics.enrolledCount)}
                  sub="spans full + partial"
                />
                <Stat
                  label="Not locally truncated"
                  value={fmtGroup(metrics.provenance.notLocallyTruncatedCount, metrics.enrolledCount)}
                  sub="known false, not null"
                />
                <Stat
                  label="Legacy / unknown"
                  value={fmtGroup(metrics.provenance.legacyUnknownCount, metrics.enrolledCount)}
                  sub="completeness null, or full/partial with unknown truncation"
                />
                <Stat
                  label="Full, not truncated"
                  value={fmtGroup(metrics.provenance.fullNotTruncated, metrics.enrolledCount)}
                  sub="derived group"
                />
                <Stat
                  label="Full, locally truncated"
                  value={fmtGroup(metrics.provenance.fullTruncated, metrics.enrolledCount)}
                  sub="derived group"
                />
                <Stat
                  label="Partial, not truncated"
                  value={fmtGroup(metrics.provenance.partialNotTruncated, metrics.enrolledCount)}
                  sub="derived group"
                />
                <Stat
                  label="Partial, locally truncated"
                  value={fmtGroup(metrics.provenance.partialTruncated, metrics.enrolledCount)}
                  sub="derived group"
                />
              </Section>

              <Section title="Coverage">
                <Stat label="Never notified" value={metrics.neverNotifiedCount} />
                <Stat label="Never viewed" value={metrics.neverViewedCount} />
                <Stat label="Viewed, unresolved" value={metrics.viewedButUnresolvedCount} />
                <Stat label="Expired, no view" value={metrics.expiredWithoutViewCount} />
                <Stat label="Expired, after view" value={metrics.expiredAfterViewCount} />
                <Stat
                  label="Decided within 24h of view"
                  value={`${metrics.decidedWithin24hOfView.count} / ${metrics.decidedWithin24hOfView.denominator}`}
                  sub="numerator / denominator"
                />
              </Section>

              <Section title="Latency (among resolved items only)">
                <MedianStat
                  label="Notification → first view"
                  result={metrics.notificationToViewMedian}
                  note="fewer than 5 resolved pairs"
                />
                <MedianStat
                  label="First view → decision"
                  result={metrics.viewToDecisionMedian}
                  note="fewer than 5 resolved pairs"
                />
                <MedianStat
                  label="Total system latency"
                  result={metrics.totalSystemLatencyMedian}
                  note="fewer than 5 resolved pairs"
                />
              </Section>

              <Section
                title="Instrumentation reliability"
                note={
                  metrics.canary.state === "breached"
                    ? "Canary: decided_without_view_count / decided_item_count. Fails above 5% — never-viewed data cannot support T-002B while breached."
                    : "Canary: decided_without_view_count / decided_item_count. Fails above 5%."
                }
              >
                <Stat label="Decided without a view" value={metrics.canary.decidedWithoutViewCount} />
                <Stat label="Decided item count" value={metrics.canary.decidedItemCount} />
                <Stat
                  label="Instrumentation miss rate"
                  value={fmtPct(metrics.canary.rate)}
                  sub={CANARY_LABEL[metrics.canary.state]}
                />
              </Section>

              <Section
                title="Signal 1 — unresolved after view"
                note="Eligible = viewed ≥24h ago. Unresolved = no decision inside the first 24h after view (includes still-pending and expired-after-view). Threshold: rate ≥25% with n≥10."
              >
                <Stat label="Eligible (viewed ≥24h ago)" value={metrics.signal1EligibleCount} />
                <Stat
                  label="Unresolved at 24h"
                  value={`${metrics.signal1UnresolvedAt24hCount} / ${metrics.signal1EligibleCount}`}
                  sub="numerator / denominator"
                />
                <Stat
                  label="Rate"
                  value={fmtPct(metrics.signal1Rate)}
                  sub={
                    !metrics.signal1MinimumReached
                      ? `Insufficient data (n<10)`
                      : metrics.signal1ThresholdMet
                        ? "≥25% — threshold met"
                        : "below 25% threshold"
                  }
                />
              </Section>

              <Section title="Rejected-item audit" note="Separate forward-only stream — never enters the primary population.">
                <Stat label="Reviewed" value={metrics.rejections.reviewedCount} />
                <Stat label="Time-sensitive" value={metrics.rejections.timeSensitiveCount} />
                <Stat label="Unreviewed" value={metrics.rejections.unreviewedCount} />
                <Stat
                  label="False-negative fraction"
                  value={
                    metrics.rejections.falseNegativeFraction === null
                      ? "Insufficient data"
                      : `${metrics.rejections.timeSensitiveCount} / ${metrics.rejections.reviewedCount}`
                  }
                  sub={
                    metrics.rejections.falseNegativeFraction === null
                      ? "no reviewed rejections yet"
                      : fmtPct(metrics.rejections.falseNegativeFraction)
                  }
                />
              </Section>

              {observationHours !== null && (
                <p className="text-[11px]" style={{ color: "var(--gray-3)" }}>
                  Observation horizon: {observationHours}h.
                </p>
              )}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
