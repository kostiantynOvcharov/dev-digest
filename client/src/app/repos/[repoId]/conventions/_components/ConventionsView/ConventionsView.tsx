/* ConventionsView — /repos/:repoId/conventions.
   Header "Conventions in <repo>" + Re-scan button (runs extraction); the body
   branches loading→Skeleton / error→ErrorState / empty→EmptyState / list of
   ConventionCards. A "Create skill" button (enabled once ≥1 candidate is
   accepted) opens the merge modal. Mirrors the PR-list page structure. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import {
  useConventions,
  useRunExtraction,
  useUpdateConvention,
  type ConventionCandidate,
} from "@/lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { s } from "./styles";

const SKELETON_ROWS = 3;

export function ConventionsView() {
  const t = useTranslations("conventions.page");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;

  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const toast = useToast();

  const { data, isLoading, isError, error, refetch } = useConventions(repoId);
  const extract = useRunExtraction(repoId);
  const update = useUpdateConvention();
  const [modalOpen, setModalOpen] = React.useState(false);

  const repoName = activeRepo?.full_name ?? repoId;
  const candidates = data ?? [];
  const accepted = candidates.filter((c) => c.status === "accepted");
  // Which row currently has an in-flight mutation (disables only that card).
  const pendingId = update.isPending ? update.variables?.id : undefined;

  const runExtraction = () => {
    extract.mutate(undefined, {
      onError: (e) =>
        toast.error(e instanceof ApiError ? e.message : t("extractionFailed")),
    });
  };

  const setStatus = (c: ConventionCandidate, status: ConventionCandidate["status"]) => {
    // Toggle off when re-clicking the active state, mirroring the finding card.
    const next = c.status === status ? "pending" : status;
    update.mutate({ id: c.id, patch: { status: next } });
  };

  const editRule = (c: ConventionCandidate, rule: string) => {
    update.mutate({ id: c.id, patch: { rule } });
  };

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("crumbConventions") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const crumb = [
    { label: t("crumbLab") },
    { label: repoName, mono: true },
    { label: t("crumbConventions") },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>
            {t("headingPrefix")}
            {repoName}
          </h1>
          <p style={s.pageSubtitle}>{t("subtitle")}</p>
        </div>
        <div style={s.headerActions}>
          <Button
            kind="primary"
            icon="ListChecks"
            onClick={() => setModalOpen(true)}
            disabled={accepted.length === 0}
            title={accepted.length === 0 ? t("createSkillHint") : undefined}
          >
            {t("createSkill")}
          </Button>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={extract.isPending}
            disabled={extract.isPending}
            onClick={runExtraction}
          >
            {extract.isPending ? t("scanning") : t("rescan")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div style={s.loadingStack}>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} height={150} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title={t("loadError")}
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : candidates.length === 0 ? (
        <EmptyState
          icon="ListChecks"
          title={t("empty.title")}
          body={t("empty.body")}
          cta={t("empty.cta")}
          onCta={runExtraction}
          ctaLoading={extract.isPending}
        />
      ) : (
        <>
          <div style={s.countRow}>{t("candidateCount", { count: candidates.length })}</div>
          <div style={s.list}>
            {candidates.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                pending={pendingId === c.id}
                repoFullName={activeRepo?.full_name}
                defaultBranch={activeRepo?.default_branch}
                onAccept={() => setStatus(c, "accepted")}
                onReject={() => setStatus(c, "rejected")}
                onEditRule={(rule) => editRule(c, rule)}
              />
            ))}
          </div>
        </>
      )}

      {modalOpen && (
        <CreateSkillModal
          repoId={repoId}
          evidenceFiles={accepted.map((c) => c.evidence_path)}
          onClose={() => setModalOpen(false)}
        />
      )}
    </AppShell>
  );
}
