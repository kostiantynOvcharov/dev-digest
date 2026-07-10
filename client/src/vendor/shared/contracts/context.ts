import { z } from 'zod';

/**
 * Project Context DTOs (SPEC-01) — manual doc-attachment feature. NOT the
 * server's `db/schema/context.ts` repo-intel code-indexing tables; this is
 * markdown discovery + agent/skill attachment.
 *
 * D1: the run-trace contract (`trace.ts`) is UNCHANGED by this feature —
 * `prompt_assembly.specs` / `specs_read` already carry the injected block and
 * paths. Nothing here duplicates or renames those fields.
 */

// ---- Discovered doc type badge (derived from the matched root folder) ----
export const ContextDocType = z.enum(['specs', 'docs', 'insights']);
export type ContextDocType = z.infer<typeof ContextDocType>;

/** One markdown doc found under a configured root (Project Context page list
 * item). `used_by_agents` counts direct attachments + skill-inherited usage
 * (Decision D9). */
export const DiscoveredDoc = z.object({
  path: z.string(),
  type: ContextDocType,
  size_bytes: z.number().int().nonnegative(),
  used_by_agents: z.number().int().nonnegative(),
});
export type DiscoveredDoc = z.infer<typeof DiscoveredDoc>;

/** The raw markdown content of a single discovered doc, for the Project
 * Context page's safe preview (AC-5). Read through a path-traversal guard on the
 * server (resolve-within-clone); the absolute clone path is NEVER surfaced. */
export const DocContent = z.object({
  path: z.string(),
  content: z.string(),
});
export type DocContent = z.infer<typeof DocContent>;

/** Doc-index status for a repo: files count + last-indexed time only — NO
 * chunk count (Decision D8). Named `ContextIndexStatus` (not `IndexStatus`) to
 * avoid colliding with the pre-existing (unrelated, repo-intel-scaffold)
 * `IndexStatus` already exported from `platform.ts`. */
export const ContextIndexStatus = z.object({
  files_indexed: z.number().int().nonnegative(),
  last_indexed_at: z.string().nullable(),
});
export type ContextIndexStatus = z.infer<typeof ContextIndexStatus>;

/** A doc manually attached to an agent, in attach order. `missing` is true
 * when the path no longer exists in the latest doc-index snapshot (Decision
 * D6 — flagged, never auto-detached). */
export const AgentContextLink = z.object({
  agent_id: z.string(),
  path: z.string(),
  order: z.number().int(),
  missing: z.boolean(),
});
export type AgentContextLink = z.infer<typeof AgentContextLink>;

/** A doc attached to a skill; every agent that loads the skill inherits it at
 * run assembly (placed before the agent's own attached docs — Decision D2). */
export const SkillContextLink = z.object({
  skill_id: z.string(),
  path: z.string(),
  order: z.number().int(),
  missing: z.boolean(),
});
export type SkillContextLink = z.infer<typeof SkillContextLink>;
