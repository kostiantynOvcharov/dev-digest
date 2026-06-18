/* FindingsHoverCard — popover body listing a set of findings (title, category,
   file:line, confidence, rationale snippet), sorted most-severe first. Shared by
   the PR list FINDINGS column and the Agent-runs timeline; pair with HoverPopover. */
"use client";

import React from "react";
import { SeverityBadge, CategoryTag } from "@devdigest/ui";
import type { Category } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";

const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

function truncate(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

export function FindingsHoverCard({
  findings,
  title,
}: {
  findings: FindingRecord[];
  /** Header label; defaults to "{n} FINDINGS". */
  title?: string;
}) {
  const sorted = React.useMemo(
    () =>
      [...findings].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
      ),
    [findings],
  );
  if (sorted.length === 0) return null;
  const heading = title ?? `${sorted.length} FINDINGS`;

  return (
    <div>
      <div style={s.header}>{heading}</div>
      <div style={s.list}>
        {sorted.map((f) => (
          <div key={f.id} style={s.item}>
            <div style={s.titleRow}>
              <SeverityBadge severity={f.severity} compact />
              <span style={s.title}>{f.title}</span>
              <CategoryTag category={f.category as Category} />
            </div>
            <div style={s.meta}>
              <span className="mono" style={s.fileRef}>
                {f.file}:{f.start_line}
                {f.end_line !== f.start_line ? `-${f.end_line}` : ""}
              </span>
              <span style={s.conf}>● {Math.round(f.confidence * 100)}% conf</span>
            </div>
            {f.rationale && <div style={s.rationale}>{truncate(f.rationale)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

const s = {
  header: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 10,
  },
  list: { display: "flex", flexDirection: "column", gap: 14 },
  item: { display: "flex", flexDirection: "column", gap: 5 },
  titleRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" },
  meta: { display: "flex", alignItems: "center", gap: 10, fontSize: 12 },
  fileRef: { color: "var(--accent-text)" },
  conf: { color: "var(--text-muted)" },
  rationale: { fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45 },
} satisfies Record<string, React.CSSProperties>;

export default FindingsHoverCard;
