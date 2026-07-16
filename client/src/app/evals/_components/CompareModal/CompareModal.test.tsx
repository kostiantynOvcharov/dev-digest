import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { EvalCompare } from "@/lib/hooks/eval";

const COMPARE: EvalCompare = {
  a: {
    run_group_id: "g6",
    ran_at: "2026-07-10T00:00:00.000Z",
    agent_version: 6,
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    cost_usd: 0.01,
    traces_passed: 8,
    traces_total: 10,
    system_prompt: "You are a reviewer.\nBe concise.",
  },
  b: {
    run_group_id: "g7",
    ran_at: "2026-07-11T00:00:00.000Z",
    agent_version: 7,
    recall: 0.85,
    precision: 0.8,
    citation_accuracy: 1,
    cost_usd: 0.02,
    traces_passed: 7,
    traces_total: 10,
    system_prompt: "You are a reviewer.\nBe concise.\nFlag every TODO comment.",
  },
  delta: { recall: 0.05, precision: -0.1, citation_accuracy: 0, cost_usd: 0.01 },
  system_prompt_a: "You are a reviewer.\nBe concise.",
  system_prompt_b: "You are a reviewer.\nBe concise.\nFlag every TODO comment.",
};

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCompare: () => ({ data: COMPARE, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));

import { CompareModal } from "./CompareModal";

afterEach(cleanup);

describe("CompareModal", () => {
  it("shows the four metric deltas and a system-prompt diff with the added line highlighted", () => {
    render(<CompareModal aRunGroupId="g6" bRunGroupId="g7" onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: /Compare runs/i });

    // Metric deltas (old→new): recall improved +5 pts, precision dropped 10 pts.
    expect(screen.getByText(/\+5 pts/)).toBeInTheDocument();
    expect(screen.getByText(/10 pts/)).toBeInTheDocument();
    // All four metric rows are present.
    expect(screen.getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText("Precision")).toBeInTheDocument();
    expect(screen.getByText("Citation accuracy")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();

    // System-prompt diff: the added line appears and is marked as an addition.
    expect(dialog).toHaveTextContent("Flag every TODO comment.");
    const added = Array.from(dialog.querySelectorAll('[data-kind="added"]'));
    expect(added.some((el) => el.textContent?.includes("Flag every TODO comment."))).toBe(true);

    // A11y: a visible Close control exists (focus trap + Escape wired by A11yModal).
    expect(screen.getByRole("button", { name: /Close/i })).toBeInTheDocument();
  });
});
