import type { SkillType } from "@devdigest/shared";

/** Skill types selectable in the Config tab. */
export const SKILL_TYPE_OPTIONS: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Rough token estimate (~4 chars/token) for the body header — display only. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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
