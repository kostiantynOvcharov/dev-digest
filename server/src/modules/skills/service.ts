import type { Container } from '../../platform/container.js';
import type {
  Agent,
  Skill,
  SkillContextLink,
  SkillImportPreview,
  SkillSource,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { SkillsRepository } from './repository.js';
import { agentRowToDto, toSkillDto, toSkillVersionDto, extractSkillFromUpload } from './helpers.js';
import { DEFAULT_SKILL_SOURCE, MAX_IMPORT_BYTES } from './constants.js';

/**
 * Skills service. Business logic for the Skills page (reusable rule/rubric text
 * blocks) and the agent editor's Skills tab. A skill = name + description +
 * type + body (markdown) — pure text + config, never executable. Body changes
 * are versioned via `skill_versions` (repository).
 */

// Re-exported for parity with the agents module's public surface.
export { toSkillDto } from './helpers.js';

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      type: input.type,
      source: input.source ?? DEFAULT_SKILL_SOURCE,
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.evidence_files !== undefined ? { evidenceFiles: input.evidence_files } : {}),
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /** Body history for a skill, newest first. Workspace-scoped (route → 404). */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /** Agents that link this skill (Stats tab). Workspace-scoped (route → 404). */
  async agentsUsing(workspaceId: string, skillId: string): Promise<Agent[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.agentsUsing(workspaceId, skillId);
    return rows.map(agentRowToDto);
  }

  // ---- Context docs (SPEC-01) — attach/read markdown docs on a skill --------

  /** Attached context docs for a skill as SkillContextLink[] (ordered), each
   * flagged `missing` when its path is no longer in the doc-index snapshot.
   * Workspace-scoped: undefined when the skill isn't in this workspace (→ 404). */
  async contextLinks(
    workspaceId: string,
    skillId: string,
  ): Promise<SkillContextLink[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.buildContextLinks(workspaceId, skillId);
  }

  /** Read the attached docs + derive the `missing` flag against the snapshot. */
  private async buildContextLinks(
    workspaceId: string,
    skillId: string,
  ): Promise<SkillContextLink[]> {
    const docs = await this.repo.linkedContextDocs(skillId);
    const existing = await this.repo.existingSnapshotPaths(
      workspaceId,
      docs.map((d) => d.path),
    );
    return docs.map((d) => ({
      skill_id: skillId,
      path: d.path,
      order: d.order,
      missing: !existing.has(d.path),
    }));
  }

  /**
   * Set / reorder the whole ordered set of attached docs. Replaces the set in the
   * given order. Returns the resulting ordered links (undefined → 404).
   */
  async setContextDocs(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<SkillContextLink[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    await this.repo.setContextDocs(skillId, paths);
    return this.buildContextLinks(workspaceId, skillId);
  }

  /** Attach a single doc path (append or set order) — additive to existing. */
  async linkContextDoc(
    workspaceId: string,
    skillId: string,
    path: string,
    order?: number,
  ): Promise<SkillContextLink[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const existing = await this.repo.linkedContextDocs(skillId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkContextDoc(skillId, path, resolvedOrder);
    return this.buildContextLinks(workspaceId, skillId);
  }

  /**
   * Parse an uploaded .md/.zip into a preview WITHOUT persisting it. Nothing in
   * the archive is executed; non-markdown entries come back in `ignored_files`.
   * The skill is created only on a subsequent confirm (POST /skills).
   */
  previewImport(filename: string, contentBase64: string): SkillImportPreview {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(contentBase64, 'base64'));
    } catch {
      throw new ValidationError('content_base64 is not valid base64');
    }
    if (bytes.length === 0) throw new ValidationError('The uploaded file is empty');
    if (bytes.length > MAX_IMPORT_BYTES) {
      throw new ValidationError(
        `Import is too large (${bytes.length} bytes; max ${MAX_IMPORT_BYTES})`,
      );
    }
    return extractSkillFromUpload(filename, bytes);
  }
}
