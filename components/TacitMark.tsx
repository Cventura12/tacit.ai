// The Tacit symbol — the rounded square with evidence nodes.
// Extracted from the full logo SVG, used as avatar and loading mark.

export function TacitMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 320 320"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect width="320" height="320" rx="78" fill="#08261A" />
      <path
        d="M118 120 L202 202"
        fill="none"
        stroke="#9FCFA1"
        strokeWidth="12"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="116" cy="116" r="48" fill="#409844" />
      <circle cx="204" cy="204" r="48" fill="#F8F6EF" />
      <circle cx="116" cy="116" r="18" fill="#BFE2C0" opacity="0.34" />
      <circle cx="204" cy="204" r="18" fill="#FFFFFF" opacity="0.38" />
    </svg>
  );
}
