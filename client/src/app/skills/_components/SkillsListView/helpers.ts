import type { Skill } from "@devdigest/shared";

/** Case-insensitive filter over name + description. */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
  );
}

/** A blank skill body used by "Create from scratch". */
export const BLANK_SKILL_BODY = "# New skill\n\nDescribe the rule the agent should follow.\n";
