/* hooks/eval.ts — Eval pipeline (SPEC-04) hooks. Turn a DECIDED finding into a
   persisted eval case; the server derives owner/diff/expected/meta from the
   finding (tenancy-checked). This module is the home for the eval hooks — later
   units add the list/run/dashboard/compare hooks alongside `useCreateEvalCase`. */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { notify } from "../toast";
import type { EvalCase } from "@devdigest/shared";

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
      qc.invalidateQueries({ queryKey: ["eval-cases", created.owner_kind, created.owner_id] });
    },
    onError: (err) => {
      notify.error(err instanceof Error ? err.message : "Couldn't create the eval case.");
    },
  });
}
