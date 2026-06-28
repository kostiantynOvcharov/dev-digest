/* hooks/intent.ts — Intent Layer: read the stored PR intent + (re)compute it.
   The intent card shows how the machine understood the PR before you read the
   review; Recompute re-derives it after the PR changes. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { notify } from "../toast";
import type { Intent } from "@devdigest/shared";

/** The stored intent for a PR, or null if it hasn't been computed yet. */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-intent", prId],
    queryFn: () => api.get<Intent | null>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/** (Re)compute the intent now. PRIMARY action → surfaces server errors as a toast. */
export function useComputeIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Intent>(`/pulls/${prId}/intent/compute`),
    onSuccess: (data) => {
      qc.setQueryData(["pr-intent", prId], data);
      qc.invalidateQueries({ queryKey: ["pr-intent", prId] });
    },
    onError: (err) => {
      notify.error(err instanceof Error ? err.message : "Couldn't compute the PR intent.");
    },
  });
}
