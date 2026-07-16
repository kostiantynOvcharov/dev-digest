import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
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
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A patch whose new-side lines 10–13 exist, so grounding can bind line 11. */
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

/** A phantom finding on a line NOT in the diff (dropped by grounding). */
const FINDING_999: Review['findings'][number] = {
  ...FINDING_11,
  id: 'f999',
  title: 'Phantom finding',
  start_line: 999,
  end_line: 999,
};

const reviewOf = (findings: Review['findings']): Review => ({
  verdict: 'comment',
  summary: '',
  score: 100,
  findings,
});

/**
 * A scripted LLM provider: `handler(messages)` decides the Review to return (or
 * throws to simulate an unavailable model). Tracks its own structured-call count.
 * `id: 'openai'` so an agent with provider 'openai' resolves to it via the
 * injected container override (else a real key could make a live call).
 */
function scriptedProvider(handler: (messages: ChatMessage[]) => Review): LLMProvider & {
  structuredCalls: number;
} {
  const p = {
    id: 'openai' as const,
    structuredCalls: 0,
    async listModels() {
      return [{ id: 'gpt-4.1', provider: 'openai' as const }];
    },
    async complete(req: { model: string }) {
      return { text: '', model: req.model, tokensIn: 1, tokensOut: 1, costUsd: 0 };
    },
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      p.structuredCalls += 1;
      const data = req.schema.parse(handler(req.messages) as unknown);
      return {
        data,
        model: req.model,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
        raw: '',
        attempts: 1,
      };
    },
    async embed(texts: string[]) {
      return texts.map(() => [] as number[]);
    },
  };
  return p;
}

let seq = 0;

/** Seed repo + PR + pr_files + review(agent) + a DECIDED finding; return its id. */
async function seedDecidedFinding(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  agentId: string | null,
  decision: 'accepted' | 'dismissed',
  title: string,
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
      title,
      rationale: 'seed',
      confidence: 0.95,
      kind: 'finding',
      acceptedAt: decision === 'accepted' ? new Date() : null,
      dismissedAt: decision === 'dismissed' ? new Date() : null,
    })
    .returning();
  return finding!.id;
}

