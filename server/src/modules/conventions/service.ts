import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ChatMessage } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { AppError, ExternalServiceError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { ConventionsRepository, type RepoLocator } from './repository.js';
import {
  composeSkillBody,
  groundCandidates,
  toConventionDto,
  type ConventionCandidateDto,
  type ConventionStatus,
  type RawConventionCandidate,
} from './helpers.js';
import { CONFIG_GLOBS, MAX_FILE_CHARS, SAMPLE_FILE_COUNT, SCHEMA_NAME } from './constants.js';

/**
 * Conventions service. Orchestrates the extraction pipeline:
 *   1. sample selection (pure code, no model) — config files + ranked samples,
 *   2. ONE structured LLM call proposing candidates with file+line evidence,
 *   3. the grounding gate (re-derive snippet, verify the quote — drop ungrounded),
 *   4. persist survivors as `pending` rows (replacing prior pending rows).
 *
 * Best-effort per server/CLAUDE.md: an unindexed/uncloned repo yields `[]`, never
 * a throw. The model is resolved from Settings (`resolveFeatureModel`), never
 * hardcoded.
 */

/** What the model returns (untrusted until grounded). */
const CandidatesSchema = z.object({
  candidates: z
    .array(
      z.object({
        category: z.string().nullable(),
        rule: z.string(),
        evidence_path: z.string(),
        evidence_snippet: z.string(),
        evidence_start_line: z.number().int(),
        evidence_end_line: z.number().int(),
        confidence: z.number(),
      }),
    ),
});

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  /** Persisted candidates for the page (workspace + repo scoped). */
  async list(workspaceId: string, repoId: string): Promise<ConventionCandidateDto[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  /** Accept/reject/edit a single candidate. Undefined if it doesn't exist. */
  async update(
    workspaceId: string,
    id: string,
    patch: { status?: ConventionStatus; rule?: string },
  ): Promise<ConventionCandidateDto | undefined> {
    const row = await this.repo.patch(workspaceId, id, patch);
    return row ? toConventionDto(row) : undefined;
  }

  /**
   * Run the extraction pipeline synchronously and return the surviving
   * candidates (freshly-persisted `pending` rows).
   *
   * Unlike review-time context enrichment (which is best-effort and silent),
   * extraction is a PRIMARY user action: a misconfiguration must surface, not
   * vanish into an empty list. We throw a typed error the UI can show — 404 for
   * a missing repo, 422 for an un-synced repo, and the provider's own error
   * (e.g. ConfigError "OPENAI_API_KEY is not configured") for an LLM failure.
   * An empty result is reserved for the genuine "model found nothing groundable".
   */
  async extract(workspaceId: string, repoId: string): Promise<ConventionCandidateDto[]> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    if (!repo.clonePath) {
      throw new ValidationError('Repository is not cloned yet — sync it before extracting.');
    }

    // (1) Sample selection — pure code, no model.
    const files = await this.collectSamples(repo);
    if (files.size === 0) {
      throw new ValidationError(
        'No sample files found — index the repo (repo-intel) before extracting.',
      );
    }

    // (2) One structured model call. Let configuration/provider errors propagate
    // (wrapping only unexpected, non-domain failures) so the UI shows the reason.
    let raw: RawConventionCandidate[];
    try {
      raw = await this.proposeCandidates(workspaceId, files);
    } catch (err) {
      if (err instanceof AppError) throw err; // e.g. ConfigError(missing key) → 500 w/ message
      throw new ExternalServiceError(
        `Convention extraction model call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // (3) Grounding gate — drop ungrounded; re-derive every snippet from code.
    const grounded = groundCandidates(raw, files);

    // (4) Persist survivors as fresh `pending` rows (reconcile prior scan).
    await this.repo.deletePending(workspaceId, repoId);
    const rows = await this.repo.insertPending(workspaceId, repoId, grounded);
    return rows.map(toConventionDto);
  }

  /**
   * Compose (NO persist) a merged skill draft from the repo's ACCEPTED
   * candidates. One `## <rule>` section each with a located, fenced snippet.
   */
  async skillDraft(
    workspaceId: string,
    repoId: string,
  ): Promise<{ name: string; description: string; type: 'convention'; body: string }> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    const accepted = (await this.repo.listAccepted(workspaceId, repoId)).map(toConventionDto);
    const label = repo?.fullName ?? 'this repo';
    return {
      name: `${repo?.fullName ?? 'repo'}-conventions`,
      description: `House conventions extracted from ${label} (${accepted.length} rule${accepted.length === 1 ? '' : 's'}).`,
      type: 'convention',
      body: composeSkillBody(accepted),
    };
  }

  // ---- pipeline internals -------------------------------------------------

  /**
   * Read config files (if present) + the top-ranked repo files into a
   * path→contents map. Per-file read failures are skipped (best-effort) —
   * a missing file simply doesn't enter the map.
   */
  private async collectSamples(repo: RepoLocator): Promise<Map<string, string>> {
    const clonePath = repo.clonePath!;
    const ranked = await this.container.repoIntel.getConventionSamples(repo.id, SAMPLE_FILE_COUNT);
    // Config files first, then ranked samples — dedupe while preserving order.
    const paths = Array.from(new Set([...CONFIG_GLOBS, ...ranked]));

    const files = new Map<string, string>();
    for (const relPath of paths) {
      try {
        const content = await readFile(join(clonePath, relPath), 'utf8');
        files.set(relPath, content);
      } catch {
        // File absent / unreadable — skip it (config files are optional).
      }
    }
    return files;
  }

  /** One structured LLM call proposing candidates. Throws on provider failure. */
  private async proposeCandidates(
    workspaceId: string,
    files: Map<string, string>,
  ): Promise<RawConventionCandidate[]> {
    const model = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(model.provider);
    const messages = buildMessages(files);

    const res = await llm.completeStructured({
      model: model.model,
      schema: CandidatesSchema,
      schemaName: SCHEMA_NAME,
      messages,
    });
    return res.data.candidates ?? [];
  }
}

/** Build the system+user messages: labelled sampled files + the extraction ask. */
function buildMessages(files: Map<string, string>): ChatMessage[] {
  const blocks: string[] = [];
  for (const [path, content] of files) {
    const clipped =
      content.length > MAX_FILE_CHARS ? `${content.slice(0, MAX_FILE_CHARS)}\n…(truncated)` : content;
    blocks.push(`### FILE: ${path}\n\`\`\`\n${clipped}\n\`\`\``);
  }

  const system: ChatMessage = {
    role: 'system',
    content:
      'You extract HOUSE CONVENTIONS (recurring, project-specific coding patterns) from a ' +
      'repository sample. For each convention, cite ONE concrete piece of evidence: the exact ' +
      'file path, the 1-based inclusive start/end line range, and the VERBATIM code snippet at ' +
      'that range (copied exactly from the file shown). Only propose a convention you can ground ' +
      'in the provided files; never invent file paths, line numbers, or code. Prefer fewer, ' +
      'well-evidenced conventions over many weak ones. `category` is a short tag (e.g. "naming", ' +
      '"imports", "errors"); `confidence` is 0..1.',
  };

  const user: ChatMessage = {
    role: 'user',
    content:
      `Here are sampled files from the repository. Identify the house conventions and return ` +
      `candidates with grounded evidence.\n\n${blocks.join('\n\n')}`,
  };

  return [system, user];
}
