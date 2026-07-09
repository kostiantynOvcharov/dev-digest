/* hooks/context.ts — React Query hooks for the Project Context feature (SPEC-01).
   All requests go through src/lib/api.ts; types come from @devdigest/shared.

   This file owns the Project Context PAGE's READ hooks (list docs, index-state,
   reindex). Unit 7 (agent/skill Context tabs) will ADD the attach/detach hooks
   (`useAgentContextDocs` / `useSetAgentContextDocs`, and the skill equivalents)
   here alongside these — the read hooks below are self-contained and do not need
   to be rewritten to accommodate them.

   NOTE: query keys are deliberately distinct from the pre-existing (dead)
   `useContextFiles`/`useReindexContext` scaffold in hooks/core.ts, which targets
   an OLD SpecFile contract on `/repos/:id/context`. These hooks use the real
   Unit 2 endpoints under `/repos/:id/context/{docs,index-state,reindex}`. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentContextLink,
  ContextIndexStatus,
  DiscoveredDoc,
  DocContent,
  SkillContextLink,
} from "@devdigest/shared";
import { api } from "../api";

const docsKey = (repoId: string | null | undefined) => ["context-docs", repoId] as const;
const indexStateKey = (repoId: string | null | undefined) =>
  ["context-index-state", repoId] as const;
const docContentKey = (
  repoId: string | null | undefined,
  path: string | null | undefined,
) => ["context-doc-content", repoId, path] as const;
const agentContextKey = (agentId: string | null | undefined) =>
  ["agent-context-docs", agentId] as const;
const skillContextKey = (skillId: string | null | undefined) =>
  ["skill-context-docs", skillId] as const;

/** Discovered markdown docs for a repo (path, type badge, size, used-by count). */
export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: docsKey(repoId),
    queryFn: () => api.get<DiscoveredDoc[]>(`/repos/${repoId}/context/docs`),
    enabled: !!repoId,
  });
}

/** Doc-index status: files count + last-indexed time only (NO chunk count, D8). */
export function useContextIndexState(repoId: string | null | undefined) {
  return useQuery({
    queryKey: indexStateKey(repoId),
    queryFn: () =>
      api.get<ContextIndexStatus>(`/repos/${repoId}/context/index-state`),
    enabled: !!repoId,
  });
}

/**
 * Raw markdown of one discovered doc, for the safe preview (AC-5). Disabled
 * until a doc is selected (no `path` → no request). The server reads the file
 * through a path-traversal guard and returns `{ path, content }`.
 */
export function useDocContent(
  repoId: string | null | undefined,
  path: string | null | undefined,
) {
  return useQuery({
    queryKey: docContentKey(repoId, path),
    queryFn: () =>
      api.get<DocContent>(
        `/repos/${repoId}/context/docs/content?path=${encodeURIComponent(path!)}`,
      ),
    enabled: !!repoId && !!path,
  });
}

/**
 * Trigger a synchronous rescan of the clone. On success we refresh both the doc
 * list and the index-state (the server replaces the snapshot + bumps the state).
 */
export function useReindexContext(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ContextIndexStatus>(`/repos/${repoId}/context/reindex`),
    onSuccess: (state) => {
      // The reindex response IS the fresh index-state — seed it directly, then
      // invalidate the doc list so the new snapshot is fetched.
      qc.setQueryData(indexStateKey(repoId), state);
      qc.invalidateQueries({ queryKey: indexStateKey(repoId) });
      qc.invalidateQueries({ queryKey: docsKey(repoId) });
    },
  });
}

// ---- Attach hooks (Unit 7): agent + skill Context tabs ----
// The POST body mirrors the skills "set the whole ordered set" shape
// (`{ paths }`); the server also accepts `{ path }` to link one, which the tab
// UI does not use. Responses are the ordered link lists with the `missing` flag.

/** Docs manually attached to an agent, in attach order (with `missing`). */
export function useAgentContextDocs(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentContextKey(agentId),
    queryFn: () => api.get<AgentContextLink[]>(`/agents/${agentId}/context`),
    enabled: !!agentId,
  });
}

/** Set / reorder the full ordered set of an agent's attached docs. */
export function useSetAgentContextDocs(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.post<AgentContextLink[]>(`/agents/${agentId}/context`, { paths }),
    onSuccess: (data) => {
      qc.setQueryData(agentContextKey(agentId), data);
      // The used-by count on the Project Context page depends on attachments.
      qc.invalidateQueries({ queryKey: ["context-docs"] });
    },
  });
}

/** Docs attached to a skill, in attach order (with `missing`). */
export function useSkillContextDocs(skillId: string | null | undefined) {
  return useQuery({
    queryKey: skillContextKey(skillId),
    queryFn: () => api.get<SkillContextLink[]>(`/skills/${skillId}/context`),
    enabled: !!skillId,
  });
}

/** Set / reorder the full ordered set of a skill's attached docs. */
export function useSetSkillContextDocs(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.post<SkillContextLink[]>(`/skills/${skillId}/context`, { paths }),
    onSuccess: (data) => {
      qc.setQueryData(skillContextKey(skillId), data);
      // A skill attachment is inherited by every agent that loads the skill.
      qc.invalidateQueries({ queryKey: ["context-docs"] });
    },
  });
}
