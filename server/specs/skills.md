# Spec — Skills (L02): reusable skills for review agents

Status: in progress · Owner: Skills Lab · Canonical spec for the L02 lesson
(server is the backbone; the UI is summarized here and detailed in
`client/specs/skills.md`). **Updated to the renewed tabbed-editor design.**

## 1. Context & problem

DevDigest is a local-first AI PR reviewer. **Agents already exist end to end**
(CRUD, editor, config versioning, prompt assembly, run trace). What's missing is
a way to share review guidance across agents without copy-pasting it into every
system prompt.

A **Skill** is a *reusable text block* of rules/rubric, authored once and bound
to many agents. At review time the bodies of an agent's enabled, linked skills
are injected into the prompt as a single `## Skills / rules` section.

Unlike an agent, a skill is **text + configuration only — nothing executable**.
This is the central trust property: a skill (especially an imported one) is
*someone else's instructions in your agent's prompt*, and must be treated as
data, never run.

### Key discovery: the scaffolding already exists but is not connected

| Layer | Already present | File |
|------|-----------------|------|
| DB | `skills`, `skill_versions`, `agent_skills` (with `order`) | `server/src/db/schema/skills.ts`, `agents.ts` |
| Contracts | `Skill`, `SkillType`, `SkillSource`, `AgentSkillLink` (both vendored copies) | `*/src/vendor/shared/contracts/knowledge.ts` |
| Agent side | `GET/POST /agents/:id/skills`; repo `linkedSkills/setSkills/linkSkill/unlinkSkill` | `server/src/modules/agents/{routes,repository}.ts` |
| Engine | `assemblePrompt` renders `## Skills / rules` and exposes `prompt_assembly.skills` | `reviewer-core/src/prompt.ts` |
| Client | trace renders the skills block; `skills.json` i18n; `activeKeyFor` maps `/skills` | `client/.../RunTraceDrawer/.../TraceBody.tsx`, `client/messages/en/skills.json`, `client/src/components/app-shell/helpers.ts` |

This lesson **wires together** existing pieces and adds the missing module + UI.
**No new migration is required** — the tables already exist.

## 2. Goals / non-goals

**Goals**
1. A server `skills` module: workspace-scoped CRUD + body versioning + import.
2. Resolve an agent's enabled+linked skills into the review prompt (the missing wire).
3. A `/skills` master–detail page whose right pane is a **full tabbed editor
   that mirrors the Agent editor**: **Config · Preview · Evals · Stats ·
   Versions** (see §8). The skill title shows a version badge and a
   **Run on evals** action.
4. A **Skills** tab in the agent editor: link/unlink + drag-to-reorder.
5. Seed a new **Test Quality Reviewer** agent and demo skills.

**Non-goals (out of scope for L02)**
- Importing from URL or a community catalog (the source values exist, but the
  drawer only ships the *From file* tab).
- Per-agent skill enable/disable as a *separate* flag — binding *is* enabling
  (see §5).
- Executing anything from an imported archive (explicitly forbidden — §7).
- **Evals tab + Run on evals**: present for parity but a disabled/stub state in
  L02 (skill evals are a later lesson; `EvalCase.owner_kind` already allows
  `skill`).
- **Computed Stats analytics** (pull frequency, accept rate, findings counts,
  findings-by-category donut): the *Stats tab ships*, and **USED BY** + the
  **agents-using list** are real (from `agent_skills`); the rate/finding metrics
  shown in the mockups are **design placeholders** rendered as `—` in L02 — we
  do not fabricate numbers. Real wiring is deferred.

## 3. Data model (no migration)

`skills` (existing): `id, workspace_id, name, description, type, source, body,
enabled, version, evidence_files, created_at`.
- `type ∈ {rubric, convention, security, custom}`
- `source ∈ {manual, imported_url, imported_file, extracted, community}` —
  **`imported_file` is added** to the Drizzle enum as a TS-only widening; the
  column stays `text`, so `db:generate` produces **no** migration. Keep in
  lock-step with both vendored `SkillSource` contracts.
- `enabled` = the skill's **global master switch** (§5).
- `version` = current body version; `evidence_files` = optional citations.

