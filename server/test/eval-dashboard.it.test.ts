import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type {
  ChatMessage,
  LLMProvider,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A patch whose new-side line 11 exists, so grounding can bind a finding there. */
const PATCH = [
  '@@ -10,3 +10,4 @@',
  '   port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  '   redisUrl: x,',
].join('\n');

/** One finding on src/config.ts:11 (kept by grounding against PATCH). */
const FINDING_11: Review['findings'][number] = {
  id: 'f11',
  severity: 'CRITICAL',
  category: 'security',
  title: 'Config finding',
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  rationale: 'A live key is committed.',
  confidence: 0.95,
  kind: 'finding',
};

const reviewOf = (findings: Review['findings']): Review => ({
  verdict: 'comment',
  summary: '',
  score: 100,
  findings,
});

/**
 * A scripted provider (id 'openai' so an agent with provider 'openai' resolves
 * to it via the injected override — no live calls). It flags config:11 ONLY when
 * the assembled prompt carries the FLAG_CONFIG marker, so toggling the system
 * prompt flips a must_not_flag case pass↔fail and moves precision.
 */
function scriptedProvider(): LLMProvider {
  return {
    id: 'openai' as const,
    async listModels() {
      return [{ id: 'gpt-4.1', provider: 'openai' as const }];
    },
    async complete(req: { model: string }) {
      return { text: '', model: req.model, tokensIn: 1, tokensOut: 1, costUsd: 0 };
    },
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const flag = JSON.stringify(req.messages as ChatMessage[]).includes('FLAG_CONFIG');
      const data = req.schema.parse((flag ? reviewOf([FINDING_11]) : reviewOf([])) as unknown);
      return { data, model: req.model, tokensIn: 100, tokensOut: 50, costUsd: 0.002, raw: '', attempts: 1 };
    },
    async embed(texts: string[]) {
      return texts.map(() => [] as number[]);
    },
  };
}

let seq = 0;

