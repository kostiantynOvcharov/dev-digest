"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { Card, SectionLabel, Badge, Icon, Skeleton, EmptyState, ErrorState } from "@devdigest/ui";
import type { BlastPriorPr } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useBlastRadius } from "@/lib/hooks/blast";
import { BlastTree } from "../BlastTree";
import { s } from "./styles";

interface BlastCardProps {
  prId: string | null;
  /** owner/repo for github deep-links; null until the repo loads. */
  repoFullName: string | null;
  /** PR head sha — pins caller links to the right lines. */
  headSha: string | null;
}

/**
 * Blast Radius card — the PR impact map ("what can these changes break?"),
 * shown in the Overview tab beside Intent. Read straight from the pre-built
 * repo-intel index (no model call): changed symbols → callers (`file:line`,
 * click opens the code) → impacted endpoints/crons.
 */
export function BlastCard({ prId, repoFullName, headSha }: BlastCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, error, refetch } = useBlastRadius(prId);

  if (!prId) return null;

  const statusBadge = renderStatusBadge(data?.status, t);

  return (
    <section>
      <Card>
        <SectionLabel icon="GitBranch" right={statusBadge ?? undefined}>
          {t("title")}
        </SectionLabel>

        {isLoading && !data ? (
          <Skeleton height={160} />
        ) : isError ? (
          <ErrorState
            title={t("error")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : !data || data.status === "none" || data.counts.symbols === 0 ? (
          <EmptyState icon="GitBranch" title={t("empty.title")} body={t("empty.body")} />
        ) : (
          <>
            <div style={s.statRow}>
              <Stat n={data.counts.symbols} label={t("stat.symbols")} />
              <Stat n={data.counts.callers} label={t("stat.callers")} />
              <Stat n={data.counts.endpoints} label={t("stat.endpoints")} />
              {data.counts.crons > 0 && <Stat n={data.counts.crons} label={t("stat.crons")} />}
              {data.reason && data.degraded && <span style={s.reason}>{data.reason}</span>}
            </div>
            <BlastTree blast={data} repoFullName={repoFullName} headSha={headSha} />
            <PriorPrs prs={data.prior_prs} />
          </>
        )}
      </Card>
    </section>
  );
}

/** Collapsible "prior PRs touching these files" — each row opens that PR. */
function PriorPrs({ prs }: { prs: BlastPriorPr[] }) {
  const t = useTranslations("blast");
  const router = useRouter();
  const { repoId } = useParams<{ repoId: string }>();
  const [open, setOpen] = React.useState(false);

  if (prs.length === 0) return null;
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div style={s.priorWrap}>
      <button style={s.priorHeader} onClick={() => setOpen((o) => !o)}>
        <Icon.Clock size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={s.priorLabel}>{t("priorPrs")}</span>
        <span style={s.priorCount}>{prs.length}</span>
        <Chevron size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      </button>
      {open && (
        <div style={s.priorList}>
          {prs.map((pr) => (
            <button
              key={pr.id}
              style={s.priorRow}
              onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
            >
              <span className="mono" style={s.priorNum}>
                #{pr.number}
              </span>
              <span style={s.priorTitle}>{pr.title}</span>
              <span style={s.priorStatus}>{pr.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span style={s.stat}>
      <span className="tnum" style={s.statNum}>
        {n}
      </span>
      {label}
    </span>
  );
}

/** Amber badge for a non-`full` index; nothing when the index is complete. */
function renderStatusBadge(
  status: string | undefined,
  t: ReturnType<typeof useTranslations>,
): React.ReactNode {
  if (!status || status === "full" || status === "none") return null;
  const label =
    status === "partial"
      ? t("status.partial")
      : status === "failed"
        ? t("status.failed")
        : t("status.degraded");
  return (
    <Badge icon="AlertTriangle" color="var(--warn)" bg="transparent">
      {label}
    </Badge>
  );
}
