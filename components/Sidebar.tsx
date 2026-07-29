"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import type { RecentRun } from "@/lib/types";

// ── Icons ──────────────────────────────────────────────────────────────────────

const IcoWorkspace = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
    <rect x="8.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
    <rect x="1.5" y="8.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
    <rect x="8.5" y="8.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
  </svg>
);

const IcoDocuments = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path d="M9 1.5H3.5A1 1 0 002.5 2.5v10A1 1 0 003.5 13.5h8a1 1 0 001-1V6L9 1.5z"
      stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 1.5v4.5h4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
  </svg>
);

const IcoActivity = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path d="M1 7.5h2.5l2-5 2.5 8.5 2-6 1.5 2.5H14"
      stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IcoConnections = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path d="M5 3.5v2M10 3.5v2M4 5.5h7v1.5a3.5 3.5 0 01-3.5 3.5v0A3.5 3.5 0 014 7V5.5zM7.5 10.5v3"
      stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ── Logo ───────────────────────────────────────────────────────────────────────

const TacitLogo = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="100%"
    viewBox="0 0 1600 500"
    role="img"
    aria-labelledby="tacit-logo-title tacit-logo-description"
  >
    <title id="tacit-logo-title">Tacit</title>
    <desc id="tacit-logo-description">Tacit Evidence Agent logo</desc>
    <rect width="1600" height="500" fill="#F8F6EF" />
    <g transform="translate(120 90)">
      <rect width="320" height="320" rx="78" fill="#08261A" />
      <path d="M118 120 L202 202" fill="none" stroke="#9FCFA1" strokeWidth="12" strokeLinecap="round" opacity="0.7" />
      <circle cx="116" cy="116" r="48" fill="#409844" />
      <circle cx="204" cy="204" r="48" fill="#F8F6EF" />
      <circle cx="116" cy="116" r="18" fill="#BFE2C0" opacity="0.34" />
      <circle cx="204" cy="204" r="18" fill="#FFFFFF" opacity="0.38" />
    </g>
    <g transform="translate(525 164)">
      <text x="0" y="92" fill="#08261A" fontFamily="Inter, Arial, sans-serif" fontSize="126" fontWeight="650" letterSpacing="22">TACIT</text>
      <line x1="4" y1="142" x2="664" y2="142" stroke="#BFC7BE" strokeWidth="2" />
      <text x="4" y="194" fill="#537064" fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fontSize="28" fontWeight="600" letterSpacing="8">EVIDENCE AGENT</text>
    </g>
  </svg>
);

// ── Nav config ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { icon: <IcoWorkspace />, label: "Workspace", href: "/" },
  { icon: <IcoDocuments />, label: "Documents", href: "/documents" },
  { icon: <IcoActivity />, label: "Activity", href: "/activity" },
  { icon: <IcoConnections />, label: "Connections", href: "/connections" },
];

// ── Sidebar ────────────────────────────────────────────────────────────────────

interface SidebarProps {
  recentRuns?: RecentRun[];
  onNewRequest?: () => void;
}

export function Sidebar({ recentRuns = [], onNewRequest }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  function handleNewRequest() {
    if (onNewRequest) {
      onNewRequest();
    } else {
      router.push("/");
    }
  }

  return (
    <aside
      className="hidden lg:flex flex-col w-[220px] shrink-0 h-dvh"
      style={{
        background: "var(--forest)",
        borderRight: "0.5px solid var(--forest-border)",
      }}
    >
      {/* Logo */}
      <div className="w-full">
        <TacitLogo />
      </div>

      {/* New request button */}
      <div className="px-3 pb-4">
        <button
          onClick={handleNewRequest}
          className="w-full flex items-center gap-2 px-3 py-[8px] rounded-lg text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--green)" }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          New request
        </button>
      </div>

      {/* Nav */}
      <nav className="px-2 flex flex-col gap-[2px]">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-2.5 px-2 py-[7px] rounded-lg w-full transition-colors"
              style={{
                background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
                color: isActive ? "var(--forest-text)" : "var(--forest-muted)",
                textDecoration: "none",
              }}
            >
              <span style={{ color: isActive ? "var(--forest-text)" : "var(--forest-icon)" }}>
                {item.icon}
              </span>
              <span className="text-[13px]">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Recent runs */}
      {recentRuns.length > 0 && (
        <div className="mt-5 px-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="font-mono text-[9px] tracking-[0.12em] uppercase" style={{ color: "var(--forest-muted)" }}>
              Recent runs
            </p>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"
              style={{ color: "var(--forest-icon)" }}>
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4 6h4M6 4l2 2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="flex flex-col gap-[2px]">
            {recentRuns.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between px-2 py-[7px] rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
              >
                <span
                  className="text-[12px] truncate leading-snug"
                  style={{ color: run.isCurrent ? "var(--forest-text)" : "var(--forest-muted)" }}
                >
                  {run.label}
                </span>
                <span
                  className="text-[10px] ml-2 shrink-0 font-mono"
                  style={{ color: run.isCurrent ? "#4ade80" : "var(--forest-icon)" }}
                >
                  {run.relativeTime}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom: machine + owner */}
      <div
        className="px-4 py-4"
        style={{ borderTop: "0.5px solid var(--forest-border)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span
            className="w-[7px] h-[7px] rounded-full shrink-0"
            style={{ background: "var(--green)" }}
          />
          <div className="min-w-0">
            <p className="text-[11px] font-medium leading-tight truncate" style={{ color: "var(--forest-text)" }}>
              Cloud
            </p>
            <p className="text-[10px] leading-tight" style={{ color: "var(--forest-muted)" }}>
              database and storage online
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--green)" }}
          >
            <span className="text-white text-[9px] font-medium tracking-wide">CV</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium leading-tight truncate" style={{ color: "var(--forest-text)" }}>
              Caleb Ventura
            </p>
            <p className="text-[10px] leading-tight" style={{ color: "var(--forest-muted)" }}>
              Owner · single user
            </p>
          </div>
          <SignOutButton>
            <button
              title="Sign out"
              className="shrink-0 rounded p-1 transition-opacity hover:opacity-70"
              style={{ color: "var(--forest-muted)" }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M5 2H2.5A.5.5 0 002 2.5v9a.5.5 0 00.5.5H5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M9.5 10L12 7l-2.5-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 7H5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          </SignOutButton>
        </div>
      </div>
    </aside>
  );
}
