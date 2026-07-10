import type { BlastRadius } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';

/**
 * Reshape the flat engine result (`BlastResult` from `repoIntel.getBlastRadius`)
 * into the per-symbol tree the UI renders (`BlastRadius`) + top-level `counts`.
 *
 * Pure (no I/O) so it's unit-testable without the DB. The heavy analysis already
 * happened in the repo-intel index; this only groups the pre-computed rows:
 *   - callers grouped under the changed symbol they reach (`viaSymbol`),
 *   - endpoints/crons attributed to a changed symbol via `factsByFile` of the
 *     files its callers live in (present only on the persistent, non-degraded
 *     path — absent on the ripgrep fallback, so those trees show callers only).
 */
export function reshapeBlast(result: BlastResult): {
  blast: BlastRadius;
  counts: { symbols: number; callers: number; endpoints: number; crons: number };
} {
  const changed_symbols = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  const factsByFile = result.factsByFile ?? {};

  // Group callers + their files by the changed symbol they reach.
  const callersBySymbol = new Map<string, { name: string; file: string; line: number }[]>();
  const filesBySymbol = new Map<string, Set<string>>();
  for (const c of result.callers) {
    const callers = callersBySymbol.get(c.viaSymbol) ?? [];
    callers.push({ name: c.symbol, file: c.file, line: c.line });
    callersBySymbol.set(c.viaSymbol, callers);

    const files = filesBySymbol.get(c.viaSymbol) ?? new Set<string>();
    files.add(c.file);
    filesBySymbol.set(c.viaSymbol, files);
  }

  const allCrons = new Set<string>();
  const downstream = changed_symbols.map((sym) => {
    const callers = callersBySymbol.get(sym.name) ?? [];
    const files = filesBySymbol.get(sym.name) ?? new Set<string>();
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const file of files) {
      const facts = factsByFile[file];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const c of facts.crons) {
        crons.add(c);
        allCrons.add(c);
      }
    }
    return {
      symbol: sym.name,
      callers,
      endpoints_affected: [...endpoints],
      crons_affected: [...crons],
    };
  });

  const counts = {
    symbols: changed_symbols.length,
    callers: result.callers.length,
    // `impactedEndpoints` is the engine's authoritative flat union (distinct).
    endpoints: new Set(result.impactedEndpoints).size,
    crons: allCrons.size,
  };

  // `summary` is intentionally empty: this feature makes NO model call.
  return { blast: { changed_symbols, downstream, summary: '' }, counts };
}
