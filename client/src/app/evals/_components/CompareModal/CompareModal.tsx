/* CompareModal — compare two eval run groups (SPEC-04, AC-10 UI).

   Shows the four metric deltas (recall / precision / citation / cost, old→new)
   and a diff of the two runs' STORED system-prompt snapshots with added lines
   highlighted. Rendered inside A11yModal, which traps focus, closes on Escape,
   and always offers a visible Close button. The prompt text is rendered as
   escaped React text (never dangerouslySetInnerHTML). */
"use client";

import React from "react";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { formatCost } from "@/lib/cost";
import { useEvalCompare } from "@/lib/hooks/eval";
import { diffLines, pct, deltaPts } from "@/lib/eval-format";
import { A11yModal } from "@/components/A11yModal";

function DeltaRow({ label, a, b, delta }: { label: string; a: string; b: string; delta: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
      <span className="tnum" style={{ fontSize: 13 }}>{a}</span>
      <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>{b}</span>
      <span className="tnum" style={{ fontSize: 13, color: "var(--text-muted)" }}>{delta}</span>
    </div>
  );
}

export function CompareModal({
  aRunGroupId,
  bRunGroupId,
  onClose,
}: {
  aRunGroupId: string;
  bRunGroupId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error, refetch } = useEvalCompare(aRunGroupId, bRunGroupId);

  return (
    <A11yModal
      title="Compare runs"
      subtitle={data ? `v${data.a.agent_version} → v${data.b.agent_version}` : undefined}
      onClose={onClose}
      width={760}
    >
      <div style={{ padding: 24 }}>
        {isLoading ? (
          <Skeleton height={220} />
        ) : isError || !data ? (
          <ErrorState
            title="Couldn’t load the comparison"
            body={error instanceof Error ? error.message : "The two runs could not be compared."}
            onRetry={() => refetch()}
          />
        ) : (
          <>
            <section aria-label="Metric deltas">
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 8, fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em", paddingBottom: 6, borderBottom: "1px solid var(--border-strong)" }}>
                <span>METRIC</span>
                <span>v{data.a.agent_version}</span>
                <span>v{data.b.agent_version}</span>
                <span>Δ</span>
              </div>
              <DeltaRow label="Recall" a={pct(data.a.recall)} b={pct(data.b.recall)} delta={deltaPts(data.delta.recall)} />
              <DeltaRow label="Precision" a={pct(data.a.precision)} b={pct(data.b.precision)} delta={deltaPts(data.delta.precision)} />
              <DeltaRow label="Citation accuracy" a={pct(data.a.citation_accuracy)} b={pct(data.b.citation_accuracy)} delta={deltaPts(data.delta.citation_accuracy)} />
              <DeltaRow
                label="Cost"
                a={formatCost(data.a.cost_usd)}
                b={formatCost(data.b.cost_usd)}
                delta={data.delta.cost_usd == null ? "—" : formatCost(data.delta.cost_usd)}
              />
            </section>

            <section aria-label="System prompt diff" style={{ marginTop: 22 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em", marginBottom: 8 }}>
                SYSTEM PROMPT DIFF
              </div>
              <PromptDiff a={data.system_prompt_a} b={data.system_prompt_b} />
            </section>
          </>
        )}
      </div>
    </A11yModal>
  );
}

function PromptDiff({ a, b }: { a: string; b: string }) {
  const lines = React.useMemo(() => diffLines(a, b), [a, b]);
  if (a === b) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Identical system prompts — no changes.</div>;
  }
  return (
    <pre
      className="mono"
      style={{
        margin: 0,
        padding: "10px 12px",
        borderRadius: 7,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        fontSize: 12.5,
        lineHeight: 1.5,
        maxHeight: 320,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {lines.map((ln, i) => (
        <div
          key={i}
          data-kind={ln.kind}
          style={{
            background: ln.kind === "added" ? "var(--ok-bg, rgba(46,160,67,.15))" : ln.kind === "removed" ? "var(--crit-bg)" : "transparent",
            color: ln.kind === "removed" ? "var(--text-muted)" : "var(--text-primary)",
            textDecoration: ln.kind === "removed" ? "line-through" : undefined,
          }}
        >
          <span style={{ userSelect: "none", opacity: 0.6 }}>
            {ln.kind === "added" ? "+ " : ln.kind === "removed" ? "- " : "  "}
          </span>
          {ln.text}
        </div>
      ))}
    </pre>
  );
}
