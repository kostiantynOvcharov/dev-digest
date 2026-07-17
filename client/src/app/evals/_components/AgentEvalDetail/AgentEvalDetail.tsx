/* AgentEvalDetail — one agent's eval detail on the Eval Dashboard (AC-11/AC-12
   UI). Metric cards with trend, a METRIC TREND chart WITH a text/table
   alternative for a11y, a RECENT RUNS table whose checkboxes pick two runs to
   Compare, and a regression-alert banner (`aria-live="polite"`). Data lives in
   hooks; selection of the two compared runs is transient UI state. */
"use client";

import React from "react";
import { Button, Card, LineChart, MetricCard, Skeleton, type ChartSeries } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { formatCost } from "@/lib/cost";
import { useEvalDashboard, useEvalRunHistory } from "@/lib/hooks/eval";
import { pct } from "@/lib/eval-format";
import { CompareModal } from "../CompareModal";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AgentEvalDetail({ agent }: { agent: Agent }) {
  const dashQuery = useEvalDashboard(agent.id);
  const historyQuery = useEvalRunHistory(agent.id);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState<[string, string] | null>(null);

  const dash = dashQuery.data;
  const history = historyQuery.data ?? [];
  const trend = dash?.trend ?? [];
  const current = dash?.current;
  const delta = dash?.delta;

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 2 ? [...prev, id] : [prev[1]!, id],
    );

  const series: ChartSeries[] = [
    { name: "recall", color: "var(--accent)", data: trend.map((p) => p.recall) },
    { name: "precision", color: "var(--ok)", data: trend.map((p) => p.precision) },
    { name: "citation", color: "var(--warn)", data: trend.map((p) => p.citation_accuracy) },
  ];
  const trendOf = (key: "recall" | "precision" | "citation_accuracy") =>
    trend.length > 1 ? trend.map((p) => p[key]) : undefined;

  if (dashQuery.isLoading) return <Skeleton height={320} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {dash?.alert && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderRadius: 8,
            border: "1px solid var(--crit)",
            background: "var(--crit-bg)",
            color: "var(--crit)",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {dash.alert}
        </div>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <MetricCard label="RECALL" value={pct(current?.recall)} delta={delta?.recall} trend={trendOf("recall")} color="var(--accent)" />
        <MetricCard label="PRECISION" value={pct(current?.precision)} delta={delta?.precision} trend={trendOf("precision")} color="var(--ok)" />
        <MetricCard label="CITATION ACCURACY" value={pct(current?.citation_accuracy)} delta={delta?.citation_accuracy} trend={trendOf("citation_accuracy")} color="var(--warn)" />
        <MetricCard label="TRACES PASSED" value={`${current?.traces_passed ?? 0}/${current?.traces_total ?? 0}`} />
      </div>

      <section aria-label="Metric trend">
        <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.03em", marginBottom: 10 }}>
          METRIC TREND
        </h3>
        {trend.length === 0 ? (
          <Card><span style={{ fontSize: 13, color: "var(--text-muted)" }}>No runs yet.</span></Card>
        ) : (
          <>
            <LineChart series={series} />
            {/* Text/table alternative to the chart for a11y (WCAG 2.1 AA). */}
            <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse", fontSize: 12.5 }}>
              <caption style={{ textAlign: "left", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                Metric trend as a table (chart alternative)
              </caption>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                  <th style={th}>Run</th>
                  <th style={th}>Recall</th>
                  <th style={th}>Precision</th>
                  <th style={th}>Citation</th>
                  <th style={th}>Pass rate</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((p, i) => (
                  <tr key={`${p.ran_at}-${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>{fmtDate(p.ran_at)}</td>
                    <td style={td}>{pct(p.recall)}</td>
                    <td style={td}>{pct(p.precision)}</td>
                    <td style={td}>{pct(p.citation_accuracy)}</td>
                    <td style={td}>{pct(p.pass_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section aria-label="Recent runs">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.03em" }}>RECENT RUNS</h3>
          <Button
            kind="secondary"
            size="sm"
            icon="BarChart"
            disabled={selected.length !== 2}
            onClick={() => selected.length === 2 && setComparing([selected[0]!, selected[1]!])}
            style={{ marginLeft: "auto" }}
          >
            Compare
          </Button>
        </div>
        {historyQuery.isLoading ? (
          <Skeleton height={140} />
        ) : history.length === 0 ? (
          <Card><span style={{ fontSize: 13, color: "var(--text-muted)" }}>No runs yet.</span></Card>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 12 }}>
                <th style={th} aria-label="Select" />
                <th style={th}>Version</th>
                <th style={th}>When</th>
                <th style={th}>Recall</th>
                <th style={th}>Precision</th>
                <th style={th}>Citation</th>
                <th style={th}>Pass</th>
                <th style={th}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {history.map((g) => (
                <tr key={g.run_group_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={selected.includes(g.run_group_id)}
                      onChange={() => toggle(g.run_group_id)}
                      aria-label={`Select run v${g.agent_version} from ${fmtDate(g.ran_at)} to compare`}
                    />
                  </td>
                  <td style={td}>v{g.agent_version}</td>
                  <td style={td}>{fmtDate(g.ran_at)}</td>
                  <td style={td}>{pct(g.recall)}</td>
                  <td style={td}>{pct(g.precision)}</td>
                  <td style={td}>{pct(g.citation_accuracy)}</td>
                  <td style={td}>{g.traces_passed}/{g.traces_total}</td>
                  <td style={td}>{formatCost(g.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {comparing && (
        <CompareModal aRunGroupId={comparing[0]} bRunGroupId={comparing[1]} onClose={() => setComparing(null)} />
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px", color: "var(--text-primary)" };
