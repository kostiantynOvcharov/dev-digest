import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Agent, EvalCase, EvalDashboard } from "@devdigest/shared";

// next/link needs no App Router context in a unit test — render a plain anchor.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const CASES: EvalCase[] = [
  {
    id: "c1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "stripe-key-leak",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [{ file: "src/config.ts", start_line: 12, end_line: 12 }],
    notes: null,
  },
  {
    id: "c2",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "readme-tweak-quiet",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [], // must_not_flag → "expected 0"
    notes: null,
  },
];

// Dashboard carries a latest run for c1 only (failing) → c2 has "never run".
const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 2,
  current: { recall: 0.5, precision: 0.5, citation_accuracy: 1, traces_passed: 0, traces_total: 2, cost_usd: 0 },
  delta: { recall: 0, precision: 0, citation_accuracy: 0 },
  trend: [],
  alert: null,
  recent_runs: [
    {
      id: "r1",
      case_id: "c1",
      case_name: "stripe-key-leak",
      ran_at: "2026-07-10T00:00:00.000Z",
      actual_output: null,
      pass: false,
      recall: 0,
      precision: 0,
      citation_accuracy: 0,
      duration_ms: 120,
      cost_usd: 0,
      run_group_id: "g1",
      agent_version: 6,
      system_prompt: "p",
    },
  ],
};

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: CASES, isLoading: false }),
  useEvalDashboard: () => ({ data: DASHBOARD, isLoading: false }),
  useRunEvals: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 6,
};

afterEach(cleanup);

describe("EvalsTab", () => {
  it("lists the agent's cases with expectation summaries and per-case status incl. 'never run' / 'expected 0'", () => {
    render(<EvalsTab agent={AGENT} />);

    // Both cases (must_find + must_not_flag) are visible (AC-2 UI, AC-4).
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("readme-tweak-quiet")).toBeInTheDocument();

    // Expectation summaries: must_find → "expected 1 finding"; must_not_flag → "expected 0".
    expect(screen.getByText("expected 1 finding")).toBeInTheDocument();
    expect(screen.getByText("expected 0")).toBeInTheDocument();

    // Latest per-case status: c1 ran and failed; c2 has never run.
    expect(screen.getByText("fail")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();

    // Passing count reflects 0 of 2 (c1 failed, c2 never run).
    expect(screen.getByText(/Eval cases · 0\/2 passing/)).toBeInTheDocument();

    // Top-level actions + per-row icon buttons carry accessible names.
    expect(screen.getByRole("button", { name: /Run all evals/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit stripe-key-leak/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete readme-tweak-quiet/i })).toBeInTheDocument();
  });
});
