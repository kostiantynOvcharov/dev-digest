import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { hunkHash } from '../src/modules/pulls/hunk-hash.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[diff-summary] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const CORE_PATCH_A = '@@ -1,2 +1,3 @@\n export function handle() {\n+  validate();\n }';
const CORE_PATCH_B = '@@ -1,2 +1,3 @@\n export function other() {\n+  log();\n }';
const WIRING_PATCH = '@@ -1,3 +1,4 @@\n {\n+  "name": "x"\n }';

const GOOD_FIXTURE = {
  summaries: [{ path: 'src/service.ts', summary: 'Validates input before handling the request.' }],
};

d('Diff Summary module (Testcontainers pg)', () => {
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

  async function makeApp(fixture: unknown) {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient(),
        llm: { openai: llm },
      },
    });
    // `diff_summary`'s REGISTRY default provider is 'openrouter' (real network) —
    // pin the workspace override to 'openai' so the resolved provider is always
    // the injected mock, regardless of which real secrets happen to be
    // configured on the machine running the suite.
    await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { diff_summary: { provider: 'openai', model: 'gpt-4.1' } } },
    });
    return { app, llm };
  }

  async function seedRepoAndPr(
    name: string,
    number: number,
    opts: {
      corePatch?: string | null;
      secondCorePatch?: string | null;
      wiringPatch?: string | null;
    } = {},
  ) {
    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number,
        title: 'Add validation',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'sha-1',
        additions: 3,
        deletions: 0,
        filesCount: 2,
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/service.ts',
      additions: 1,
      deletions: 0,
      patch: opts.corePatch !== undefined ? opts.corePatch : CORE_PATCH_A,
    });
    if (opts.secondCorePatch !== undefined) {
      await db.insert(t.prFiles).values({
        prId: pr!.id,
        path: 'src/other.ts',
        additions: 1,
        deletions: 0,
        patch: opts.secondCorePatch,
      });
    }
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'package.json',
      additions: 1,
      deletions: 0,
      patch: opts.wiringPatch !== undefined ? opts.wiringPatch : WIRING_PATCH,
    });
    return { repo: repo!, pr: pr! };
  }

  it('POST generates via exactly ONE LLM call and persists a pr_diff_summary row', async () => {
    const { app, llm } = await makeApp(GOOD_FIXTURE);
    const { pr } = await seedRepoAndPr('diff-summary-gen', 201);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/smart-diff/summaries`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const rows = await pg.handle.db.select().from(t.prDiffSummary);
    const stored = rows.find((r) => r.prId === pr.id);
    expect(stored).toBeDefined();
    const json = stored!.json as Record<string, { hunk_hash: string; summary: string }>;
    expect(json['src/service.ts']).toBeDefined();
    expect(json['src/service.ts']!.summary).toContain('Validates input');
    expect(json['src/service.ts']!.hunk_hash).toBe(hunkHash(CORE_PATCH_A));
    // The wiring file (package.json) is never sent to the model / cached.
    expect(json['package.json']).toBeUndefined();
    await app.close();
  });

  it('GET /pulls/:id/smart-diff fills pseudocode_summary on core files, null on wiring (reconciled by hunk_hash)', async () => {
    const { app } = await makeApp(GOOD_FIXTURE);
    const { pr } = await seedRepoAndPr('diff-summary-reconcile', 202);

    const gen = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/smart-diff/summaries`,
      payload: {},
    });
    expect(gen.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const smartDiff = res.json() as {
      groups: { role: string; files: { path: string; pseudocode_summary: string | null }[] }[];
    };
    const core = smartDiff.groups.find((g) => g.role === 'core');
    const wiring = smartDiff.groups.find((g) => g.role === 'wiring');
    const serviceFile = core?.files.find((f) => f.path === 'src/service.ts');
    const pkgFile = wiring?.files.find((f) => f.path === 'package.json');
    expect(serviceFile?.pseudocode_summary).toContain('Validates input');
    expect(pkgFile?.pseudocode_summary).toBeNull();
    await app.close();
  });

  it('GET shows null when the file changed after caching (stale hunk_hash)', async () => {
    const { app } = await makeApp(GOOD_FIXTURE);
    const { pr } = await seedRepoAndPr('diff-summary-stale', 203);

    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/smart-diff/summaries`,
      payload: {},
    });

    // The file's patch changes AFTER the summary was cached (e.g. a new push) —
    // simulate by updating pr_files directly, without regenerating the cache.
    await pg.handle.db
      .update(t.prFiles)
      .set({ patch: CORE_PATCH_B })
      .where(and(eq(t.prFiles.prId, pr.id), eq(t.prFiles.path, 'src/service.ts')));

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const smartDiff = res.json() as {
      groups: { role: string; files: { path: string; pseudocode_summary: string | null }[] }[];
    };
    const core = smartDiff.groups.find((g) => g.role === 'core');
    const serviceFile = core?.files.find((f) => f.path === 'src/service.ts');
    expect(serviceFile?.pseudocode_summary).toBeNull();
    await app.close();
  });

  it('regenerating with an unchanged patch reuses the cache (no 2nd call for that file)', async () => {
    const { app, llm } = await makeApp(GOOD_FIXTURE);
    const { pr } = await seedRepoAndPr('diff-summary-reuse', 204);

    const first = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/smart-diff/summaries`,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    // Same PR, unchanged patches → nothing is stale, so a second generate call
    // must NOT make a second LLM call.
    const second = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/smart-diff/summaries`,
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    await app.close();
  });

  it('an LLM failure surfaces an error and writes no row', async () => {
    // A fixture that fails the DiffSummaries schema → MockLLMProvider throws.
    const { app } = await makeApp({ summaries: 'not-an-array' });
    const { pr } = await seedRepoAndPr('diff-summary-fail', 205);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/smart-diff/summaries`,
      payload: {},
    });
    expect(res.statusCode).toBe(502);

    const rows = await pg.handle.db.select().from(t.prDiffSummary);
    expect(rows.find((r) => r.prId === pr.id)).toBeUndefined();
    await app.close();
  });
});
