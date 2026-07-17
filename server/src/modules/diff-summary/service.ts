import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { AppError, ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import { classifyFile } from '../pulls/classifier.js';
import { hunkHash } from '../pulls/hunk-hash.js';
import { buildDiffSummaryMessages, DiffSummaries } from './helpers.js';

/** Minimal log sink (Fastify's `req.log` satisfies this). */
export interface DiffSummaryLog {
  info(msg: string): void;
}

/** One stored entry: the patch hash it was generated against + the sentence. */
export interface DiffSummaryEntry {
  hunk_hash: string;
  summary: string;
}
export type DiffSummaryMap = Record<string, DiffSummaryEntry>;

/** Only the Core-logic files get a summary — cap the batch to bound cost/latency. */
const MAX_CORE_FILES = 15;

/**
 * "What this does" per-file Diff Summary — generates ONE batched LLM call over
 * the PR's Core-logic files (per the Smart Diff classifier), caches each
 * summary per-file keyed by a hash of the file's patch (`hunkHash`), and
 * reuses a cached entry whose hash still matches the file's CURRENT patch.
 *
 * Cross-cutting data is reached ONLY through `container.reviewRepo` (never a
 * cross-module code import); `classifyFile`/`hunkHash` are imported from the
 * sibling `pulls` module because they are PURE, I/O-free helpers — the onion
 * boundary only forbids importing another module's `service.ts`/`repository.ts`
 * (cf. how `brief/service.ts` imports `composeSmartDiff`).
 *
 * Error semantics: generation is a PRIMARY user action, so LLM/config failures
 * SURFACE (rethrow `AppError`, wrap the rest in `ExternalServiceError`) and the
 * cache is NEVER updated with a partial/empty result on failure — the upsert
 * only runs after the LLM call (if any) has already succeeded.
 */
export class DiffSummaryService {
  constructor(private container: Container) {}

  private get repo() {
    return this.container.reviewRepo;
  }

  async generate(
    workspaceId: string,
    prId: string,
    log?: DiffSummaryLog,
  ): Promise<DiffSummaryMap> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // ---- (1) Core-logic files only, capped ---------------------------------
    const prFiles = await this.repo.getPrFiles(prId);
    const coreFiles = prFiles.filter((f) => classifyFile(f.path) === 'core');
    const capped = coreFiles.slice(0, MAX_CORE_FILES);
    if (coreFiles.length > MAX_CORE_FILES) {
      log?.info(
        `diff-summary: ${coreFiles.length} core file(s) — capped to ${MAX_CORE_FILES}`,
      );
    }

    // ---- (2) Reuse cache: only (re)generate missing/stale entries ----------
    const existing = (await this.repo.getDiffSummary(prId)) ?? {};
    const finalMap: DiffSummaryMap = { ...existing };

    const toGenerate: { path: string; patch: string | null; hash: string }[] = [];
    for (const f of capped) {
      const hash = hunkHash(f.patch);
      const cached = finalMap[f.path];
      if (!cached || cached.hunk_hash !== hash) {
        toGenerate.push({ path: f.path, patch: f.patch ?? null, hash });
      }
    }

    // ---- (3) ONE structured LLM call for everything missing/stale ---------
    if (toGenerate.length > 0) {
      const messages = buildDiffSummaryMessages(
        toGenerate.map((f) => ({ path: f.path, patch: f.patch })),
      );
      const model = await resolveFeatureModel(this.container, workspaceId, 'diff_summary');
      const llm = await this.container.llm(model.provider);

      let data: DiffSummaries;
      try {
        const res = await llm.completeStructured({
          model: model.model,
          schema: DiffSummaries,
          schemaName: 'DiffSummaries',
          messages,
        });
        data = res.data;
      } catch (err) {
        if (err instanceof AppError) throw err; // e.g. ConfigError(missing key)
        throw new ExternalServiceError(
          `Diff-summary model call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const byPath = new Map(data.summaries.map((s) => [s.path, s.summary]));
      for (const f of toGenerate) {
        const summary = byPath.get(f.path);
        // A path the model didn't return stays uncached (or keeps its previous
        // — now provably stale — entry): never fabricate a summary, and the
        // GET reconciliation already treats a hash mismatch as "no summary".
        if (summary !== undefined && summary.trim().length > 0) {
          finalMap[f.path] = { hunk_hash: f.hash, summary };
        }
      }

      log?.info(`diff-summary: generated ${toGenerate.length} file(s) in one call`);
    }

    // ---- (4) Persist the merged map (only reached after any LLM call OK) --
    await this.repo.upsertDiffSummary(prId, finalMap);
    return finalMap;
  }
}
