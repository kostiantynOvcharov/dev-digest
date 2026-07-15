/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   CLAUDE.md / .claude/CLAUDE.md / any agent / engine change → run the workflow tier
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs so the job can print a visible "SKIP <name> (no evals)" line instead of going red.
 *
 * Emits GitHub Actions step outputs to $GITHUB_OUTPUT:
 *   skills / agents            — JSON arrays of changed artifact names that HAVE evals
 *   skills_paths / agents_paths — the same, as a space-joined vitest path list ready to pass to
 *                                 `pnpm eval` (e.g. "skills/foo skills/bar"); empty string = skip
 *   run_workflow               — "true"/"false": run the workflow tier
 *   skipped_skills / skipped_agents — changed artifacts with NO evals (reported, not failed)
 * Pure filesystem + string work — no deps.
 */

import { existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(EVALS_DIR, "..");

const changed = (process.env.CHANGED_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

/** The exact evals/<tier>/<name>/*.eval.ts paths (repo-relative to evals/). */
function evalFiles(tier, name) {
  const dir = join(EVALS_DIR, tier, name);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".eval.ts"))
    .map((f) => `${tier}/${name}/${f}`);
}

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
function hasEvals(tier, name) {
  return evalFiles(tier, name).length > 0;
}

/** Collect distinct artifact names touched under a `.claude` and/or `evals` prefix. */
function touched(reClaude, reEvals) {
  const names = new Set();
  for (const f of changed) {
    const m = f.match(reClaude) ?? f.match(reEvals);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

// Eval-only A/B "B-side" agents whose evals are DELIBERATELY-failing measurement artifacts, not
// pass/fail gates: e.g. `architecture-reviewer-lite` has the rule-citation requirement removed, so
// the shared citation case (threshold 1.0) scores ~0.67 BY DESIGN. Its own description says "do not
// wire it into production". Gating CI on it is a guaranteed red — so treat a change to one like a
// no-evals skip and measure it manually (eval:repeat + eval:delta against its strict counterpart).
const EVAL_ONLY_AGENTS = new Set(["architecture-reviewer-lite"]);

const skillNames = touched(
  /^\.claude\/skills\/([^/]+)\//,
  /^evals\/skills\/([^/]+)\//,
);
const agentNames = touched(
  /^\.claude\/agents\/([^/]+)\.md$/,
  /^evals\/agents\/([^/]+)\//,
);

const skills = skillNames.filter((n) => hasEvals("skills", n));
const skippedSkills = skillNames.filter((n) => !hasEvals("skills", n));
const gatedAgents = agentNames.filter((n) => !EVAL_ONLY_AGENTS.has(n));
const evalOnlyAgents = agentNames.filter((n) => EVAL_ONLY_AGENTS.has(n));
const agents = gatedAgents.filter((n) => hasEvals("agents", n));
const skippedAgents = gatedAgents.filter((n) => !hasEvals("agents", n));

// The workflow tier measures the LIVE harness, so anything that changes it re-triggers it:
// the root or .claude CLAUDE.md, any agent definition, the workflow cases, or the engine itself.
// CLAUDE.md is a symlink to AGENTS.md, so a real edit to the guide shows up as AGENTS.md in the
// diff — watch both, or an agent-guide change silently skips the workflow tier.
const runWorkflow = changed.some(
  (f) =>
    f === "CLAUDE.md" ||
    f === "AGENTS.md" ||
    f === ".claude/CLAUDE.md" ||
    /^\.claude\/agents\/.+\.md$/.test(f) ||
    /^evals\/workflow\//.test(f) ||
    /^evals\/src\//.test(f),
);

const out = process.env.GITHUB_OUTPUT;
const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

write("skills", JSON.stringify(skills));
write("agents", JSON.stringify(agents));
// vitest-ready path lists so the workflow can `pnpm eval $paths` without parsing JSON in bash.
// Emit the EXACT *.eval.ts file paths, not the directory: a bare dir arg like
// `agents/architecture-reviewer` is a vitest SUBSTRING that also matches
// `agents/architecture-reviewer-lite/…`, silently re-running an excluded artifact.
write("skills_paths", skills.flatMap((n) => evalFiles("skills", n)).join(" "));
write("agents_paths", agents.flatMap((n) => evalFiles("agents", n)).join(" "));
write("run_workflow", String(runWorkflow));
write("skipped_skills", skippedSkills.join(" "));
write("skipped_agents", skippedAgents.join(" "));

// Human-readable summary in the step log.
console.error("── eval change detection ──");
console.error(`changed files : ${changed.length}`);
console.error(`skills → run  : ${skills.join(", ") || "(none)"}`);
console.error(`agents → run  : ${agents.join(", ") || "(none)"}`);
console.error(`workflow tier : ${runWorkflow ? "run" : "skip"}`);
if (skippedSkills.length) console.error(`SKIP skills (no evals): ${skippedSkills.join(", ")}`);
if (skippedAgents.length) console.error(`SKIP agents (no evals): ${skippedAgents.join(", ")}`);
if (evalOnlyAgents.length)
  console.error(`SKIP agents (eval-only A/B, measure manually): ${evalOnlyAgents.join(", ")}`);
