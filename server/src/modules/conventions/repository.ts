import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow } from '../../db/rows.js';
import type { ConventionStatus, GroundedConvention } from './helpers.js';

export type { ConventionRow };

/**
 * Conventions data-access. Owns the `conventions` table, workspace-scoped
 * throughout. It also READS the sibling `repos` table (clonePath / fullName /
 * defaultBranch) to drive extraction — reading a sibling TABLE is allowed by the
 * onion boundary; importing the repos module's CODE is not (see server/INSIGHTS).
 */

export interface RepoLocator {
  id: string;
  clonePath: string | null;
  fullName: string;
  defaultBranch: string;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** Resolve a repo (scoped to workspace) for extraction. Undefined if absent. */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoLocator | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        clonePath: t.repos.clonePath,
        fullName: t.repos.fullName,
        defaultBranch: t.repos.defaultBranch,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** All candidates for a repo (workspace-scoped), oldest first for stable order. */
  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(asc(t.conventions.id));
  }

  /** A single candidate (workspace-scoped). */
  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /** Accepted candidates for a repo — feeds the merged skill draft. */
  async listAccepted(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'accepted'),
        ),
      )
      .orderBy(asc(t.conventions.id));
  }

  /** Delete the repo's PENDING rows so a re-scan reconciles (keeps accepted/rejected). */
  async deletePending(workspaceId: string, repoId: string): Promise<void> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'pending'),
        ),
      );
  }

  /** Bulk-insert grounded survivors as fresh `pending` rows. */
  async insertPending(
    workspaceId: string,
    repoId: string,
    rows: GroundedConvention[],
  ): Promise<ConventionRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        rows.map((r) => ({
          workspaceId,
          repoId,
          rule: r.rule,
          category: r.category,
          evidencePath: r.evidencePath,
          evidenceSnippet: r.evidenceSnippet,
          evidenceStartLine: r.evidenceStartLine,
          evidenceEndLine: r.evidenceEndLine,
          confidence: r.confidence,
          status: 'pending' as const,
          accepted: false,
        })),
      )
      .returning();
  }

  /**
   * Patch a candidate's status and/or rule (workspace-scoped). Keeps the legacy
   * `accepted` boolean in sync with `status` (`accepted === status==='accepted'`)
   * so the vendored contract still validates. Undefined if no such row.
   */
  async patch(
    workspaceId: string,
    id: string,
    patch: { status?: ConventionStatus; rule?: string },
  ): Promise<ConventionRow | undefined> {
    const set: Partial<{ status: ConventionStatus; accepted: boolean; rule: string }> = {};
    if (patch.status !== undefined) {
      set.status = patch.status;
      set.accepted = patch.status === 'accepted';
    }
    if (patch.rule !== undefined) set.rule = patch.rule;
    if (Object.keys(set).length === 0) return this.getById(workspaceId, id);

    const [row] = await this.db
      .update(t.conventions)
      .set(set)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
