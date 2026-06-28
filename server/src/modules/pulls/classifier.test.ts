import { describe, it, expect } from 'vitest';
import { classifyFile } from './classifier.js';

/**
 * Smart Diff classifier — the single most important function in the feature:
 * it decides where each changed file lands (core / wiring / boilerplate), and
 * therefore the order the reviewer's eye falls. If lock-files, dist/, snapshots
 * and migrations correctly bucket as boilerplate, the layout is trustworthy.
 *
 * 15 cases, 5 per category. The graded checkpoint (`pnpm verify:l03`) runs this.
 */
describe('classifyFile', () => {
  it.each([
    ['pnpm-lock.yaml', 'boilerplate'],
    ['package-lock.json', 'boilerplate'],
    ['server/src/db/migrations/0001_migration.sql', 'boilerplate'],
    ['client/dist/index.js', 'boilerplate'],
    ['server/src/modules/pulls/__snapshots__/routes.test.ts.snap', 'boilerplate'],
  ])('classifies %s as boilerplate', (path, expected) => {
    expect(classifyFile(path)).toBe(expected);
  });

  it.each([
    ['src/index.ts', 'wiring'],
    ['server/src/server.ts', 'wiring'],
    ['tsconfig.json', 'wiring'],
    ['client/vite.config.ts', 'wiring'],
    ['server/package.json', 'wiring'],
  ])('classifies %s as wiring', (path, expected) => {
    expect(classifyFile(path)).toBe(expected);
  });

  it.each([
    ['server/src/modules/reviews/service.ts', 'core'],
    ['server/src/modules/pulls/classifier.ts', 'core'],
    ['reviewer-core/src/grounding.ts', 'core'],
    ['client/src/components/SmartDiffViewer/SmartDiffViewer.tsx', 'core'],
    ['server/src/modules/intent/helpers.ts', 'core'],
  ])('classifies %s as core', (path, expected) => {
    expect(classifyFile(path)).toBe(expected);
  });

  // Docs / assets / tooling must NOT pollute "core" (the review-closely bucket).
  it.each([
    // Docs & markdown → boilerplate (skim), even nested or at the root.
    ['docs/api-contract-reviewer/experiment.md', 'boilerplate'],
    ['README.md', 'boilerplate'],
    ['CLAUDE.md', 'boilerplate'],
    ['AGENTS.md', 'boilerplate'],
    ['client/public/logo.svg', 'boilerplate'],
    // Tooling config / dot-files / scripts / data → wiring.
    ['.gitignore', 'wiring'],
    ['scripts/dev.sh', 'wiring'],
    ['.claude/settings.json', 'wiring'],
    ['client/messages/en/prReview.json', 'wiring'],
    ['.husky/pre-commit', 'wiring'],
  ])('routes non-code %s away from core (→ %s)', (path, expected) => {
    expect(classifyFile(path)).toBe(expected);
  });

  it('keeps a markdown prompt inside a dot-dir as boilerplate (doc rule wins over dot-dir wiring)', () => {
    expect(classifyFile('.claude/skills/foo/SKILL.md')).toBe('boilerplate');
  });

  it('prefers boilerplate over wiring for a generated entry file (dist/index.js)', () => {
    // index.js looks like a barrel/entry (wiring) but living under dist/ makes
    // it generated output — boilerplate must win.
    expect(classifyFile('packages/web/dist/index.js')).toBe('boilerplate');
  });

  it('keeps package.json as wiring even though package-lock.json is boilerplate', () => {
    expect(classifyFile('package.json')).toBe('wiring');
    expect(classifyFile('package-lock.json')).toBe('boilerplate');
  });
});
