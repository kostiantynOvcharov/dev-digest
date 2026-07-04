import type React from "react";

export const s = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  node: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  },
  nodeHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "10px 12px",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left" as const,
    color: "var(--text-primary)",
  },
  chevron: {
    color: "var(--text-muted)",
    flexShrink: 0,
    display: "inline-flex",
  },
  symbolName: {
    fontSize: 13.5,
    fontWeight: 600,
  },
  callerCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap" as const,
  },
  body: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    padding: "2px 12px 12px 30px",
  },
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
  },
  callerArrow: {
    color: "var(--text-muted)",
    flexShrink: 0,
  },
  badges: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
    marginTop: 4,
  },
  none: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
  },
} satisfies Record<string, React.CSSProperties>;
