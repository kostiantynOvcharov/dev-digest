import type { ChatMessage } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';

/**
 * Pure helpers for the Intent Layer's cheap classifier call.
 *
 * The classifier deliberately sees the PR's title + body + the changed-files
 * list with HUNK HEADERS ONLY (`@@ -a,b +c,d @@`) — never the diff body lines.
 * Sending headers-only is the whole point: it tells the model WHAT changed and
 * WHERE without the (large, expensive) line content, and we log how many tokens
 * that saved vs. shipping the full patch (see `fullDiffChars`).
 */

/** Structural shape of a persisted pr_files row (only what we read). */
export interface PrFileLike {
  path: string;
  patch: string | null;
}

/**
 * Build the "changed files (paths + hunk ranges only)" text from pr_files
 * patches, reusing the same synthetic-diff assembly + parser the review path
 * uses (`diffFromPrFiles` → `parseUnifiedDiff`). Returns the rendered text plus
 * `fullDiffChars` — the summed length of every patch, the baseline for the
 * "tokens saved" estimate.
 */
export function buildHunkHeaderText(files: PrFileLike[]): { text: string; fullDiffChars: number } {
  let fullDiffChars = 0;
  const sections: string[] = [];

  for (const f of files) {
    if (!f.patch) {
      // Binary / rename / too-large file — GitHub returns no patch. Keep the
      // file visible to the classifier even without hunks.
      sections.push(`### ${f.path} (no textual diff)`);
      continue;
    }
    fullDiffChars += f.patch.length;

    // Same synthetic block diffFromPrFiles assembles, parsed for hunk geometry.
    const synthetic = [
      `diff --git a/${f.path} b/${f.path}`,
      `--- a/${f.path}`,
      `+++ b/${f.path}`,
      f.patch,
    ].join('\n');
    const hunks = parseUnifiedDiff(synthetic).files[0]?.hunks ?? [];
    if (hunks.length === 0) {
      sections.push(`### ${f.path} (no hunks)`);
      continue;
    }
    // Headers ONLY — reconstructed from the parsed geometry, never the bodies.
    const headers = hunks.map(
      (h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    );
    sections.push(`### ${f.path}\n${headers.join('\n')}`);
  }

  return { text: sections.join('\n\n'), fullDiffChars };
}

/**
 * The classifier messages. The PR title + body (which may carry an inline plan
 * or spec) are treated as the source of truth for motivation; the changed-files
 * block carries paths + hunk ranges only (no code).
 */
export function buildIntentMessages(
  title: string,
  body: string | null,
  hunkHeaders: string,
): ChatMessage[] {
  const system: ChatMessage = {
    role: 'system',
    content:
      'You classify the MOTIVATION and SCOPE behind a pull request. You are given the PR ' +
      'title, the author description (which may contain an inline plan or specification — ' +
      'treat it as the source of truth for intent), and the list of changed files with hunk ' +
      'ranges only (NO code is shown). Produce: `intent` — one sentence stating WHAT the PR ' +
      'does and WHY; `in_scope` — the concrete things this PR intends to change; `out_of_scope` ' +
      '— things explicitly or implicitly NOT part of this PR. When the description is thin, ' +
      'infer scope from the title and the changed-file paths. Never invent file names or claims ' +
      'you cannot support from the inputs. Keep each list item short.',
  };

  const user: ChatMessage = {
    role: 'user',
    content:
      `# Title\n${title}\n\n` +
      `# Description\n${body && body.trim().length > 0 ? body.trim() : '(none)'}\n\n` +
      `# Changed files (paths + hunk ranges only)\n${hunkHeaders.length > 0 ? hunkHeaders : '(no changed files)'}`,
  };

  return [system, user];
}
