/* ContextAttach — shared attach/detach/reorder list for the agent & skill
   editors' Context tabs (SPEC-01, Unit 7). Presentational + interactive over
   props: the owning ContextTab wires the repo docs, the current attachments and
   the persist callback, so this component is trivially testable and identical
   across both editors.

   Behaviour mirrors the agent SkillsTab (drag handle + checkbox + name + type
   badge + filter), and ADDS, per SPEC-01:
   - a LIVE per-doc + total token estimate (derived DURING render — never stored
     in state/effect — AC-10),
   - a non-blocking overflow warning when the total exceeds the workspace
     `context_token_warn_threshold` (aria-live=polite; nothing is auto-detached
     or truncated — AC-18),
   - a "missing" marker for an attached doc no longer in the index snapshot,
     conveyed via text + aria (NOT colour alone) and never auto-detached (AC-19),
   - keyboard-operable reorder (move up/down buttons) alongside HTML5 drag. */
"use client";

import React from "react";
import { Badge, Checkbox, Icon } from "@devdigest/ui";
import type { DiscoveredDoc } from "@devdigest/shared";
import { useTranslations } from "next-intl";
import { SafeDocPreview } from "@/components/SafeDocPreview";
import { estimateDocTokens, TYPE_META, type ContextLink } from "./helpers";
import { s } from "./styles";

export interface ContextAttachProps {
  /** Discovered markdown docs for the active repo (the attachable universe). */
  docs: DiscoveredDoc[] | undefined;
  /** Current server attachments for this agent/skill, ordered. */
  links: ContextLink[] | undefined;
  /** Persist the full ordered set of attached paths (mirrors setSkills). */
  onChange: (paths: string[]) => void;
  /** Workspace overflow-warning threshold (tokens). */
  threshold: number;
  /** True while docs/links are still loading. */
  isLoading?: boolean;
  /** True when no repo is selected (no docs universe to attach from). */
  noRepo?: boolean;
}

