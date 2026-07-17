import type { ContextDocType } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Per-type badge metadata (icon only; the label is i18n-driven). */
export const TYPE_META: Record<ContextDocType, { icon: IconName; color: string; bg: string }> = {
  specs: { icon: "FileText", color: "var(--accent-text, #7aa2ff)", bg: "var(--bg-hover)" },
  docs: { icon: "Folder", color: "var(--text-secondary)", bg: "var(--bg-hover)" },
  insights: { icon: "Lightbulb", color: "var(--warn, #d9a441)", bg: "var(--bg-hover)" },
};

/** Human-readable KB string for a byte count (one decimal). */
export function formatKb(sizeBytes: number): string {
  return (sizeBytes / 1024).toFixed(1);
}

export type RelativeParts = { key: "justNow" | "seconds" | "minutes" | "hours" | "days"; count: number };

/**
 * Reduce an ISO timestamp to a coarse relative bucket for "last <t> ago".
 * Pure + `now`-injectable so the status line is deterministic in tests.
 */
export function relativeParts(iso: string, now: number = Date.now()): RelativeParts {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 10) return { key: "justNow", count: 0 };
  if (secs < 60) return { key: "seconds", count: secs };
  const mins = Math.round(secs / 60);
  if (mins < 60) return { key: "minutes", count: mins };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { key: "hours", count: hours };
  return { key: "days", count: Math.round(hours / 24) };
}
