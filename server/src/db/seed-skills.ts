import type { SkillType } from '@devdigest/shared';

/**
 * Demo skills seeded for the Test Quality Reviewer. The 4th skill from the
 * lesson (`flaky-test-patterns`) is intentionally NOT here — it is created live
 * via .md/.zip import during the demo, exercising the whole import path.
 *
 * Bodies are plain markdown; at review time they are injected verbatim into the
 * prompt's `## Skills / rules` section.
 */
export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'uncovered-branches',
    description: 'Every new conditional must have a test that fails when that branch breaks.',
    type: 'rubric',
    body: `# Uncovered branches

For each NEW conditional in the diff — \`if\`/\`else\`, \`switch\` case, ternary,
\`??\`/\`||\` fallback, early return, or \`catch\` — verify a test exercises it.

- Flag a branch when only ONE side is asserted (e.g. the happy path is tested but
  the error path / empty case is not).
- A new function with behaviour but only a single "returns ok" assertion is a miss.
- Cite the exact file:line of the untested branch and name the case to add.`,
  },
  {
    name: 'edge-case-coverage',
    description: 'Boundaries and degenerate inputs are where regressions hide — require them.',
    type: 'rubric',
    body: `# Edge-case coverage

Tests should cover the inputs that break code, not just the typical one:

- Empty / null / undefined; zero, negative, and very large numbers.
- Empty arrays/objects; the first and last element; off-by-one boundaries.
- Duplicates, ordering assumptions, timezones, and unicode where relevant.

Flag a documented behaviour whose degenerate input has no assertion. Suggest the
specific case and the expected result.`,
  },
  {
    name: 'mock-overuse-gate',
    description: 'Reject tests that mock the unit under test or only assert on the mock.',
    type: 'convention',
    body: `# Mock-overuse gate

Mocking the database, clock, or network is fine. These are NOT:

- Mocking the very function/unit under test — the test then proves nothing.
- Asserting only that a mock was called (call count / arguments) instead of the
  observable result.
- So much mocking that no real code path executes.

Flag the over-mocked test, name what it should assert about real behaviour instead.`,
  },
];
