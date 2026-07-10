import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent } from '@devdigest/shared';
import { BriefStored } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

/** One prior PR (other than the current one) that touched the same file(s). */
export interface PriorPrRow {
  id: string;
  number: number;
  title: string;
  openedAt: Date | null;
  status: string;
}

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Prior PRs (newest first) in the same repo — other than `excludePrId` — that
 * touched ANY of `paths`. Powers the Blast Radius "prior PRs touching these
 * files" section. Distinct over the PR identity so a PR that touched several of
 * the files appears once; capped at `limit`.
 */
export async function priorPrsTouchingFiles(
  db: Db,
  workspaceId: string,
  repoId: string,
  excludePrId: string,
  paths: string[],
  limit = 10,
): Promise<PriorPrRow[]> {
  if (paths.length === 0) return [];
  return db
    .selectDistinct({
      id: t.pullRequests.id,
      number: t.pullRequests.number,
      title: t.pullRequests.title,
      openedAt: t.pullRequests.openedAt,
      status: t.pullRequests.status,
    })
    .from(t.pullRequests)
    .innerJoin(t.prFiles, eq(t.prFiles.prId, t.pullRequests.id))
    .where(
      and(
        eq(t.pullRequests.workspaceId, workspaceId),
        eq(t.pullRequests.repoId, repoId),
        ne(t.pullRequests.id, excludePrId),
        inArray(t.prFiles.path, paths),
      ),
    )
    .orderBy(desc(t.pullRequests.openedAt))
    .limit(limit);
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export async function upsertIntent(db: Db, prId: string, intent: Intent): Promise<void> {
  await db
    .insert(t.prIntent)
    .values({
      prId,
      intent: intent.intent,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
    })
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: { intent: intent.intent, inScope: intent.in_scope, outOfScope: intent.out_of_scope },
    });
}

export async function getIntent(db: Db, prId: string): Promise<Intent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
}

// ---- brief (pr_brief) -----------------------------------------------------
// One row per PR; `head_sha` + observability + the `inputs` snapshot all live
// INSIDE the json blob (no dedicated columns). Upsert-semantics like intent.

export async function upsertBrief(db: Db, prId: string, stored: BriefStored): Promise<void> {
  await db
    .insert(t.prBrief)
    .values({ prId, json: stored })
    .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: stored } });
}

export async function getBrief(db: Db, prId: string): Promise<BriefStored | undefined> {
  const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
  if (!row) return undefined;
  return BriefStored.parse(row.json);
}

// ---- diff summary (pr_diff_summary) ----------------------------------------
// One row per PR; keyed by changed-file path. Each entry's `hunk_hash` records
// the file's patch hash AT GENERATION TIME, so a reader can tell "current" from
// "stale" by recomputing the hash from the file's CURRENT patch (see
// `pulls/hunk-hash.ts`) — same upsert-semantics as intent/brief.

export interface DiffSummaryEntry {
  hunk_hash: string;
  summary: string;
}
export type DiffSummaryMap = Record<string, DiffSummaryEntry>;

export async function upsertDiffSummary(
  db: Db,
  prId: string,
  map: DiffSummaryMap,
): Promise<void> {
  await db
    .insert(t.prDiffSummary)
    .values({ prId, json: map })
    .onConflictDoUpdate({ target: t.prDiffSummary.prId, set: { json: map } });
}

export async function getDiffSummary(
  db: Db,
  prId: string,
): Promise<DiffSummaryMap | undefined> {
  const [row] = await db.select().from(t.prDiffSummary).where(eq(t.prDiffSummary.prId, prId));
  if (!row) return undefined;
  return row.json as DiffSummaryMap;
}
