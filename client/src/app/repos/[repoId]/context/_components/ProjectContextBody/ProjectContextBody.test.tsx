/**
 * ProjectContextBody — the Project Context page body (AC-1/2/4/5/6).
 * Pure over props, so it renders under just an intl provider (no query client).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextIndexStatus, DiscoveredDoc } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";
import { ProjectContextBody, type ProjectContextBodyProps } from "./ProjectContextBody";

afterEach(cleanup);

// Fixed clock so "last <t> ago" is deterministic.
const NOW = new Date("2026-07-09T12:00:00.000Z").getTime();

const DOCS: DiscoveredDoc[] = [
  { path: "specs/SPEC-01.md", type: "specs", size_bytes: 2048, used_by_agents: 2 },
  { path: "docs/architecture.md", type: "docs", size_bytes: 512, used_by_agents: 0 },
];

const INDEXED: ContextIndexStatus = {
  files_indexed: 2,
  last_indexed_at: "2026-07-09T10:00:00.000Z", // 2h before NOW
};

function renderBody(overrides: Partial<ProjectContextBodyProps> = {}) {
  const props: ProjectContextBodyProps = {
    docs: DOCS,
    indexState: INDEXED,
    isLoading: false,
    isError: false,
    onRetry: vi.fn(),
    onReindex: vi.fn(),
    onSelectPath: vi.fn(),
    reindexing: false,
    repoName: "acme/app",
    now: NOW,
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextBody {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("ProjectContextBody", () => {
  it("lists each discovered doc with its path, type badge, size and used-by count (AC-1, AC-6)", () => {
    renderBody();
    expect(screen.getByText("specs/SPEC-01.md")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    // Type badges (labels from i18n)
    expect(screen.getByText("specs")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    // Used-by count (direct + inherited), pluralized
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();
    expect(screen.getByText("Used by 0 agents")).toBeInTheDocument();
  });

  it("shows an index status line 'Indexed: N · last <t> ago' WITHOUT a chunk count (AC-2, D8)", () => {
    renderBody();
    expect(screen.getByText(/Indexed:\s*2\s*·\s*last\s*2h ago/)).toBeInTheDocument();
    expect(screen.queryByText(/chunk/i)).not.toBeInTheDocument();
  });

  it("renders the coverage placeholder '—' per doc, not a real metric (D7)", () => {
    renderBody();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(DOCS.length);
  });

  it("triggers a reindex when the Refresh button is clicked (AC-4)", async () => {
    const props = renderBody();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(props.onReindex).toHaveBeenCalledTimes(1);
  });

  it("wires SafeDocPreview: selecting a doc opens a safe preview region for it (AC-5)", async () => {
    const props = renderBody();
    // No preview region until a doc is selected.
    expect(screen.getByText("Select a document to preview it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /specs\/SPEC-01\.md/ }));
    // SafeDocPreview renders a labeled landmark region for the selected doc.
    expect(
      screen.getByRole("region", { name: "Preview of specs/SPEC-01.md" }),
    ).toBeInTheDocument();
    // Selecting a doc reports it up so the wrapper can fetch its content.
    expect(props.onSelectPath).toHaveBeenCalledWith("specs/SPEC-01.md");
  });

  it("renders the FETCHED markdown content of the selected doc via SafeDocPreview (AC-5)", () => {
    // The wrapper feeds the fetched content down; the body renders it (safely).
    renderBody({ docContent: "# Rendered heading\n\nBody paragraph." });
    fireEvent.click(screen.getByRole("button", { name: /specs\/SPEC-01\.md/ }));
    // Markdown is rendered (heading + paragraph), not shown as raw source.
    expect(screen.getByRole("heading", { name: "Rendered heading" })).toBeInTheDocument();
    expect(screen.getByText("Body paragraph.")).toBeInTheDocument();
    // The old "content unavailable" placeholder is gone once content is present.
    expect(
      screen.queryByText("Preview content isn’t available for this document yet."),
    ).not.toBeInTheDocument();
  });

  it("shows a loading state while the selected doc's content is being fetched", () => {
    renderBody({ docContentLoading: true });
    fireEvent.click(screen.getByRole("button", { name: /specs\/SPEC-01\.md/ }));
    // While loading the markdown region is not rendered yet…
    expect(
      screen.queryByRole("region", { name: "Preview of specs/SPEC-01.md" }),
    ).not.toBeInTheDocument();
    // …and the preview area is marked busy.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("surfaces a content-read error in the preview without leaking a path", () => {
    renderBody({ docContentError: true });
    fireEvent.click(screen.getByRole("button", { name: /specs\/SPEC-01\.md/ }));
    expect(
      screen.getByText("Preview content isn’t available for this document yet."),
    ).toBeInTheDocument();
  });

  it("shows a NOT-INDEXED empty state with a reindex affordance (never an error) pre-index", async () => {
    const props = renderBody({
      docs: [],
      indexState: { files_indexed: 0, last_indexed_at: null },
    });
    expect(screen.queryByText(/Couldn.t load project context/)).not.toBeInTheDocument();
    // Empty-state CTA is unique to the not-indexed state.
    const cta = screen.getByRole("button", { name: "Re-index now" });
    fireEvent.click(cta);
    expect(props.onReindex).toHaveBeenCalledTimes(1);
  });

  it("shows a 'no docs found' empty state when indexed but the snapshot is empty", () => {
    renderBody({ docs: [], indexState: { files_indexed: 0, last_indexed_at: INDEXED.last_indexed_at } });
    expect(screen.getByText("No context docs found")).toBeInTheDocument();
  });

  it("surfaces a load error with retry (does not silently swallow)", async () => {
    const props = renderBody({ isError: true, errorMessage: "boom" });
    expect(screen.getByText("Couldn’t load project context")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry);
    expect(props.onRetry).toHaveBeenCalled();
  });
});
