import type { CSSProperties } from "react";

/** Co-located styles for the Project Context page body.
 *  Interactive row states (hover/focus/active) live in ROW_CSS in the component,
 *  not here — inline styles can't express :hover, which is why the cards used to
 *  render inconsistently (whichever button the browser happened to focus/hover
 *  looked "boxed"). Everything static stays inline; everything stateful is CSS. */
export const s = {
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 16,
  } satisfies CSSProperties,
  pageTitle: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 13.5,
    color: "var(--text-secondary)",
    margin: "6px 0 0",
    maxWidth: 640,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  headerActions: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 } satisfies CSSProperties,
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 18,
  } satisfies CSSProperties,
  layout: { display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" } satisfies CSSProperties,
  listCol: { flex: "1 1 440px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  previewCol: {
    flex: "1 1 380px",
    minWidth: 0,
    position: "sticky",
    top: 12,
  } satisfies CSSProperties,
  // Small section label above the list; padded to sit over the cards' left edge.
  listHeader: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    padding: "0 2px 2px",
  } satisfies CSSProperties,
  rowMain: { minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 7 } satisfies CSSProperties,
  path: {
    fontSize: 13,
    color: "var(--text-primary)",
    wordBreak: "break-all",
    lineHeight: 1.35,
  } satisfies CSSProperties,
  meta: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  metaText: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  // Coverage is a placeholder this iteration (Decision D7) — render it as a quiet
  // ring rather than a big floating dash so it reads as "ring, not yet computed".
  coverage: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0, width: 52 } satisfies CSSProperties,
  coverageRing: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "2px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  coverageCaption: {
    fontSize: 9.5,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  previewCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 16,
  } satisfies CSSProperties,
  previewHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  } satisfies CSSProperties,
  previewTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  previewPlaceholder: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, margin: 0 } satisfies CSSProperties,
  // Centered empty state so the preview pane doesn't read as a dead void.
  previewEmpty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    gap: 10,
    padding: "36px 16px",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;

/** Interactive card states. Injected once via a <style> tag by the component so
 *  hover/focus/active are real CSS (inline styles can't do them). */
export const ROW_CSS = `
.pcx-row{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;color:inherit;font:inherit;transition:border-color .12s ease,background .12s ease,box-shadow .12s ease,transform .12s ease;}
.pcx-row:hover{border-color:var(--accent,#7aa2ff);background:var(--bg-hover);transform:translateY(-1px);}
.pcx-row:focus-visible{outline:none;border-color:var(--accent,#7aa2ff);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#7aa2ff) 22%,transparent);}
.pcx-row[aria-pressed="true"]{border-color:var(--accent,#7aa2ff);background:var(--bg-hover);box-shadow:inset 3px 0 0 var(--accent,#7aa2ff);}
.pcx-row[aria-pressed="true"] .pcx-ring{border-color:var(--accent,#7aa2ff);color:var(--text-secondary);}
`;
