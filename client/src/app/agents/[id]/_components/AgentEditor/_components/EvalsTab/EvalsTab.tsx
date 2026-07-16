/* EvalsTab — the Agent editor's Evals tab (SPEC-04, AC-2/AC-4 UI).

   EVAL METRICS cards (recall / precision / citation accuracy with ▲/▼ deltas +
   traces passed) sourced from the agent's latest run, a link to the full Eval
   Dashboard, and the agent's eval-case list (name · expectation summary · latest
   per-case pass/fail or "never run") with per-row run/edit/delete and top-level
   "Run all evals" / "New eval case" actions. Data lives in hooks; the component
   stays declarative (no derived state in useState). */
"use client";

import React from "react";
import Link from "next/link";
import { Button, EmptyState, MetricCard, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { notify } from "@/lib/toast";
import { useEvalCases, useEvalDashboard, useRunEvals, useDeleteEvalCase } from "@/lib/hooks/eval";
import { latestRunByCase, pct } from "@/lib/eval-format";
import { EvalCaseRow } from "./EvalCaseRow";
import { EvalCaseEditor } from "./EvalCaseEditor";

export function EvalsTab({ agent }: { agent: Agent }) {
  const casesQuery = useEvalCases("agent", agent.id);
  const dashQuery = useEvalDashboard(agent.id);
  const run = useRunEvals(agent.id);
  const del = useDeleteEvalCase("agent", agent.id);

  const [editingId, setEditingId] = React.useState<string | null>(null);

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
            href={`/evals?owner=${agent.id}`}
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
            <Button
              kind="primary"
              size="sm"
              icon="Plus"
              onClick={() =>
                notify.info("Create an eval case from a decided finding — use 'Turn into eval case' on a PR finding.")
              }
            >
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
            body="Turn a decided finding into an eval case from a PR (Accept → must_find, Dismiss → must_not_flag), then run the set here to measure regressions."
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

      {editing && <EvalCaseEditor agent={agent} evalCase={editing} onClose={() => setEditingId(null)} />}
    </div>
  );
}
