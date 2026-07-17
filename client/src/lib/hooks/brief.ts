/* hooks/brief.ts — Why+Risk Brief: read the cached PR brief + (re)generate it.
   The brief card synthesizes "what is this PR, why, how risky, what to read
   first" from deterministic inputs; Generate/Regenerate re-derives it against
   the current PR state (optionally seeded by a picked agent's specs). Mirrors
   `hooks/intent.ts` (usePrIntent / useComputeIntent). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { notify } from "../toast";
import type { BriefResponse } from "@devdigest/shared";

/** The cached Why+Risk brief for a PR, or null if none has been generated yet. */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-brief", prId],
    queryFn: () => api.get<BriefResponse | null>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/**
 * (Re)generate the brief now, optionally seeded by a review agent's attached
 * specs (`context_agent_id`; null → the server uses empty specs). This is a
 * PRIMARY action → surfaces server errors as a toast (AC-10).
 */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contextAgentId: string | null) =>
      api.post<BriefResponse>(`/pulls/${prId}/brief`, {
        context_agent_id: contextAgentId ?? undefined,
      }),
    onSuccess: (data) => {
      qc.setQueryData(["pr-brief", prId], data);
      qc.invalidateQueries({ queryKey: ["pr-brief", prId] });
    },
    onError: (err) => {
      notify.error(err instanceof Error ? err.message : "Couldn't generate the PR brief.");
    },
  });
}
