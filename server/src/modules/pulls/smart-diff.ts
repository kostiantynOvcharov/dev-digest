import type { PrFile, SmartDiff, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { classifyFile } from './classifier.js';
import { BIG_PR_LINE_THRESHOLD } from './classifier.constants.js';

/** Minimal finding shape needed to overlay finding lines onto files. */
export interface FindingLine {
  file: string;
  line: number;
}

/** Groups are always emitted in this reading order (most→least risk). */
const ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

const ROLE_LABEL: Record<SmartDiffRole, string> = {
  core: 'Core logic',
  wiring: 'Wiring',
  boilerplate: 'Boilerplate',
};

/**
 * Deterministically compose a Smart Diff from already-available data — the PR's
 * changed files and the latest review's findings. NO model call: the expensive
 * LLM work happened in the Structured Reviewer; here we only classify + group +
 * map finding lines. `pseudocode_summary` stays null (that's the LLM field).
 */
export function composeSmartDiff(files: PrFile[], findings: FindingLine[]): SmartDiff {
  // Pre-index finding lines by file so each file is O(1) to look up.
  const linesByFile = new Map<string, Set<number>>();
  for (const f of findings) {
    let set = linesByFile.get(f.file);
    if (!set) {
      set = new Set();
      linesByFile.set(f.file, set);
    }
    set.add(f.line);
  }

  const byRole = new Map<SmartDiffRole, SmartDiffGroup['files']>(
    ROLE_ORDER.map((role) => [role, []]),
  );

  let totalLines = 0;
  for (const file of files) {
    totalLines += file.additions + file.deletions;
    const role = classifyFile(file.path);
    byRole.get(role)!.push({
      path: file.path,
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: [...(linesByFile.get(file.path) ?? [])].sort((a, b) => a - b),
    });
  }

  const groups: SmartDiffGroup[] = ROLE_ORDER.filter(
    (role) => byRole.get(role)!.length > 0,
  ).map((role) => ({ role, files: byRole.get(role)! }));

  const tooBig = totalLines > BIG_PR_LINE_THRESHOLD;

  return {
    groups,
    split_suggestion: {
      too_big: tooBig,
      total_lines: totalLines,
      // Deterministic split: one bundle per non-empty role (not a model idea).
      proposed_splits: tooBig
        ? groups.map((g) => ({
            name: ROLE_LABEL[g.role],
            files: g.files.map((f) => f.path),
          }))
        : [],
    },
  };
}
