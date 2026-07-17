/* EvalsTab — the Skill editor's Evals tab (SPEC-04), at parity with the Agent
   editor's Evals tab.

   EVAL METRICS cards (recall / precision / citation accuracy with ▲/▼ deltas +
   traces passed) sourced from the skill's latest run, and the skill's eval-case
   list (name · expectation summary · latest per-case pass/fail or "never run")
   with per-row run/edit/delete and top-level "Run all evals" / "New eval case".

   KEY DIFFERENCE from the agent tab: skills have no PR-finding source, so the
   only way to author a case is manually — "New eval case" opens the shared
   `EvalCaseEditor` directly in CREATE mode. Data lives in hooks; the component
   stays declarative (no derived state in useState). */
"use client";

import React from "react";
import Link from "next/link";
import { Button, EmptyState, MetricCard, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useEvalCases, useEvalDashboard, useRunEvals, useDeleteEvalCase } from "@/lib/hooks/eval";
import { latestRunByCase, pct } from "@/lib/eval-format";
import { EvalCaseRow } from "@/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalCaseRow";
import { EvalCaseEditor } from "@/components/EvalCaseEditor";

const EMPTY_CASE = {
  name: "",
  input_diff: "",
  input_files: null,
  input_meta: null,
  expected_output: [],
} as const;

export function EvalsTab({ skill }: { skill: Skill }) {
  const casesQuery = useEvalCases("skill", skill.id);
  const dashQuery = useEvalDashboard(skill.id, "skill");
  const run = useRunEvals(skill.id, "skill");
  const del = useDeleteEvalCase("skill", skill.id);

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const cases = casesQuery.data ?? [];
  const dash = dashQuery.data;
  const latestByCase = latestRunByCase(dash?.recent_runs);
  const passing = cases.filter((c) => latestByCase.get(c.id)?.pass === true).length;
  const editing = cases.find((c) => c.id === editingId) ?? null;

  const current = dash?.current;
  const delta = dash?.delta;
  const trend = dash?.trend ?? [];
  const trendOf = (key: "recall" | "precision" | "citation_accuracy") =>
    trend.length > 1 ? trend.map((p) => p[key]) : undefined;

  const onDelete = (id: string, name: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete eval case "${name}"?`)) return;
    del.mutate(id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* --- EVAL METRICS ---------------------------------------------------- */}
      <section aria-label="Eval metrics">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>Eval metrics</h2>
          <Link
            href={`/evals?owner=${skill.id}`}
            style={{ marginLeft: "auto", fontSize: 13, color: "var(--accent)", textDecoration: "none" }}
          >
            View full dashboard →
          </Link>
        </div>
        {dashQuery.isLoading ? (
          <Skeleton height={110} />
        ) : (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <MetricCard label="RECALL" value={pct(current?.recall)} delta={delta?.recall} trend={trendOf("recall")} color="var(--accent)" />
            <MetricCard label="PRECISION" value={pct(current?.precision)} delta={delta?.precision} trend={trendOf("precision")} color="var(--ok)" />
            <MetricCard label="CITATION ACCURACY" value={pct(current?.citation_accuracy)} delta={delta?.citation_accuracy} trend={trendOf("citation_accuracy")} color="var(--warn)" />
            <MetricCard label="TRACES PASSED" value={`${current?.traces_passed ?? 0}/${current?.traces_total ?? 0}`} />
          </div>
        )}
      </section>

      {/* --- EVAL CASES ------------------------------------------------------ */}
      <section aria-label="Eval cases">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>
            Eval cases · {passing}/{cases.length} passing
          </h2>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <Button
              kind="secondary"
              size="sm"
              icon="FlaskConical"
              loading={run.isPending}
              disabled={cases.length === 0}
              onClick={() => run.mutate()}
            >
              Run all evals
            </Button>
            <Button kind="primary" size="sm" icon="Plus" onClick={() => setCreating(true)}>
              New eval case
            </Button>
          </div>
        </div>

        {casesQuery.isLoading ? (
          <Skeleton height={120} />
        ) : cases.length === 0 ? (
          <EmptyState
            icon="FlaskConical"
            title="No eval cases yet"
            body="Author an eval case to assert what this skill should (or should not) flag, then run the set here to measure regressions across skill versions."
            cta="New eval case"
            onCta={() => setCreating(true)}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cases.map((c) => (
              <EvalCaseRow
                key={c.id}
                evalCase={c}
                latestRun={latestByCase.get(c.id)}
                onRun={() => run.mutate()}
                onEdit={() => setEditingId(c.id)}
                onDelete={() => onDelete(c.id, c.name)}
                busy={del.isPending && del.variables === c.id}
              />
            ))}
          </div>
        )}
      </section>

      {creating && (
        <EvalCaseEditor
          mode="create"
          ownerKind="skill"
          ownerId={skill.id}
          title="New eval case"
          subtitle="Assert the expected output"
          initial={{ ...EMPTY_CASE }}
          onClose={() => setCreating(false)}
        />
      )}

      {editing && (
        <EvalCaseEditor
          mode="edit"
          editCaseId={editing.id}
          ownerKind="skill"
          ownerId={skill.id}
          title="Edit eval case"
          subtitle="Assert the expected output"
          initial={{
            name: editing.name,
            input_diff: editing.input_diff,
            input_files: editing.input_files,
            input_meta: editing.input_meta,
            expected_output: editing.expected_output,
          }}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
