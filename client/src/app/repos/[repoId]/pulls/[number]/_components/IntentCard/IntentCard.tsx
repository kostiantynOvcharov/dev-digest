"use client";

import React from "react";
import { Card, SectionLabel, Button, Icon, Skeleton } from "@devdigest/ui";
import { usePrIntent, useComputeIntent } from "@/lib/hooks/intent";

interface IntentCardProps {
  prId: string | null;
}

/**
 * Intent Layer card — shows how the machine understood the PR's motivation +
 * scope BEFORE you read the review. "Generate" derives it on first use;
 * "Recompute" re-derives it after the PR changes (the intent is per-PR).
 */
export function IntentCard({ prId }: IntentCardProps) {
  const { data: intent, isLoading } = usePrIntent(prId);
  const compute = useComputeIntent(prId);

  if (!prId) return null;

  const recomputeBtn = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      loading={compute.isPending}
      disabled={compute.isPending}
      onClick={() => compute.mutate()}
    >
      {intent ? "Recompute" : "Generate"}
    </Button>
  );

  return (
    <section>
      <Card>
        <SectionLabel icon="Target" right={recomputeBtn}>
          Intent
        </SectionLabel>

        {isLoading && !intent ? (
          <Skeleton />
        ) : !intent ? (
          <p style={st.empty}>
            No intent derived yet. Generate one to see how the reviewer understands this PR.
          </p>
        ) : (
          <>
            <p style={st.summary}>&ldquo;{intent.intent}&rdquo;</p>
            <div style={st.columns}>
              <ScopeList
                title="In scope"
                items={intent.in_scope}
                icon="CheckCircle"
                color="var(--success, #3fb950)"
              />
              <ScopeList
                title="Out of scope"
                items={intent.out_of_scope}
                icon="XCircle"
                color="var(--text-muted)"
              />
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

function ScopeList({
  title,
  items,
  icon,
  color,
}: {
  title: string;
  items: string[];
  icon: "CheckCircle" | "XCircle";
  color: string;
}) {
  const I = Icon[icon];
  return (
    <div style={st.column}>
      <div style={st.columnTitle}>{title}</div>
      {items.length === 0 ? (
        <div style={st.none}>None specified</div>
      ) : (
        <ul style={st.list}>
          {items.map((item, i) => (
            <li key={i} style={st.item}>
              <I size={13} style={{ color, flexShrink: 0, marginTop: 2 }} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const st = {
  empty: {
    fontSize: 13.5,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
  summary: {
    fontSize: 14,
    fontStyle: "italic",
    color: "var(--text-secondary)",
    lineHeight: 1.55,
    marginBottom: 18,
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 24,
  },
  column: {},
  columnTitle: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    marginBottom: 10,
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  item: {
    display: "flex",
    gap: 8,
    fontSize: 13.5,
    color: "var(--text-secondary)",
    lineHeight: 1.45,
  },
  none: {
    fontSize: 13,
    color: "var(--text-muted)",
  },
} satisfies Record<string, React.CSSProperties>;
