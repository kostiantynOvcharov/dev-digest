/**
 * Application core: run one agent on a pull and BLOCK until the run reaches a
 * terminal state, then return the grounded findings. This is the "outcome, not
 * operation" logic behind run_agent_on_pr, kept out of the tool binding.
 */
import type { DevDigestClient } from '../http-client.js';
import type { ApiRunSummary, CompactReview, StartedRun } from '../format.js';
import { fetchReviewForRun } from './findings.js';

/** Terminal run statuses (server contracts/trace.ts — note: NO `error` status). */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const POLL_INTERVAL_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface RunReviewArgs {
  pullId: string;
  agentId: string;
}

/**
 * Trigger a review for one agent on a pull, poll until terminal, and return the
 * concise verdict + findings. Throws a forward-leading Error on a failed /
 * cancelled run or if no review is produced.
 */
export async function runReviewAndWait(
  client: DevDigestClient,
  { pullId, agentId }: RunReviewArgs,
): Promise<CompactReview> {
  // 1. Trigger (fire-and-forget on the server; returns run ids immediately).
  const started = await client.post<{ runs: StartedRun[] }>(`/pulls/${pullId}/review`, {
    agentId,
  });
  const run = started.runs.find((r) => r.agent_id === agentId) ?? started.runs[0];
  if (!run) {
    throw new Error('Review did not start — no run was created. Check the agent is enabled.');
  }
  const runId = run.run_id;

  // 2. Block until the run reaches a terminal state (no client-side cap).
  let summary: ApiRunSummary | undefined;
  for (;;) {
    const runs = await client.get<ApiRunSummary[]>(`/pulls/${pullId}/runs`);
    summary = runs.find((r) => r.run_id === runId);
    if (summary?.status && TERMINAL.has(summary.status)) break;
    await sleep(POLL_INTERVAL_MS);
  }
  if (summary.status !== 'done') {
    throw new Error(
      `Review run ${summary.status}${summary.error ? `: ${summary.error}` : ''}. ` +
        `Try again, or check the agent configuration and API keys.`,
    );
  }

  // 3. Return the concise verdict + findings for this run.
  const review = await fetchReviewForRun(client, pullId, runId);
  if (!review) {
    throw new Error('Run finished but no review was found for it — call get_findings to retry.');
  }
  return review;
}
