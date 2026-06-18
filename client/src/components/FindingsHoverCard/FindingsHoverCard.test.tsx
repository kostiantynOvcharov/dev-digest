import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { FindingRecord } from "@devdigest/shared";
import { FindingsHoverCard } from "./FindingsHoverCard";
import { SeverityCounts, countBySeverity } from "../SeverityCounts/SeverityCounts";

afterEach(cleanup);

function makeFinding(
  over: Partial<FindingRecord> & Pick<FindingRecord, "id" | "severity" | "title">,
): FindingRecord {
  return {
    category: "security",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "A secret is committed and exposed.",
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

const MIXED: FindingRecord[] = [
  makeFinding({ id: "f1", severity: "WARNING", title: "N+1 query" }),
  makeFinding({ id: "f2", severity: "CRITICAL", title: "Hardcoded secret" }),
  makeFinding({ id: "f3", severity: "SUGGESTION", title: "Extract magic number" }),
];

describe("countBySeverity", () => {
  it("tallies each severity", () => {
    expect(countBySeverity(MIXED)).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 1 });
  });
});

describe("SeverityCounts", () => {
  it("renders nothing for an empty set", () => {
    const { container } = render(<SeverityCounts findings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FindingsHoverCard", () => {
  it("renders a header with the count and each finding title", () => {
    render(<FindingsHoverCard findings={MIXED} />);
    expect(screen.getByText("3 FINDINGS")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Extract magic number")).toBeInTheDocument();
  });

  it("uses a custom title when provided", () => {
    render(<FindingsHoverCard findings={MIXED} title="3 FINDINGS IN THIS RUN" />);
    expect(screen.getByText("3 FINDINGS IN THIS RUN")).toBeInTheDocument();
  });

  it("renders nothing when there are no findings", () => {
    const { container } = render(<FindingsHoverCard findings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
