import type { EvalCase, FindingCategory, Severity } from '@devdigest/shared';
import type { ExpectedFinding } from './scoring.js';
import type { EvalCaseRow } from './repository.js';

/**
 * Pure helpers for the eval module — I/O-free transforms only (no container, no
 * Drizzle, no LLM). Two responsibilities:
 *
 *  1. Slice the finding's hunk (plus its own diff context) out of the file's
 *     `pr_files.patch`, under a per-fragment size cap — NOT the whole-file patch
 *     (spec D3 / AC-1).
 *  2. Derive an eval case's `expected_output` + `input_meta` from the source
 *     finding and the reviewer's accept/dismiss decision (spec D1 / AC-1):
 *       - accepted  → `must_find`     (expected_output lists the finding)
 *       - dismissed → `must_not_flag` (empty expected_output; guard in input_meta)
 *
 * Kept behaviour-pure so it is unit-testable without Docker/Postgres.
 */

/** Default number of characters a captured diff fragment may hold (size cap). */
export const MAX_FRAGMENT_CHARS = 8000;

/** The reviewer decision a case is derived from (never `pending` — AC-3). */
export type EvalDecision = 'accepted' | 'dismissed';

/** The location a case protects (source finding's file + line range). */
export interface EvalGuard {
  file: string;
  start_line: number;
  end_line: number;
}

/** What `deriveEvalCase` records in the case's `input_meta` jsonb. */
export interface EvalCaseMeta {
  guard: EvalGuard;
  source_finding_id: string;
  decision: EvalDecision;
}

/** The derived, storable fields of an eval case (before persistence). */
export interface DerivedEvalCase {
  input_diff: string;
  expected_output: ExpectedFinding[];
  input_meta: EvalCaseMeta;
}

/** The subset of a finding row the derivation needs (camelCase DB shape). */
export interface EvalSourceFinding {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  title: string;
}

/** Options for `extractHunkFragment`. */
export interface SliceOptions {
  /** Max characters of the captured fragment (default `MAX_FRAGMENT_CHARS`). */
  maxChars?: number;
}

interface DiffHunk {
  header: string;
  body: string[];
  /** First line of the hunk in NEW-file coordinates. */
  newStart: number;
  /** Last line of the hunk in NEW-file coordinates (inclusive). */
  newEnd: number;
}

// `@@ -oldStart,oldLen +newStart,newLen @@` — capture the NEW-file start/len.
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** Split a single-file unified-diff patch into its hunks (new-file spans). */
function parseHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  for (const line of patch.split('\n')) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      if (current) hunks.push(current);
      const newStart = Number.parseInt(m[1]!, 10);
      const newLen = m[2] !== undefined ? Number.parseInt(m[2], 10) : 1;
      current = {
        header: line,
        body: [],
        newStart,
        // A zero-length new side (pure deletion) still occupies its start anchor.
        newEnd: newStart + Math.max(newLen, 1) - 1,
      };
    } else if (current) {
      current.body.push(line);
    }
    // Lines before the first `@@` (the ---/+++ file headers) are dropped.
  }
  if (current) hunks.push(current);
  return hunks;
}

/** Truncate a fragment to `maxChars`, appending a marker when it was cut. */
function cap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… [truncated]`;
}

/**
 * Extract the hunk(s) of `patch` that cover `[startLine, endLine]` (NEW-file
 * coordinates), size-capped. Falls back to the whole (single-file) patch when no
 * hunk matches (e.g. a grounding-exempt full-file finding) so there is always a
 * usable fragment — never the aggregate of every file's patch.
 */
export function extractHunkFragment(
  patch: string | null | undefined,
  startLine: number,
  endLine: number,
  opts: SliceOptions = {},
): string {
  const maxChars = opts.maxChars ?? MAX_FRAGMENT_CHARS;
  if (!patch) return '';
  const hunks = parseHunks(patch);
  if (hunks.length === 0) return cap(patch, maxChars);

  const lo = Math.min(startLine, endLine);
  const hi = Math.max(startLine, endLine);
  const matching = hunks.filter((h) => h.newStart <= hi && lo <= h.newEnd);
  const selected = matching.length > 0 ? matching : hunks;

  const text = selected.map((h) => [h.header, ...h.body].join('\n')).join('\n');
  return cap(text, maxChars);
}

/**
 * Derive a case's stored fields from a decided finding + the file's patch.
 * `accepted` → a `must_find` case listing the finding; `dismissed` → a
 * `must_not_flag` case (empty expected list) whose guard remembers what it
 * protects. The severity/category came from an already-validated finding, so
 * they are cast to the contract enums.
 */
export function deriveEvalCase(
  finding: EvalSourceFinding,
  decision: EvalDecision,
  patch: string | null | undefined,
  opts?: SliceOptions,
): DerivedEvalCase {
  const guard: EvalGuard = {
    file: finding.file,
    start_line: finding.startLine,
    end_line: finding.endLine,
  };
  const expected_output: ExpectedFinding[] =
    decision === 'accepted'
      ? [
          {
            file: finding.file,
            start_line: finding.startLine,
            end_line: finding.endLine,
            severity: finding.severity as Severity,
            category: finding.category as FindingCategory,
            title: finding.title,
          },
        ]
      : [];
  return {
    input_diff: extractHunkFragment(patch, finding.startLine, finding.endLine, opts),
    expected_output,
    input_meta: { guard, source_finding_id: finding.id, decision },
  };
}

/** Map a persisted `eval_cases` row to the public `EvalCase` DTO. */
export function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: row.expectedOutput ?? null,
    notes: row.notes ?? null,
  };
}

/**
 * Resolve a non-colliding case name within an owner's set: if `base` is already
 * taken, append " (2)", " (3)", … (spec Edge cases — allow duplicates, dedupe
 * the name rather than hard-rejecting a re-captured finding).
 */
export function dedupeCaseName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}
