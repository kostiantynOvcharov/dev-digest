import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const SAMPLE_PATH = 'src/mw.ts';
const SAMPLE_SRC = [
  'export function rateLimit(req) {', // 1
  '  return req.ip;', // 2
  '}', // 3
].join('\n');

// One grounded candidate (quote present at lines 1-1) + one hallucinated
// (quote absent) + one out-of-bounds. Only the first must survive the gate.
const EXTRACTION_FIXTURE = {
  candidates: [
    {
      category: 'naming',
      rule: 'exported helpers use camelCase',
      evidence_path: SAMPLE_PATH,
      evidence_snippet: 'export function rateLimit(req) {',
      evidence_start_line: 1,
      evidence_end_line: 1,
      confidence: 0.9,
    },
    {
      category: 'naming',
      rule: 'this rule is hallucinated',
      evidence_path: SAMPLE_PATH,
      evidence_snippet: 'export function neverExisted() {',
      evidence_start_line: 1,
      evidence_end_line: 1,
      confidence: 0.8,
    },
    {
      category: 'imports',
      rule: 'out of bounds range',
      evidence_path: SAMPLE_PATH,
      evidence_snippet: 'whatever',
      evidence_start_line: 99,
      evidence_end_line: 120,
      confidence: 0.7,
    },
  ],
};

/** A minimal RepoIntel that only answers getConventionSamples (the pipeline use). */
const mockRepoIntel = (paths: string[]): RepoIntel =>
  ({ getConventionSamples: async () => paths }) as unknown as RepoIntel;

d('Conventions module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    // A real on-disk clone the pipeline can read via node:fs.
    clonePath = await mkdtemp(join(tmpdir(), 'conv-clone-'));
    const abs = join(clonePath, SAMPLE_PATH);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, SAMPLE_SRC, 'utf8');
  });

  afterAll(async () => {
    await rm(clonePath, { recursive: true, force: true });
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        repoIntel: mockRepoIntel([SAMPLE_PATH]),
        llm: { openai: new MockLLMProvider('openai', { structured: EXTRACTION_FIXTURE }) },
      },
    });
  }

  async function seedRepo() {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `conv-${Math.random().toString(36).slice(2, 8)}`,
        fullName: `acme/conv-${Math.random().toString(36).slice(2, 8)}`,
        clonePath,
      })
      .returning();
    return repo!.id;
  }

  it('extract: persists only GROUNDED candidates; re-derives the snippet', async () => {
    const app = await makeApp();
    const repoId = await seedRepo();

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const candidates = res.json();

    // 3 proposed, 2 ungrounded → exactly 1 survives.
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      rule: 'exported helpers use camelCase',
      category: 'naming',
      evidence_path: SAMPLE_PATH,
      evidence_start_line: 1,
      evidence_end_line: 1,
      status: 'pending',
    });
    // Snippet re-derived from the real file, not trusted from the model.
    expect(candidates[0].evidence_snippet).toBe('export function rateLimit(req) {');

    // GET returns the same persisted row.
    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    expect(list).toHaveLength(1);
    await app.close();
  });

  it('extract on an un-cloned repo → 422 (surfaces the misconfig, not a silent [])', async () => {
    const app = await makeApp();
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'no-clone', fullName: 'acme/no-clone' })
      .returning();
    const res = await app.inject({ method: 'POST', url: `/repos/${repo!.id}/conventions/extract` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/not cloned/i);
    await app.close();
  });

  it('PATCH accept/reject/edit; re-scan keeps accepted, replaces pending', async () => {
    const app = await makeApp();
    const repoId = await seedRepo();

    const first = (await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })).json();
    const id = first[0].id;

    const accepted = (
      await app.inject({ method: 'PATCH', url: `/conventions/${id}`, payload: { status: 'accepted', rule: 'edited rule' } })
    ).json();
    expect(accepted).toMatchObject({ status: 'accepted', rule: 'edited rule' });

    // Re-scan: the accepted (now non-pending) row survives; a new pending row appears.
    const rescan = (await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })).json();
    expect(rescan).toHaveLength(1); // the freshly-inserted pending candidate

    const all = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    const statuses = all.map((c: { status: string }) => c.status).sort();
    expect(statuses).toEqual(['accepted', 'pending']);
    await app.close();
  });

  it('skill-draft merges ACCEPTED candidates into a markdown body (no persist)', async () => {
    const app = await makeApp();
    const repoId = await seedRepo();

    const c = (await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })).json();
    await app.inject({ method: 'PATCH', url: `/conventions/${c[0].id}`, payload: { status: 'accepted' } });

    const draft = (await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/skill-draft` })).json();
    expect(draft.type).toBe('convention');
    expect(draft.body).toContain('## exported helpers use camelCase');
    expect(draft.body).toContain(`Detected in \`${SAMPLE_PATH}:1\`:`);
    expect(draft.body).toContain('export function rateLimit(req) {');
    await app.close();
  });

  it('PATCH on a missing candidate → 404', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/conventions/00000000-0000-0000-0000-000000000000',
      payload: { status: 'rejected' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
