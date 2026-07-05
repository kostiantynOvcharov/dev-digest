# pr-self-review

A local **pre-PR review gate** for DevDigest. It reviews everything not yet merged to
`main`, routes each changed file to the project's best-practice skills, runs the
deterministic checks, and records a pass/fail verdict that two `git push` hooks enforce —
so a CRITICAL never reaches a pull request.

## How it works

1. **`/pr-self-review`** (this skill) computes the change set (`main...HEAD` + staged +
   unstaged), applies the routed skills + hard gates, and writes `.claude/pr-self-review.json`
   with `{ head_sha, diff_hash, verdict, criticals, reviewed_at }`.
2. Two hooks read that artifact and **block `git push`** unless a fresh `pass` exists for the
   exact current changes:
   - **`PreToolUse`** (in `.claude/settings.json`) — governs pushes Claude Code issues.
   - **native `.git/hooks/pre-push`** — governs pushes typed in a terminal.
3. The verdict goes stale automatically when `HEAD` moves or the diff changes (`diff_hash`
   mismatch), forcing a re-review.

## Install (once per clone)

```bash
bash scripts/install-hooks.sh        # installs the native pre-push hook
```

The `PreToolUse` hook needs no install — it's read from `.claude/settings.json`.

## Bypass / config

- `PR_SELF_REVIEW_SKIP=1 git push ...` — intentional WIP push, skips the gate.
- `PR_SELF_REVIEW_BASE=<branch>` — review against a base other than `main`.

## File → skill routing

| Area | Skills |
|---|---|
| `client/` React/TSX | `react-best-practices`, `react-frontend-best-practices` |
| `client/src/app/**` | + `next-best-practices` |
| `client/**/*.test.*` | + `react-testing-library` |
| `server/`, `reviewer-core/` | `onion-architecture` (+ `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design` by file) |
| cross-cutting | `security`, `typescript-expert`, `zod` |
| `vendor/shared/**`, `db/migrations/**` | RESTRICTED → hand-edit = CRITICAL |

## Deterministic gates (failure = CRITICAL)

Per changed package: `typecheck`, `test`, and (server / reviewer-core) `arch:check`
(dependency-cruiser). No ESLint/Prettier in this repo.

## Components

| File | Role |
|---|---|
| `.claude/skills/pr-self-review/SKILL.md` | the review logic + artifact spec |
| `.claude/hooks/pr-self-review-gate.sh` | shared gate check (exit 0 allow / 1 block) |
| `.claude/hooks/pretooluse-push-guard.sh` | PreToolUse wrapper (exit 2 blocks the tool call) |
| `.claude/hooks/pre-push.githook` | native hook body, symlinked into `.git/hooks/pre-push` |
| `scripts/install-hooks.sh` | installs the native hook |
| `.claude/pr-self-review.json` | the verdict artifact (git-ignored, machine-local) |

## Relationship to other skills

- Composes the 11 best-practice skills as **review lenses** rather than restating them.
- Independent of the built-in `code-review` / `security-review` (self-contained by design;
  either can be run separately for extra depth).
- Does not capture insights — that's `engineering-insights`.

## Version

**1.0.0** (mirrors the `version` field in `SKILL.md`).

### Changelog
- **1.0.0** — Initial release: scope computation, file→skill routing, deterministic hard
  gates, unified severity rubric, verdict artifact, and the two-hook `git push` block with
  `PR_SELF_REVIEW_SKIP` bypass.
