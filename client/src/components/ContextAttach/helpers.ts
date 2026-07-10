import type { ContextDocType } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** The subset of an Agent/Skill context link the attach UI needs (both DTOs
 * share `path`/`order`/`missing`; only the owning-id key differs). */
export interface ContextLink {
  path: string;
  order: number;
  missing: boolean;
}

/**
 * Per-doc token estimate. Mirrors the shared
 * `estimateTokens(text) = ceil(len/4)` (`@/lib/tokens`) — the same
 * 4-chars/token ratio — applied to the doc's byte size, because the read API
 * does not expose doc CONTENT (and adding a server round-trip is out of scope,
 * AC-10). For markdown, `size_bytes` is a faithful character-length proxy.
 */
export function estimateDocTokens(sizeBytes: number): number {
  return Math.ceil(sizeBytes / 4);
}

/** Per-type badge metadata (icon only; the label is i18n-driven). Mirrors the
 * Project Context page's TYPE_META so both surfaces read identically. */
export const TYPE_META: Record<ContextDocType, { icon: IconName; color: string }> = {
  specs: { icon: "FileText", color: "var(--accent-text, #7aa2ff)" },
  docs: { icon: "Folder", color: "var(--text-secondary)" },
  insights: { icon: "Lightbulb", color: "var(--warn, #d9a441)" },
};
