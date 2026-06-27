import type { CSSProperties } from "react";

/** Co-located styles for the skill VersionsTab. */
export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 18px" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  rowHead: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" } satisfies CSSProperties,
  versionBadge: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 6,
    background: "var(--bg-hover)",
    color: "var(--accent-text)",
  } satisfies CSSProperties,
  date: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  rowActions: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  body: {
    margin: 0,
    padding: 14,
    borderTop: "1px solid var(--border)",
    background: "var(--bg-primary)",
    fontSize: 12.5,
    lineHeight: 1.5,
    fontFamily: "var(--font-mono, monospace)",
    whiteSpace: "pre-wrap",
    maxHeight: 320,
    overflow: "auto",
  } satisfies CSSProperties,
} as const;
