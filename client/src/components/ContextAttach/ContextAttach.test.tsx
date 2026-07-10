/**
 * ContextAttach — the shared attach/detach/reorder list behind both editors'
 * Context tabs (SPEC-01, Unit 7). Pure over props, so it renders under just an
 * intl provider (no query client). Covers AC-8 (order → persisted order),
 * AC-10 (live per-doc + total token estimate, no round-trip), AC-18 (overflow
 * warning, nothing auto-detached) and AC-19 (missing marker, never auto-detached).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DiscoveredDoc } from "@devdigest/shared";
import messages from "../../../messages/en/context.json";
import { ContextAttach, type ContextAttachProps } from "./ContextAttach";
import type { ContextLink } from "./helpers";

afterEach(cleanup);

// ceil(size_bytes / 4) tokens: 400 → 100, 40 → 10.
const DOC_A: DiscoveredDoc = { path: "specs/a.md", type: "specs", size_bytes: 400, used_by_agents: 0 };
const DOC_B: DiscoveredDoc = { path: "docs/b.md", type: "docs", size_bytes: 40, used_by_agents: 0 };

function renderTab(overrides: Partial<ContextAttachProps> = {}) {
  const props: ContextAttachProps = {
    docs: [DOC_A, DOC_B],
    links: [],
    onChange: vi.fn(),
    threshold: 8000,
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextAttach {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

/** The row <div> that contains a given doc path. */
function rowFor(path: string): HTMLElement {
  return screen.getByText(path).parentElement as HTMLElement;
}

describe("ContextAttach", () => {
  it("recomputes the total token estimate IN PLACE when a doc is toggled, with no reload (AC-10)", () => {
    const props = renderTab();
    // Nothing attached yet → 0 tokens total.
    expect(screen.getByText("~0 tokens total")).toBeInTheDocument();

    // Attach DOC_A (100 tok) via its checkbox — no prop change / re-render.
    fireEvent.click(within(rowFor("specs/a.md")).getByRole("checkbox"));

    expect(props.onChange).toHaveBeenCalledWith(["specs/a.md"]);
    // Total updates live from the local order (derived during render).
    expect(screen.getByText("~100 tokens total")).toBeInTheDocument();
    // Per-doc estimate is shown too.
    expect(within(rowFor("specs/a.md")).getByText("~100 tok")).toBeInTheDocument();
  });

  it("shows an aria-live overflow warning when the total exceeds the threshold, and detaches nothing (AC-18)", () => {
    const links: ContextLink[] = [{ path: "specs/a.md", order: 0, missing: false }];
    const props = renderTab({ links, threshold: 50 }); // 100 tok > 50

    const warning = screen.getByRole("status");
    expect(warning).toHaveAttribute("aria-live", "polite");
    expect(warning).toHaveTextContent(/exceed the 50-token warning threshold/i);

    // The doc stays attached (checkbox checked) — nothing auto-detached.
    expect(within(rowFor("specs/a.md")).getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("marks an attached doc missing from the snapshot with a non-colour text marker, keeping it attached (AC-19)", () => {
    const links: ContextLink[] = [{ path: "ghost/gone.md", order: 0, missing: true }];
    const props = renderTab({ links });

    // Marker is conveyed as TEXT (+ icon), not colour alone.
    expect(screen.getByText("missing — not in the latest index")).toBeInTheDocument();
    // Still attached — never auto-detached.
    expect(within(rowFor("ghost/gone.md")).getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("persists the new UI order when a doc is reordered (AC-8)", () => {
    const links: ContextLink[] = [
      { path: "specs/a.md", order: 0, missing: false },
      { path: "docs/b.md", order: 1, missing: false },
    ];
    const props = renderTab({ links });

    // Move the first attached doc (specs/a.md) down one slot.
    fireEvent.click(within(rowFor("specs/a.md")).getByRole("button", { name: "Move down" }));

    expect(props.onChange).toHaveBeenCalledWith(["docs/b.md", "specs/a.md"]);
  });
});
