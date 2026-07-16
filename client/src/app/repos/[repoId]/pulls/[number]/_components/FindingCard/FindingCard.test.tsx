import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

// The eval-case mutation is exercised through its hook — mock the module (as
// FindingsPanel does for useFindingAction) so the button behaviour is asserted
// without a QueryClient / real network call.
const createEvalCaseMutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useCreateEvalCase: () => ({ mutate: createEvalCaseMutate, isPending: false }),
}));

import { FindingCard } from "./FindingCard";

beforeEach(() => createEvalCaseMutate.mockClear());
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

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  it("disables 'Turn into eval case' for an undecided finding and fires no request", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(createEvalCaseMutate).not.toHaveBeenCalled();
  });

  it("enables 'Turn into eval case' once accepted and creates the case with the finding id", () => {
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-16T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(createEvalCaseMutate).toHaveBeenCalledWith("f1");
  });

  it("enables 'Turn into eval case' once dismissed", () => {
    const dismissed: FindingRecord = { ...FINDING, dismissed_at: "2026-07-16T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded onAction={() => {}} />);
    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(createEvalCaseMutate).toHaveBeenCalledWith("f1");
  });
});
