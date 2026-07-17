import type { CSSProperties } from "react";

/** Co-located styles for ConventionCard. */
export const s = {
  card: (muted: boolean): CSSProperties => ({
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "var(--bg-surface)",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    opacity: muted ? 0.62 : 1,
    transition: "opacity .15s",
  }),
  topRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    justifyContent: "space-between",
  } satisfies CSSProperties,
  ruleWrap: { flex: 1, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  rule: { fontSize: 14, fontWeight: 600, lineHeight: 1.45 } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  badgeCol: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    background: "var(--bg-hover)",
    borderRadius: 8,
    fontSize: 12.5,
    lineHeight: 1.5,
    overflowX: "auto",
    whiteSpace: "pre",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: 180,
  } satisfies CSSProperties,
  editRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
} as const;
