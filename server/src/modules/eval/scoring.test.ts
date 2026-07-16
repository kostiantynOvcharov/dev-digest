import { describe, it, expect } from 'vitest';
import {
  matchFindings,
  citationAccuracy,
  score,
  passCase,
  type FindingLocation,
  type ExpectedFinding,
} from './scoring.js';

/**
 * Pure eval scoring (AC-7/AC-8/AC-18). These tests exercise the match rule
 * (file-equal + range-overlap), the three metric formulas, the per-case pass
 * rule (incl. `must_not_flag` noise), and BOTH zero-denominator conventions —
 * with zero LLM/provider involvement.
 */

const loc = (file: string, start: number, end: number): FindingLocation => ({
  file,
  start_line: start,
  end_line: end,
});

const expected = (file: string, start: number, end: number): ExpectedFinding => ({
  file,
  start_line: start,
  end_line: end,
  severity: 'WARNING',
  category: 'bug',
  title: 'expected issue',
});

describe('matchFindings', () => {
  it('matches when file is equal and ranges overlap', () => {
    expect(matchFindings(loc('a.ts', 10, 20), expected('a.ts', 15, 25))).toBe(true);
  });

  it('matches when one range is fully contained in the other', () => {
    expect(matchFindings(loc('a.ts', 10, 30), expected('a.ts', 15, 20))).toBe(true);
  });

  it('matches touching ranges (shared boundary line)', () => {
    expect(matchFindings(loc('a.ts', 10, 20), expected('a.ts', 20, 30))).toBe(true);
  });

  it('does NOT match non-overlapping lines in the same file', () => {
    expect(matchFindings(loc('a.ts', 10, 20), expected('a.ts', 21, 30))).toBe(false);
  });

  it('does NOT match when the file path differs, even with identical ranges', () => {
    expect(matchFindings(loc('a.ts', 10, 20), expected('b.ts', 10, 20))).toBe(false);
  });
});

describe('citationAccuracy', () => {
  it('is kept / (kept + dropped)', () => {
    expect(citationAccuracy(3, 1)).toBe(0.75);
  });

  it('is 1 when there is nothing to ground (kept + dropped === 0)', () => {
    expect(citationAccuracy(0, 0)).toBe(1);
  });
});

describe('score', () => {
  it('computes recall / precision / citation_accuracy for a mixed case', () => {
    const produced = [loc('a.ts', 10, 20), loc('a.ts', 100, 110)]; // 2nd is noise
    const exp = [expected('a.ts', 15, 25), expected('b.ts', 1, 5)]; // 2nd unmatched
    const result = score(produced, exp, 2, 0);
    // recall: 1 of 2 expected matched
    expect(result.recall).toBe(0.5);
    // precision: 1 of 2 produced matched an expected
    expect(result.precision).toBe(0.5);
    // citation: 2 kept / 2 total
    expect(result.citation_accuracy).toBe(1);
  });

  it('empty produced set → precision = 1 and citation_accuracy = 1 (zero denominators)', () => {
    const result = score([], [expected('a.ts', 10, 20)], 0, 0);
    expect(result.precision).toBe(1);
    expect(result.citation_accuracy).toBe(1);
    // recall is over must_find expected; none matched
    expect(result.recall).toBe(0);
  });

  it('no must_find expectations → recall = 1 (zero denominator)', () => {
    const result = score([], [], 0, 0);
    expect(result.recall).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.citation_accuracy).toBe(1);
  });

  it('never emits NaN for any metric', () => {
    const result = score([], [], 0, 0);
    expect(Number.isNaN(result.recall)).toBe(false);
    expect(Number.isNaN(result.precision)).toBe(false);
    expect(Number.isNaN(result.citation_accuracy)).toBe(false);
  });
});

describe('passCase', () => {
  it('passes when all expected are matched and there is no noise', () => {
    expect(passCase([loc('a.ts', 10, 20)], [expected('a.ts', 12, 18)])).toBe(true);
  });

  it('fails when an expected finding is not matched', () => {
    expect(passCase([], [expected('a.ts', 10, 20)])).toBe(false);
  });

  it('fails when a produced finding is unexpected noise', () => {
    expect(
      passCase([loc('a.ts', 10, 20), loc('a.ts', 100, 110)], [expected('a.ts', 12, 18)]),
    ).toBe(false);
  });

  it('must_not_flag: ANY produced finding is noise → fail', () => {
    expect(passCase([loc('a.ts', 10, 20)], [])).toBe(false);
  });

  it('clean must_not_flag pass (no produced findings) scores 1.0 across the board', () => {
    expect(passCase([], [])).toBe(true);
    const result = score([], [], 0, 0);
    expect(result).toEqual({ recall: 1, precision: 1, citation_accuracy: 1 });
  });
});
