import type { SkillType } from "@devdigest/shared";

/** Skill types selectable in the Config tab. */
export const SKILL_TYPE_OPTIONS: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Re-exported from the shared token util so existing ConfigTab importers keep
 *  working while the single source of truth lives in `@/lib/tokens`. */
export { estimateTokens } from "@/lib/tokens";

/** kebab-case a name for the displayed `<name>.md` filename. */
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "skill"
  );
}
