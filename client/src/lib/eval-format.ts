/* eval-format.ts — pure, generic formatting/derivation helpers for the eval
   pipeline UI (SPEC-04). No React, no I/O — safe to unit-test in isolation and
   reuse across the Evals tab and the Eval Dashboard page. */

import type { EvalCase, EvalRunRecord } from "@devdigest/shared";

/** A metric in [0,1] as a whole-percent string ("87%"); "—" when unknown. */
export function pct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

/** A signed delta in [-1,1] as points ("+5 pts" / "−3 pts" / "0 pts"). */
export function deltaPts(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const pts = Math.round(value * 100);
  const sign = pts > 0 ? "+" : pts < 0 ? "−" : "";
  return `${sign}${Math.abs(pts)} pts`;
}

/**
 * How many findings a case expects. `must_find` ⇔ non-empty `expected_output`
 * array; `must_not_flag` ⇔ empty array (SPEC-04 D1). Anything non-array counts
 * as 0 (guarded case) — never throws on user-authored JSON.
 */
export function expectedCount(expectedOutput: unknown): number {
  return Array.isArray(expectedOutput) ? expectedOutput.length : 0;
}

/** Human summary of a case's expectation: "expected 0" / "expected N finding(s)". */
export function expectationSummary(c: Pick<EvalCase, "expected_output">): string {
  const n = expectedCount(c.expected_output);
  if (n === 0) return "expected 0";
  return `expected ${n} finding${n === 1 ? "" : "s"}`;
}

/** Whether a case is a `must_not_flag` guard (empty expected set). */
export function isMustNotFlag(c: Pick<EvalCase, "expected_output">): boolean {
  return expectedCount(c.expected_output) === 0;
}

/** One line of a two-prompt diff. */
export interface DiffLine {
  text: string;
  kind: "context" | "added" | "removed";
}

/**
 * A minimal LCS line diff of two system-prompt snapshots (AC-10). Deterministic
 * and pure — the same two stored prompts always produce the same diff. Added
 * lines (present in `b`, not `a`) are `"added"`; removed lines `"removed"`.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ text: A[i]!, kind: "context" });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ text: A[i]!, kind: "removed" });
      i++;
    } else {
      out.push({ text: B[j]!, kind: "added" });
      j++;
    }
  }
  while (i < n) out.push({ text: A[i++]!, kind: "removed" });
  while (j < m) out.push({ text: B[j++]!, kind: "added" });
  return out;
}

/**
 * Latest per-case run keyed by `case_id`, resolved by `ran_at` (most recent
 * wins). Runs arrive newest-first from the API but we do not rely on order.
 */
export function latestRunByCase(
  runs: EvalRunRecord[] | undefined,
): Map<string, EvalRunRecord> {
  const map = new Map<string, EvalRunRecord>();
  for (const r of runs ?? []) {
    const prev = map.get(r.case_id);
    if (!prev || r.ran_at > prev.ran_at) map.set(r.case_id, r);
  }
  return map;
}
