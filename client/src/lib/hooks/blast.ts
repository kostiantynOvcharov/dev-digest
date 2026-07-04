/* hooks/blast.ts — Blast Radius: the PR impact map ("what can these changes
   break?"). Read straight from the pre-built repo-intel index — no model call,
   so this is a plain read-only query (no compute mutation). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse } from "@devdigest/shared";

/** The blast radius for a PR: changed symbols → callers → impacted endpoints. */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-blast", prId],
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
