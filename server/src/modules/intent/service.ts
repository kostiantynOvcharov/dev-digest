import { Intent } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { AppError, ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import { buildHunkHeaderText, buildIntentMessages } from './helpers.js';

/** A minimal log sink (RunLogger satisfies this) for the token-savings line. */
export interface IntentLog {
  info(msg: string): void;
}

/**
 * Intent Layer service — derives a PR's motivation + scope with a CHEAP
 * flash-class model before the (expensive) review runs.
 *
 * Input is deliberately small: PR title + body (inline plan/spec honoured) +
 * the changed-files list with hunk headers ONLY (no diff bodies). The result is
 * persisted per-PR in `pr_intent` and injected into the review prompt to keep
 * the reviewer on-scope.
 *
 * Data access goes through `container.reviewRepo` (the cross-cutting repository
 * that owns the `pr_intent`/`pull_requests`/`pr_files` tables) — never a
 * cross-module code import, per the onion boundary rules. The model is resolved
 * from Settings (`resolveFeatureModel`, feature id `review_intent`), never
 * hardcoded.
 */
export class IntentService {
  constructor(private container: Container) {}

  private get repo() {
    return this.container.reviewRepo;
  }

  /** The stored intent for a PR (workspace-scoped), or undefined if none yet. */
  async get(workspaceId: string, prId: string): Promise<Intent | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return this.repo.getIntent(prId);
  }

  /**
   * Compute (or recompute) the intent and persist it. This is a PRIMARY user
   * action (the Recompute button), so configuration/provider errors SURFACE as
   * typed errors rather than vanishing — mirroring `ConventionsService.extract`.
   */
  async compute(workspaceId: string, prId: string, log?: IntentLog): Promise<Intent> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // (1) Build the cheap input: title + body + hunk-headers-only (no bodies).
    const { text: hunkHeaders, fullDiffChars } = buildHunkHeaderText(
      await this.repo.getPrFiles(prId),
    );

    // (2) One structured call to the cheap model. Let configuration/provider
    // errors propagate (wrapping only unexpected, non-domain failures).
    const model = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
    const llm = await this.container.llm(model.provider);
    const messages = buildIntentMessages(pull.title, pull.body, hunkHeaders);

    let data: Intent;
    let tokensIn = 0;
    try {
      const res = await llm.completeStructured({
        model: model.model,
        schema: Intent,
        schemaName: 'Intent',
        messages,
      });
      data = res.data;
      tokensIn = res.tokensIn;
    } catch (err) {
      if (err instanceof AppError) throw err; // e.g. ConfigError(missing key)
      throw new ExternalServiceError(
        `Intent classification model call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // (3) Token-savings log: hunk-headers-only vs. an estimate of the full diff.
    const estFullDiffTokens = Math.ceil(fullDiffChars / 4); // ~4 chars/token
    const saved = Math.max(0, estFullDiffTokens - tokensIn);
    const pct = estFullDiffTokens > 0 ? Math.round((saved / estFullDiffTokens) * 100) : 0;
    log?.info(
      `intent: hunk-headers-only sent — ${tokensIn} tokens in vs ~${estFullDiffTokens} est. full-diff tokens (~${saved} saved, ${pct}%)`,
    );

    // (4) Normalize (defensive against empty/missing arrays) and persist.
    const normalized: Intent = {
      intent: data.intent,
      in_scope: data.in_scope ?? [],
      out_of_scope: data.out_of_scope ?? [],
    };
    await this.repo.upsertIntent(prId, normalized);
    return normalized;
  }

  /**
   * Used by the review flow: return the stored intent, computing it once if
   * absent. Recompute is button-only, so an existing intent is reused as-is.
   */
  async generateIfMissing(workspaceId: string, prId: string, log?: IntentLog): Promise<Intent> {
    const existing = await this.repo.getIntent(prId);
    return existing ?? this.compute(workspaceId, prId, log);
  }
}
