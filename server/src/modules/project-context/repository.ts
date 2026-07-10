import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ContextDocType } from '@devdigest/shared';

/**
 * Project Context data-access (SPEC-01). Owns the per-repo doc-index snapshot
 * (`repo_context_docs`) + its state (`repo_context_index_state`), both keyed by
 * `repo_id`. It also READS the sibling attachment tables (`agent_context_docs`,
 * `skill_context_docs`, `agent_skills`, `agents`) to compute the "used by N
 * agents" count — reading a sibling TABLE is allowed by the onion boundary;
 * importing the agents/skills module CODE is not (see server/INSIGHTS).
 *
 * Workspace scoping: `repo_context_docs` has no `workspace_id`, so the SERVICE
 * verifies the repo belongs to the workspace (via `getRepo`) before any read; the
 * used-by count is additionally scoped by joining attachments to `agents`
 * (which carry `workspace_id`).
 */

export interface RepoLocator {
  id: string;
  clonePath: string | null;
}

export interface SnapshotDoc {
  path: string;
  type: ContextDocType;
  sizeBytes: number;
}

export interface IndexStateRow {
  lastIndexedAt: Date | null;
  filesIndexed: number;
}

export class ProjectContextRepository {
  constructor(private db: Db) {}

  /** Raw stored `context_root_names` setting value for a workspace (or undefined
   * when unset). Parsing/defaulting is the service's concern. */
  async getContextRootNamesSetting(workspaceId: string): Promise<unknown> {
    const [row] = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(
        and(
          eq(t.settings.workspaceId, workspaceId),
          eq(t.settings.key, 'context_root_names'),
        ),
      );
    return row?.value;
  }

  /** Resolve a repo (scoped to workspace). Undefined if absent / cross-tenant. */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoLocator | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** The current doc-index snapshot for a repo (path-sorted for stable output). */
  async listDocs(repoId: string): Promise<SnapshotDoc[]> {
    const rows = await this.db
      .select({
        path: t.repoContextDocs.path,
        type: t.repoContextDocs.type,
        sizeBytes: t.repoContextDocs.sizeBytes,
      })
      .from(t.repoContextDocs)
      .where(eq(t.repoContextDocs.repoId, repoId))
      .orderBy(t.repoContextDocs.path);
    return rows;
  }

  /** Whether a repo-relative path is part of the repo's current doc-index
   * snapshot. Used to scope the content read to discovered docs (and to 404
   * anything else, including traversal attempts). */
  async hasDoc(repoId: string, path: string): Promise<boolean> {
    const [row] = await this.db
      .select({ path: t.repoContextDocs.path })
      .from(t.repoContextDocs)
      .where(and(eq(t.repoContextDocs.repoId, repoId), eq(t.repoContextDocs.path, path)));
    return !!row;
  }

  /** Index state for a repo, or null when it has never been indexed. */
  async getIndexState(repoId: string): Promise<IndexStateRow | null> {
    const [row] = await this.db
      .select({
        lastIndexedAt: t.repoContextIndexState.lastIndexedAt,
        filesIndexed: t.repoContextIndexState.filesIndexed,
      })
      .from(t.repoContextIndexState)
      .where(eq(t.repoContextIndexState.repoId, repoId));
    return row ?? null;
  }

  /**
   * Replace the repo's doc-index snapshot wholesale and bump its state — in ONE
   * transaction, so a concurrent read never sees a half-written snapshot
   * (delete-all-then-insert, mirroring the conventions/agent-skills pattern).
   */
  async replaceSnapshot(repoId: string, docs: SnapshotDoc[]): Promise<IndexStateRow> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.delete(t.repoContextDocs).where(eq(t.repoContextDocs.repoId, repoId));
      if (docs.length > 0) {
        await tx.insert(t.repoContextDocs).values(
          docs.map((d) => ({
            repoId,
            path: d.path,
            type: d.type,
            sizeBytes: d.sizeBytes,
          })),
        );
      }
      await tx
        .insert(t.repoContextIndexState)
        .values({ repoId, lastIndexedAt: now, filesIndexed: docs.length })
        .onConflictDoUpdate({
          target: t.repoContextIndexState.repoId,
          set: { lastIndexedAt: now, filesIndexed: docs.length },
        });
    });
    return { lastIndexedAt: now, filesIndexed: docs.length };
  }

  /**
   * "Used by N agents" per path (Decision D9): counts DISTINCT agents that either
   * attach the path directly OR inherit it via a linked skill. Scoped to the
   * workspace by joining both attachment sources to `agents.workspace_id`.
   * Returns a path → count map (paths with no users are simply absent).
   */
  async usedByAgentCounts(
    workspaceId: string,
    paths: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (paths.length === 0) return result;

    // Direct: agent_context_docs ⋈ agents (workspace-scoped).
    const direct = await this.db
      .select({ agentId: t.agentContextDocs.agentId, path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agents.id, t.agentContextDocs.agentId))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          inArray(t.agentContextDocs.path, paths),
        ),
      );

    // Inherited: skill_context_docs ⋈ agent_skills ⋈ agents (workspace-scoped).
    const inherited = await this.db
      .select({ agentId: t.agentSkills.agentId, path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skillContextDocs.skillId))
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          inArray(t.skillContextDocs.path, paths),
        ),
      );

    // Union distinct (path, agentId) pairs, then count agents per path.
    const byPath = new Map<string, Set<string>>();
    for (const row of [...direct, ...inherited]) {
      let set = byPath.get(row.path);
      if (!set) {
        set = new Set<string>();
        byPath.set(row.path, set);
      }
      set.add(row.agentId);
    }
    for (const [path, agents] of byPath) result.set(path, agents.size);
    return result;
  }
}
