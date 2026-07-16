/* hooks/eval.ts — Eval pipeline (SPEC-04) hooks. Turn a DECIDED finding into a
   persisted eval case; list an owner's cases; run all of an agent's cases
   hermetically; read run history, the dashboard, and a two-run comparison.

   All API access goes through `api.*` (src/lib/api.ts) and every server type is
   consumed from `@devdigest/shared` — never hand-duplicated. The two aggregation
   responses below (`EvalRunGroupSummary`, `EvalCompare`) are server-internal
   DTOs (module `eval/dashboard.ts`) that are NOT part of the vendored contract
   barrel, so their shapes are mirrored here as read-only client types. */
"use client";

import {
  useMutation,
  useQuery,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../api";
import { notify } from "../toast";
import type {
  EvalCase,
  EvalCaseInput,
  EvalDashboard,
  EvalOwnerKind,
  EvalRun,
} from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Server aggregation DTOs (mirror server/src/modules/eval/dashboard.ts). These
// are response shapes, not shared contracts — hence a local, read-only mirror.
// ---------------------------------------------------------------------------

/** One run group flattened for history + the Compare view. */
export interface EvalRunGroupSummary {
  run_group_id: string;
  ran_at: string;
  agent_version: number;
  recall: number;
  precision: number;
  citation_accuracy: number;
  cost_usd: number | null;
  traces_passed: number;
  traces_total: number;
  system_prompt: string;
}

/** Compare two run groups: four metric deltas + the two STORED prompt snapshots. */
export interface EvalCompare {
  a: EvalRunGroupSummary;
  b: EvalRunGroupSummary;
  /** old→new deltas (b − a). `cost_usd` null when either side has no cost. */
  delta: {
    recall: number;
    precision: number;
    citation_accuracy: number;
    cost_usd: number | null;
  };
  system_prompt_a: string;
  system_prompt_b: string;
}

// ---------------------------------------------------------------------------
// Query keys — one factory so mutations invalidate exactly what they touch.
// ---------------------------------------------------------------------------

export const evalKeys = {
  cases: (ownerKind: EvalOwnerKind, ownerId: string) =>
    ["eval-cases", ownerKind, ownerId] as const,
  history: (agentId: string) => ["eval-runs", agentId] as const,
  dashboard: (ownerId?: string) => ["eval-dashboard", ownerId ?? "__all__"] as const,
  compare: (a: string, b: string) => ["eval-compare", a, b] as const,
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create an eval case from an accepted/dismissed finding.
 * POSTs `{ finding_id }` to `POST /eval-cases` and returns the created case.
 * This is a PRIMARY user action → surface success + server errors as a toast
 * (mirrors `useGenerateBrief`), and refresh the owner's eval-case list so a
 * later Evals tab reflects the new case.
 */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<EvalCase>("/eval-cases", { finding_id: findingId }),
    onSuccess: (created) => {
      notify.success("Eval case created.");
      qc.invalidateQueries({ queryKey: evalKeys.cases(created.owner_kind, created.owner_id) });
    },
    onError: (err) => {
      notify.error(err instanceof Error ? err.message : "Couldn't create the eval case.");
    },
  });
}

/**
 * Replace a case's editable fields (`POST /eval-cases/:id`). The payload is
 * validated as `EvalCaseInput` at the API boundary; the studio editor also
 * `safeParse`s `expected_output` before calling this. Refreshes the owner list.
 */
export function useUpdateEvalCase(ownerKind: EvalOwnerKind, ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EvalCaseInput }) =>
      api.post<EvalCase>(`/eval-cases/${id}`, input),
    onSuccess: () => {
      notify.success("Eval case saved.");
      qc.invalidateQueries({ queryKey: evalKeys.cases(ownerKind, ownerId) });
    },
    onError: (err) => {
      notify.error(err instanceof Error ? err.message : "Couldn't save the eval case.");
    },
  });
}

/** Delete a case (`DELETE /eval-cases/:id`). Refreshes the owner list. */
export function useDeleteEvalCase(ownerKind: EvalOwnerKind, ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: () => {
      notify.success("Eval case deleted.");
      qc.invalidateQueries({ queryKey: evalKeys.cases(ownerKind, ownerId) });
    },
    onError: (err) => {
      notify.error(err instanceof Error ? err.message : "Couldn't delete the eval case.");
    },
  });
}

/**
 * Run every case in an agent's set hermetically (`POST /agents/:id/eval-runs`)
 * and return the `EvalRun` aggregate. A PRIMARY action → toast on both edges,
 * and invalidate the agent's history + dashboards so the fresh run shows up.
 */
export function useRunEvals(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRun>(`/agents/${agentId}/eval-runs`),
    onSuccess: (run) => {
      notify.success(
        `Eval run complete — ${run.traces_passed}/${run.traces_total} case(s) passed.`,
      );
      qc.invalidateQueries({ queryKey: evalKeys.history(agentId) });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
    },
    onError: (err) => {
      notify.error(err instanceof Error ? err.message : "The eval run failed.");
    },
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List every eval case owned by an owner (agent/skill). */
export function useEvalCases(ownerKind: EvalOwnerKind, ownerId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(ownerKind, ownerId ?? ""),
    queryFn: () =>
      api.get<EvalCase[]>(
        `/eval-cases?owner_kind=${ownerKind}&owner_id=${encodeURIComponent(ownerId ?? "")}`,
      ),
    enabled: !!ownerId,
  });
}

/** An agent's run history, grouped by `run_group_id`, newest first. */
export function useEvalRunHistory(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.history(agentId ?? ""),
    queryFn: () => api.get<EvalRunGroupSummary[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

/** The eval dashboard — workspace overview, or one agent's detail via `ownerId`. */
export function useEvalDashboard(ownerId?: string | null) {
  return useQuery({
    queryKey: evalKeys.dashboard(ownerId ?? undefined),
    queryFn: () =>
      api.get<EvalDashboard>(
        ownerId ? `/eval-dashboard?owner_id=${encodeURIComponent(ownerId)}` : "/eval-dashboard",
      ),
  });
}

/**
 * Per-agent dashboards, one query per id (the all-agents overview needs each
 * agent's latest metrics). Shares the same cache key as `useEvalDashboard`, so
 * opening an agent's detail reuses the already-fetched data both directions.
 */
export function useAgentEvalDashboards(agentIds: string[]) {
  return useQueries({
    queries: agentIds.map((id) => ({
      queryKey: evalKeys.dashboard(id),
      queryFn: () => api.get<EvalDashboard>(`/eval-dashboard?owner_id=${encodeURIComponent(id)}`),
    })),
  });
}

/** Compare two run groups (metric deltas + both stored prompt snapshots). */
export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(a ?? "", b ?? ""),
    queryFn: () =>
      api.get<EvalCompare>(
        `/eval-runs/compare?a=${encodeURIComponent(a ?? "")}&b=${encodeURIComponent(b ?? "")}`,
      ),
    enabled: !!a && !!b,
  });
}
