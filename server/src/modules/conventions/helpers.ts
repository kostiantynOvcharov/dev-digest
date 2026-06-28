import type { ConventionRow } from '../../db/rows.js';

/**
 * Pure helpers for the conventions module — module-local DTO types, row⇄DTO
 * mapping, and the citation-grounding gate. Nothing here does I/O: the grounding
 * function takes already-read file contents so it can be unit-tested without a
 * cloned repo (mirrors the spirit of reviewer-core's `groundFindings`).
 *
 * The vendored `ConventionCandidate` contract is do-not-touch; the richer
 * `ConventionCandidateDto` the client codes against is defined HERE (snake_case
 * JSON), extending the vendored shape with status/category/line fields.
 */

export type ConventionStatus = 'pending' | 'accepted' | 'rejected';

/** Public DTO for a convention candidate (snake_case JSON, client contract). */
export interface ConventionCandidateDto {
  id: string;
  repo_id: string | null;
  rule: string;
  category: string | null;
  evidence_path: string | null;
  evidence_snippet: string | null;
  evidence_start_line: number | null;
  evidence_end_line: number | null;
  confidence: number;
  status: ConventionStatus;
}

/** Map a persisted conventions row to the public candidate DTO. */
export function toConventionDto(row: ConventionRow): ConventionCandidateDto {
  return {
    id: row.id,
    repo_id: row.repoId,
    rule: row.rule,
    category: row.category,
    evidence_path: row.evidencePath,
    evidence_snippet: row.evidenceSnippet,
    evidence_start_line: row.evidenceStartLine,
    evidence_end_line: row.evidenceEndLine,
    confidence: row.confidence ?? 0,
    status: row.status as ConventionStatus,
  };
}

/** A raw candidate as proposed by the model (snake_case, untrusted). */
export interface RawConventionCandidate {
  category?: string | null;
  rule: string;
  evidence_path: string;
  /** The model's quoted snippet — verified against the real file lines, then discarded. */
  evidence_snippet: string;
  evidence_start_line: number;
  evidence_end_line: number;
  confidence: number;
}

/** A survivor of the grounding gate: line range clamped + snippet re-derived. */
export interface GroundedConvention {
  category: string | null;
  rule: string;
  evidencePath: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  /** RE-DERIVED from the actual file lines — never the model's own snippet. */
  evidenceSnippet: string;
  confidence: number;
}

/** Collapse runs of whitespace and trim — used to compare quoted vs real text. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The citation-grounding gate. For each candidate, the cited file must exist in
 * `files` (path → full contents), the [start,end] line range must be in-bounds,
 * and the snippet RE-DERIVED from those actual lines must contain the model's
 * quoted text (normalized whitespace). Candidates failing any check are dropped.
 *
 * Pure: callers read the files first (best-effort) and pass the contents in.
 * `files` keys are repo-relative paths (matching `evidence_path`).
 */
export function groundCandidates(
  candidates: RawConventionCandidate[],
  files: Map<string, string>,
): GroundedConvention[] {
  const kept: GroundedConvention[] = [];

  for (const c of candidates) {
    const content = files.get(c.evidence_path);
    if (content === undefined) continue; // cited file not in the sampled set

    const lines = content.split('\n');
    const start = Math.trunc(c.evidence_start_line);
    const end = Math.trunc(c.evidence_end_line);
    // 1-based, inclusive. Reject non-positive, inverted, or out-of-bounds ranges.
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 1 || end < start || end > lines.length) continue;

    // Re-derive the snippet from the ACTUAL file lines (never trust the model's).
    const snippet = lines.slice(start - 1, end).join('\n');
    if (normalizeWhitespace(snippet).length === 0) continue;

    // The model's QUOTED text must actually appear in those real lines (drop the
    // hallucinations). Compared with whitespace normalized so reformatting/indent
    // differences don't reject a genuine citation. An empty quote can't be
    // verified → drop.
    const quoted = normalizeWhitespace(c.evidence_snippet ?? '');
    if (quoted.length === 0) continue;
    if (!normalizeWhitespace(snippet).includes(quoted)) continue;

    kept.push({
      category: c.category ?? null,
      rule: c.rule,
      evidencePath: c.evidence_path,
      evidenceStartLine: start,
      evidenceEndLine: end,
      evidenceSnippet: snippet,
      confidence: clampConfidence(c.confidence),
    });
  }

  return kept;
}

/** Clamp a model-reported confidence into [0,1]; default 0.5 when absent/NaN. */
export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * Compose a merged skill body from accepted candidates — one `## <rule>` section
 * each, with a `Detected in \`path:start-end\`:` line + a fenced snippet. Pure
 * string assembly (the route returns this without persisting).
 */
export function composeSkillBody(accepted: ConventionCandidateDto[]): string {
  return accepted
    .map((c) => {
      const loc = locationLabel(c);
      const fence = '```';
      const snippet = c.evidence_snippet ?? '';
      return `## ${c.rule}\n\nDetected in \`${loc}\`:\n\n${fence}\n${snippet}\n${fence}`;
    })
    .join('\n\n');
}

/** `path:start-end` (or `path:start`, or just `path`) label for a candidate. */
export function locationLabel(c: ConventionCandidateDto): string {
  const path = c.evidence_path ?? '(unknown)';
  if (c.evidence_start_line == null) return path;
  if (c.evidence_end_line == null || c.evidence_end_line === c.evidence_start_line) {
    return `${path}:${c.evidence_start_line}`;
  }
  return `${path}:${c.evidence_start_line}-${c.evidence_end_line}`;
}
