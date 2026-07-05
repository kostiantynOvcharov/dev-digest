import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView. */
export const s = {
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  pageTitle: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 } satisfies CSSProperties,
  pageSubtitle: { fontSize: 13.5, color: "var(--text-secondary)", margin: "6px 0 0", maxWidth: 620, lineHeight: 1.5 } satisfies CSSProperties,
  headerActions: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 } satisfies CSSProperties,
  countRow: { fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
} as const;
