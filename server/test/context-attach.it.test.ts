/**
 * Context attachment API — integration tests (Testcontainers pg). SPEC-01 Unit 3.
 *
 * Drives the real routes → service → repository for attaching markdown docs to
 * agents and skills, asserting:
 *   - POST /agents/:id/context sets the whole ordered set; GET reads it back in
 *     attach order (AC-7),
 *   - attaching one more doc (`path`) is additive and appends,
 *   - POST/GET /skills/:id/context persists a skill attachment and reads it back
 *     in order (AC-9 persistence half),
 *   - `missing` is derived from the doc-index snapshot: a path present in the
 *     snapshot → missing:false; a path never in it → missing:true,
 *   - deleting a doc from the snapshot leaves the attachment ROW intact and flips
 *     it to missing:true — it is NEVER auto-detached (AC-19 / Decision D6),
 *   - unknown agent/skill → 404.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context-attach] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('Context attachment API (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const makeApp = () => buildApp({ config: config(), db: pg.handle.db });

  async function seedAgent(name = 'agent'): Promise<string> {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name, provider: 'openai', model: 'gpt', systemPrompt: 'x' })
      .returning();
    return agent!.id;
  }

  async function seedSkill(name = 'skill'): Promise<string> {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name,
        description: 'd',
        type: 'custom',
        source: 'manual',
        body: 'b',
      })
      .returning();
    return skill!.id;
  }

  /** Seed a repo + a doc-index snapshot containing exactly `paths`. */
  async function seedSnapshot(paths: string[]): Promise<string> {
    const suffix = Math.random().toString(36).slice(2, 8);
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `ca-${suffix}`,
        fullName: `acme/ca-${suffix}`,
      })
      .returning();
    if (paths.length > 0) {
      await pg.handle.db.insert(t.repoContextDocs).values(
        paths.map((path) => ({ repoId: repo!.id, path, type: 'docs' as const, sizeBytes: 10 })),
      );
    }
    return repo!.id;
  }

  it('attach docs to an agent → read back in attach order (AC-7)', async () => {
    const app = await makeApp();
    const agentId = await seedAgent('ordered');
    await seedSnapshot(['docs/a.md', 'docs/b.md', 'docs/c.md']);

    const set = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { paths: ['docs/c.md', 'docs/a.md', 'docs/b.md'] },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().map((l: { path: string; order: number }) => [l.path, l.order])).toEqual([
      ['docs/c.md', 0],
      ['docs/a.md', 1],
      ['docs/b.md', 2],
    ]);

    const read = await app.inject({ method: 'GET', url: `/agents/${agentId}/context` });
    expect(read.statusCode).toBe(200);
    expect(read.json().map((l: { path: string }) => l.path)).toEqual([
      'docs/c.md',
      'docs/a.md',
      'docs/b.md',
    ]);
    // Every attached path exists in the snapshot → none flagged missing.
    expect(read.json().every((l: { missing: boolean }) => l.missing === false)).toBe(true);
    await app.close();
  });

  it('attach one more doc (path) is additive and appends at the end', async () => {
    const app = await makeApp();
    const agentId = await seedAgent('additive');
    await seedSnapshot(['docs/x.md', 'docs/y.md']);

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { paths: ['docs/x.md'] },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { path: 'docs/y.md' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((l: { path: string; order: number }) => [l.path, l.order])).toEqual([
      ['docs/x.md', 0],
      ['docs/y.md', 1],
    ]);
    await app.close();
  });

  it('replacing the set with a shorter list detaches the omitted docs', async () => {
    const app = await makeApp();
    const agentId = await seedAgent('replace');
    await seedSnapshot(['docs/1.md', 'docs/2.md']);

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { paths: ['docs/1.md', 'docs/2.md'] },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { paths: ['docs/2.md'] },
    });
    expect(res.json().map((l: { path: string }) => l.path)).toEqual(['docs/2.md']);
    await app.close();
  });

  it('skill attachment persists and reads back in order (AC-9)', async () => {
    const app = await makeApp();
    const skillId = await seedSkill('skill-ctx');
    await seedSnapshot(['docs/s1.md', 'docs/s2.md']);

    const set = await app.inject({
      method: 'POST',
      url: `/skills/${skillId}/context`,
      payload: { paths: ['docs/s2.md', 'docs/s1.md'] },
    });
    expect(set.statusCode).toBe(200);

    const read = await app.inject({ method: 'GET', url: `/skills/${skillId}/context` });
    expect(read.statusCode).toBe(200);
    expect(read.json().map((l: { skill_id: string; path: string }) => [l.skill_id, l.path])).toEqual(
      [
        [skillId, 'docs/s2.md'],
        [skillId, 'docs/s1.md'],
      ],
    );
    await app.close();
  });

  it('missing flag: a path not in any snapshot is flagged missing:true (AC-19)', async () => {
    const app = await makeApp();
    const agentId = await seedAgent('missing-derive');
    await seedSnapshot(['docs/present.md']);

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { paths: ['docs/present.md', 'docs/ghost.md'] },
    });
    const read = (await app.inject({ method: 'GET', url: `/agents/${agentId}/context` })).json();
    const byPath = new Map(read.map((l: { path: string; missing: boolean }) => [l.path, l.missing]));
    expect(byPath.get('docs/present.md')).toBe(false);
    expect(byPath.get('docs/ghost.md')).toBe(true);
    await app.close();
  });

  it('deleting a doc from the snapshot keeps its attachment row, flagged missing (AC-19 / D6)', async () => {
    const app = await makeApp();
    const agentId = await seedAgent('delete-doc');
    const repoId = await seedSnapshot(['docs/keep.md', 'docs/drop.md']);

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { paths: ['docs/keep.md', 'docs/drop.md'] },
    });
    // Both present initially.
    let read = (await app.inject({ method: 'GET', url: `/agents/${agentId}/context` })).json();
    expect(read.every((l: { missing: boolean }) => l.missing === false)).toBe(true);

    // Simulate a reindex that dropped the doc from the clone: remove it from the
    // snapshot ONLY — the attachment table is untouched.
    await pg.handle.db
      .delete(t.repoContextDocs)
      .where(eq(t.repoContextDocs.path, 'docs/drop.md'));

    read = (await app.inject({ method: 'GET', url: `/agents/${agentId}/context` })).json();
    // Row is NOT auto-removed — still two links, in order.
    expect(read.map((l: { path: string }) => l.path)).toEqual(['docs/keep.md', 'docs/drop.md']);
    const byPath = new Map(read.map((l: { path: string; missing: boolean }) => [l.path, l.missing]));
    expect(byPath.get('docs/keep.md')).toBe(false);
    expect(byPath.get('docs/drop.md')).toBe(true);

    // The underlying attachment row genuinely survived in the DB.
    const rows = await pg.handle.db
      .select()
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId));
    expect(rows).toHaveLength(2);
    // Keep repoId referenced (snapshot belongs to it) for clarity.
    expect(repoId).toBeTypeOf('string');
    await app.close();
  });

  it('unknown agent / skill → 404 on GET and POST', async () => {
    const app = await makeApp();
    const bogus = '00000000-0000-0000-0000-000000000000';

    const getAgent = await app.inject({ method: 'GET', url: `/agents/${bogus}/context` });
    expect(getAgent.statusCode).toBe(404);
    const postAgent = await app.inject({
      method: 'POST',
      url: `/agents/${bogus}/context`,
      payload: { paths: [] },
    });
    expect(postAgent.statusCode).toBe(404);

    const getSkill = await app.inject({ method: 'GET', url: `/skills/${bogus}/context` });
    expect(getSkill.statusCode).toBe(404);
    await app.close();
  });
});
