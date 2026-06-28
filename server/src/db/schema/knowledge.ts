import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, boolean, integer, vector, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

export const conventions = pgTable('conventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
  rule: text('rule').notNull(),
  // Free-text category used as a badge on the candidate card (e.g. "naming",
  // "imports"). Nullable — the model may omit it.
  category: text('category'),
  evidencePath: text('evidence_path'),
  evidenceSnippet: text('evidence_snippet'),
  // Cited line range (1-based, inclusive). Drives the GitHub deep-link and the
  // `file:line` label. Nullable — re-derived & verified by the grounding gate.
  evidenceStartLine: integer('evidence_start_line'),
  evidenceEndLine: integer('evidence_end_line'),
  confidence: doublePrecision('confidence'),
  // Lifecycle status — source of truth for accept/reject/edit. The legacy
  // `accepted` boolean below is kept in sync (`accepted === status==='accepted'`)
  // so the vendored `ConventionCandidate` contract still validates.
  status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
    .notNull()
    .default('pending'),
  accepted: boolean('accepted').notNull().default(false),
});
