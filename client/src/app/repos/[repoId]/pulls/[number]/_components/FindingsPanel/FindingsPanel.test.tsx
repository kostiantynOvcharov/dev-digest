import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function makeFinding(over: Partial<FindingRecord> & Pick<FindingRecord, "id" | "severity" | "title">): FindingRecord {
  return {
    category: "security",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "rationale",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

const FINDINGS: FindingRecord[] = [
  makeFinding({ id: "f1", severity: "CRITICAL", title: "Hardcoded secret" }),
];

const MIXED: FindingRecord[] = [
  makeFinding({ id: "f1", severity: "CRITICAL", title: "Hardcoded secret" }),
  makeFinding({ id: "f2", severity: "WARNING", title: "N+1 query" }),
  makeFinding({ id: "f3", severity: "SUGGESTION", title: "Extract magic number" }),
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("narrows to a single severity when severityFilter is set", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" severityFilter="WARNING" />);
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.queryByText("Extract magic number")).not.toBeInTheDocument();
  });

  it("shows all severities when severityFilter is null", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" severityFilter={null} />);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Extract magic number")).toBeInTheDocument();
  });
});
