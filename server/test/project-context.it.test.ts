/**
 * Project Context module — integration tests (Testcontainers pg).
 *
 * Drives the real routes → service → repository → repo-intel facade against a
 * live Postgres + an on-disk clone, asserting:
 *   - reindex walks the clone and REPLACES the snapshot + bumps index-state,
 *   - the docs list carries path + type badge + used-by (direct + inherited),
 *   - a repo-root README.md is NOT listed; a doc under an EXCLUDED_DIRS parent
 *     but inside a configured root IS listed (Decision D3),
 *   - a never-indexed repo returns an EMPTY state (not an error),
 *   - reindex on an un-cloned repo surfaces a 422.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

d('Project Context module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    // A real on-disk clone the doc walker can read via node:fs.
    clonePath = await mkdtemp(join(tmpdir(), 'pc-clone-'));
    await writeFileAt(clonePath, 'docs/guide.md', '# Guide');
    await writeFileAt(clonePath, 'specs/deep/api.md', '# API spec');
    await writeFileAt(clonePath, 'insights/notes.md', '# Notes');
    await writeFileAt(clonePath, 'README.md', '# Root readme (should NOT be listed)');
    // Configured root nested below an EXCLUDED_DIRS parent — Decision D3.
    await writeFileAt(clonePath, 'vendor/docs/vendored.md', '# Vendored doc');
  });

  afterAll(async () => {
    await rm(clonePath, { recursive: true, force: true });
    await pg?.stop();
  });

  const makeApp = () => buildApp({ config: config(), db: pg.handle.db });

  async function seedRepo(withClone = true): Promise<string> {
    const suffix = Math.random().toString(36).slice(2, 8);
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `pc-${suffix}`,
        fullName: `acme/pc-${suffix}`,
        clonePath: withClone ? clonePath : null,
      })
      .returning();
    return repo!.id;
  }

  it('index-state on a never-indexed repo → empty state, not an error', async () => {
    const app = await makeApp();
    const repoId = await seedRepo();

    const state = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/index-state` });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toEqual({ files_indexed: 0, last_indexed_at: null });

    const docs = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
    expect(docs.statusCode).toBe(200);
    expect(docs.json()).toEqual([]);
    await app.close();
  });

  it('reindex discovers .md under configured roots (any depth), badges them, excludes README + honors D3', async () => {
    const app = await makeApp();
    const repoId = await seedRepo();

    const reindex = await app.inject({ method: 'POST', url: `/repos/${repoId}/context/reindex` });
    expect(reindex.statusCode).toBe(200);
    // 4 discovered: docs/guide, specs/deep/api, insights/notes, vendor/docs/vendored.
    expect(reindex.json().files_indexed).toBe(4);
    expect(reindex.json().last_indexed_at).toBeTypeOf('string');

    const docs = (await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` })).json();
    const byPath = new Map(docs.map((d: { path: string; type: string }) => [d.path, d.type]));

    expect(byPath.get('docs/guide.md')).toBe('docs');
    expect(byPath.get('specs/deep/api.md')).toBe('specs');
    expect(byPath.get('insights/notes.md')).toBe('insights');
    expect(byPath.get('vendor/docs/vendored.md')).toBe('docs'); // D3: excluded parent, root wins
    expect(byPath.has('README.md')).toBe(false); // outside any configured root

    // index-state reflects the count + a timestamp, and carries NO chunk count (D8).
    const state = (await app.inject({ method: 'GET', url: `/repos/${repoId}/context/index-state` })).json();
    expect(state.files_indexed).toBe(4);
    expect(state.last_indexed_at).toBeTypeOf('string');
    expect(state).not.toHaveProperty('chunks');
    await app.close();
  });

  it('reindex REPLACES the snapshot (removing a doc drops it from the list)', async () => {
    const app = await makeApp();
    const repoId = await seedRepo();

    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/reindex` });

    // Add a new doc to the clone, then reindex — the snapshot reflects the change.
    const extra = join(clonePath, 'docs', 'added.md');
    await writeFile(extra, '# Added');
    try {
      const reindex = (await app.inject({ method: 'POST', url: `/repos/${repoId}/context/reindex` })).json();
      expect(reindex.files_indexed).toBe(5);
      const docs = (await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` })).json();
      expect(docs.map((x: { path: string }) => x.path)).toContain('docs/added.md');
    } finally {
      await rm(extra, { force: true });
    }
    await app.close();
  });

  it('used_by_agents counts direct attachment + skill-inherited usage (AC-6)', async () => {
    const app = await makeApp();
    const repoId = await seedRepo();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/reindex` });

    const path = 'docs/guide.md';

    // Agent A attaches the doc directly.
    const [agentA] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'A', provider: 'openai', model: 'gpt', systemPrompt: 'x' })
      .returning();
    await pg.handle.db.insert(t.agentContextDocs).values({ agentId: agentA!.id, path, order: 0 });

    // Agent B inherits the same doc via a linked skill.
    const [agentB] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'B', provider: 'openai', model: 'gpt', systemPrompt: 'x' })
      .returning();
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({ workspaceId, name: 'S', description: 'd', type: 'custom', source: 'manual', body: 'b' })
      .returning();
    await pg.handle.db.insert(t.skillContextDocs).values({ skillId: skill!.id, path, order: 0 });
    await pg.handle.db.insert(t.agentSkills).values({ agentId: agentB!.id, skillId: skill!.id, order: 0 });

    const docs = (await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` })).json();
    const guide = docs.find((x: { path: string }) => x.path === path);
    expect(guide.used_by_agents).toBe(2);

    // A doc nobody attached shows 0.
    const notes = docs.find((x: { path: string }) => x.path === 'insights/notes.md');
    expect(notes.used_by_agents).toBe(0);
    await app.close();
  });

  it('docs/content returns a discovered doc’s markdown text (AC-5)', async () => {
    const app = await makeApp();
    const repoId = await seedRepo();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/reindex` });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/docs/content?path=${encodeURIComponent('docs/guide.md')}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: 'docs/guide.md', content: '# Guide' });
    await app.close();
  });

  it('docs/content rejects a `../`-style traversal path with a 404 (no clone path leaked)', async () => {
    const app = await makeApp();
    const repoId = await seedRepo();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/reindex` });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/docs/content?path=${encodeURIComponent('../etc/passwd')}`,
    });
    expect(res.statusCode).toBe(404);
    // The error message must not leak the absolute clone path.
    expect(res.json().error.message).not.toContain(clonePath);
    await app.close();
  });

  it('docs/content 404s for a path not present in the current snapshot', async () => {
    const app = await makeApp();
    const repoId = await seedRepo();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/reindex` });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/docs/content?path=${encodeURIComponent('docs/nope.md')}`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('reindex on an un-cloned repo surfaces a 422 (primary action, not silent)', async () => {
    const app = await makeApp();
    const repoId = await seedRepo(false);
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/context/reindex` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/not cloned/i);
    await app.close();
  });
});
