import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * SafeDocPreview — renders ARBITRARY repo-authored markdown SAFELY (AC-5).
 *
 * Repo markdown is untrusted input (OWASP A05 stored-XSS): a doc could contain
 * a raw `<script>` tag, inline event handlers, or a `javascript:` link. This
 * component neutralizes all of them by construction, extending the safe-by-
 * default stance of the `vendor/ui` `Markdown` primitive:
 *
 *   - `react-markdown` v9 + `remark-gfm`, with **NO `rehype-raw`** — raw HTML
 *     in the source is NOT parsed into DOM; it renders as literal, escaped text.
 *   - The default `urlTransform` is kept (not overridden), so `javascript:`,
 *     `data:`, `vbscript:` and other dangerous protocols in link/image URLs are
 *     stripped before they ever reach an `href`/`src`.
 *   - **NEVER** `dangerouslySetInnerHTML` — the one React escape hatch that
 *     would reintroduce the XSS surface. This file must stay free of it.
 *
 * The doc `path` is rendered as ordinary React text (JSX auto-escaping), never
 * as HTML. The whole preview is wrapped in a labeled landmark region for a11y.
 */
export type SafeDocPreviewProps = {
  /** Raw markdown source of the doc. `null`/empty renders an empty region. */
  content?: string | null;
  /** Repo-relative doc path, shown (escaped) as the region heading. */
  path?: string;
  /** Accessible name for the landmark region. Defaults to the path or a
   *  generic label so the region always has a name. */
  label?: string;
};

export function SafeDocPreview({ content, path, label }: SafeDocPreviewProps) {
  const regionLabel = label ?? (path ? `Preview of ${path}` : "Document preview");

  return (
    <section
      role="region"
      aria-label={regionLabel}
      className="dd-safe-doc-preview"
      style={{ fontSize: "inherit", lineHeight: 1.55 }}
    >
      {path ? (
        <div
          className="mono"
          style={{
            fontSize: "0.85em",
            color: "var(--text-secondary)",
            marginBottom: 8,
            wordBreak: "break-all",
          }}
        >
          {/* Path as escaped React text — never HTML. */}
          {path}
        </div>
      ) : null}
      <div className="dd-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          /* No rehypePlugins => no rehype-raw => raw HTML stays inert text. */
          /* urlTransform intentionally NOT overridden => keeps the built-in
             dangerous-protocol stripper (javascript:/data:/vbscript:). */
          components={{
            p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
            strong: ({ children }) => (
              <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>
                {children}
              </strong>
            ),
            code: ({ children }) => (
              <code
                className="mono"
                style={{
                  fontSize: "0.92em",
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "var(--bg-hover)",
                  color: "var(--accent-text)",
                }}
              >
                {children}
              </code>
            ),
            a: ({ children, href }) => (
              // `href` is already sanitized by react-markdown's default
              // urlTransform; a stripped javascript: URL arrives as "".
              <a
                href={href}
                rel="noopener noreferrer nofollow"
                style={{ color: "var(--accent-text)", textDecoration: "underline" }}
              >
                {children}
              </a>
            ),
          }}
        >
          {content ?? ""}
        </ReactMarkdown>
      </div>
    </section>
  );
}
