import type { BlastRadiusResponse } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { BlastResult } from '../repo-intel/types.js';
import { NotFoundError } from '../../platform/errors.js';
import { reshapeBlast } from './helpers.js';

/**
 * Blast Radius service — the PR impact map ("what can these changes break?").
 *
 * Deliberately AI-free: it makes NO model call. Everything is READ from the
 * pre-built repo-intel index via the facade `container.repoIntel.*` (never the
 * pipeline directly, per server/CLAUDE.md). PR + changed-files come from the
 * cross-cutting `container.reviewRepo` (owns `pull_requests`/`pr_files`), so no
 * new table or repository is needed — same wiring as the Intent module.
 *
 * Repo-intel reads are best-effort: on an unindexed/degraded repo the facade
 * returns a `degraded` result (never throws), which we surface as a status/reason
 * for the UI's partial/degraded badge rather than failing the route.
 */
export class BlastService {
  constructor(private container: Container) {}

  private get repo() {
    return this.container.reviewRepo;
  }

  async get(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const changedFiles = (await this.repo.getPrFiles(prId)).map((f) => f.path);

    // The engine: symbols → callers → impacted endpoints/crons, read from the
    // index (persistent path) or a ripgrep best-effort fallback (degraded).
    const result = await this.container.repoIntel.getBlastRadius(pull.repoId, changedFiles);

    const { status, reason } = await this.resolveStatus(pull.repoId, result);
    const { blast, counts } = reshapeBlast(result);

    // Prior PRs that touched the same files — from the PR history, not the
    // index. Best-effort: an empty list is a valid answer, never a throw.
    const priorPrs = await this.repo.priorPrsTouchingFiles(
      workspaceId,
      pull.repoId,
      prId,
      changedFiles,
    );

    return {
      ...blast,
      status,
      degraded: result.degraded ?? false,
      reason,
      counts,
      prior_prs: priorPrs.map((p) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        opened_at: p.openedAt ? p.openedAt.toISOString() : null,
        status: p.status,
      })),
    };
  }

  /**
   * Map the index state to a UI status. `getIndexState` never throws and
   * synthesizes a degraded row when nothing is indexed; we translate "no usable
   * index" (no data / flag off) to `'none'` so the client shows an empty state
   * instead of a scary "degraded" badge over an empty tree.
   */
  private async resolveStatus(
    repoId: string,
    result: BlastResult,
  ): Promise<{ status: BlastRadiusResponse['status']; reason: string | null }> {
    try {
      const state = await this.container.repoIntel.getIndexState(repoId);
      const noIndex =
        state.degraded === true &&
        (state.degradedReason === 'no_data' || state.degradedReason === 'flag_off');
      const status = noIndex ? 'none' : state.status;
      const reason = result.reason ?? state.degradedReason ?? null;
      return { status, reason };
    } catch {
      return { status: 'none', reason: result.reason ?? null };
    }
  }
}
