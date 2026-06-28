/* hooks/conventions.ts — React Query hooks for the Conventions Extractor page.
   Mirrors hooks/skills.ts. All requests go through src/lib/api.ts.

   The vendored ConventionCandidate contract lacks the UI-only fields the page
   needs (status / category / line range), so we define a client-local type
   matching the frozen API contract here rather than importing from
   @devdigest/shared. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

export type ConventionStatus = "pending" | "accepted" | "rejected";

/** Client-local DTO mirroring the frozen `POST/GET /conventions` contract. */
export interface ConventionCandidate {
  id: string;
  repo_id: string;
  rule: string;
  category: string | null;
  evidence_path: string;
  evidence_snippet: string;
  evidence_start_line: number | null;
  evidence_end_line: number | null;
  confidence: number;
  status: ConventionStatus;
}

/** Composed (not-yet-persisted) skill draft from the repo's accepted candidates. */
export interface ConventionSkillDraft {
  name: string;
  description: string;
  type: "convention";
  body: string;
}

/** Persisted candidates for the page. */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** Run extraction (synchronous on the server) and refresh the list. */
export function useRunExtraction(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => {
      qc.setQueryData(["conventions", repoId], data);
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: { status?: ConventionStatus; rule?: string };
}

/** Accept/reject a candidate, or inline-edit its rule text. */
export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (updated) => {
      // The list is keyed by repo; patch the cached row in place, then refetch.
      qc.setQueryData<ConventionCandidate[]>(
        ["conventions", updated.repo_id],
        (prev) => prev?.map((c) => (c.id === updated.id ? updated : c)),
      );
      qc.invalidateQueries({ queryKey: ["conventions", updated.repo_id] });
    },
  });
}

/** Compose a merged skill draft from the repo's accepted candidates (no persist). */
export function useConventionSkillDraft(repoId: string | null | undefined) {
  return useMutation({
    mutationFn: () =>
      api.post<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
  });
}
