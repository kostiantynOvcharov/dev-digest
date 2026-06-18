/* SeverityCounts — compact "icon + count" row for the non-zero severities of a
   finding set (CRITICAL → WARNING → SUGGESTION). Shared by the PR list FINDINGS
   column and the Agent-runs timeline. Renders nothing when there are no findings. */
"use client";

import React from "react";
import { SeverityBadge } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";

/** Display order; mirrors FindingsPanel SEVERITY_ORDER. */
const ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

export function countBySeverity(findings: FindingRecord[]): Record<Severity, number> {
  const acc: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) acc[f.severity] = (acc[f.severity] ?? 0) + 1;
  return acc;
}

export function SeverityCounts({ findings }: { findings: FindingRecord[] }) {
  const counts = countBySeverity(findings);
  const shown = ORDER.filter((s) => counts[s] > 0);
  if (shown.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {shown.map((s) => (
        <SeverityBadge key={s} severity={s} count={counts[s]} compact />
      ))}
    </span>
  );
}

export default SeverityCounts;
