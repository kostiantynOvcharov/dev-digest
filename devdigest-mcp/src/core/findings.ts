/**
 * Application core: fetching + selecting review records for a pull. Shared by
 * get_findings (grouped by agent) and run_agent_on_pr (the just-completed run).
 */
import type { DevDigestClient } from '../http-client.js';
import { toCompactReview, type CompactReview, type ReviewDto } from '../format.js';

/**
 * Reduce reviews to the latest per agent (unless `allRuns`). `reviewsForPull`
 * returns newest-first, so the first review seen for an agent is its latest.
 */
export function latestPerAgent(reviews: ReviewDto[], allRuns: boolean): ReviewDto[] {
  if (allRuns) return reviews;
  const seen = new Set<string>();
  const out: ReviewDto[] = [];
  for (const r of reviews) {
    const key = r.agent_id ?? r.run_id ?? r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Fetch a PR's reviews grouped by agent (latest per agent, or all runs). */
export async function fetchGroupedReviews(
  client: DevDigestClient,
  pullId: string,
  allRuns: boolean,
): Promise<CompactReview[]> {
  const reviews = await client.get<ReviewDto[]>(`/pulls/${pullId}/reviews`);
  return latestPerAgent(reviews, allRuns).map(toCompactReview);
}

/** Fetch the concise review for a specific run id (newest match wins). */
export async function fetchReviewForRun(
  client: DevDigestClient,
  pullId: string,
  runId: string,
): Promise<CompactReview | null> {
  const reviews = await client.get<ReviewDto[]>(`/pulls/${pullId}/reviews`);
  const review = reviews.find((r) => r.run_id === runId);
  return review ? toCompactReview(review) : null;
}