d('eval runs — hermetic (Testcontainers pg)', () => {
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

  /** Build an app whose openai provider is pinned to `llm` (no live calls). */
  function appWith(llm: LLMProvider) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } });
  }

  async function createAgent(
    a: Awaited<ReturnType<typeof buildApp>>,
    systemPrompt = 'You are a reviewer.',
  ): Promise<{ id: string; version: number }> {
    const res = await a.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Sec-${seq++}`, provider: 'openai', model: 'gpt-4.1', system_prompt: systemPrompt },
    });
    const j = res.json();
    return { id: j.id as string, version: j.version as number };
  }

  async function createCase(
    a: Awaited<ReturnType<typeof buildApp>>,
    agentId: string,
    decision: 'accepted' | 'dismissed',
    title: string,
  ): Promise<void> {
    const findingId = await seedDecidedFinding(pg.handle.db, workspaceId, agentId, decision, title);
    const res = await a.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: findingId } });
    expect(res.statusCode).toBe(201);
  }

  it('AC-2: must_find passes on a matching finding; must_not_flag fails on an overlapping one', async () => {
    // Model always flags config:11 (kept) + a phantom config:999 (dropped).
    const app = await appWith(new MockLLMProvider('openai', { structured: reviewOf([FINDING_11, FINDING_999]) }));
    const agent = await createAgent(app);
    await createCase(app, agent.id, 'accepted', 'MustFind'); // must_find, expects config:11
    await createCase(app, agent.id, 'dismissed', 'MustNotFlag'); // must_not_flag, guards config:11

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const run = res.json();

    expect(run.traces_total).toBe(2);
    expect(run.traces_passed).toBe(1);

    const byName = Object.fromEntries(run.per_trace.map((p: { name: string }) => [p.name, p]));
    expect(byName.MustFind.pass).toBe(true); // agent flagged the expected location
    expect(byName.MustNotFlag.pass).toBe(false); // overlapping finding = noise
    // Actual output carries the produced (kept) finding, not the phantom.
    expect(byName.MustFind.actual).toEqual([
      expect.objectContaining({ file: 'src/config.ts', start_line: 11 }),
    ]);

    await app.close();
  });

  it('AC-9: changing the system prompt moves the aggregate metrics', async () => {
    // The model flags config:11 ONLY when the (untrusted-fenced) system prompt
    // carries the FLAG_CONFIG marker — so a must_not_flag case flips pass↔fail.
    const app = await appWith(
      scriptedProvider((messages) =>
        JSON.stringify(messages).includes('FLAG_CONFIG') ? reviewOf([FINDING_11]) : reviewOf([]),
      ),
    );
    const agent = await createAgent(app, 'clean prompt');
    await createCase(app, agent.id, 'dismissed', 'Guard'); // must_not_flag

    const run1 = (await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })).json();
    expect(run1.precision).toBe(1); // no finding produced → nothing noisy
    expect(run1.traces_passed).toBe(1);

    // Edit the prompt (bumps the agent version) → the model now flags config:11.
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}`,
      payload: { system_prompt: 'clean prompt FLAG_CONFIG' },
    });

    const run2 = (await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })).json();
    expect(run2.precision).toBe(0); // overlapping finding is now noise
    expect(run2.traces_passed).toBe(0);
    expect(run2.precision).not.toBe(run1.precision); // metrics moved

    // The two runs snapshot different prompts + versions under distinct groups.
    const rows = await pg.handle.db.select().from(t.evalRuns);
    const prompts = new Set(rows.map((r) => r.systemPrompt));
    expect(prompts.has('clean prompt')).toBe(true);
    expect(prompts.has('clean prompt FLAG_CONFIG')).toBe(true);

    await app.close();
  });

  it('AC-16: a per-case model failure is recorded errored with a reason; the run continues', async () => {
    let n = 0;
    const app = await appWith(
      scriptedProvider(() => {
        n += 1;
        if (n === 1) throw new Error('model unavailable');
        return reviewOf([]); // subsequent cases succeed → must_not_flag passes
      }),
    );
    const agent = await createAgent(app);
    await createCase(app, agent.id, 'dismissed', 'CaseA');
    await createCase(app, agent.id, 'dismissed', 'CaseB');

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200); // NOT a bare 500
    const run = res.json();
    expect(run.traces_total).toBe(2);

    const errored = run.per_trace.filter(
      (p: { actual: unknown }) => (p.actual as { error?: string })?.error,
    );
    const scored = run.per_trace.filter(
      (p: { actual: unknown }) => !(p.actual as { error?: string })?.error,
    );
    expect(errored).toHaveLength(1); // one case failed
    expect((errored[0].actual as { error: string }).error).toContain('model unavailable');
    expect(errored[0].pass).toBe(false);
    expect(scored).toHaveLength(1); // the run continued past the failure
    expect(scored[0].pass).toBe(true);

    // The errored row persists with NULL metrics (no fabricated zeros).
    const erroredCaseName = errored[0].name as string;
    const [erroredCase] = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerId, agent.id), eq(t.evalCases.name, erroredCaseName)));
    const [row] = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.caseId, erroredCase!.id));
    expect(row!.pass).toBeNull();
    expect(row!.recall).toBeNull();
    expect(row!.precision).toBeNull();

    await app.close();
  });

  it('empty set → empty aggregate, ZERO LLM calls, no crash', async () => {
    const mock = new MockLLMProvider('openai', { structured: reviewOf([]) });
    const app = await appWith(mock);
    const agent = await createAgent(app); // no cases

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const run = res.json();
    expect(run.traces_total).toBe(0);
    expect(run.per_trace).toEqual([]);
    expect(run.recall).toBe(0);
    expect(mock.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('AC-15: running eval for an agent outside the workspace → 404', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: reviewOf([]) }));
    const res = await app.inject({ method: 'POST', url: `/agents/${crypto.randomUUID()}/eval-runs` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
