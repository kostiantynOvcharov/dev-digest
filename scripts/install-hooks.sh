#!/usr/bin/env bash
# Installs the native git pre-push hook for pr-self-review.
# Run once per clone: `bash scripts/install-hooks.sh`
# (.git/hooks is not version-controlled, so this can't be committed for you.)
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
hooks_dir="$repo_root/.git/hooks"
target="$hooks_dir/pre-push"
src=".claude/hooks/pre-push.githook"

chmod +x "$repo_root/.claude/hooks/"*.sh "$repo_root/.claude/hooks/pre-push.githook" 2>/dev/null || true

if [ -e "$target" ] && [ ! -L "$target" ]; then
  echo "⚠️  $target already exists and is not a symlink — backing it up to pre-push.bak"
  mv "$target" "$target.bak"
fi

# Relative symlink from .git/hooks/ → repo-root/.claude/hooks/pre-push.githook
ln -sf "../../$src" "$target"
echo "✅ Installed pre-push hook → $src"
echo "   Bypass a single push with:  PR_SELF_REVIEW_SKIP=1 git push ..."
