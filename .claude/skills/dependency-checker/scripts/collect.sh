#!/usr/bin/env bash
#
# collect.sh — gather the raw dependency dataset for the dependency-checker skill.
#
# This does the *mechanical* half of the skill deterministically, so the model spends its
# turns on judgement (findings, priorities, recommendations) rather than re-deriving the same
# du/grep incantations every run. It only READS — it never installs, removes, or edits anything.
#
# Usage:
#   bash .claude/skills/dependency-checker/scripts/collect.sh [repo-root]
#
# Output is plain text with clearly-delimited sections; feed it straight into the report step.
# Sizes need installed node_modules; where a package isn't installed the size section says so
# instead of failing.

# pipefail only (no `set -u`): macOS ships bash 3.2, where `"${arr[@]}"` on an empty array under
# `set -u` errors. This script only reads, so lenient expansion is the safer default here.
set -o pipefail
ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" || { echo "cannot cd into $ROOT"; exit 1; }

# Packages = every directory holding a package.json, excluding installed deps, VCS, build output,
# and DevDigest's runtime review clones (server/clones/* is where the reviewer checks out repos —
# not source of THIS repo). Skipping these keeps the analysis about the real packages.
# while-read (not `mapfile`, which is bash 4+ and absent on macOS's system bash 3.2).
PKG_JSONS=()
while IFS= read -r pj; do PKG_JSONS+=("$pj"); done < <(find . -name package.json \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/.next/*' \
  -not -path '*/clones/*' \
  -not -path '*/dist/*' \
  -not -path '*/build/*' \
  -not -path '*/coverage/*' \
  -not -path '*/.claude/worktrees/*' \
  | sort)

echo "# dependency-checker dataset"
echo "# repo root: $ROOT"
echo "# packages found: ${#PKG_JSONS[@]}"
echo

# ---------------------------------------------------------------------------
# 1. Declared dependencies, per package
# ---------------------------------------------------------------------------
echo "=== DECLARED DEPENDENCIES (per package) ==="
for pj in "${PKG_JSONS[@]}"; do
  dir=$(dirname "$pj")
  node -e '
    const j = require(process.argv[1]);
    const dir = process.argv[2];
    const list = (o) => Object.entries(o||{}).map(([k,v])=>`${k}@${v}`).join(", ") || "(none)";
    console.log(`\n[${dir}]  name=${j.name||"?"}`);
    console.log(`  dependencies:    ${list(j.dependencies)}`);
    console.log(`  devDependencies: ${list(j.devDependencies)}`);
  ' "$pj" "$dir"
done
echo

# ---------------------------------------------------------------------------
# 2. Installed size per top-level dependency (du -sh), per package
# ---------------------------------------------------------------------------
echo "=== INSTALLED SIZES (du -sh of node_modules entries) ==="
for pj in "${PKG_JSONS[@]}"; do
  dir=$(dirname "$pj")
  nm="$dir/node_modules"
  echo
  echo "[$dir]"
  if [ ! -d "$nm" ]; then
    echo "  (node_modules not installed — run the package's install to get sizes)"
    continue
  fi
  # Total, then the heaviest 20 top-level entries (scoped packages counted per scope member).
  echo "  TOTAL: $(du -sh "$nm" 2>/dev/null | cut -f1)"
  du -sh "$nm"/*/ "$nm"/@*/*/ 2>/dev/null \
    | sort -rh \
    | head -20 \
    | sed -E "s#$nm/##; s#^#  #"
done
echo

# ---------------------------------------------------------------------------
# 3. Version drift — the same package resolved to different versions across packages
# ---------------------------------------------------------------------------
echo "=== VERSION DRIFT (same dependency, different declared version) ==="
node -e '
  const fs = require("fs");
  const pjs = process.argv.slice(1);
  const seen = {}; // dep -> { version -> [pkgDir] }
  for (const pj of pjs) {
    const j = JSON.parse(fs.readFileSync(pj, "utf8"));
    const dir = require("path").dirname(pj);
    for (const field of ["dependencies","devDependencies"]) {
      for (const [dep, ver] of Object.entries(j[field]||{})) {
        (seen[dep] ??= {});
        (seen[dep][ver] ??= []).push(dir);
      }
    }
  }
  let any = false;
  for (const [dep, byVer] of Object.entries(seen)) {
    if (Object.keys(byVer).length > 1) {
      any = true;
      console.log(`  ${dep}:`);
      for (const [ver, dirs] of Object.entries(byVer)) console.log(`    ${ver}  <- ${dirs.join(", ")}`);
    }
  }
  if (!any) console.log("  (no version drift detected across package.json files)");
' "${PKG_JSONS[@]}"
echo

# ---------------------------------------------------------------------------
# 4. Cross-package / internal imports — the non-monorepo path-alias topology
#    DevDigest shares code via tsconfig path aliases + relative imports, NOT workspace:*.
#    We surface both the sanctioned aliases and the risky deep relative imports.
# ---------------------------------------------------------------------------
echo "=== INTERNAL (CROSS-PACKAGE) IMPORTS ==="
GREP_EXCL="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=clones --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage"
echo "-- path-alias imports (@shared, @devdigest/*, @/*) --"
grep -rEn "from ['\"](@shared|@devdigest/[^'\"]+|@/)" \
  --include='*.ts' --include='*.tsx' $GREP_EXCL . 2>/dev/null \
  | sed 's/^/  /' | head -60
echo
echo "-- deep relative imports climbing into a sibling package's src (boundary smell) --"
grep -rEn "from ['\"](\.\./)+[a-z-]+/src/" \
  --include='*.ts' --include='*.tsx' $GREP_EXCL . 2>/dev/null \
  | sed 's/^/  /' | head -40
echo

# ---------------------------------------------------------------------------
# 5. Possibly-unused runtime dependencies — declared but never imported in src
#    Heuristic only (misses dynamic/re-exported/config-only use) — flag as a QUESTION,
#    never auto-remove. The model must confirm before recommending removal.
# ---------------------------------------------------------------------------
echo "=== POSSIBLY-UNUSED RUNTIME DEPENDENCIES (heuristic — verify before acting) ==="
for pj in "${PKG_JSONS[@]}"; do
  dir=$(dirname "$pj")
  src="$dir/src"
  [ -d "$src" ] || src="$dir"
  deps=()
  while IFS= read -r d; do [ -n "$d" ] && deps+=("$d"); done \
    < <(node -e 'const j=require(process.argv[1]);console.log(Object.keys(j.dependencies||{}).join("\n"))' "$pj")
  unused=()
  for dep in "${deps[@]}"; do
    [ -z "$dep" ] && continue
    if ! grep -rqE "(from ['\"]${dep}(/|['\"])|require\(['\"]${dep}(/|['\"])|import ['\"]${dep})" \
         --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
         --exclude-dir=node_modules "$src" 2>/dev/null; then
      unused+=("$dep")
    fi
  done
  if [ ${#unused[@]} -gt 0 ]; then
    echo "  [$dir] not imported under $src: ${unused[*]}"
  fi
done
echo
echo "# end of dataset"
