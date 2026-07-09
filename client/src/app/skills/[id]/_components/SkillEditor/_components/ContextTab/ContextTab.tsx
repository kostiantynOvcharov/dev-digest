/* Context tab (skill editor) — attach/detach/reorder repo context docs for a
   skill (SPEC-01, Unit 7). A skill's attached docs are INHERITED by every agent
   that loads the skill (placed before the agent's own docs at assembly — D2).
   Mirrors the agent ContextTab; wires skill-scoped hooks into <ContextAttach>. */
"use client";

import React from "react";
import type { Skill } from "@devdigest/shared";
import { ContextAttach } from "@/components/ContextAttach";
import { useActiveRepo } from "@/lib/repo-context";
import { useSettings } from "@/lib/hooks/core";
import { DEFAULT_CONTEXT_TOKEN_WARN_THRESHOLD } from "@/lib/tokens";
import {
  useContextDocs,
  useSetSkillContextDocs,
  useSkillContextDocs,
} from "@/lib/hooks/context";

export function ContextTab({ skill }: { skill: Skill }) {
  const { repoId } = useActiveRepo();
  const { data: docs, isLoading: docsLoading } = useContextDocs(repoId);
  const { data: links, isLoading: linksLoading } = useSkillContextDocs(skill.id);
  const setDocs = useSetSkillContextDocs(skill.id);
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
