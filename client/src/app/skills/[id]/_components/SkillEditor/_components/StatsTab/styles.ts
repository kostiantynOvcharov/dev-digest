import type { CSSProperties } from "react";

const card: CSSProperties = {
  padding: 16,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
};

/** Co-located styles for the skill StatsTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  metricsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  } satisfies CSSProperties,
  metric: card,
  metricLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metricValue: { fontSize: 28, fontWeight: 700, marginTop: 8 } satisfies CSSProperties,
  metricUnit: { fontSize: 14, fontWeight: 500, color: "var(--text-secondary)" } satisfies CSSProperties,
  panels: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } satisfies CSSProperties,
  panel: card,
  panelTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 14,
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  agentList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  } satisfies CSSProperties,
  agentName: { flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  open: { fontSize: 12, color: "var(--accent-text)" } satisfies CSSProperties,
} as const;
