#!/usr/bin/env bash
# Stop hook — nudge the engineering-insights skill, but ONLY when it's worth it.
#
# Why this exists: the old Stop hook was a `type:"prompt"` hook with no guard, so
# it re-woke the model on EVERY assistant stop — including hundreds of idle
# "waiting on background agent" turns during a long multi-agent run. One run
# spent ~$159 (61% of total) re-reading the full cached context on those idle
# rewakes for zero value (see docs/retro/workflow-retro-ledger.md, 2026-07-09).
#
# This guard fires the nudge at most once per settled change-state:
#   - silent unless module code (client/server/reviewer-core/e2e) actually changed
#   - silent while the tree is still changing between stops (agents mid-write)
#   - silent once it has already nudged for this exact state
# i.e. it fires ~once when a burst of work has settled, never on idle churn.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

prev_f=".claude/.insights-prev"
done_f=".claude/.insights-reminded"

# Module CODE changes only (tracked + untracked). .md (incl. INSIGHTS.md) never
# matches the extension filter, so capturing insights can't re-trigger the hook.
changed=$(git status --porcelain -- client server reviewer-core e2e 2>/dev/null \
  | grep -E '\.(ts|tsx|js|jsx|sql)$' || true)

if [ -z "$changed" ]; then
  : > "$prev_f" 2>/dev/null || true
  exit 0   # no module code touched this session → nothing to capture
fi

cur=$(printf '%s' "$changed" | shasum -a 256 | cut -d' ' -f1)
prev=$(cat "$prev_f" 2>/dev/null || true)
done=$(cat "$done_f" 2>/dev/null || true)
printf '%s' "$cur" > "$prev_f" 2>/dev/null || true

[ "$cur" != "$prev" ] && exit 0   # state changed since last stop → still churning → wait
[ "$cur" = "$done" ] && exit 0    # already nudged for this settled state → stay silent

printf '%s' "$cur" > "$done_f" 2>/dev/null || true
cat <<'JSON'
{"decision":"block","reason":"Before ending this session, invoke the engineering-insights skill for the module(s) with uncommitted code changes (client/, server/, reviewer-core/, e2e/). Read the touched module's INSIGHTS.md first; append only substantial, non-duplicate, file-grounded entries (append-only). If nothing substantial survives the quality filter, skip silently. Do not ask for confirmation."}
JSON
exit 0
