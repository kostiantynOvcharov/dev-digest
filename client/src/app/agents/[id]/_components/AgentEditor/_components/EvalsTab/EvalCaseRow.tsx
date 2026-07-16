/* EvalCaseRow — one row in the agent's eval-case list (AC-4). Shows the case
   name, its expectation summary ("expected 0" / "expected N findings"), the
   latest per-case pass/fail (or "never run"), and icon-only run / edit / delete
   actions — each with an `aria-label` for screen readers. Presentational: all
   data + handlers arrive as props. */
"use client";

import React from "react";
import { Badge, IconBtn } from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import { expectationSummary } from "@/lib/eval-format";

function StatusBadge({ run }: { run: EvalRunRecord | undefined }) {
  if (!run) return <Badge color="var(--text-muted)">never run</Badge>;
  if (run.pass === true) return <Badge color="var(--ok)">pass</Badge>;
  if (run.pass === false) return <Badge color="var(--crit)">fail</Badge>;
  return <Badge color="var(--warn)">errored</Badge>;
}

export function EvalCaseRow({
  evalCase,
  latestRun,
  onRun,
  onEdit,
  onDelete,
  busy,
}: {
  evalCase: EvalCase;
  latestRun: EvalRunRecord | undefined;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-elevated)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {evalCase.name}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{expectationSummary(evalCase)}</span>
      <StatusBadge run={latestRun} />
      <IconBtn icon="Play" label={`Run eval set for ${evalCase.name}`} onClick={onRun} />
      <IconBtn icon="Edit" label={`Edit ${evalCase.name}`} onClick={onEdit} />
      <IconBtn icon="Trash" label={`Delete ${evalCase.name}`} onClick={onDelete} danger />
      {busy && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>…</span>}
    </div>
  );
}
