import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PATCH = [
  '@@ -10,3 +10,4 @@',
  '   port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  '   redisUrl: x,',
].join('\n');

let seq = 0;

/** Insert a repo + PR + pr_files + review + finding for `workspaceId`, returning the finding id. */
async function seedDecidedFinding(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  agentId: string | null,
  decision: 'accepted' | 'dismissed',
): Promise<{ findingId: string; prId: string }> {
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
      title: 'Add stripe key',
      author: 'dev',
      branch: 'feat/x',
      base: 'main',
      headSha: 'sha1',
      filesCount: 1,
    })
    .returning();
  await db
    .insert(t.prFiles)
    .values({ prId: pr!.id, path: 'src/config.ts', patch: PATCH });
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
      title: 'Hardcoded Stripe secret key',
      rationale: 'A live Stripe key is committed in source.',
      confidence: 0.95,
      kind: 'finding',
      acceptedAt: decision === 'accepted' ? new Date() : null,
      dismissedAt: decision === 'dismissed' ? new Date() : null,
    })
    .returning();
  return { findingId: finding!.id, prId: pr!.id };
}

d('eval cases (Testcontainers pg)', () => {
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

  function app() {
    return buildApp({ config: config(), db: pg.handle.db, overrides: {} });
  }

  async function createAgent(a: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
    const res = await a.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Sec-${seq++}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
    });
    return res.json().id as string;
  }

  it('accepted finding → must_find case with a non-empty expected_output', async () => {
    const a = await app();
    const agentId = await createAgent(a);
    const { findingId } = await seedDecidedFinding(pg.handle.db, workspaceId, agentId, 'accepted');

    const res = await a.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { finding_id: findingId },
    });
    expect(res.statusCode).toBe(201);
    const c = res.json();
    expect(c.owner_kind).toBe('agent');
    expect(c.owner_id).toBe(agentId);
    expect(Array.isArray(c.expected_output)).toBe(true);
    expect(c.expected_output).toHaveLength(1);
    expect(c.expected_output[0]).toMatchObject({
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      severity: 'CRITICAL',
      category: 'security',
    });
    // The captured fragment is the hunk, not empty, and holds the changed line.
    expect(c.input_diff).toContain('stripeKey');
    expect(c.input_meta.guard).toEqual({ file: 'src/config.ts', start_line: 11, end_line: 11 });

    // Appears in the owner's list.
    const list = (
      await a.inject({ method: 'GET', url: `/eval-cases?owner_kind=agent&owner_id=${agentId}` })
    ).json();
    expect(list.some((row: { id: string }) => row.id === c.id)).toBe(true);

    await a.close();
  });

  it('dismissed finding → must_not_flag case: empty expected_output + guard input_meta', async () => {
    const a = await app();
    const agentId = await createAgent(a);
    const { findingId } = await seedDecidedFinding(pg.handle.db, workspaceId, agentId, 'dismissed');

    const c = (
      await a.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: findingId } })
    ).json();
    expect(c.expected_output).toEqual([]);
    expect(c.input_meta.decision).toBe('dismissed');
    expect(c.input_meta.guard).toEqual({ file: 'src/config.ts', start_line: 11, end_line: 11 });

    await a.close();
  });

  it('cross-workspace finding → 404 and nothing written', async () => {
    const a = await app();
    // A finding in a DIFFERENT workspace than the caller's (default) workspace.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other' })
      .returning();
    const { findingId } = await seedDecidedFinding(pg.handle.db, otherWs!.id, null, 'accepted');

    const before = await pg.handle.db.select().from(t.evalCases);
    const res = await a.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { finding_id: findingId },
    });
    expect(res.statusCode).toBe(404);
    const after = await pg.handle.db.select().from(t.evalCases);
    expect(after.length).toBe(before.length); // nothing written

    await a.close();
  });

  it('malformed EvalCaseInput on update → typed 4xx, nothing written', async () => {
    const a = await app();
    const before = await pg.handle.db.select().from(t.evalCases);
    const res = await a.inject({
      method: 'POST',
      url: `/eval-cases/${crypto.randomUUID()}`,
      payload: { owner_kind: 'agent' }, // missing owner_id + name (name min 1)
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.json().error.code).toBe('validation_error');
    const after = await pg.handle.db.select().from(t.evalCases);
    expect(after.length).toBe(before.length);

    await a.close();
  });

  it('pending (undecided) finding → 400, no case created', async () => {
    const a = await app();
    const agentId = await createAgent(a);
    // Insert an undecided finding by seeding then clearing the decision.
    const { findingId } = await seedDecidedFinding(pg.handle.db, workspaceId, agentId, 'accepted');
    await pg.handle.db
      .update(t.findings)
      .set({ acceptedAt: null, dismissedAt: null })
      .where(eq(t.findings.id, findingId));

    const res = await a.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { finding_id: findingId },
    });
    expect(res.statusCode).toBe(400);

    await a.close();
  });

  it('update + delete a case (workspace-scoped)', async () => {
    const a = await app();
    const agentId = await createAgent(a);
    const { findingId } = await seedDecidedFinding(pg.handle.db, workspaceId, agentId, 'accepted');
    const c = (
      await a.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: findingId } })
    ).json();

    const updated = (
      await a.inject({
        method: 'POST',
        url: `/eval-cases/${c.id}`,
        payload: {
          owner_kind: 'agent',
          owner_id: agentId,
          name: 'Renamed case',
          input_diff: c.input_diff,
          expected_output: [],
          notes: 'edited',
        },
      })
    ).json();
    expect(updated.name).toBe('Renamed case');
    expect(updated.notes).toBe('edited');

    const del = await a.inject({ method: 'DELETE', url: `/eval-cases/${c.id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    const [gone] = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.id, c.id), eq(t.evalCases.workspaceId, workspaceId)));
    expect(gone).toBeUndefined();

    await a.close();
  });
});
