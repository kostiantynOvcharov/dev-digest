import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

// Deciding a finding (or the flask) now opens the "New eval case" editor, seeded
// from the finding via `useEvalCaseSeed`. Mock the eval hooks so the button
// behaviour is asserted without a QueryClient / real network call. The editor
// mounts once the seed resolves, so the seed mock always returns a ready case.
const SEED = {
  owner_kind: "agent" as const,
  owner_id: "ag1",
  name: "From finding: Hardcoded Stripe secret key",
  input_diff: "@@ diff @@",
  input_files: null,
  input_meta: null,
  expected_output: [{ file: "src/config.ts", start_line: 11, end_line: 11, title: "Hardcoded Stripe secret key" }],
  notes: null,
};
vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useEvalCaseSeed: () => ({ data: SEED }),
  useRunEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateEvalCaseFromInput: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("clicking Accept fires the action but does NOT open the modal (only highlights)", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    expect(screen.queryByText("New eval case")).not.toBeInTheDocument();
  });

  it("clicking Dismiss fires the action but does NOT open the modal (only highlights)", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
    expect(screen.queryByText("New eval case")).not.toBeInTheDocument();
  });

  it("disables 'Turn into eval case' for an undecided finding and opens no modal", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByText("New eval case")).not.toBeInTheDocument();
  });

  it("enables 'Turn into eval case' once accepted and opens the modal without re-deciding", () => {
    const onAction = vi.fn();
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-16T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={onAction} />);
    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    // The flask only opens the editor; it does not re-fire an accept/dismiss action.
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText("New eval case")).toBeInTheDocument();
  });

  it("enables 'Turn into eval case' once dismissed", () => {
    const dismissed: FindingRecord = { ...FINDING, dismissed_at: "2026-07-16T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded onAction={() => {}} />);
    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.getByText("New eval case")).toBeInTheDocument();
  });
});