/** Seed repo + PR + pr_files + review(agent) + a DISMISSED finding; return its id. */
async function seedDismissedFinding(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  agentId: string,
): Promise<string> {
  const name = `payments-${seq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Add key',
      author: 'dev',
      branch: 'feat/x',
      base: 'main',
      headSha: 'sha1',
      filesCount: 1,
    })
    .returning();
  await db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts', patch: PATCH });
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId: pr!.id, agentId, kind: 'review' })
    .returning();
  const [finding] = await db
    .insert(t.findings)
    .values({
      reviewId: review!.id,
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Guarded config finding',
      rationale: 'seed',
      confidence: 0.95,
      kind: 'finding',
      dismissedAt: new Date(),
    })
    .returning();
  return finding!.id;
}

d('eval dashboard / history / compare (Testcontainers pg)', () => {
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

  function appWith(llm: LLMProvider) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } });
  }

  async function createAgent(
    a: Awaited<ReturnType<typeof buildApp>>,
    systemPrompt: string,
  ): Promise<string> {
    const res = await a.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Sec-${seq++}`, provider: 'openai', model: 'gpt-4.1', system_prompt: systemPrompt },
    });
    return res.json().id as string;
  }

  /** Create a must_not_flag case (from a dismissed finding) guarding config:11. */
  async function createGuardCase(a: Awaited<ReturnType<typeof buildApp>>, agentId: string) {
    const findingId = await seedDismissedFinding(pg.handle.db, workspaceId, agentId);
    const res = await a.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: findingId } });
    expect(res.statusCode).toBe(201);
  }

  async function run(a: Awaited<ReturnType<typeof buildApp>>, agentId: string) {
    const res = await a.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  async function setPrompt(a: Awaited<ReturnType<typeof buildApp>>, agentId: string, prompt: string) {
    const res = await a.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { system_prompt: prompt } });
    expect(res.statusCode).toBe(200);
  }

  it('history groups by run_group_id (newest first) and dashboard latest resolves by ran_at', async () => {
    const app = await appWith(scriptedProvider());
    const agentId = await createAgent(app, 'clean prompt'); // no FLAG_CONFIG → no findings
    await createGuardCase(app, agentId);

    // Run 1: clean prompt → produces nothing → precision 1, the guard passes.
    const r1 = await run(app, agentId);
    expect(r1.precision).toBe(1);
    expect(r1.traces_passed).toBe(1);

    // Break the prompt → the model now flags an overlapping finding (noise).
    await setPrompt(app, agentId, 'clean prompt FLAG_CONFIG');
    const r2 = await run(app, agentId);
    expect(r2.precision).toBe(0);
    expect(r2.traces_passed).toBe(0);

    // History: two run groups, newest first, each covering the single case.
    const history = (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs` })).json();
    expect(history).toHaveLength(2);
    expect(new Set(history.map((g: { run_group_id: string }) => g.run_group_id)).size).toBe(2);
    for (const g of history) expect(g.traces_total).toBe(1);
    // Newest first: the latest (broken-prompt) group has precision 0.
    expect(history[0].precision).toBe(0);
    expect(history[1].precision).toBe(1);

    // Dashboard "current" resolves to the LATEST run by ran_at (the broken one).
    const dash = (await app.inject({ method: 'GET', url: `/eval-dashboard?owner_id=${agentId}` })).json();
    expect(dash.owner_id).toBe(agentId);
    expect(dash.owner_kind).toBe('agent');
    expect(dash.current.precision).toBe(0); // latest, not the earlier precision-1 run
    expect(dash.trend).toHaveLength(2);
    expect(dash.trend[dash.trend.length - 1].precision).toBe(0);

    await app.close();
  });

  it('a precision-dropping run yields a non-null regression alert', async () => {
    const app = await appWith(scriptedProvider());
    const agentId = await createAgent(app, 'clean prompt');
    await createGuardCase(app, agentId);

    await run(app, agentId); // precision 1
    await setPrompt(app, agentId, 'clean prompt FLAG_CONFIG');
    await run(app, agentId); // precision 0 → regression

    const dash = (await app.inject({ method: 'GET', url: `/eval-dashboard?owner_id=${agentId}` })).json();
    expect(dash.delta.precision).toBe(-1);
    expect(dash.alert).toBeTypeOf('string');
    expect(dash.alert).toContain('Precision');

    await app.close();
  });

  it('an improving run yields a null alert', async () => {
    const app = await appWith(scriptedProvider());
    const agentId = await createAgent(app, 'clean prompt FLAG_CONFIG'); // starts noisy
    await createGuardCase(app, agentId);

    await run(app, agentId); // precision 0
    await setPrompt(app, agentId, 'clean prompt'); // fix it
    await run(app, agentId); // precision 1 → improved

    const dash = (await app.inject({ method: 'GET', url: `/eval-dashboard?owner_id=${agentId}` })).json();
    expect(dash.current.precision).toBe(1);
    expect(dash.delta.precision).toBe(1);
    expect(dash.alert).toBeNull();

    await app.close();
  });

  it('compare returns four metric deltas and BOTH stored prompt snapshots', async () => {
    const app = await appWith(scriptedProvider());
    const agentId = await createAgent(app, 'clean prompt');
    await createGuardCase(app, agentId);

    await run(app, agentId); // group A: precision 1, prompt "clean prompt"
    await setPrompt(app, agentId, 'clean prompt FLAG_CONFIG');
    await run(app, agentId); // group B: precision 0, prompt with FLAG_CONFIG

    const history = (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs` })).json();
    const bId = history[0].run_group_id as string; // newest
    const aId = history[1].run_group_id as string; // oldest

    const cmp = (
      await app.inject({ method: 'GET', url: `/eval-runs/compare?a=${aId}&b=${bId}` })
    ).json();

    // Four metric deltas (old→new = b − a).
    expect(Object.keys(cmp.delta).sort()).toEqual(
      ['citation_accuracy', 'cost_usd', 'precision', 'recall'].sort(),
    );
    expect(cmp.delta.precision).toBe(-1); // 0 − 1

    // Both stored snapshots, sourced from the persisted rows (not time-inferred).
    expect(cmp.system_prompt_a).toBe('clean prompt');
    expect(cmp.system_prompt_b).toBe('clean prompt FLAG_CONFIG');
    expect(cmp.a.run_group_id).toBe(aId);
    expect(cmp.b.run_group_id).toBe(bId);

    await app.close();
  });

  it('compare across a run group outside the workspace → 404', async () => {
    const app = await appWith(scriptedProvider());
    const res = await app.inject({
      method: 'GET',
      url: `/eval-runs/compare?a=${crypto.randomUUID()}&b=${crypto.randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('history for an agent outside the workspace → 404', async () => {
    const app = await appWith(scriptedProvider());
    const res = await app.inject({ method: 'GET', url: `/agents/${crypto.randomUUID()}/eval-runs` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('workspace dashboard (no owner) lists recent runs across agents', async () => {
    const app = await appWith(scriptedProvider());
    const agentId = await createAgent(app, 'clean prompt');
    await createGuardCase(app, agentId);
    await run(app, agentId);

    const dash = (await app.inject({ method: 'GET', url: '/eval-dashboard' })).json();
    expect(dash.owner_kind).toBeNull();
    expect(dash.owner_id).toBeNull();
    expect(Array.isArray(dash.recent_runs)).toBe(true);
    expect(dash.recent_runs.length).toBeGreaterThan(0);

    await app.close();
  });
});
