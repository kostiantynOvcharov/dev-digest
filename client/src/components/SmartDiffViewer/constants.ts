import type { SmartDiffRole } from "@devdigest/shared";
import type { Severity } from "@devdigest/ui";

/** Per-role header copy + accent, in the order they should be read. */
export const ROLE_META: Record<
  SmartDiffRole,
  { label: string; description: string; dot: string }
> = {
  core: {
    label: "Core logic",
    description: "The substance of the change — review closely",
    dot: "var(--accent)",
  },
  wiring: {
    label: "Wiring",
    description: "Hooks the core into the app",
    dot: "var(--warn)",
  },
  boilerplate: {
    label: "Boilerplate",
    description: "Generated, docs & mechanical — skim",
    dot: "var(--text-muted)",
  },
};

/** Higher = more severe; used to pick the badge when a line has >1 finding. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
  INFO: 0,
};
