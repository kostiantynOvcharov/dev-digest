---
name: pr-self-review
description: "Local pre-PR self-review gate for DevDigest. Collects everything not yet on main (committed-since-main + staged + unstaged), routes each changed file to the relevant best-practice skills (React/Next for client, onion-architecture/Fastify/Drizzle for server & reviewer-core, security/typescript/zod cross-cutting), runs the repo's deterministic checks (typecheck, test, arch:check), and writes a pass/fail verdict that two git-push hooks enforce. Use when about to open a pull request, before pushing, on request to self-review changes, or when a push is blocked by the pr-self-review gate. Triggers: self-review, pre-PR, before push, review my changes, pr gate, blocked push."
version: 1.0.0
user-invocable: true
---

# PR Self-Review

A local gate that reviews everything not yet merged to `main`, applies the project's
best-practice skills as review lenses, runs the deterministic checks, and records a
verdict. Two hooks (`PreToolUse` on Bash + native `pre-push`) **block `git push` unless a
fresh `pass` verdict exists** for the exact current changes — so no CRITICAL reaches a PR.

This skill produces the verdict; it never bypasses it. Bypass is the user's choice via
`PR_SELF_REVIEW_SKIP=1 git push`.

## When to run
- Before opening a PR / before pushing.
- On "self-review", "review my changes", "am I safe to push".
- When a push was blocked and the user wants to clear the gate.

## Step 1 — Compute the review scope
Base branch is `main` (override: `$PR_SELF_REVIEW_BASE`). The change set =
committed-since-base **+** staged **+** unstaged:

```bash
git fetch origin main --quiet 2>/dev/null || true
git diff --name-only main...HEAD          # committed, not yet merged
git diff --name-only HEAD                 # tracked working-tree changes (staged + unstaged)
git status --porcelain                    # also surfaces untracked/new files
```
Union and dedupe the file list. If the set is empty → report "nothing to review" and exit
without writing a fail.

## Step 2 — Route each changed file (apply skills as lenses)

| Changed path | Load & apply |
|---|---|
| `client/src/**/*.{tsx,jsx}` | `react-best-practices`, `react-frontend-best-practices` |
| `client/src/app/**` (`page/layout/route/loading/error`) | + `next-best-practices` |
| `client/**/*.test.{tsx,ts}` | + `react-testing-library` |
| `server/src/modules/**`, `reviewer-core/src/**` | `onion-architecture` |
| `server/**/{routes,app,server}.ts` | + `fastify-best-practices` |
| `server/src/db/schema/**`, `*repository*.ts` | + `drizzle-orm-patterns`, `postgresql-table-design` |
| any `.ts/.tsx` touching auth / input / secrets / uploads / API | `security` |
| any `.ts/.tsx` (types) · schemas/validation | `typescript-expert` · `zod` |
| `server/src/vendor/shared/**`, `server/src/db/migrations/**` | **RESTRICTED** — any hand-edit = **CRITICAL** (do-not-touch per CLAUDE.md) |

Load each routed skill with the Skill tool and check the diff against its rules. This skill
is the router; the depth lives in the routed skills — do not re-implement their rules here.

## Step 3 — Deterministic hard gates (any failure = CRITICAL)
Run only for the packages that changed:
- `client/` → `pnpm -C client typecheck` && `pnpm -C client test`
- `server/` → `pnpm -C server typecheck` && `pnpm -C server test` && `pnpm -C server arch:check`
- `reviewer-core/` → `npm --prefix reviewer-core run typecheck` && `... test` && `... arch:check`

(No ESLint/Prettier exist in this repo — do not invent them.)

> Known pre-existing failure: `client/.../RunHistory/RunHistory.test.tsx` cost-format assertion
> fails on the current tree (see `client/INSIGHTS.md`). Treat ONLY that one as pre-existing;
> any other test failure is a real CRITICAL.

## Step 4 — Severity rubric (unified across all lenses)
- **CRITICAL** (blocks): any Step-3 failure; a `security` CRITICAL (auth bypass, RCE,
  hardcoded secret, injection); a `react-best-practices` / `zod` CRITICAL; an edit to a
  RESTRICTED path.
- **HIGH / MEDIUM / LOW**: report, do not block.
- **Verdict:** `criticals.length == 0 → "pass"`, else `"fail"`.

## Step 5 — Write the verdict artifact
Write `.claude/pr-self-review.json`. The `diff_hash` MUST use the exact recipe the gate
recomputes (keep in sync with `.claude/hooks/pr-self-review-gate.sh`):

```bash
HEAD_SHA=$(git rev-parse HEAD)
DIFF_HASH=$({ git diff main...HEAD; git diff HEAD; git status --porcelain; } | shasum -a 256 | cut -d' ' -f1)
```
```json
{
  "head_sha": "<HEAD_SHA>",
  "diff_hash": "<DIFF_HASH>",
  "verdict": "pass",
  "criticals": [{ "path": "", "line": 0, "rule": "", "skill": "" }],
  "reviewed_at": "<ISO8601>"
}
```
Always rewrite it (pass or fail). It is git-ignored and machine-local.

> Hashing caveat: the recipe captures tracked diffs + the porcelain status line for untracked
> files, but NOT untracked-file *contents*. Editing a brand-new (untracked) file after a pass
> won't invalidate the verdict. Re-run the review after changing untracked files, or `git add`
> them first so they appear in `git diff HEAD`.

## Step 6 — Report
Print a summary then findings grouped by area:
```
PR self-review — N files · X CRITICAL · Y HIGH · Z MEDIUM
<path>:<line> — <SEVERITY> — <finding> — <skill> — <suggested fix>
```
- 0 criticals → ✅ "Safe to open a PR." (verdict pass; push allowed)
- ≥1 critical → ❌ "Not safe to open a PR" + list the blockers (verdict fail; push blocked)

## Boundaries
- Report-only — never auto-fix.
- Not a CI replacement — CI still runs per-package on the PR.
- Insight capture is separate — leave it to `engineering-insights`.
