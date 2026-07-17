/* AllAgentsOverview — the Eval Dashboard's all-agents view (AC-11 UI).

   A per-agent list (recall / precision / citation + "Last run vN · date · X/Y
   pass" + a trend sparkline), each opening that agent's detail, plus a "RECENT
   EVAL RUNS · ALL AGENTS" list. Per-agent metrics come from one dashboard query
   per agent (shared cache with the detail view); the recent-runs list comes from
   the workspace-wide dashboard. Metric values are TEXT, not colour-only. */
"use client";

import React from "react";
import { Badge, Card, EmptyState, Skeleton, Sparkline } from "@devdigest/ui";
import type { Agent, EvalDashboard, EvalRunRecord } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEvalDashboards, useEvalDashboard } from "@/lib/hooks/eval";
import { pct } from "@/lib/eval-format";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 74 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.03em" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function AgentEvalCard({
  agent,
  dash,
  onSelect,
}: {
  agent: Agent;
  dash: EvalDashboard | undefined;
  onSelect: () => void;
}) {
  const c = dash?.current;
  const latest = dash?.recent_runs?.[0];
  const trend = dash?.trend ?? [];
  const lastRunLabel = latest
    ? `Last run v${latest.agent_version} · ${fmtDate(latest.ran_at)} · ${c?.traces_passed ?? 0}/${c?.traces_total ?? 0} pass`
    : "Never run";
  return (
    <Card hover onClick={onSelect} style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{agent.name}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{lastRunLabel}</div>
      </div>
      <Metric label="RECALL" value={pct(c?.recall)} />
      <Metric label="PRECISION" value={pct(c?.precision)} />
      <Metric label="CITATION" value={pct(c?.citation_accuracy)} />
      {trend.length > 1 ? (
        <Sparkline data={trend.map((p) => p.precision)} color="var(--ok)" />
      ) : (
        <Badge color="var(--text-muted)">no trend</Badge>
      )}
    </Card>
  );
}

function RecentRunRow({ run }: { run: EvalRunRecord }) {
  const color = run.pass === true ? "var(--ok)" : run.pass === false ? "var(--crit)" : "var(--warn)";
  const label = run.pass === true ? "pass" : run.pass === false ? "fail" : "errored";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
      <Badge color={color}>{label}</Badge>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {run.case_name ?? run.case_id}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>v{run.agent_version}</span>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{fmtDate(run.ran_at)}</span>
    </div>
  );
}

export function AllAgentsOverview({ onSelect }: { onSelect: (agentId: string) => void }) {
  const agentsQuery = useAgents();
  const agents = React.useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const dashboards = useAgentEvalDashboards(agents.map((a) => a.id));
  const workspace = useEvalDashboard();

  if (agentsQuery.isLoading) return <Skeleton height={280} />;
  if (agents.length === 0) {
    return <EmptyState icon="Cpu" title="No agents yet" body="Create an agent to start capturing eval cases and runs." />;
  }

  const recentRuns = workspace.data?.recent_runs ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section aria-label="Agents">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {agents.map((a, i) => (
            <AgentEvalCard key={a.id} agent={a} dash={dashboards[i]?.data} onSelect={() => onSelect(a.id)} />
          ))}
        </div>
      </section>

      <section aria-label="Recent eval runs across all agents">
        <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.03em", marginBottom: 8 }}>
          RECENT EVAL RUNS · ALL AGENTS
        </h2>
        {workspace.isLoading ? (
          <Skeleton height={120} />
        ) : recentRuns.length === 0 ? (
          <Card><span style={{ fontSize: 13, color: "var(--text-muted)" }}>No eval runs yet.</span></Card>
        ) : (
          <Card>
            {recentRuns.map((r) => (
              <RecentRunRow key={r.id} run={r} />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
