/* SeverityFilterBar — PR-level "3 CRITICAL · 5 WARNING · 2 SUGGESTION" counter.
   Clicking a severity narrows the findings shown across every review run to that
   level; clicking the active one again clears the filter. A zero-count severity
   renders muted and non-clickable so it can't filter into an empty list. */
"use client";

import React from "react";
import { Chip, SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";

/** Severities in display order (mirrors FindingsPanel SEVERITY_ORDER). */
const ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

export function SeverityFilterBar({
  counts,
  active,
  onChange,
}: {
  counts: Record<Severity, number>;
  active: Severity | null;
  onChange: (s: Severity | null) => void;
}) {
  return (
    <div style={s.bar} role="group" aria-label="Filter findings by severity">
      {ORDER.map((sev, i) => {
        const sevToken = SEV[sev];
        const count = counts[sev] ?? 0;
        const isActive = active === sev;
        return (
          <React.Fragment key={sev}>
            {i > 0 && (
              <span aria-hidden style={s.sep}>
                ·
              </span>
            )}
            {count === 0 ? (
              <span style={s.empty}>
                {sevToken.label} {count}
              </span>
            ) : (
              <Chip
                icon={sevToken.icon}
                color={sevToken.c}
                count={count}
                active={isActive}
                onClick={() => onChange(isActive ? null : sev)}
              >
                {sevToken.label}
              </Chip>
            )}
          </React.Fragment>
        );
      })}
      {active && (
        <button type="button" style={s.clear} onClick={() => onChange(null)}>
          Clear
        </button>
      )}
    </div>
  );
}

const s = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  sep: { color: "var(--text-muted)", fontSize: 13 },
  empty: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-muted)",
    opacity: 0.6,
  },
  clear: {
    marginLeft: 4,
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 12.5,
    color: "var(--text-muted)",
    textDecoration: "underline",
  },
} satisfies Record<string, React.CSSProperties>;

export default SeverityFilterBar;
