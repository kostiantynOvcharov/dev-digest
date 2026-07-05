import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';

/**
 * Blast Radius end-to-end over the PERSISTENT repo-intel index.
 *
 * Mirrors the acceptance criterion: a PR that changes a shared helper
 * (`src/rate-limit.ts`) shows ≥2 callers and ≥1 impacted endpoint, and each
 * caller carries the `file:line` the UI links to. Seeds the index tables the
 * way the (pre-existing) indexer would, then drives the real route via
 * `app.inject()` — proving NO model call is needed (repo-intel reads only).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const HELPER = 'src/rate-limit.ts';
const CALLER_A = 'src/api/public/index.ts';
const CALLER_B = 'src/api/public/webhooks.ts';

d('GET /pulls/:id/blast (persistent index)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    const { workspaceId } = await seed(db);

    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'pay', fullName: 'acme/pay' })
      .returning();
    const repoId = repo!.id;

    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'deadbeef',
      })
      .returning();
    prId = pr!.id;

    // The PR changes ONLY the shared helper file.
    await db.insert(t.prFiles).values({ prId, path: HELPER, additions: 40, deletions: 5 });

    // A PRIOR merged PR that also touched the helper → should surface under
    // "prior PRs touching these files". A second PR touching an unrelated file
    // must NOT surface.
    const [priorPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 470,
        title: 'Extract rate-limit helper',
        author: 'sam',
        branch: 'refactor/extract-rl',
        base: 'main',
        headSha: 'cafe01',
        status: 'merged',
        openedAt: new Date('2026-06-01T00:00:00Z'),
      })
      .returning();
    await db.insert(t.prFiles).values({ prId: priorPr!.id, path: HELPER, additions: 10, deletions: 2 });

    const [unrelatedPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 400,
        title: 'Unrelated docs change',
        author: 'lee',
        branch: 'docs/readme',
        base: 'main',
        headSha: 'cafe02',
        status: 'merged',
      })
      .returning();
    await db.insert(t.prFiles).values({ prId: unrelatedPr!.id, path: 'README.md', additions: 3, deletions: 0 });

    const repoIntel = new RepoIntelRepository(db);
    await repoIntel.upsertIndexState({
      repoId,
      lastIndexedSha: 'deadbeef',
      indexerVersion: 2,
      status: 'full',
      filesIndexed: 3,
      filesSkipped: 0,
      stats: {},
    });

    // Two changed symbols declared in the helper + one symbol per caller file
    // (so the enclosing-caller-name lookup has rows to resolve).
    await repoIntel.insertSymbols([
      { repoId, path: HELPER, name: 'rateLimit', kind: 'function', line: 10, endLine: 30, exported: true, signature: 'rateLimit(req)', contentHash: 'h1' },
      { repoId, path: HELPER, name: 'bucketKey', kind: 'function', line: 32, endLine: 40, exported: true, signature: 'bucketKey(ip)', contentHash: 'h2' },
      { repoId, path: CALLER_A, name: 'handler', kind: 'function', line: 15, endLine: 30, exported: true, signature: null, contentHash: 'h3' },
      { repoId, path: CALLER_B, name: 'onWebhook', kind: 'function', line: 38, endLine: 60, exported: true, signature: null, contentHash: 'h4' },
    ]);

    // Resolved cross-file callers: `decl_file` points at the changed helper.
    // (insertReferences leaves decl_file NULL — the indexer's resolve step sets
    // it — so we insert directly with it populated.)
    await db.insert(t.references).values([
      { repoId, fromPath: CALLER_A, toSymbol: 'rateLimit', line: 23, declFile: HELPER, contentHash: 'x1' },
      { repoId, fromPath: CALLER_B, toSymbol: 'rateLimit', line: 45, declFile: HELPER, contentHash: 'x2' },
      { repoId, fromPath: CALLER_A, toSymbol: 'bucketKey', line: 24, declFile: HELPER, contentHash: 'x3' },
    ]);

    // file_rank is INNER-JOINed by getResolvedCallers — a caller only surfaces
    // when its file has a rank row.
    await db.insert(t.fileRank).values([
      { repoId, filePath: CALLER_A, pagerank: 0.9, hotness: 0, rank: 0.9, percentile: 95 },
      { repoId, filePath: CALLER_B, pagerank: 0.7, hotness: 0, rank: 0.7, percentile: 80 },
    ]);

    // Per-file facts → the endpoints/crons attributed to a changed symbol.
    await db.insert(t.fileFacts).values([
      { repoId, filePath: CALLER_A, endpoints: ['GET /api/public/items'], crons: [] },
      { repoId, filePath: CALLER_B, endpoints: ['POST /api/public/webhooks'], crons: ['reset-rate-buckets (hourly)'] },
    ]);

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    app = await buildApp({ config, db });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('returns the impact map with ≥2 callers and ≥1 endpoint — no model call', async () => {
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.status).toBe('full');
    expect(body.degraded).toBe(false);
    expect(body.summary).toBe(''); // zero-LLM
    expect(body.counts.symbols).toBe(2);
    expect(body.counts.callers).toBeGreaterThanOrEqual(2);
    expect(body.counts.endpoints).toBeGreaterThanOrEqual(1);

    const rateLimit = body.downstream.find((d: { symbol: string }) => d.symbol === 'rateLimit');
    expect(rateLimit.callers.length).toBe(2);
    // Each caller carries the file:line the UI deep-links to.
    expect(rateLimit.callers.map((c: { file: string; line: number }) => `${c.file}:${c.line}`)).toEqual(
      expect.arrayContaining([`${CALLER_A}:23`, `${CALLER_B}:45`]),
    );
    expect(rateLimit.endpoints_affected).toEqual(
      expect.arrayContaining(['GET /api/public/items', 'POST /api/public/webhooks']),
    );
    expect(rateLimit.crons_affected).toContain('reset-rate-buckets (hourly)');

    // Prior PRs: only the one that touched the helper, not the docs-only PR.
    expect(body.prior_prs.map((p: { number: number }) => p.number)).toEqual([470]);
    expect(body.prior_prs[0]).toMatchObject({ title: 'Extract rate-limit helper', status: 'merged' });
  });

  it('404s for an unknown PR id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-0000-0000-000000000000/blast',
    });
    expect(res.statusCode).toBe(404);
  });
});
