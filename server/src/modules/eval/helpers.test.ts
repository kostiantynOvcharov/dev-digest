import { describe, it, expect } from 'vitest';
import {
  deriveEvalCase,
  dedupeCaseName,
  extractHunkFragment,
  MAX_FRAGMENT_CHARS,
  type EvalSourceFinding,
} from './helpers.js';

const MULTI_HUNK_PATCH = [
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '+const b = 2;',
  ' const c = 3;',
  ' const d = 4;',
  '@@ -20,3 +21,4 @@',
  ' port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  ' redisUrl: x,',
  ' timeout: 5,',
].join('\n');

const FINDING: EvalSourceFinding = {
  id: 'find-1',
  file: 'src/config.ts',
  startLine: 22,
  endLine: 22,
  severity: 'CRITICAL',
  category: 'security',
  title: 'Hardcoded Stripe secret key',
};

describe('extractHunkFragment', () => {
  it('returns only the hunk covering the finding line, not the whole patch', () => {
    const frag = extractHunkFragment(MULTI_HUNK_PATCH, 22, 22);
    expect(frag).toContain('@@ -20,3 +21,4 @@');
    expect(frag).toContain('stripeKey');
    // The unrelated first hunk must NOT be captured.
    expect(frag).not.toContain('@@ -1,3 +1,4 @@');
    expect(frag).not.toContain('const b = 2;');
  });

  it('falls back to the whole single-file patch when no hunk matches', () => {
    const frag = extractHunkFragment(MULTI_HUNK_PATCH, 9999, 9999);
    expect(frag).toContain('@@ -1,3 +1,4 @@');
    expect(frag).toContain('@@ -20,3 +21,4 @@');
  });

  it('returns empty for a missing patch (grounding-exempt / no-patch finding)', () => {
    expect(extractHunkFragment(null, 1, 1)).toBe('');
    expect(extractHunkFragment(undefined, 1, 1)).toBe('');
    expect(extractHunkFragment('', 1, 1)).toBe('');
  });

  it('enforces the per-fragment size cap', () => {
    const huge = `@@ -1,1 +1,1 @@\n${'+x'.repeat(10_000)}`;
    const frag = extractHunkFragment(huge, 1, 1, { maxChars: 100 });
    expect(frag.length).toBeLessThanOrEqual(100 + '\n… [truncated]'.length);
    expect(frag).toContain('[truncated]');
  });

  it('has a sane default cap', () => {
    expect(MAX_FRAGMENT_CHARS).toBeGreaterThan(0);
  });
});

describe('deriveEvalCase', () => {
  it('accepted → must_find: non-empty expected_output listing the finding', () => {
    const d = deriveEvalCase(FINDING, 'accepted', MULTI_HUNK_PATCH);
    expect(d.expected_output).toHaveLength(1);
    expect(d.expected_output[0]).toMatchObject({
      file: 'src/config.ts',
      start_line: 22,
      end_line: 22,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
    });
    expect(d.input_diff).toContain('stripeKey');
    expect(d.input_meta).toMatchObject({
      guard: { file: 'src/config.ts', start_line: 22, end_line: 22 },
      source_finding_id: 'find-1',
      decision: 'accepted',
    });
  });

  it('dismissed → must_not_flag: empty expected_output but a guard in input_meta', () => {
    const d = deriveEvalCase(FINDING, 'dismissed', MULTI_HUNK_PATCH);
    expect(d.expected_output).toEqual([]);
    expect(d.input_meta.decision).toBe('dismissed');
    expect(d.input_meta.guard).toEqual({
      file: 'src/config.ts',
      start_line: 22,
      end_line: 22,
    });
  });
});

describe('dedupeCaseName', () => {
  it('returns the base name when unused', () => {
    expect(dedupeCaseName('Leak', ['Other'])).toBe('Leak');
  });

  it('appends an incrementing suffix on collision', () => {
    expect(dedupeCaseName('Leak', ['Leak'])).toBe('Leak (2)');
    expect(dedupeCaseName('Leak', ['Leak', 'Leak (2)'])).toBe('Leak (3)');
  });
});
