import type { IconName } from "@devdigest/ui";
import type { SkillSource, SkillType } from "@devdigest/shared";

/** Badge color per skill type (mirrors the trace/skill-type palette). */
export function typeColor(type: SkillType): string {
  switch (type) {
    case "security":
      return "var(--err)";
    case "convention":
      return "var(--ok)";
    case "rubric":
      return "var(--accent)";
    default:
      return "var(--text-secondary)";
  }
}

/** Short source label + whether it is an untrusted (non-manual) source. */
export function sourceLabel(source: SkillSource): { label: string; icon: IconName; untrusted: boolean } {
  switch (source) {
    case "manual":
      return { label: "Manual", icon: "Edit", untrusted: false };
    case "extracted":
      return { label: "Extracted", icon: "Sparkles", untrusted: true };
    case "community":
      return { label: "Community", icon: "Globe", untrusted: true };
    case "imported_url":
    case "imported_file":
      return { label: "Imported", icon: "Link", untrusted: true };
    default:
      return { label: source, icon: "File", untrusted: true };
  }
}