`skill_versions` (existing): `(skill_id, version) → body, created_at`. An
immutable body snapshot, mirroring `agent_versions`. Powers the **Versions** tab
(history, Diff, Restore).

`agent_skills` (existing): `(agent_id, skill_id) → order`. **No new column** —
presence of a row means "linked & enabled for this agent". Also the source for
the Stats tab's **USED BY** count and **agents-using** list.

## 4. Contracts (both vendored copies, in lock-step)

Added to `vendor/shared/contracts/knowledge.ts`:
- `SkillVersion = { skill_id, version, body, created_at }`
- `SkillImportIgnored = { path, size, reason }`
- `SkillImportPreview = { name, description, type, source, body, ignored_files: SkillImportIgnored[] }`
- `SkillSource` gains `imported_file`.

The "agents using a skill" endpoint reuses the existing `Agent` DTO (no new
contract).

## 5. Enablement model (decided)

Two independent switches; a skill reaches a prompt only when **both** are on:
1. **Linked to the agent** — a row in `agent_skills` (agent-editor checkbox).
2. **Globally enabled** — `skills.enabled` (Config tab toggle / list-card toggle).
   A globally-disabled skill is excluded from every agent's prompt even if linked.

**Order** is `agent_skills.order` (ascending) and determines the sequence of
blocks within `## Skills / rules`. Reordering is drag-and-drop.

## 6. Server

### 6.1 Module `server/src/modules/skills/` (mirrors `agents/`)

- `repository.ts` — `SkillsRepository(db)`, workspace-scoped: `list / getById /
  insert / update / deleteById` over `t.skills`; `listVersions / getVersion`
  over `t.skillVersions`; `agentsUsing(workspaceId, skillId)` (join
  `agent_skills`→`agents`, ordered) for the Stats tab. `insert` snapshots v1;
  `update` **bumps `version` and snapshots a new `skill_versions` row only when
  `body` changes** (name / description / type / enabled edits do not bump).
- `helpers.ts` — `toSkillDto` / `toSkillVersionDto` (snake_case DTOs);
  `isBodyChange`; a local `agentRowToDto` (so the agents-using join can return
  `Agent[]` without crossing module boundaries); and the **pure** extractor
  `extractSkillFromUpload(filename, bytes)` + `deriveName` / `deriveDescription`
  / `inferType` (default `custom`). The extractor decodes/unzips an in-memory
  buffer (`fflate`) and returns a `SkillImportPreview`; it **never executes**
  archive contents.
- `service.ts` — `SkillsService(container)`: `list / get / create / update /
  delete / listVersions / agentsUsing`; `previewImport(filename, contentBase64)`
  (decode → size-guard → extract; no persistence).
- `routes.ts` — Fastify plugin (one line in `modules/index.ts`).
- `constants.ts` — `INITIAL_SKILL_VERSION`, defaults, `MAX_IMPORT_BYTES` (1 MiB).

### 6.2 REST surface (matches the renewed API map)

| Method | Path | Body | Returns | Purpose |
|--------|------|------|---------|---------|
| GET | `/skills` | — | `Skill[]` | workspace skill list |
| GET | `/skills/:id` | — | `Skill` | one skill (404 otherwise) |
| POST | `/skills` | `{ name, description?, type, body, source?, enabled?, evidence_files? }` | `Skill` (201) | create — also the import **Confirm** |
| PUT | `/skills/:id` | partial of the above | `Skill` | update; body change → new version. **Restore** = PUT with an old version's body |
| DELETE | `/skills/:id` | — | `{ ok: true }` | delete |
| GET | `/skills/:id/versions` | — | `SkillVersion[]` | Versions tab (newest first; bodies enable client-side Diff) |
| GET | `/skills/:id/agents` | — | `Agent[]` | Stats tab — USED BY + agents-using list |
| POST | `/skills/import` | `{ filename, content_base64 }` | `SkillImportPreview` | preview `.md`/`.zip`, **no persistence, no execution** |

Import uses JSON + base64 (not multipart) so we avoid adding
`@fastify/multipart`. **Confirmation is a plain `POST /skills`** with the
(possibly edited) preview fields, `source: 'imported_file'`, `enabled: false`
(must be vetted + enabled before use).

