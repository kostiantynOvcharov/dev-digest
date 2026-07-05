# API Contract Reviewer — runbook

A lesson-2 lab exercise (Part B). You build a review **agent** scoped to public
HTTP API contract changes, give it **4 directive skills**, and prove the skills
matter by running the same PR diff once *without* skills (the breaking change
slips through) and once *with* them (it is flagged as a grounded CRITICAL finding
with an inline comment).

This is a **UI walkthrough** — no code changes. Everything below is done through
the running DevDigest studio. The skill bodies and the experiment diff live next
to this file:

- `skill-breaking-change.md`
- `skill-response-schema.md`
- `skill-semver-discipline.md`
- `skill-deprecation-policy.md`
- `experiment.md`

## How skills reach the model (why this works)

A skill body is plain markdown. At review time the linked skill bodies are
injected **verbatim** into the prompt's `## Skills / rules` section
(`reviewer-core/src/prompt.ts` → `assemblePrompt`, the `skillsBlock`). The agent's
`system_prompt` is trusted; the diff is wrapped as untrusted data. So the skill
text is the lever that tells the model *what to look for* in the diff.

Every finding the model emits then passes the **grounding gate**
(`reviewer-core/src/grounding.ts`): a finding is kept only if its `[start_line,
end_line]` range intersects a real hunk in the diff for that file. A skill that
says "flag X as CRITICAL" only produces a surviving finding if the model also
cites real changed lines. That is the whole point of the demo — the skill changes
*recall*, grounding keeps it honest.

---

## Step 1 — Create the agent

Agents → **Create Agent**.

| Field | Value |
| --- | --- |
| name | `API Contract Reviewer` |
| description | `Flags breaking changes to public HTTP API contracts in a diff.` |
| provider | your choice (`anthropic` / `openai` / `openrouter`) |
| model | a capable model for the provider |
| ci_fail_on | **`critical`** (block the PR iff ≥1 CRITICAL finding) |
| strategy | `single-pass` (default) |
| repo_intel | on (default) |

Suggested **system_prompt** (scopes the agent to public API contract changes):

```text
You are the API Contract Reviewer. Your sole job is to review the diff for
changes to PUBLIC HTTP API contracts: route paths and methods, request and
response field names, field types, optionality/nullability, status codes, and
public exported types that describe an API response.

Scope:
- ONLY consider changes that alter what an external client of the API observes.
- IGNORE purely internal refactors, private helpers, tests, comments, and
  formatting that do not change the observable contract.

For every contract change you find, follow the linked Skills / rules to decide
the severity. Emit a finding ONLY when you can cite the exact changed line(s) in
the diff that prove the change. Prefer no finding over an ungrounded guess.

Severity:
- CRITICAL: a backward-incompatible change to a public contract (removed/renamed
  route or response field, narrowed type, new required request field, removed
  field without deprecation).
- WARNING: a risky-but-additive or under-documented change.
```

Save. Note the agent's `ci_fail_on: critical` — this is what makes a CRITICAL
finding actually block the check run rather than just comment.

---

## Step 2 — Create the 4 skills

Three skills you create by hand; **one you create via Import** to exercise that
path (the lab requires exercising Import at least once).

Each skill's `type` should be `convention` (these are house rules about the API
contract), `source` is set automatically (`manual` for hand-created,
`imported_file` for the imported one).

### 2a. Create three skills by hand — Skills → **Create**

For each, copy the fields below and paste the matching `.md` file's contents into
the **body** field.

| name | description | body file |
| --- | --- | --- |
| `breaking-change` | `Removing or renaming a public route or response field is a CRITICAL breaking change.` | `skill-breaking-change.md` |
| `response-schema` | `Changes to response field types, optionality, or nullability break clients.` | `skill-response-schema.md` |
| `semver-discipline` | `Which kinds of API change force a MAJOR version bump.` | `skill-semver-discipline.md` |

### 2b. Create the fourth skill via Import — Skills → **Import**

Use the `deprecation-policy` skill to exercise the import path:

1. Skills → **Import**.
2. Upload `skill-deprecation-policy.md` (a plain `.md` file is a valid import).
3. The importer parses the file **without persisting** and shows a preview
   (`SkillImportPreview`: name, description, type, body, plus any `ignored_files`
   — for a single `.md` there are none).
4. Confirm. This creates the skill with `source: imported_file`. Imported skills
   may land **disabled until vetted** — if so, open it and enable it.

After this step the Skills list shows all four:
`breaking-change`, `response-schema`, `semver-discipline`, `deprecation-policy`.

---

## Step 3 — Link all 4 skills to the agent

Open the **API Contract Reviewer** agent → **Skills** tab.

Add all four skills. Their order sets the order they appear in the prompt's
`## Skills / rules` block — put `breaking-change` first (it carries the headline
CRITICAL rule). Save.

The agent now snapshots a new version whose `AgentVersionConfig.skills` lists the
four linked skill ids — so a later eval/replay reproduces this exact prompt.

---

## Step 4 — Run the with/without experiment

Use the sample PR in `experiment.md` (it renames a response field `userId` → `id`).

### Run A — WITHOUT skills (baseline)

1. Either create the agent first with **no skills linked**, or temporarily unlink
   all four in the Skills tab.
2. Run a review of the experiment PR with the API Contract Reviewer.
3. **Expected:** the reviewer sees a field rename in a diff but has no rule that
   says a rename is a breaking change, so it typically reports **no finding** (or
   at most a low-severity stylistic note). The `userId → id` break is missed. The
   check does **not** block.

### Run B — WITH skills linked

1. Link all four skills (Step 3) and re-run the review of the same PR.
2. **Expected:** `breaking-change` and `response-schema` now tell the model that a
   removed/renamed public response field is a CRITICAL break. The model emits a
   CRITICAL finding citing the exact changed line(s) where `userId` was renamed to
   `id`. Because those lines are real diff hunks, the finding **survives the
   grounding gate** and an **inline comment** is posted on that line.
3. With `ci_fail_on: critical`, the CRITICAL finding **blocks** the check run.

### What to compare

| | Run A (no skills) | Run B (skills linked) |
| --- | --- | --- |
| `## Skills / rules` in the prompt | absent | 4 skill bodies injected |
| Finding for `userId → id` | missed / low severity | CRITICAL |
| Grounded (cites a real diff line)? | n/a | yes |
| Inline comment posted? | no | yes |
| Check run | passes | blocks (`ci_fail_on: critical`) |

The delta between the two runs is the entire lesson: a skill is curated review
knowledge, injected into the prompt, made trustworthy by grounding.

> Tip: if you want a reproducible fixture instead of a live PR, the seeded PR-diff
> test pattern lives in `server/test/skills.it.test.ts`.
