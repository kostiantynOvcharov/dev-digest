# Spec — Skills (L02), client

The canonical, full-stack spec is **`server/specs/skills.md`**. This file covers
the `@devdigest/web` surface for the **renewed tabbed-editor design**.

## Routing (mirrors `/agents`)

- `/skills` → list view (`SkillsListView`).
- `/skills/[id]` → master–detail editor: a persistent left **skill list** + a
  right pane with a tab bar. Active tab in `?tab=` (`config` default). Breadcrumb
  `Skills Lab › Skills`.

## Pages & components (`client/src/app/skills/`)

- `page.tsx` → `SkillsListView` (card grid + search + **Add Skill** dropdown).
- `_components/SkillCard` — icon, name, **enabled** toggle, truncated
  description, a **type badge** (rubric/convention/security/custom), a **source
  badge** (Manual / Extracted / Community / Imported), and a usage line
  "`N agents · X% pull · Y% accept`". Only `N agents` is real in L02; pull/accept
  are placeholders. Non-`manual` sources get a "needs vetting" affordance.
- `_components/ImportDrawer` — **From file** tab only: a picker accepting
  `.md`/`.zip`; bytes are base64-encoded and sent to `POST /skills/import`
  (`useImportSkillPreview`); the response renders the extracted body + the
  `ignored_files` list ("executable — not run"). **Confirm** = `POST /skills`
  (`source: 'imported_file'`, `enabled: false`). URL/Community tabs are not shipped.
- `[id]/page.tsx` → left list (reuses `SkillCard`) + `SkillEditor`; declares
  `VALID_TABS = ["config","preview","stats","versions"]` (+ `evals` stub).
- `[id]/_components/SkillEditor` — tab shell (mirrors `AgentEditor`). Title shows
  a `vN` badge and a **Run on evals** button (stub). Tabs:
  - **ConfigTab** — `name`, `description` (hint: *the skill's directive
    interface — phrase it as an instruction*), `type` select, and the **Skill
    body** markdown editor (filename header, token count, *unsaved* indicator,
    line numbers); `Enabled` toggle in the header. Save → `useUpdateSkill`
    (`PUT /skills/:id`; a body change bumps the version + shows "Saved (vN)").
  - **PreviewTab** — body rendered as markdown ("Rendered as the reviewing agent
    receives it").
  - **StatsTab** — cards **USED BY** (real, from `useSkillAgents`), **PULL
    FREQUENCY / ACCEPT RATE / FINDINGS (30D)** (`—` placeholders), **AGENTS
    USING THIS SKILL** list (each links to `/agents/:id`), **FINDINGS BY
    CATEGORY** donut (placeholder).
  - **VersionsTab** — history from `useSkillVersions` ("Every save snapshots the
    body so eval runs stay reproducible"): **Current** badge, per-row **Diff**
    (client-side body diff between snapshots) and **Restore** (`PUT` the old body
    → a new version).
  - **EvalsTab** — empty/coming-soon state in L02.

Most list/import strings already exist in `client/messages/en/skills.json`; add
keys for the editor tabs (config form, preview, stats labels, versions).

## Hooks (`client/src/lib/hooks/skills.ts`, mirror `agents.ts`)

`useSkills`, `useSkill(id)`, `useCreateSkill`, `useUpdateSkill`,
`useDeleteSkill`, `useSkillVersions(id)`, `useSkillAgents(id)`,
`useImportSkillPreview`. Everything via `src/lib/api.ts`; mutations invalidate
`["skills"]` and the relevant `["skill", id]` / `["skill-versions", id]` keys.

## Navigation (`client/src/vendor/ui/nav.ts`)

Add a **SKILLS LAB** section with a **Skills** item (`/skills`, `Sparkles`
icon) beside **Agents** (with a `g s` shortcut). `activeKeyFor` already maps
`/skills`.

## Agent editor — Skills tab

`AgentEditor/_components/SkillsTab`: fetch all workspace skills (`useSkills`) and
the agent's linked set (`GET /agents/:id/skills`); render a list with a checkbox
(attach/detach = link/unlink), a drag-handle for native HTML5 reorder, a type
badge, a filter, and an "N of M enabled" header. A change persists via
`POST /agents/:id/skills` with the ordered `skill_ids` (`setSkills`). Register
`skills` in `AgentEditor/constants.ts` `TABS` and in `agents/[id]/page.tsx`
`VALID_TABS`. No server change required.

## Verification

RTL tests for the Config / Preview / Versions tabs, `ImportDrawer` (preview +
`ignored_files`), and `SkillsTab` (attach + reorder). `pnpm test`,
`pnpm typecheck`.
