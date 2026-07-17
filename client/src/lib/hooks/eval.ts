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

/**
 * Ephemeral single-case run result (`POST /agents/:id/eval-run-case`). A
 * server-internal DTO — not part of the vendored contract barrel — so mirrored
 * here read-only, like `EvalRunGroupSummary` below. `actual_output` is the
 * produced findings array, or `{ error }` on model failure (metrics null then).
 */
export interface EvalRunCaseResult {
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  actual_output: unknown;
  duration_ms: number;
  cost_usd: number | null;
}

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
  history: (ownerKind: EvalOwnerKind, ownerId: string) =>
    ["eval-runs", ownerKind, ownerId] as const,
  dashboard: (ownerId?: string, ownerKind: EvalOwnerKind = "agent") =>
    ["eval-dashboard", ownerKind, ownerId ?? "__all__"] as const,
  compare: (a: string, b: string) => ["eval-compare", a, b] as const,
  seed: (findingId: string, decision: string) =>
    ["eval-case-seed", findingId, decision] as const,
};

/** Owner path segment for the run/history endpoints (`agents` | `skills`). */
const ownerPath = (ownerKind: EvalOwnerKind) => (ownerKind === "skill" ? "skills" : "agents");

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
 * Create an eval case from a fully-formed `EvalCaseInput` payload (the seed
 * flow: a decided finding is expanded server-side into a draft case the reviewer
 * tweaks before saving). POSTs the whole payload to `POST /eval-cases`. Like
 * `useCreateEvalCase` this is a PRIMARY action → toast both edges + refresh the
 * owner's list. Kept separate from `useCreateEvalCase` (which posts a bare
 * `{ finding_id }`) so the two call sites stay honest about what they send.
 */
export function useCreateEvalCaseFromInput(ownerKind: EvalOwnerKind, ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) => api.post<EvalCase>("/eval-cases", input),
    onSuccess: () => {
      notify.success("Eval case created.");
      qc.invalidateQueries({ queryKey: evalKeys.cases(ownerKind, ownerId) });
    },
    onError: (err) => {
      notify.error(err instanceof Error ? err.message : "Couldn't create the eval case.");
    },
  });
}

/**
 * Run ONE case ephemerally (`POST /{agents|skills}/:id/eval-run-case`) — nothing
 * is persisted, so there is NO cache invalidation and NO toast (the result
 * renders inline in the editor). Returns the single-case metrics +
 * `actual_output`. `ownerId` first, `ownerKind` optional (default "agent") so
 * existing agent call sites keep working.
 */
export function useRunEvalCase(ownerId: string, ownerKind: EvalOwnerKind = "agent") {
  return useMutation({
    mutationFn: (input: {
      input_diff: string;
      input_files: unknown;
      input_meta: unknown;
      expected_output: unknown;
    }) => api.post<EvalRunCaseResult>(`/${ownerPath(ownerKind)}/${ownerId}/eval-run-case`, input),
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
 * Run every case in an owner's set hermetically
 * (`POST /{agents|skills}/:id/eval-runs`) and return the `EvalRun` aggregate. A
 * PRIMARY action → toast on both edges, and invalidate the owner's history +
 * dashboards so the fresh run shows up. `ownerId` first, `ownerKind` optional
 * (default "agent") so existing agent call sites keep working.
 */
export function useRunEvals(ownerId: string, ownerKind: EvalOwnerKind = "agent") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRun>(`/${ownerPath(ownerKind)}/${ownerId}/eval-runs`),
    onSuccess: (run) => {
      notify.success(
        `Eval run complete — ${run.traces_passed}/${run.traces_total} case(s) passed.`,
      );
      qc.invalidateQueries({ queryKey: evalKeys.history(ownerKind, ownerId) });
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

/**
 * Seed a NOT-yet-persisted `EvalCaseInput` from a DECIDED finding
 * (`GET /eval-cases/seed`). The server expands the finding into a draft case
 * (name, input diff/files/meta, and the expected output implied by the
 * decision: accepted → must_find, dismissed → must_not_flag). No persistence —
 * the editor lets the reviewer tweak it and Save creates the real case.
 */
export function useEvalCaseSeed(
  findingId: string,
  decision: "accepted" | "dismissed",
  enabled: boolean,
) {
  return useQuery({
    queryKey: evalKeys.seed(findingId, decision),
    queryFn: () =>
      api.get<EvalCaseInput>(
        `/eval-cases/seed?finding_id=${encodeURIComponent(findingId)}&decision=${decision}`,
      ),
    enabled,
  });
}

/**
 * An owner's run history, grouped by `run_group_id`, newest first. `ownerId`
 * first, `ownerKind` optional (default "agent") so agent call sites are unchanged.
 */
export function useEvalRunHistory(
  ownerId: string | null | undefined,
  ownerKind: EvalOwnerKind = "agent",
) {
  return useQuery({
    queryKey: evalKeys.history(ownerKind, ownerId ?? ""),
    queryFn: () =>
      api.get<EvalRunGroupSummary[]>(`/${ownerPath(ownerKind)}/${ownerId}/eval-runs`),
    enabled: !!ownerId,
  });
}

/**
 * The eval dashboard — workspace overview (no `ownerId`), or one owner's detail
 * via `ownerId` (+ `owner_kind`). `ownerId` first, `ownerKind` optional (default
 * "agent"); the query key is distinct per (ownerId, ownerKind).
 */
export function useEvalDashboard(ownerId?: string | null, ownerKind: EvalOwnerKind = "agent") {
  return useQuery({
    queryKey: evalKeys.dashboard(ownerId ?? undefined, ownerKind),
    queryFn: () =>
      api.get<EvalDashboard>(
        ownerId
          ? `/eval-dashboard?owner_id=${encodeURIComponent(ownerId)}&owner_kind=${ownerKind}`
          : "/eval-dashboard",
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
