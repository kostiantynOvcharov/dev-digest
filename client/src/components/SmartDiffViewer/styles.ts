import type { CSSProperties } from "react";

/** Co-located styles for the SmartDiffViewer. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 22 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "0 2px",
  } satisfies CSSProperties,
  dot: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),
  roleLabel: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  roleDesc: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  fileCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  empty: {
    padding: 24,
    fontSize: 14,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
} as const;
