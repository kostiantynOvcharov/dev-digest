import { describe, it, expect } from 'vitest';
import type { PrFile } from '@devdigest/shared';
import { composeSmartDiff } from './smart-diff.js';

const file = (path: string, additions = 1, deletions = 0): PrFile => ({
  path,
  additions,
  deletions,
  patch: null,
});

describe('composeSmartDiff', () => {
  it('orders groups core → wiring → boilerplate and skips empty roles', () => {
    const diff = composeSmartDiff(
      [file('pnpm-lock.yaml'), file('src/index.ts'), file('src/modules/x/service.ts')],
      [],
    );
    expect(diff.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
  });

  it('maps findings to sorted, de-duplicated finding_lines on the matching file', () => {
    const diff = composeSmartDiff(
      [file('src/modules/x/service.ts')],
      [
        { file: 'src/modules/x/service.ts', line: 30 },
        { file: 'src/modules/x/service.ts', line: 12 },
        { file: 'src/modules/x/service.ts', line: 30 },
        { file: 'other.ts', line: 99 },
      ],
    );
    const core = diff.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.finding_lines).toEqual([12, 30]);
    expect(core.files[0]!.pseudocode_summary).toBeNull();
  });

  it('flags too_big past the threshold and proposes one split per non-empty role', () => {
    const small = composeSmartDiff([file('a.ts', 10, 5)], []);
    expect(small.split_suggestion.too_big).toBe(false);
    expect(small.split_suggestion.proposed_splits).toEqual([]);

    const big = composeSmartDiff([file('a.ts', 300, 0), file('package.json', 150, 0)], []);
    expect(big.split_suggestion.total_lines).toBe(450);
    expect(big.split_suggestion.too_big).toBe(true);
    expect(big.split_suggestion.proposed_splits.map((s) => s.name)).toEqual([
      'Core logic',
      'Wiring',
    ]);
  });
});
