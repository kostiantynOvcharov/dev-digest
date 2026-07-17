/* Context tab (agent editor) — attach/detach/reorder repo context docs for an
   agent (SPEC-01, Unit 7). Wires the active repo's discovered docs, the agent's
   current attachments and the persist mutation into the shared <ContextAttach>.
   Docs are attached by repo-relative PATH; order = the D2 injection order. */
"use client";

import React from "react";
import type { Agent } from "@devdigest/shared";
import { ContextAttach } from "@/components/ContextAttach";
import { useActiveRepo } from "@/lib/repo-context";
import { useSettings } from "@/lib/hooks/core";
import { DEFAULT_CONTEXT_TOKEN_WARN_THRESHOLD } from "@/lib/tokens";
import {
  useAgentContextDocs,
  useContextDocs,
  useSetAgentContextDocs,
} from "@/lib/hooks/context";

export function ContextTab({ agent }: { agent: Agent }) {
  const { repoId } = useActiveRepo();
  const { data: docs, isLoading: docsLoading } = useContextDocs(repoId);
  const { data: links, isLoading: linksLoading } = useAgentContextDocs(agent.id);
  const setDocs = useSetAgentContextDocs(agent.id);
  const { data: settings } = useSettings();

  const threshold = settings?.context_token_warn_threshold ?? DEFAULT_CONTEXT_TOKEN_WARN_THRESHOLD;

  return (
    <ContextAttach
      docs={docs}
      links={links}
      onChange={(paths) => setDocs.mutate(paths)}
      threshold={threshold}
      isLoading={docsLoading || linksLoading}
      noRepo={!repoId}
    />
  );
}
