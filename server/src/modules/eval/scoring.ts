import type { Finding } from '@devdigest/shared';

/**
 * Pure eval scoring — the I/O-free metric core of the eval pipeline.
 *
 * Mirrors the purity of `reviewer-core/src/grounding.ts`: NO container, NO
 * Drizzle, NO provider/LLM import. All three metrics are computed from the
 * produced + expected findings (plus the engine's kept/dropped counts) alone,
 * so `verify:l06` runs without Docker/Postgres (AC-8: zero LLM calls).
 *
 * Match rule (AC-7): a produced finding MATCHES an expected one only when the
 * file path is EQUAL and their `[start_line, end_line]` ranges OVERLAP.
 */

/** The subset of a `Finding` needed to locate it in a file (for matching). */
export type FindingLocation = Pick<Finding, 'file' | 'start_line' | 'end_line'>;

/**
 * An expected finding in an eval case (the `must_find` target). Reuses the
 * `Finding` subset rather than redefining the shape. A `must_not_flag` case
 * carries an empty `expected` set.
 */
export type ExpectedFinding = Pick<
  Finding,
  'file' | 'start_line' | 'end_line' | 'severity' | 'category' | 'title'
>;

/** The three code-computed eval metrics, each in `[0, 1]`. */
export interface Scores {
  recall: number;
  precision: number;
  citation_accuracy: number;
}

/** Two `[start_line, end_line]` ranges overlap iff `a.start <= b.end && b.start <= a.end`. */
function rangesOverlap(a: FindingLocation, b: FindingLocation): boolean {
  const aStart = Math.min(a.start_line, a.end_line);
  const aEnd = Math.max(a.start_line, a.end_line);
  const bStart = Math.min(b.start_line, b.end_line);
  const bEnd = Math.max(b.start_line, b.end_line);
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * A produced finding matches an expected one when the file path is equal AND
 * their line ranges overlap.
 */
export function matchFindings(produced: FindingLocation, expected: FindingLocation): boolean {
  return produced.file === expected.file && rangesOverlap(produced, expected);
}

/**
 * citation_accuracy = kept / (kept + dropped). Zero-denominator convention:
 * an empty produced set (kept + dropped === 0) scores 1 (nothing to ground).
 */
export function citationAccuracy(keptCount: number, droppedCount: number): number {
  const total = keptCount + droppedCount;
  return total === 0 ? 1 : keptCount / total;
}

/**
 * Compute the three eval metrics for a single case.
 *
 * - recall = fraction of `must_find` expected findings matched by ≥1 produced.
 * - precision = fraction of produced findings that match ≥1 expected.
 * - citation_accuracy = kept / (kept + dropped).
 *
 * Zero-denominator convention (never let `0/0 = NaN` escape):
 * - produced set empty → precision = 1 (nothing wrong flagged).
 * - no `must_find` expectations → recall = 1 (nothing was required).
 * - kept + dropped === 0 → citation_accuracy = 1 (nothing to ground).
 */
export function score(
  produced: readonly FindingLocation[],
  expected: readonly ExpectedFinding[],
  keptCount: number,
  droppedCount: number,
): Scores {
  const recall =
    expected.length === 0
      ? 1
      : expected.filter((e) => produced.some((p) => matchFindings(p, e))).length / expected.length;

  const precision =
    produced.length === 0
      ? 1
      : produced.filter((p) => expected.some((e) => matchFindings(p, e))).length / produced.length;

  return {
    recall,
    precision,
    citation_accuracy: citationAccuracy(keptCount, droppedCount),
  };
}

/**
 * Per-case pass rule: pass iff ALL expected findings are matched AND there are
 * zero unexpected/noise produced findings. For a `must_not_flag` case (empty
 * `expected`), ANY produced finding is noise → fail.
 */
export function passCase(
  produced: readonly FindingLocation[],
  expected: readonly ExpectedFinding[],
): boolean {
  const allExpectedMatched = expected.every((e) => produced.some((p) => matchFindings(p, e)));
  const noNoise = produced.every((p) => expected.some((e) => matchFindings(p, e)));
  return allExpectedMatched && noNoise;
}
