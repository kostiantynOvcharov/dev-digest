// reviewer-core/src/enrich.ts
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import simpleGit from 'simple-git';
import { z } from 'zod';
import type { LLMProvider } from '@devdigest/shared';

export const EnrichedContext = z.object({
  diff: z.string(),
  fileContents: z.record(z.string()),
  recentCommits: z.array(z.string()),
});
export type EnrichedContext = z.infer<typeof EnrichedContext>;

/**
 * Enriches a review with the full contents of the touched files and the last
 * few commit messages, then asks the model to summarize the blast radius.
 */
export async function enrichReview(
  repoDir: string,
  changedFiles: string[],
  llm: LLMProvider,
): Promise<string> {
  const fileContents: Record<string, string> = {};
  for (const file of changedFiles) {
    const path = `${repoDir}/${file}`;
    if (existsSync(path)) {
      fileContents[file] = readFileSync(path, 'utf8');
    }
  }

  const git = simpleGit(repoDir);
  const log = await git.log({ maxCount: 5 });
  const recentCommits = log.all.map((c) => c.message);

  const branch = execSync('git rev-parse --abbrev-ref HEAD', {
    cwd: repoDir,
  })
    .toString()
    .trim();

  const prompt = [
    `Branch: ${branch}`,
    `Recent commits:\n${recentCommits.join('\n')}`,
    `Changed files:\n${Object.keys(fileContents).join('\n')}`,
    'Summarize the blast radius of this change.',
  ].join('\n\n');

  const res = await llm.complete({ prompt });
  return res.text;
}
