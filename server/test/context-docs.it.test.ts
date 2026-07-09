import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  console.warn('[context-docs] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = { verdict: 'comment', summary: 'ok', score: 80, findings: [] };

/**
 * Project Context wire (SPEC-01, Unit 4) — the run-executor resolves attached
 * doc paths (skill-inherited first, then agent-attached; dedup keeps the skill
 * position — Decision D2), reads each within a path-traversal guard, injects the
 * bodies as `specs` (engine wraps `<untrusted source="spec-*">`) and records
 * `specs_read`. An unreadable/deleted doc or a `../`-traversal path is omitted
 * and the run still completes (AC-8/9/11/12/13/14).
 */
d('Project Context wire (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let cloneDir: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    // A real on-disk clone with the doc files the run reads FRESH per run.
    cloneDir = await mkdtemp(join(tmpdir(), 'ctx-clone-'));
    await mkdir(join(cloneDir, 'specs'), { recursive: true });
    await mkdir(join(cloneDir, 'docs'), { recursive: true });
    await writeFile(join(cloneDir, 'specs/skill-a.md'), 'SKILL-A-BODY-MARKER', 'utf8');
    await writeFile(join(cloneDir, 'docs/shared.md'), 'SHARED-DOC-BODY-MARKER', 'utf8');
    await writeFile(join(cloneDir, 'docs/agent-b.md'), 'AGENT-B-BODY-MARKER', 'utf8');
    await writeFile(join(cloneDir, 'docs/gone.md'), 'GONE-DOC-BODY-MARKER', 'utf8');
    // A secret file OUTSIDE the clone — a traversal path must never read it.
    await writeFile(join(cloneDir, '..', 'ctx-secret.md'), 'OUTSIDE-CLONE-SECRET-MARKER', 'utf8');
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(cloneDir, { recursive: true, force: true }).catch(() => undefined);
    await unlink(join(cloneDir, '..', 'ctx-secret.md')).catch(() => undefined);
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

  async function seedRepoAndPr(name: string, number: number) {
    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: cloneDir })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number,
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
    return { repo: repo!, pr: pr! };
  }

  it('injects skill-inherited then agent docs in D2 order (dedup keeps skill position); specs_read = injected paths', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const { pr } = await seedRepoAndPr('ctx-order', 11);

    // A skill (enabled) with two attached docs, in order.
    const skillId = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'ctx-skill', type: 'custom', body: 'skill body', enabled: true },
      })
    ).json().id;
    await app.inject({
      method: 'POST',
      url: `/skills/${skillId}/context`,
      payload: { paths: ['specs/skill-a.md', 'docs/shared.md'] },
    });

    // An agent that loads that skill AND attaches its own docs. `docs/shared.md`
    // is attached to both — dedup must keep its earlier (skill) position.
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'CtxAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review', repo_intel: false },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/skills`, payload: { skill_ids: [skillId] } });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['docs/shared.md', 'docs/agent-b.md'] },
    });

    const run = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    expect(run.statusCode).toBe(200);
    const runId = run.json().runs[0].run_id;
    await waitForPrRuns(db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    const specs: string = trace.prompt_assembly.specs;

    // AC-13 — the engine wrapped each injected doc as untrusted.
    expect(specs).toContain('<untrusted source="spec-0">');
    expect(specs).toContain('<untrusted source="spec-1">');
    expect(specs).toContain('<untrusted source="spec-2">');
    expect(specs).toContain('SKILL-A-BODY-MARKER');
    expect(specs).toContain('SHARED-DOC-BODY-MARKER');
    expect(specs).toContain('AGENT-B-BODY-MARKER');

    // AC-8/9 — D2 order: skill docs first (skill-a, shared), then agent-only
    // docs (agent-b); the duplicate `docs/shared.md` keeps its skill position.
    expect(specs.indexOf('SKILL-A-BODY-MARKER')).toBeLessThan(specs.indexOf('SHARED-DOC-BODY-MARKER'));
    expect(specs.indexOf('SHARED-DOC-BODY-MARKER')).toBeLessThan(specs.indexOf('AGENT-B-BODY-MARKER'));

    // AC-14 — specs_read equals the injected paths, in the same order, deduped.
    expect(trace.specs_read).toEqual(['specs/skill-a.md', 'docs/shared.md', 'docs/agent-b.md']);
    await app.close();
  });

  it('omits a deleted doc and a `../`-traversal path; other docs remain and the run completes', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const { pr } = await seedRepoAndPr('ctx-safety', 12);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SafeAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'review', repo_intel: false },
      })
    ).json();
    // A good doc, a doc we delete from the clone, and a traversal escape.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['specs/skill-a.md', 'docs/gone.md', '../ctx-secret.md'] },
    });

    // Delete one attached doc from the clone AFTER attaching — it must be
    // omitted while the others remain (AC-12), and the attachment row stays.
    await unlink(join(cloneDir, 'docs/gone.md'));

    const run = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    expect(run.statusCode).toBe(200);
    const runId = run.json().runs[0].run_id;
    await waitForPrRuns(db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    // Run completed successfully despite the unreadable + traversal entries.
    const runRow = trace;
    expect(runRow.stats).toBeDefined();

    // Only the readable, within-clone doc was injected.
    expect(trace.specs_read).toEqual(['specs/skill-a.md']);
    expect(trace.prompt_assembly.specs).toContain('SKILL-A-BODY-MARKER');
    // The deleted doc and the traversal target never reach the prompt.
    expect(trace.prompt_assembly.specs).not.toContain('GONE-DOC-BODY-MARKER');
    expect(trace.prompt_assembly.specs).not.toContain('OUTSIDE-CLONE-SECRET-MARKER');
    await app.close();
  });
});
