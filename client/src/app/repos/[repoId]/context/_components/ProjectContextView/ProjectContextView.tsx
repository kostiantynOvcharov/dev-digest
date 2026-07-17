/* ProjectContextView — /repos/:repoId/context (WORKSPACE › Project Context).
   Owns the AppShell chrome, the active-repo resolution and the data hooks, then
   delegates all rendering to the pure <ProjectContextBody>. Mirrors the
   ConventionsView wrapper pattern. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import {
  useContextDocs,
  useContextIndexState,
  useDocContent,
  useReindexContext,
} from "@/lib/hooks/context";
import { ProjectContextBody } from "../ProjectContextBody";

export function ProjectContextView() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;

  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const toast = useToast();

  const docsQuery = useContextDocs(repoId);
  const stateQuery = useContextIndexState(repoId);
  const reindex = useReindexContext(repoId);

  // Which doc is previewed drives a guarded content fetch (disabled until one is
  // selected). The body owns selection UI and reports it up via onSelectPath.
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const contentQuery = useDocContent(repoId, selectedPath);

  const repoName = activeRepo?.full_name ?? repoId;

  const onReindex = React.useCallback(() => {
    reindex.mutate(undefined, {
      onError: (e) =>
        toast.error(e instanceof ApiError ? e.message : t("reindexError")),
    });
  }, [reindex, toast, t]);

  const crumb = [
    { label: t("crumbWorkspace") },
    { label: repoName, mono: true },
    { label: t("crumbContext") },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const loadError = docsQuery.error ?? stateQuery.error;

  return (
    <AppShell crumb={crumb}>
      {/* Page gutter — AppFrame's <main> has no padding, so each page supplies its
          own. Keeps the content off the sidebar edge (left/right) with room to breathe. */}
      <div style={{ padding: "24px 32px 40px" }}>
        <ProjectContextBody
          docs={docsQuery.data}
        indexState={stateQuery.data}
        isLoading={docsQuery.isLoading || stateQuery.isLoading}
        isError={docsQuery.isError || stateQuery.isError}
        errorMessage={loadError instanceof ApiError ? loadError.message : undefined}
        onRetry={() => {
          docsQuery.refetch();
          stateQuery.refetch();
        }}
        onReindex={onReindex}
        reindexing={reindex.isPending}
        repoName={repoName}
        onSelectPath={setSelectedPath}
        docContent={contentQuery.data?.content ?? null}
        docContentLoading={contentQuery.isLoading}
        docContentError={contentQuery.isError}
      />
      </div>
    </AppShell>
  );
}
