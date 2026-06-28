import { describe, it, expect } from 'vitest';
import {
  buildHunkHeaderText,
  buildIntentMessages,
  type PrFileLike,
} from '../src/modules/intent/helpers.js';

/**
 * Intent Layer helpers — the cheap classifier deliberately sees hunk HEADERS
 * only (no diff body lines). These tests pin that contract + the token-savings
 * baseline (`fullDiffChars`).
 */

const patchA = ['@@ -1,3 +1,4 @@', ' ctx', '-removed', '+added one', '+added two'].join('\n');
const patchB = ['@@ -10,2 +10,2 @@', ' keep', '-gone', '+brand new line'].join('\n');

describe('buildHunkHeaderText', () => {
  const files: PrFileLike[] = [
    { path: 'src/a.ts', patch: patchA },
    { path: 'src/b.ts', patch: patchB },
  ];

  it('emits per-file headers with hunk ranges only', () => {
    const { text } = buildHunkHeaderText(files);
    expect(text).toContain('### src/a.ts');
    expect(text).toContain('### src/b.ts');
    expect(text).toContain('@@ -1,3 +1,4 @@');
    expect(text).toContain('@@ -10,2 +10,2 @@');
  });

  it('strips ALL diff body lines (no + / - content leaks through)', () => {
    const { text } = buildHunkHeaderText(files);
    // No body content from either patch.
    expect(text).not.toContain('added one');
    expect(text).not.toContain('removed');
    expect(text).not.toContain('brand new line');
    expect(text).not.toContain('gone');
    // Every non-empty line is a file header or a hunk header — never a body line.
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      expect(line.startsWith('### ') || line.startsWith('@@ ')).toBe(true);
    }
  });

  it('computes fullDiffChars as the summed patch lengths (savings baseline)', () => {
    const { fullDiffChars } = buildHunkHeaderText(files);
    expect(fullDiffChars).toBe(patchA.length + patchB.length);
  });

  it('marks files with no patch and excludes them from fullDiffChars', () => {
    const { text, fullDiffChars } = buildHunkHeaderText([
      { path: 'img.png', patch: null },
      { path: 'src/a.ts', patch: patchA },
    ]);
    expect(text).toContain('### img.png (no textual diff)');
    expect(fullDiffChars).toBe(patchA.length);
  });

  it('handles an empty file list', () => {
    const { text, fullDiffChars } = buildHunkHeaderText([]);
    expect(text).toBe('');
    expect(fullDiffChars).toBe(0);
  });
});

describe('buildIntentMessages', () => {
  it('uses the body as-is and labels the changed-files block', () => {
    const [system, user] = buildIntentMessages('Add rate limiting', 'Closes #1\nsee plan below', '### src/a.ts\n@@ -1,3 +1,4 @@');
    expect(system.role).toBe('system');
    expect(user.content).toContain('# Title\nAdd rate limiting');
    expect(user.content).toContain('see plan below');
    expect(user.content).toContain('@@ -1,3 +1,4 @@');
  });

  it('substitutes placeholders for an empty body / no files', () => {
    const [, user] = buildIntentMessages('T', null, '');
    expect(user.content).toContain('# Description\n(none)');
    expect(user.content).toContain('(no changed files)');
  });
});
