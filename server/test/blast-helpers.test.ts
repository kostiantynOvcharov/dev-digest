import { describe, it, expect } from 'vitest';
import { reshapeBlast } from '../src/modules/blast/helpers.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

/**
 * Blast Radius reshape — turns the flat engine `BlastResult` into the per-symbol
 * tree the UI renders. Pure grouping (no I/O); these tests pin the attribution
 * rules: callers grouped by `viaSymbol`, endpoints/crons attributed via
 * `factsByFile` of the caller files, and the top-level distinct counts.
 */

const persistent: BlastResult = {
  changedSymbols: [
    { file: 'src/rate-limit.ts', name: 'rateLimit', kind: 'function' },
    { file: 'src/rate-limit.ts', name: 'bucketKey', kind: 'function' },
  ],
  callers: [
    { file: 'src/api/public/index.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 23, rank: 9 },
    { file: 'src/api/public/webhooks.ts', symbol: 'onHook', viaSymbol: 'rateLimit', line: 45, rank: 7 },
    { file: 'src/rate-limit.ts', symbol: 'rateLimit', viaSymbol: 'bucketKey', line: 12, rank: 3 },
  ],
  impactedEndpoints: ['GET /api/public/items', 'POST /api/public/webhooks'],
  factsByFile: {
    'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
    'src/api/public/webhooks.ts': {
      endpoints: ['POST /api/public/webhooks'],
      crons: ['reset-rate-buckets (hourly)'],
    },
    'src/rate-limit.ts': { endpoints: [], crons: [] },
  },
  degraded: false,
};

describe('reshapeBlast', () => {
  it('groups callers under the changed symbol they reach', () => {
    const { blast } = reshapeBlast(persistent);
    const byName = new Map(blast.downstream.map((d) => [d.symbol, d]));

    expect(blast.downstream).toHaveLength(2);
    expect(byName.get('rateLimit')?.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/api/public/index.ts:23',
      'src/api/public/webhooks.ts:45',
    ]);
    expect(byName.get('bucketKey')?.callers).toHaveLength(1);
  });

  it('attributes endpoints/crons to a symbol via its caller files', () => {
    const { blast } = reshapeBlast(persistent);
    const rateLimit = blast.downstream.find((d) => d.symbol === 'rateLimit')!;

    expect(rateLimit.endpoints_affected).toEqual([
      'GET /api/public/items',
      'POST /api/public/webhooks',
    ]);
    expect(rateLimit.crons_affected).toEqual(['reset-rate-buckets (hourly)']);
  });

  it('computes distinct top-level counts and never fabricates a summary', () => {
    const { blast, counts } = reshapeBlast(persistent);
    expect(counts).toEqual({ symbols: 2, callers: 3, endpoints: 2, crons: 1 });
    expect(blast.summary).toBe(''); // zero-LLM: summary is always empty
  });

  it('degraded (ripgrep) path with no factsByFile yields callers but empty endpoints', () => {
    const degraded: BlastResult = {
      changedSymbols: [{ file: 'src/helper.ts', name: 'helper', kind: 'function' }],
      callers: [{ file: 'src/a.ts', symbol: 'a', viaSymbol: 'helper', line: 5, rank: 0 }],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    };
    const { blast, counts } = reshapeBlast(degraded);
    expect(blast.downstream[0].callers).toHaveLength(1);
    expect(blast.downstream[0].endpoints_affected).toEqual([]);
    expect(counts).toEqual({ symbols: 1, callers: 1, endpoints: 0, crons: 0 });
  });

  it('a changed symbol with no callers renders an empty downstream node', () => {
    const { blast } = reshapeBlast({
      changedSymbols: [{ file: 'src/x.ts', name: 'lonely', kind: 'const' }],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    });
    expect(blast.downstream).toEqual([
      { symbol: 'lonely', callers: [], endpoints_affected: [], crons_affected: [] },
    ]);
  });
});