export function ContextAttach({
  docs,
  links,
  onChange,
  threshold,
  isLoading,
  noRepo,
}: ContextAttachProps) {
  const t = useTranslations("context");

  // Ordered attached paths — seeded from the server, persisted on every change.
  const serverPaths = React.useMemo(() => (links ?? []).map((l) => l.path), [links]);
  const [order, setOrder] = React.useState<string[]>(serverPaths);
  const dragIndex = React.useRef<number | null>(null);
  const lastSync = React.useRef<string>("");

  // Re-seed local order when the server set changes (and we didn't cause it).
  React.useEffect(() => {
    const key = serverPaths.join("\n");
    if (key !== lastSync.current) {
      lastSync.current = key;
      setOrder(serverPaths);
    }
  }, [serverPaths]);

  const byPath = React.useMemo(() => {
    const m = new Map<string, DiscoveredDoc>();
    for (const d of docs ?? []) m.set(d.path, d);
    return m;
  }, [docs]);

  const [filter, setFilter] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const q = filter.trim().toLowerCase();
  const matches = (path: string) => !q || path.toLowerCase().includes(q);

  const persist = (paths: string[]) => {
    setOrder(paths);
    lastSync.current = paths.join("\n");
    onChange(paths);
  };

  const toggle = (path: string) =>
    persist(order.includes(path) ? order.filter((x) => x !== path) : [...order, path]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    persist(next);
  };

  const onDrop = (to: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null) return;
    move(from, to);
  };

  const available = (docs ?? [])
    .filter((d) => !order.includes(d.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  // Live totals — derived DURING render, never stored (AC-10). A missing doc
  // (path ∉ snapshot) contributes 0 to the estimate but stays attached (AC-19).
  const totalTokens = order.reduce((sum, p) => {
    const doc = byPath.get(p);
    return sum + (doc ? estimateDocTokens(doc.size_bytes) : 0);
  }, 0);
  const overThreshold = totalTokens > threshold;

  const totalDocs = docs?.length ?? 0;

  if (noRepo) {
    return <p style={s.hint}>{t("tab.noRepo")}</p>;
  }
  if (isLoading) {
    return <p style={s.hint}>{t("tab.loading")}</p>;
  }
  if (totalDocs === 0 && order.length === 0) {
    return <p style={s.hint}>{t("tab.empty")}</p>;
  }

  const linkedVisible = order.filter(matches);
  const availableVisible = available.filter((d) => matches(d.path));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("tab.title")}</h2>
        <Badge color="var(--text-secondary)">
          {t("tab.attachedCount", { attached: order.length, total: totalDocs })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("tab.filterPlaceholder")}
            style={s.searchInput}
            aria-label={t("tab.filterPlaceholder")}
          />
        </div>
      </div>
      <p style={s.hint}>{t("tab.orderHint")}</p>

      {linkedVisible.length > 0 && (
        <>
          <div style={s.sectionLabel}>{t("tab.attachedSection")}</div>
          <div style={s.list}>
            {linkedVisible.map((path) => {
              const idx = order.indexOf(path);
              const doc = byPath.get(path);
              const tokens = doc ? estimateDocTokens(doc.size_bytes) : 0;
              return (
                <div
                  key={path}
                  draggable
                  onDragStart={() => (dragIndex.current = idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(idx)}
                  style={s.row(true)}
                >
                  <Icon.Menu size={14} style={s.handle} aria-hidden />
                  <div style={s.reorderGroup}>
                    <button
                      type="button"
                      style={s.iconBtn}
                      aria-label={t("tab.moveUp")}
                      disabled={idx === 0}
                      onClick={() => move(idx, idx - 1)}
                    >
                      <Icon.ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      style={s.iconBtn}
                      aria-label={t("tab.moveDown")}
                      disabled={idx === order.length - 1}
                      onClick={() => move(idx, idx + 1)}
                    >
                      <Icon.ArrowDown size={12} />
                    </button>
                  </div>
                  <Checkbox checked onChange={() => toggle(path)} />
                  <span style={s.name}>{path}</span>
                  {doc ? (
                    <Badge icon={TYPE_META[doc.type].icon} color={TYPE_META[doc.type].color}>
                      {t(`type.${doc.type}`)}
                    </Badge>
                  ) : (
                    <Badge icon="AlertTriangle" color="var(--warn, #d9a441)">
                      {t("tab.missing")}
                    </Badge>
                  )}
                  <span style={s.tokens}>{t("tab.tokens", { count: tokens })}</span>
                  <button
                    type="button"
                    style={s.iconBtn}
                    aria-label={t("tab.preview")}
                    onClick={() => setSelectedPath(path)}
                  >
                    <Icon.Eye size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {availableVisible.length > 0 && (
        <>
          <div style={s.sectionLabel}>{t("tab.availableSection")}</div>
          <div style={s.list}>
            {availableVisible.map((doc) => (
              <div key={doc.path} style={s.row(false)}>
                <span style={{ width: 14 }} />
                <Checkbox checked={false} onChange={() => toggle(doc.path)} />
                <span style={s.name}>{doc.path}</span>
                <Badge icon={TYPE_META[doc.type].icon} color={TYPE_META[doc.type].color}>
                  {t(`type.${doc.type}`)}
                </Badge>
                <span style={s.tokens}>
                  {t("tab.tokens", { count: estimateDocTokens(doc.size_bytes) })}
                </span>
                <button
                  type="button"
                  style={s.iconBtn}
                  aria-label={t("tab.preview")}
                  onClick={() => setSelectedPath(doc.path)}
                >
                  <Icon.Eye size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {linkedVisible.length === 0 && availableVisible.length === 0 && (
        <div style={s.noResults}>{t("tab.noResults")}</div>
      )}

      {/* Live total — derived during render, announced politely (AC-10). */}
      <div style={s.footer} aria-live="polite">
        <span style={s.total}>{t("tab.totalTokens", { count: totalTokens })}</span>
        <span>{t("tab.attachedCount", { attached: order.length, total: totalDocs })}</span>
      </div>

      {/* Non-blocking overflow warning — nothing is auto-detached (AC-18). */}
      {overThreshold && (
        <div style={s.warning} role="status" aria-live="polite">
          <Icon.AlertTriangle size={15} aria-hidden />
          <span>{t("tab.overflowWarning", { count: totalTokens, threshold })}</span>
        </div>
      )}

      {selectedPath && (
        <div style={s.previewWrap}>
          <SafeDocPreview content={null} path={selectedPath} />
        </div>
      )}
    </div>
  );
}
