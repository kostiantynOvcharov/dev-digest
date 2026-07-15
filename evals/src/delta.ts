/**
 * Delta between two labeled `eval:repeat --label X` series — the "before vs after a change"
 * view, each side backed by N runs. Diffs at three levels: per-test pass rate, per-practice
 * (the primary signal — which practice improved/regressed), and metrics.
 *
 *   pnpm eval:repeat skills/onion-architecture -n 5 --label baseline   # BEFORE the edit
 *   ...edit...
 *   pnpm eval:repeat skills/onion-architecture -n 5 --label candidate  # AFTER
 *   pnpm eval:delta baseline candidate
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GREEN, RED, DIM, RESET } from "./ansi.js";
import { RESULTS_DIR } from "./artifacts/paths.js";
import type { NodeAggregate, Series, Stats } from "./records/stats.js";

interface RepeatFile {
  label: string;
  git_sha: string;
  dirty: boolean;
  times: number;
  tests: Record<string, NodeAggregate>;
}

function load(label: string): RepeatFile {
  const file = join(RESULTS_DIR, `repeat-${label}.json`);
  if (!existsSync(file)) {
    console.error(`No repeat run for '${label}'. Run: pnpm eval:repeat <pattern> -n <N> --label ${label}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

const rate = (s?: Series) => (s ? Math.round(s.rate * 100) : null);
const fmtRate = (p: number | null) => (p === null ? "  —" : `${p}`.padStart(3));

/** baseline → candidate with a colored delta; null side renders as `—`. */
function rateRow(indent: string, label: string, a?: Series, b?: Series): void {
  const pa = rate(a);
  const pb = rate(b);
  const d = pa !== null && pb !== null ? pb - pa : null;
  const col = d === null ? DIM : d > 0 ? GREEN : d < 0 ? RED : DIM;
  const dStr = d === null ? "n/a" : d > 0 ? `+${d}` : `${d}`;
  console.log(`${indent}${fmtRate(pa)}% -> ${fmtRate(pb)}%  ${col}Δ ${dStr.padStart(4)}${RESET}  ${label}`);
}

function metricRow(label: string, a: Stats, b: Stats): void {
  const d = b.mean - a.mean;
  const col = d === 0 ? DIM : d < 0 ? GREEN : RED; // fewer tokens/turns/ms is better
  const sign = d > 0 ? "+" : "";
  console.log(`      ${label}: ${a.mean.toFixed(0)} -> ${b.mean.toFixed(0)}  ${col}(${sign}${d.toFixed(0)})${RESET}`);
}

function main(): void {
  const [labelA, labelB] = process.argv.slice(2);
  if (!labelA || !labelB) {
    console.error("usage: pnpm eval:delta <baseline-label> <candidate-label>");
    process.exit(1);
  }
  const a = load(labelA);
  const b = load(labelB);
  console.log(`A = ${labelA}  sha ${a.git_sha}${a.dirty ? "-dirty" : ""}  (${a.times} runs)`);
  console.log(`B = ${labelB}  sha ${b.git_sha}${b.dirty ? "-dirty" : ""}  (${b.times} runs)`);

  // Align on the trailing test-name segment, not the full nodeid. A full nodeid embeds the eval
  // file path AND the describe prefix (e.g. `agent:architecture-reviewer` vs `…-lite`), so a
  // cross-artifact A/B — two different agents/skills graded on the same case names — would never
  // line up. The trailing segment is the `test()` name, which such a pair deliberately shares, so
  // keying on it makes the per-practice diff work. Same-file baseline/candidate still aligns (the
  // trailing name is identical there too). Collisions (two distinct cases with the same trailing
  // name in one series) resolve last-wins and are surfaced as a warning.
  const shortKey = (id: string) => id.split(" > ").slice(-1)[0];
  const byShort = (tests: Record<string, NodeAggregate>, label: string) => {
    const out: Record<string, NodeAggregate> = {};
    for (const [id, agg] of Object.entries(tests)) {
      const k = shortKey(id);
      if (out[k]) console.error(`${DIM}warn: '${label}' has two cases named "${k}" — last wins${RESET}`);
      out[k] = agg;
    }
    return out;
  };
  const aShort = byShort(a.tests, labelA);
  const bShort = byShort(b.tests, labelB);

  const nodeids = [...new Set([...Object.keys(aShort), ...Object.keys(bShort)])].sort();
  for (const id of nodeids) {
    const ta = aShort[id];
    const tb = bShort[id];
    rateRow("\n  ", id, ta?.pass, tb?.pass);

    const practiceTexts = [...new Set([...Object.keys(ta?.practices ?? {}), ...Object.keys(tb?.practices ?? {})])];
    for (const text of practiceTexts) {
      const t = text.length > 70 ? text.slice(0, 67) + "…" : text;
      rateRow("      ", t, ta?.practices[text], tb?.practices[text]);
    }
    if (ta && tb) {
      metricRow("tok_out ", ta.metrics.outputTokens, tb.metrics.outputTokens);
      metricRow("turns   ", ta.metrics.numTurns, tb.metrics.numTurns);
      metricRow("duration", ta.metrics.durationMs, tb.metrics.durationMs);
    }
  }
}

main();
