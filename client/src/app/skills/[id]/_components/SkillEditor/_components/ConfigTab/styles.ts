import type { CSSProperties } from "react";

/** Co-located styles for the skill ConfigTab. */
export const s = {
  wrap: { maxWidth: 820 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", marginBottom: 20 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  enabledLabel: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  bodyHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 4px",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  filename: { fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary)" } satisfies CSSProperties,
  unsaved: {
    padding: "1px 8px",
    borderRadius: 5,
    background: "var(--bg-hover)",
    color: "var(--text-secondary)",
    fontSize: 11.5,
  } satisfies CSSProperties,
  tokens: { marginLeft: "auto" } satisfies CSSProperties,
  actions: { display: "flex", gap: 10, marginTop: 14 } satisfies CSSProperties,
  savedNote: { alignSelf: "center", fontSize: 13, color: "var(--ok)" } satisfies CSSProperties,
} as const;
