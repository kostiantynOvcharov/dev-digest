import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillModal. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" } satisfies CSSProperties,
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  unsaved: {
    fontSize: 12,
    color: "var(--warn)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginRight: "auto",
  } satisfies CSSProperties,
  bodyLabelRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between" } satisfies CSSProperties,
  tokenCount: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  loading: { padding: "48px 24px", textAlign: "center", color: "var(--text-secondary)", fontSize: 13 } satisfies CSSProperties,
  error: { padding: "24px", color: "var(--danger, var(--text-secondary))", fontSize: 13 } satisfies CSSProperties,
} as const;