### 6.3 Prompt wiring (the critical wire) — `reviews/run-executor.ts`

In `runOneAgent`, before calling `reviewPullRequest` (~line 191):

```ts
const linked = await this.agents.linkedSkills(agent.id);            // ordered by `order` ASC
const skillBodies = linked.filter(l => l.skill.enabled)            // global master switch
                          .map(l => l.skill.body);
if (skillBodies.length) runLog.info(`skills: ${skillBodies.length} enabled skill(s) attached`);
// …in the reviewPullRequest call:
...(skillBodies.length ? { skills: skillBodies } : {}),
```

`reviewPullRequest` / `assemblePrompt` are unchanged: the `## Skills / rules`
block and `prompt_assembly.skills` populate themselves and `tokens_in` grows.
This is the acceptance signal "an enabled skill shows as its own block in the
trace; a disabled one does not".

## 7. Import & trust model

- Accept `.md` / `.markdown` and `.zip`. `.md` → the file is the body. `.zip` →
  `fflate.unzipSync` (pure JS, no I/O); the markdown core (`SKILL.md`, else
  `README.md`, else the shallowest `*.md`) becomes the body; **every other entry
  (scripts, binaries, assets) is listed in `ignored_files` and never read as an
  instruction or executed**.
- Preview first, persist on confirm. The UI surfaces an "untrusted source"
  notice for any non-`manual` skill and leaves imported skills `enabled: false`
  until vetted and enabled.

## 8. Client — tabbed Skill editor (renewed design)

`/skills` is a master–detail layout mirroring the Agent editor: a left skill
list (cards) + a right pane with a tab bar. See `client/specs/skills.md` for the
component tree. Routing mirrors agents: `/skills` (list) and `/skills/[id]`
(editor with the left list + tabs; `tab` in `?tab=`).

**List card** (`SkillCard`): icon, name, `enabled` toggle, truncated
description, a **type badge** (rubric/convention/security/custom) + a **source
badge** (Manual / Extracted / Community / Imported), and a usage line
"`N agents · X% pull · Y% accept`" (only `N agents` is real in L02; the rates are
placeholders). A "needs vetting" affordance appears for non-`manual` sources.

**Tabs** (skill title shows a `vN` badge + a **Run on evals** button):
- **Config** — `name`, `description` (with the directive-interface hint),
  `type` select, and the **Skill body** markdown editor (filename header,
  token count, *unsaved* indicator, line numbers). `Enabled` toggle in the
  header. Save → `PUT /skills/:id` (body change bumps the version).
- **Preview** — "Rendered as the reviewing agent receives it": the body rendered
  as markdown (what lands in `## Skills / rules`).
- **Stats** — cards **USED BY** (real: count of linking agents), **PULL
  FREQUENCY / ACCEPT RATE / FINDINGS (30D)** (placeholder `—` in L02);
  **AGENTS USING THIS SKILL** list (real: from `GET /skills/:id/agents`, each
  links to `/agents/:id`); **FINDINGS BY CATEGORY** donut (placeholder).
- **Versions** — "Every save snapshots the body so eval runs stay reproducible":
  version history (`GET /skills/:id/versions`) with the **Current** badge,
  per-row **Diff** (client-side body diff) and **Restore** (`PUT` the old body →
  new version).
- **Evals** — stub/empty state in L02.

**Add Skill** dropdown: *Create from scratch* (opens Config on a new skill) and
*Import from file* (opens the **ImportDrawer**: pick `.md`/`.zip` → base64 →
`POST /skills/import` → preview of the extracted body + the `ignored_files` list
→ **Confirm** = `POST /skills`).

**Hooks** (`client/src/lib/hooks/skills.ts`, mirror `agents.ts`): `useSkills`,
`useSkill`, `useCreateSkill`, `useUpdateSkill`, `useDeleteSkill`,
`useSkillVersions`, `useSkillAgents`, `useImportSkillPreview`. All via
`src/lib/api.ts`; invalidate `["skills"]` (+ `["skill", id]`,
`["skill-versions", id]`).

**Nav** (`client/src/vendor/ui/nav.ts`): add a **SKILLS LAB** section with a
**Skills** item (`/skills`, `Sparkles` icon) beside **Agents**. `activeKeyFor`
already maps `/skills`.

