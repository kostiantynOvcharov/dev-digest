import { z } from 'zod';
import type { ContextIndexStatus, DiscoveredDoc, DocContent } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { ProjectContextRepository } from './repository.js';

/**
 * Default doc-scan root folder names — mirrors the `context_root_names` default
 * in the `SettingsKnown` contract (`vendor/shared/contracts/platform.ts`). Kept
 * as a local literal (not read from the contract value at runtime) so discovery
 * is robust to the workspace never having persisted the setting.
 */
const DEFAULT_CONTEXT_ROOT_NAMES = ['specs', 'docs', 'insights'] as const;

/**
 * Project Context service (SPEC-01) — discover markdown docs under the
 * workspace's configured root folders and expose the list + index status +
 * a synchronous reindex for a repo.
 *
 * Onion: reaches the clone ONLY via the repo-intel facade
 * (`container.repoIntel.discoverDocs`), never the pipeline directly. Reads the
 * doc-index snapshot and the used-by count via its own repository.
 *
 * Degradation contract:
 *   - list / index-state on a never-indexed repo → EMPTY state, never an error
 *     (graceful degradation — a freshly-cloned repo shows "not indexed yet").
 *   - reindex is a PRIMARY user action, so a misconfiguration (missing repo /
 *     un-cloned repo) SURFACES as a typed error rather than a silent empty
 *     result (server/INSIGHTS: don't swallow errors on a primary action).
 */
export class ProjectContextService {
  private repo: ProjectContextRepository;

  constructor(private container: Container) {
    this.repo = new ProjectContextRepository(container.db);
  }

  /** Discovered docs for the Project Context page (path, badge, size, used-by). */
  async listDocs(workspaceId: string, repoId: string): Promise<DiscoveredDoc[]> {
    await this.requireRepo(workspaceId, repoId);

    const docs = await this.repo.listDocs(repoId);
    const usedBy = await this.repo.usedByAgentCounts(
      workspaceId,
      docs.map((d) => d.path),
    );

    return docs.map((d) => ({
      path: d.path,
      type: d.type,
      size_bytes: d.sizeBytes,
      used_by_agents: usedBy.get(d.path) ?? 0,
      // coverage is a placeholder this iteration (Decision D7) — omitted.
    }));
  }

  /**
   * Raw markdown of one discovered doc, for the page's safe preview (AC-5).
   *
   * The path MUST belong to the repo's current snapshot — this scopes the read
   * to discovered docs and yields a clean 404 for anything else (a stale path,
   * or a `../etc/passwd`-style traversal that was never indexed). The actual
   * file read goes through the repo-intel facade's path-traversal guard (clone
   * reached ONLY via the facade). Any read failure maps to a 404 so the absolute
   * clone path / fs error is never leaked to the client.
   */
  async getDocContent(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<DocContent> {
    await this.requireRepo(workspaceId, repoId);

    const inSnapshot = await this.repo.hasDoc(repoId, path);
    if (!inSnapshot) throw new NotFoundError('Doc not found in the current index');

    try {
      const content = await this.container.repoIntel.readDocContent(repoId, path);
      return { path, content };
    } catch {
      // Never surface the absolute clone path or the underlying fs error.
      throw new NotFoundError('Doc content could not be read');
    }
  }

  /**
   * Files count + last-indexed time only (Decision D8 — NO chunk count). A
   * never-indexed repo returns a valid empty state (`files_indexed: 0`,
   * `last_indexed_at: null`), NOT an error.
   */
  async getIndexState(workspaceId: string, repoId: string): Promise<ContextIndexStatus> {
    await this.requireRepo(workspaceId, repoId);
    const state = await this.repo.getIndexState(repoId);
    return {
      files_indexed: state?.filesIndexed ?? 0,
      last_indexed_at: state?.lastIndexedAt ? state.lastIndexedAt.toISOString() : null,
    };
  }

  /**
   * Synchronous rescan: walk the clone for `.md` under the configured roots and
   * REPLACE the snapshot + bump index-state in one transaction. Returns the new
   * status. Surfaces a typed error when the repo is missing or not yet cloned.
   */
  async reindex(workspaceId: string, repoId: string): Promise<ContextIndexStatus> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (!repo.clonePath) {
      throw new ValidationError('Repository is not cloned yet — sync it before reindexing.');
    }

    const rootNames = await this.resolveRootNames(workspaceId);
    const docs = await this.container.repoIntel.discoverDocs(repoId, rootNames);
    const state = await this.repo.replaceSnapshot(repoId, docs);

    return {
      files_indexed: state.filesIndexed,
      last_indexed_at: state.lastIndexedAt ? state.lastIndexedAt.toISOString() : null,
    };
  }

  // ---- internals ----------------------------------------------------------

  /** Resolve a workspace-scoped repo or throw NotFound (tenancy guard). */
  private async requireRepo(workspaceId: string, repoId: string) {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  /**
   * The workspace's configured root folder names (the `context_root_names`
   * setting), falling back to the contract default
   * (`DEFAULT_CONTEXT_ROOT_NAMES`) when unset, invalid, or empty.
   */
  private async resolveRootNames(workspaceId: string): Promise<string[]> {
    const stored = await this.repo.getContextRootNamesSetting(workspaceId);
    const parsed = z.array(z.string()).safeParse(stored);
    if (parsed.success && parsed.data.length > 0) return parsed.data;
    // Unset / invalid / empty → the contract default.
    return [...DEFAULT_CONTEXT_ROOT_NAMES];
  }
}
