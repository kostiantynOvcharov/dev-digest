import { describe, it, expect } from 'vitest';
import {
  groundCandidates,
  composeSkillBody,
  locationLabel,
  clampConfidence,
  type RawConventionCandidate,
  type ConventionCandidateDto,
} from '../src/modules/conventions/helpers.js';

/**
 * Pure unit tests for the conventions grounding gate (no DB/network). The gate
 * is the core of the lab: ungrounded candidates MUST be dropped and every kept
 * candidate's snippet MUST be re-derived from the real file lines.
 */

const FILE = [
  'export function rateLimit(req) {', // 1
  '  return req.ip;', // 2
  '}', // 3
  '', // 4
  'export const PORT = 3000;', // 5
].join('\n');

const files = new Map<string, string>([['src/mw.ts', FILE]]);

const base: RawConventionCandidate = {
  category: 'naming',
  rule: 'exported helpers are camelCase',
  evidence_path: 'src/mw.ts',
  evidence_snippet: 'export function rateLimit(req) {',
  evidence_start_line: 1,
  evidence_end_line: 1,
  confidence: 0.9,
};

describe('groundCandidates', () => {
  it('keeps a grounded candidate and RE-DERIVES the snippet from the file', () => {
    const kept = groundCandidates([base], files);
    expect(kept).toHaveLength(1);
    // Re-derived from the actual line 1 — not trusted from the model.
    expect(kept[0]!.evidenceSnippet).toBe('export function rateLimit(req) {');
    expect(kept[0]!.evidenceStartLine).toBe(1);
    expect(kept[0]!.evidenceEndLine).toBe(1);
  });

  it('drops a candidate citing a file not in the sample set', () => {
    const c = { ...base, evidence_path: 'src/ghost.ts' };
    expect(groundCandidates([c], files)).toHaveLength(0);
  });

  it('drops a candidate whose line range is out of bounds', () => {
    const c = { ...base, evidence_start_line: 40, evidence_end_line: 42 };
    expect(groundCandidates([c], files)).toHaveLength(0);
  });

  it('drops an inverted or non-positive range', () => {
    expect(groundCandidates([{ ...base, evidence_start_line: 3, evidence_end_line: 1 }], files)).toHaveLength(0);
    expect(groundCandidates([{ ...base, evidence_start_line: 0, evidence_end_line: 0 }], files)).toHaveLength(0);
  });

  it("drops a candidate whose quoted text does NOT appear in the cited lines (hallucination)", () => {
    const c = { ...base, evidence_snippet: 'export function neverExisted() {' };
    expect(groundCandidates([c], files)).toHaveLength(0);
  });

  it('re-derives a MULTI-LINE snippet over the cited range', () => {
    const c = {
      ...base,
      evidence_snippet: 'return req.ip', // quote appears (normalized) on line 2
      evidence_start_line: 1,
      evidence_end_line: 3,
    };
    const kept = groundCandidates([c], files);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.evidenceSnippet).toBe('export function rateLimit(req) {\n  return req.ip;\n}');
  });

  it('tolerates whitespace differences in the model quote', () => {
    const c = { ...base, evidence_snippet: 'export   function    rateLimit(req)  {' };
    expect(groundCandidates([c], files)).toHaveLength(1);
  });

  it('clamps confidence into [0,1]', () => {
    expect(clampConfidence(1.7)).toBe(1);
    expect(clampConfidence(-2)).toBe(0);
    expect(clampConfidence(Number.NaN)).toBe(0.5);
  });
});

describe('composeSkillBody / locationLabel', () => {
  const dto = (over: Partial<ConventionCandidateDto>): ConventionCandidateDto => ({
    id: 'x',
    repo_id: 'r',
    rule: 'use kebab-case files',
    category: 'naming',
    evidence_path: 'src/mw.ts',
    evidence_snippet: 'export const PORT = 3000;',
    evidence_start_line: 5,
    evidence_end_line: 5,
    confidence: 0.8,
    status: 'accepted',
    ...over,
  });

  it('emits one `## rule` section with a located, fenced snippet', () => {
    const body = composeSkillBody([dto({})]);
    expect(body).toContain('## use kebab-case files');
    expect(body).toContain('Detected in `src/mw.ts:5`:');
    expect(body).toContain('```\nexport const PORT = 3000;\n```');
  });

  it('uses a start-end label for multi-line ranges', () => {
    expect(locationLabel(dto({ evidence_start_line: 1, evidence_end_line: 3 }))).toBe('src/mw.ts:1-3');
    expect(locationLabel(dto({ evidence_start_line: null, evidence_end_line: null }))).toBe('src/mw.ts');
  });
});
