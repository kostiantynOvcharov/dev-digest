import type { CSSProperties } from "react";

export const s = {
  // PR Brief is the full-width hero at the top of the Overview.
  hero: {
    marginBottom: 24,
  } satisfies CSSProperties,
  // Intent + Blast Radius sit side-by-side below the brief, wrapping on narrow widths.
  twoCol: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 24,
    alignItems: "start",
    marginBottom: 24,
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
