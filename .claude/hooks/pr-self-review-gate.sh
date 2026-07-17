#!/usr/bin/env bash
# pr-self-review-gate.sh — the shared gate both hooks consult before a `git push`.
#
#   exit 0  → push allowed (fresh "pass" verdict, or explicitly skipped)
#   exit 1  → push blocked (reason on stderr)
#
# Bypass for intentional WIP pushes:  PR_SELF_REVIEW_SKIP=1 git push ...
# Override base branch (default main): PR_SELF_REVIEW_BASE=develop
#
# The verdict artifact (.claude/pr-self-review.json) is written by the
# `pr-self-review` skill. This script never writes it — it only validates that a
# matching, passing review exists for the EXACT current changes.

set -uo pipefail

if [ "${PR_SELF_REVIEW_SKIP:-}" = "1" ]; then
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0  # not a git repo → don't interfere
artifact="$repo_root/.claude/pr-self-review.json"
base="${PR_SELF_REVIEW_BASE:-main}"

block() {
  echo "❌ pr-self-review gate: $1" >&2
  echo "   → Run /pr-self-review in Claude Code to (re)review, or set PR_SELF_REVIEW_SKIP=1 to bypass." >&2
  exit 1
}

# Same hashing recipe the skill records — keep these IN SYNC.
sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi; }
current_diff_hash() {
  { git diff "$base"...HEAD; git diff HEAD; git status --porcelain; } 2>/dev/null | sha256 | cut -d' ' -f1
}

# Read a top-level string field from the JSON artifact (jq if present, else grep).
read_field() {
  if command -v jq >/dev/null 2>&1; then
    jq -r ".$1 // empty" "$artifact" 2>/dev/null
  else
    grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$artifact" | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//'
  fi
}

[ -f "$artifact" ] || block "no review found ($artifact missing)"

head_sha=$(git rev-parse HEAD 2>/dev/null)
diff_hash=$(current_diff_hash)

verdict=$(read_field verdict)
a_head=$(read_field head_sha)
a_diff=$(read_field diff_hash)

[ "$verdict" = "pass" ]    || block "last review verdict = '${verdict:-unknown}' — criticals must be resolved"
[ "$a_head" = "$head_sha" ] || block "review is stale — HEAD moved since it ran"
[ "$a_diff" = "$diff_hash" ] || block "review is stale — working changes differ from what was reviewed"

exit 0
