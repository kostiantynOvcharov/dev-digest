/**
 * walk-docs.ts unit tests (SPEC-01 Project Context discovery).
 *
 * No DB, no git. Builds a temp dir on disk, runs `walkDocs`, and asserts the
 * discovery rules: `.md` under a configured root at any depth (with the right
 * type badge), repo-root markdown excluded, configured roots nested below an
 * EXCLUDED_DIRS parent still discovered (Decision D3), oversized skipped.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { walkDocs } from '../src/modules/repo-intel/pipeline/walk-docs.js';
import { MAX_FILE_SIZE } from '../src/modules/repo-intel/constants.js';

const ROOTS = ['specs', 'docs', 'insights'];

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

describe('walkDocs', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'walk-docs-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists .md under a configured root at any depth with the derived type badge', async () => {
    await writeFileAt(root, 'docs/guide.md', '# guide');
    await writeFileAt(root, 'specs/deep/nested/api.md', '# api');
    await writeFileAt(root, 'insights/notes.md', '# notes');
    // A configured root nested under a plain (non-excluded) parent — glob **/docs/**.
    await writeFileAt(root, 'src/docs/inner.md', '# inner');

    const docs = await walkDocs(root, ROOTS);
    const byPath = new Map(docs.map((d) => [d.path, d.type]));

    expect(byPath.get('docs/guide.md')).toBe('docs');
    expect(byPath.get('specs/deep/nested/api.md')).toBe('specs');
    expect(byPath.get('insights/notes.md')).toBe('insights');
    expect(byPath.get('src/docs/inner.md')).toBe('docs');
    // Path-sorted, repo-relative POSIX, never absolute.
    expect(docs.every((d) => !d.path.startsWith('/'))).toBe(true);
    expect([...byPath.keys()]).toEqual([...byPath.keys()].slice().sort());
  });

  it('excludes markdown outside any configured root (e.g. repo-root README.md)', async () => {
    await writeFileAt(root, 'README.md', '# readme');
    await writeFileAt(root, 'src/app.ts', 'export {}');
    await writeFileAt(root, 'src/loose.md', '# loose'); // not under a configured root
    await writeFileAt(root, 'docs/kept.md', '# kept');

    const docs = await walkDocs(root, ROOTS);
    const paths = docs.map((d) => d.path);

    expect(paths).toEqual(['docs/kept.md']);
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('src/loose.md');
  });

  it('discovers a configured root nested below an EXCLUDED_DIRS parent (Decision D3)', async () => {
    // `vendor` is in EXCLUDED_DIRS, but the configured `docs` root inside it is
    // always scanned — the D3 exception.
    await writeFileAt(root, 'vendor/docs/vendored.md', '# vendored');
    // A plain README inside the excluded parent (not under a root) stays excluded.
    await writeFileAt(root, 'vendor/README.md', '# nope');
    await writeFileAt(root, 'docs/top.md', '# top');

    const docs = await walkDocs(root, ROOTS);
    const paths = docs.map((d) => d.path).sort();

    expect(paths).toContain('vendor/docs/vendored.md');
    expect(paths).toContain('docs/top.md');
    expect(paths).not.toContain('vendor/README.md');
    expect(docs.find((d) => d.path === 'vendor/docs/vendored.md')?.type).toBe('docs');
  });

  it('skips oversized markdown (MAX_FILE_SIZE guard)', async () => {
    await writeFileAt(root, 'docs/big.md', 'x'.repeat(MAX_FILE_SIZE + 1));
    await writeFileAt(root, 'docs/small.md', '# small');

    const docs = await walkDocs(root, ROOTS);
    expect(docs.map((d) => d.path)).toEqual(['docs/small.md']);
  });

  it('honors a custom configured root name (tags docs with that raw name)', async () => {
    await writeFileAt(root, 'guides/how-to.md', '# how-to');
    await writeFileAt(root, 'docs/ignored.md', '# ignored'); // not a configured root here

    const docs = await walkDocs(root, ['guides']);
    expect(docs.map((d) => ({ path: d.path, type: d.type }))).toEqual([
      { path: 'guides/how-to.md', type: 'guides' },
    ]);
  });

  it('returns [] when no root names are configured', async () => {
    await writeFileAt(root, 'docs/guide.md', '# guide');
    expect(await walkDocs(root, [])).toEqual([]);
  });
});