**Agent editor → Skills tab** (`AgentEditor/_components/SkillsTab`): list all
workspace skills + the agent's linked set; checkbox = link/unlink; drag-handle =
native HTML5 reorder; type badge; "N of M enabled" header. Save → `POST
/agents/:id/skills` with ordered `skill_ids`. Register `skills` in
`AgentEditor/constants.ts` `TABS` and `agents/[id]/page.tsx` `VALID_TABS`. No
server change. Optionally populate `skillCount` on `AgentCard`.

## 9. Seed & demo

- `seed-prompts.ts`: add `TEST_QUALITY_REVIEWER_PROMPT` (uncovered branches,
  missed corner cases, over-mocking, flaky tests); mirror in `docs/agent-prompts/`.
- `seed.ts` (idempotent): add the **Test Quality Reviewer** agent + 3 seeded
  skills (e.g. `uncovered-branches`, `edge-case-coverage`, `mock-overuse-gate`;
  `source: 'manual'`, `enabled: true`) linked with `order`. A 4th skill
  (`flaky-test-patterns`) is **not** seeded — it is created live via `.md`/`.zip`
  import during the demo (satisfies "at least one via import" and "created /
  edited in the UI"). Optionally seed body snapshots so the Versions tab has
  history on a demo skill.

## 10. Acceptance criteria

1. A skill is created and edited in the UI (Config tab); editing the body
   increments the version, and the **Versions** tab shows the new snapshot
   (Current badge), with Diff + Restore working.
2. The **Preview** tab renders the body as the reviewing agent receives it.
3. The **Stats** tab shows the real USED BY count and the agents-using list
   (linking to each agent); placeholder metrics render as `—`, never fabricated.
4. Importing a `.zip` shows a preview with the extracted body + `ignored_files`;
   nothing executable runs; the saved skill is `enabled: false` with a "needs
   vetting" affordance.
5. The Test Quality Reviewer agent has linked skills; links can be reordered (DnD).
6. An **enabled, linked** skill appears as its own `## Skills / rules` block in
   the run trace and increases `tokens_in`; a **globally-disabled or unlinked**
   skill does not appear.
7. Control experiment reproduces: a happy-path-only test PR is missed without
   skills and flagged (uncovered branch / edge case) with skills attached.
8. `pr-self-review` (auto-invoke off) can be run manually and pulls both front-
   and back-end skills.

## 11. Verification

- **Server**: integration test for skills CRUD + import-preview + versions +
  agents-using; assert an enabled linked skill appears in
  `prompt_assembly.skills` and an unlinked / globally-disabled one does not.
  `pnpm test`, `pnpm typecheck`, `pnpm arch:check` (onion boundaries at 0 errors).
- **Client**: RTL for the Config/Preview/Versions tabs, `ImportDrawer` (preview
  + `ignored_files`), and `SkillsTab` (attach + reorder). `pnpm test`,
  `pnpm typecheck`.

## 12. Files (create / change)

**Create** — `server/src/modules/skills/{routes,service,repository,helpers,constants}.ts`;
`client/src/lib/hooks/skills.ts`; `client/src/app/skills/page.tsx` +
`_components/{SkillsListView,SkillCard,ImportDrawer}/`;
`client/src/app/skills/[id]/page.tsx` +
`_components/SkillEditor/_components/{ConfigTab,PreviewTab,StatsTab,VersionsTab}/`;
`client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/`.

**Change** — `server/src/modules/index.ts` (+1 line);
`server/src/modules/reviews/run-executor.ts` (skill wiring);
`server/src/db/schema/skills.ts` + both `vendor/shared/contracts/knowledge.ts`
(`imported_file`, lock-step); `server/src/db/rows.ts` (`SkillRow`/`SkillVersionRow`);
`server/src/db/seed.ts` + `seed-prompts.ts`; `docs/agent-prompts/`;
`client/src/vendor/ui/nav.ts`;
`client/src/app/agents/[id]/_components/AgentEditor/constants.ts` +
`agents/[id]/page.tsx` (`VALID_TABS`); `client/messages/en/skills.json` (+ editor
+ tab keys); `+fflate` in `server/package.json`.
