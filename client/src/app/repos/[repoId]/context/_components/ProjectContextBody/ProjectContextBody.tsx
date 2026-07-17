/* ProjectContextBody — presentational body for the Project Context page.
   Pure over its props (no data-fetching): the ProjectContextView wrapper owns
   the hooks + AppShell and passes data/handlers down, which keeps this unit
   trivially testable with just an intl provider. Renders the discovered-doc
   list (path + type badge + used-by + size + coverage placeholder), the index
   status line ("Indexed: N · last <t> ago" — never a chunk count, D8), a refresh
   affordance, and a safe markdown preview of the selected doc via SafeDocPreview. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { ContextIndexStatus, DiscoveredDoc } from "@devdigest/shared";
import { SafeDocPreview } from "@/components/SafeDocPreview";
import { TYPE_META, formatKb, relativeParts } from "./helpers";
import { s, ROW_CSS } from "./styles";

const SKELETON_ROWS = 4;

export interface ProjectContextBodyProps {
  docs: DiscoveredDoc[] | undefined;
  indexState: ContextIndexStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onReindex: () => void;
  reindexing: boolean;
  repoName: string;
  /** Injectable clock so the relative "last <t> ago" is deterministic in tests. */
  now?: number;
  /** Rendered markdown of the currently-selected doc (fetched by the wrapper).
   *  `null`/`undefined` while nothing is selected or the content isn't loaded. */
  docContent?: string | null;
  /** True while the selected doc's content is being fetched. */
  docContentLoading?: boolean;
  /** True when the selected doc's content failed to load. */
  docContentError?: boolean;
  /** Notifies the wrapper which doc is selected so it can fetch its content. */
  onSelectPath?: (path: string | null) => void;
}

