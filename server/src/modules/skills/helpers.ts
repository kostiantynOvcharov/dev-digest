import type {
  Agent,
  CiFailOn,
  Provider,
  ReviewStrategy,
  Skill,
  SkillImportIgnored,
  SkillImportPreview,
  SkillSource,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { unzipSync } from 'fflate';
import { ValidationError } from '../../platform/errors.js';
import type { AgentRow, SkillRow, SkillVersionRow } from '../../db/rows.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping and the upload
 * extractor. The extractor is pure (no fs/network): it decodes/unzips an
 * in-memory buffer and returns a preview. It NEVER executes anything from the
 * archive — non-markdown entries are listed as ignored, not run.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/**
 * Map an agent row to the public `Agent` DTO — a LOCAL copy of agents/helpers'
 * `toAgentDto`. The Stats tab's "agents using this skill" needs Agent[], but a
 * module→module import (`agents/helpers`) trips `arch:check`; a repo reading the
 * sibling `agents` TABLE is fine, so we map here instead of importing the mapper.
 */
export function agentRowToDto(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider as Provider,
    model: row.model,
    system_prompt: row.systemPrompt,
    output_schema: row.outputSchema ?? null,
    enabled: row.enabled,
    version: row.version,
    strategy: row.strategy as ReviewStrategy,
    ci_fail_on: row.ciFailOn as CiFailOn,
    repo_intel: row.repoIntel,
  };
}

/** Map a persisted `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/** True when a patch changes the body relative to the existing row — a body
 *  change bumps the version and snapshots `skill_versions`. Name/description/
 *  type/enabled changes do NOT bump (mirrors agents: only the prompt body is
 *  versioned). */
export function isBodyChange(existing: Pick<SkillRow, 'body'>, patch: { body?: string }): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

const decoder = new TextDecoder('utf-8', { fatal: false });
const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);
const depth = (path: string) => path.split('/').length;

/** Skill name = the first markdown H1, else the file stem. */
export function deriveName(filename: string, body: string): string {
  const heading = body.split('\n').find((l) => /^#\s+\S/.test(l.trim()));
  if (heading) return heading.trim().replace(/^#\s+/, '').trim().slice(0, 120);
  const stem = (filename.split('/').pop() ?? filename).replace(/\.(md|markdown|zip)$/i, '');
  return stem || 'imported-skill';
}

/** Description = the first non-heading, non-empty line (truncated). */
export function deriveDescription(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    return line.slice(0, 160);
  }
  return '';
}

/** Best-effort type inference; defaults to 'custom'. */
export function inferType(name: string, body: string): SkillType {
  const hay = `${name}\n${body}`.toLowerCase();
  if (/\b(security|secret|injection|ssrf|vuln|exfil)\b/.test(hay)) return 'security';
  if (/\b(rubric|score|rating|criteria|checklist)\b/.test(hay)) return 'rubric';
  if (/\b(convention|style|naming|lint)\b/.test(hay)) return 'convention';
  return 'custom';
}

const EXECUTABLE_EXT = new Set([
  'sh', 'bash', 'zsh', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'pl', 'php',
  'exe', 'bin', 'bat', 'cmd', 'ps1', 'so', 'dll', 'dylib', 'jar', 'wasm',
]);

function ignoreReason(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  if (EXECUTABLE_EXT.has(ext)) return 'executable — not processed';
  if (isMarkdown(path)) return 'extra markdown — not the skill core';
  return 'asset — not processed';
}

/** Pick the skill's markdown core: SKILL.md, then README.md, then the
 *  shallowest .md (ties broken alphabetically). Returns undefined if none. */
function pickSkillCore(paths: string[]): string | undefined {
  const md = paths.filter(isMarkdown);
  if (md.length === 0) return undefined;
  const byBase = (name: string) =>
    md.find((p) => (p.split('/').pop() ?? '').toLowerCase() === name);
  return (
    byBase('skill.md') ??
    byBase('readme.md') ??
    [...md].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0]
  );
}

/**
 * Extract a skill preview from an uploaded file's bytes — NO persistence, NO
 * execution. `.md`/`.markdown` → the whole file is the body. `.zip` → unzip in
 * memory, take the markdown core as the body, and list every other entry as
 * ignored (with a reason) so the UI can show what was skipped.
 */
export function extractSkillFromUpload(filename: string, bytes: Uint8Array): SkillImportPreview {
  if (!/\.zip$/i.test(filename)) {
    const body = decoder.decode(bytes).trim();
    if (!body) throw new ValidationError('The uploaded file is empty');
    const name = deriveName(filename, body);
    return {
      name,
      description: deriveDescription(body),
      type: inferType(name, body),
      source: 'imported_file',
      body,
      ignored_files: [],
    };
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    throw new ValidationError(`Could not read the archive: ${(err as Error).message}`);
  }
  // Drop directory markers (zero-length, path ends in '/').
  const files = Object.entries(entries).filter(([p]) => !p.endsWith('/'));
  if (files.length === 0) throw new ValidationError('The archive is empty');

  const corePath = pickSkillCore(files.map(([p]) => p));
  if (!corePath) {
    throw new ValidationError('No markdown skill core (e.g. SKILL.md) found in the archive');
  }
  const body = decoder.decode(entries[corePath]!).trim();
  if (!body) throw new ValidationError('The skill markdown in the archive is empty');

  const ignored_files: SkillImportIgnored[] = files
    .filter(([p]) => p !== corePath)
    .map(([p, data]) => ({ path: p, size: data.length, reason: ignoreReason(p) }));

  const name = deriveName(corePath, body);
  return {
    name,
    description: deriveDescription(body),
    type: inferType(name, body),
    source: 'imported_file',
    body,
    ignored_files,
  };
}
