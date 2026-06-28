import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'ok',
  score: 80,
  findings: [],
};

const b64 = (s: string) => Buffer.from(s).toString('base64');

/**
 * Skills module — CRUD + body versioning + import preview (.md/.zip, no persist,
 * no execution) + the agents-using join, and the prompt wire (an enabled, linked
 * skill lands in `prompt_assembly.skills`; a globally-disabled one does not).
 */
d('Skills module (Testcontainers pg)', () => {
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

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  const createBody = {
    name: 'pr-quality-rubric',
    description: 'Rubric for overall PR quality.',
    type: 'rubric' as const,
    body: '# PR Quality\nEvaluate correctness, tests, and clarity.',
  };

  it('CRUD: create (v1) → list → get → delete', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: createBody });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill).toMatchObject({ name: 'pr-quality-rubric', type: 'rubric', version: 1, source: 'manual' });

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.some((s: { id: string }) => s.id === skill.id)).toBe(true);

    const one = await app.inject({ method: 'GET', url: `/skills/${skill.id}` });
    expect(one.statusCode).toBe(200);

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('a body edit bumps the version + snapshots; name-only edit does not', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: createBody })).json().id;

    const bumped = (
      await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# PR Quality v2' } })
    ).json();
    expect(bumped.version).toBe(2);

    const nameOnly = (
      await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { name: 'renamed' } })
    ).json();
    expect(nameOnly.version).toBe(2); // unchanged

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0].body).toBe('# PR Quality v2');
    await app.close();
  });

  it('import preview: .md → whole file is the body, no ignored entries', async () => {
    const app = await makeApp();
    const md = '# Imported skill\nFollow this rule.';
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import',
      payload: { filename: 'my-skill.md', content_base64: b64(md) },
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json();
    expect(preview).toMatchObject({ name: 'Imported skill', source: 'imported_file', body: md });
    expect(preview.ignored_files).toEqual([]);
    await app.close();
  });

  it('import preview: .zip → markdown core is the body; executable entries are ignored, never run', async () => {
    const app = await makeApp();
    const zip = zipSync({
      'SKILL.md': strToU8('# Zip skill\nThe extracted core.'),
      'install.sh': strToU8('#!/bin/sh\nrm -rf /\n'),
      'assets/logo.png': strToU8('PNGDATA'),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import',
      payload: { filename: 'bundle.zip', content_base64: Buffer.from(zip).toString('base64') },
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json();
    expect(preview.name).toBe('Zip skill');
    expect(preview.body).toContain('The extracted core.');
    const paths = preview.ignored_files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual(['assets/logo.png', 'install.sh']);
    const sh = preview.ignored_files.find((f: { path: string }) => f.path === 'install.sh');
    expect(sh.reason).toMatch(/executable/i);
    await app.close();
  });

  it('GET /skills/:id/agents lists the agents that link the skill', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: { ...createBody, name: 'used-skill' } })).json().id;
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Linker', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/skills`, payload: { skill_ids: [id] } });

    const using = (await app.inject({ method: 'GET', url: `/skills/${id}/agents` })).json();
    expect(using.map((a: { id: string }) => a.id)).toContain(agent.id);
    await app.close();
  });

  it('prompt wire: an enabled linked skill lands in the trace; a disabled one does not', async () => {
    const app = await makeApp();
    const db = pg.handle.db;

    // A repo + PR with a persisted patch so a diff can be reconstructed.
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'skills-wire', fullName: 'acme/skills-wire' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'x',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'sha',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });

    const ON = 'ENABLED-SKILL-BODY-MARKER';
    const OFF = 'DISABLED-SKILL-BODY-MARKER';
    const onId = (
      await app.inject({ method: 'POST', url: '/skills', payload: { name: 'on', type: 'custom', body: ON, enabled: true } })
    ).json().id;
    const offId = (
      await app.inject({ method: 'POST', url: '/skills', payload: { name: 'off', type: 'custom', body: OFF, enabled: false } })
    ).json().id;

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Wired', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review', repo_intel: false },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/skills`, payload: { skill_ids: [onId, offId] } });

    const run = await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: agent.id } });
    expect(run.statusCode).toBe(200);
    const runId = run.json().runs[0].run_id;
    await waitForPrRuns(db, pr!.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills).toContain(ON);
    expect(trace.prompt_assembly.skills).not.toContain(OFF);
    await app.close();
  });
});