export function ProjectContextBody({
  docs,
  indexState,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  onReindex,
  reindexing,
  repoName,
  now,
  docContent,
  docContentLoading,
  docContentError,
  onSelectPath,
}: ProjectContextBodyProps) {
  const t = useTranslations("context");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  // Keep internal selection state as the single source of truth for which doc
  // is previewed, and notify the wrapper so it can fetch that doc's content.
  const selectPath = React.useCallback(
    (path: string | null) => {
      setSelectedPath(path);
      onSelectPath?.(path);
    },
    [onSelectPath],
  );

  const list = docs ?? [];
  // A repo is "never indexed" only once we KNOW the state and it has no timestamp.
  const neverIndexed = indexState != null && indexState.last_indexed_at == null;
  const selected = list.find((d) => d.path === selectedPath) ?? null;

  const statusText = (() => {
    if (indexState == null) return t("status.loading");
    if (indexState.last_indexed_at == null) return t("status.neverIndexed");
    const parts = relativeParts(indexState.last_indexed_at, now);
    const ago = t(`relative.${parts.key}`, { count: parts.count });
    return t("status.indexed", { count: indexState.files_indexed, ago });
  })();

  const header = (
    <>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>
            {t("headingPrefix")}
            {repoName}
          </h1>
          <p style={s.pageSubtitle}>{t("subtitle")}</p>
        </div>
        <div style={s.headerActions}>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={reindexing}
            disabled={reindexing}
            onClick={onReindex}
          >
            {reindexing ? t("reindexing") : t("refresh")}
          </Button>
        </div>
      </div>
      <div style={s.statusRow} aria-live="polite">
        <Icon.Database size={13} />
        <span>{statusText}</span>
      </div>
    </>
  );

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div style={s.loadingStack}>
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <Skeleton key={i} height={64} />
        ))}
      </div>
    );
  } else if (isError) {
    body = (
      <ErrorState title={t("loadError")} body={errorMessage} onRetry={onRetry} />
    );
  } else if (neverIndexed) {
    body = (
      <EmptyState
        icon="Database"
        title={t("empty.notIndexed.title")}
        body={t("empty.notIndexed.body")}
        cta={t("empty.notIndexed.cta")}
        onCta={onReindex}
        ctaLoading={reindexing}
      />
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon="FileText"
        title={t("empty.noDocs.title")}
        body={t("empty.noDocs.body")}
        cta={t("empty.noDocs.cta")}
        onCta={onReindex}
        ctaLoading={reindexing}
      />
    );
  } else {
    body = (
      <div style={s.layout}>
        <style>{ROW_CSS}</style>
        <div style={s.listCol}>
          <div style={s.listHeader}>{t("docCount", { count: list.length })}</div>
          {list.map((doc) => (
            <DocRow
              key={doc.path}
              doc={doc}
              active={doc.path === selectedPath}
              onSelect={() => selectPath(doc.path)}
            />
          ))}
        </div>
        <div style={s.previewCol}>
          <PreviewPanel
            doc={selected}
            content={docContent}
            loading={docContentLoading}
            error={docContentError}
            onClose={() => selectPath(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      {header}
      {body}
    </>
  );
}

function DocRow({
  doc,
  active,
  onSelect,
}: {
  doc: DiscoveredDoc;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("context");
  const meta = TYPE_META[doc.type];
  return (
    <button type="button" aria-pressed={active} onClick={onSelect} className="pcx-row">
      <div style={s.rowMain}>
        {/* Path rendered as escaped React text — never HTML. */}
        <span className="mono" style={s.path}>
          {doc.path}
        </span>
        <div style={s.meta}>
          <Badge icon={meta.icon} color={meta.color} bg={meta.bg}>
            {t(`type.${doc.type}`)}
          </Badge>
          <span style={s.metaText} title={t("usedByHint")}>
            {t("usedBy", { count: doc.used_by_agents })}
          </span>
          <span style={s.metaText}>{t("size", { kb: formatKb(doc.size_bytes) })}</span>
        </div>
      </div>
      {/* Coverage ring is a placeholder this iteration (Decision D7) — rendered
          as a quiet ring, not a big dash, so it reads as "not yet computed". */}
      <div style={s.coverage} aria-label={t("column.coverage")} title={t("column.coverage")}>
        <span className="pcx-ring" style={s.coverageRing}>
          {t("coveragePlaceholder")}
        </span>
        <span style={s.coverageCaption}>{t("column.coverage")}</span>
      </div>
    </button>
  );
}

function PreviewPanel({
  doc,
  content,
  loading,
  error,
  onClose,
}: {
  doc: DiscoveredDoc | null;
  content?: string | null;
  loading?: boolean;
  error?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  if (!doc) {
    return (
      <div style={s.previewCard}>
        <div style={s.previewHeader}>
          <span style={s.previewTitle}>{t("preview.heading")}</span>
        </div>
        <div style={s.previewEmpty}>
          <Icon.FileText size={22} />
          <p style={s.previewPlaceholder}>{t("preview.placeholder")}</p>
        </div>
      </div>
    );
  }
  return (
    <div style={s.previewCard}>
      <div style={s.previewHeader}>
        <span style={s.previewTitle}>{t("preview.heading")}</span>
        <Button kind="ghost" size="sm" icon="XCircle" onClick={onClose}>
          {t("preview.close")}
        </Button>
      </div>
      {loading ? (
        <div style={s.loadingStack} aria-busy="true">
          <Skeleton height={16} />
          <Skeleton height={16} />
          <Skeleton height={16} />
        </div>
      ) : error ? (
        // Failed content read (e.g. the doc was deleted since indexing) — surface
        // it, still showing the (escaped) path. Never an absolute clone path.
        <>
          <SafeDocPreview content={null} path={doc.path} />
          <p style={s.previewPlaceholder}>{t("preview.unavailable")}</p>
        </>
      ) : (
        // SafeDocPreview neutralizes raw HTML / javascript: links (AC-5) and
        // renders the fetched markdown; `content` may be null before it loads.
        <SafeDocPreview content={content ?? null} path={doc.path} />
      )}
    </div>
  );
}
