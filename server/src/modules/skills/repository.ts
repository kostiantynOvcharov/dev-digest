import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION, DEFAULT_SKILL_DESCRIPTION } from './constants.js';
import { isBodyChange } from './helpers.js';

/**
 * Skills data-access. Owns `skills` and `skill_versions`. Workspace-scoped
 * throughout. The `agent_skills` link table is owned by the agents repository
 * (the agent side: link/reorder); a skill is the reusable text block here.
 */

import type { AgentRow, SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description?: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

/** A context doc attached to a skill (path + order), from skill_context_docs. */
export interface LinkedContextDocRow {
  path: string;
  order: number;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Delete a skill (scoped to workspace). Versions + agent links cascade.
   *  Returns false if no such skill existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 in skill_versions (immutable snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_SKILL_DESCRIPTION,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_SKILL_VERSION);
    return row!;
  }

  /**
   * Update a skill. A body change bumps the version and snapshots the new body
   * into skill_versions (reproducibility). Other field edits (name/description/
   * type/enabled) do not bump the version.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = isBodyChange(existing, patch);
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  private async snapshotVersion(row: SkillRow, version: number): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, body: row.body })
      .onConflictDoNothing();
  }

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single body snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  /**
   * Agents that link this skill (Stats tab: USED BY + agents-using list).
   * Joins the sibling `agent_skills`/`agents` TABLES (allowed) — we never import
   * the agents module's code. Workspace-scoped, ordered by the link `order`.
   */
  async agentsUsing(workspaceId: string, skillId: string): Promise<AgentRow[]> {
    const rows = await this.db
      .select({ agent: t.agents })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => r.agent);
  }

  // ---- skill_context_docs link table (SPEC-01) ----------------------------
  // Ordered set of markdown doc PATHS attached to a skill; every agent that
  // loads the skill inherits these at run assembly (Decision D2). Mirrors the
  // agent side; the link stores a repo-relative path, not a snapshot FK, so a
  // deleted doc keeps its row and is later flagged "missing" (D6 / AC-19).

  /** Context docs attached to a skill, in `order` ascending. */
  async linkedContextDocs(skillId: string): Promise<LinkedContextDocRow[]> {
    return this.db
      .select({ path: t.skillContextDocs.path, order: t.skillContextDocs.order })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.order));
  }

  /** Attach a doc path to a skill at a given order (idempotent: upserts order). */
  async linkContextDoc(skillId: string, path: string, order: number): Promise<void> {
    await this.db
      .insert(t.skillContextDocs)
      .values({ skillId, path, order })
      .onConflictDoUpdate({
        target: [t.skillContextDocs.skillId, t.skillContextDocs.path],
        set: { order },
      });
  }

  /**
   * Replace the full ordered set of attached doc paths for a skill, assigning
   * order = index (delete-all-then-insert, exactly like `agent.setSkills`).
   */
  async setContextDocs(skillId: string, paths: string[]): Promise<void> {
    await this.db.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
    if (paths.length === 0) return;
    await this.db
      .insert(t.skillContextDocs)
      .values(paths.map((path, i) => ({ skillId, path, order: i })));
  }

  /**
   * Subset of `paths` that STILL exist in some `repo_context_docs` snapshot for a
   * repo in `workspaceId` — used to derive the `missing` flag (AC-19). Reads the
   * sibling snapshot TABLE directly (allowed); never imports project-context code.
   */
  async existingSnapshotPaths(workspaceId: string, paths: string[]): Promise<Set<string>> {
    if (paths.length === 0) return new Set();
    const rows = await this.db
      .selectDistinct({ path: t.repoContextDocs.path })
      .from(t.repoContextDocs)
      .innerJoin(t.repos, eq(t.repos.id, t.repoContextDocs.repoId))
      .where(
        and(eq(t.repos.workspaceId, workspaceId), inArray(t.repoContextDocs.path, paths)),
      );
    return new Set(rows.map((r) => r.path));
  }
}
