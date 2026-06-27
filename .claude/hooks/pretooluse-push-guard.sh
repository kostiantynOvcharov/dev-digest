#!/usr/bin/env bash
# PreToolUse guard wired to the Bash tool. Reads the tool-call JSON on stdin; if
# the command is a `git push`, consults the shared gate. Exit 2 blocks the tool
# call in Claude Code (stderr is surfaced back to the model); exit 0 allows it.
set -uo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
input=$(cat)

# Extract the command being run from the tool-call JSON (jq → python3 → raw).
extract_cmd() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception: pass' 2>/dev/null
  fi
}
cmd=$(extract_cmd)
[ -z "$cmd" ] && cmd="$input"   # last resort: scan the raw payload

# Match `git push` only as an actual invocation — at the start of the command or
# after a shell separator (; & | && ||). This avoids false positives on incidental
# mentions like echo "git push" or a commit message. (The native pre-push hook is
# the backstop: it fires on ANY real push, including ones Claude issues.)
printf '%s' "$cmd" | grep -Eq '(^|[;&|])[[:space:]]*git[[:space:]]+push([[:space:]]|$)' || exit 0

if "$dir/pr-self-review-gate.sh"; then
  exit 0
else
  exit 2
fi
