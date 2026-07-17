import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { EvalCase, EvalDashboard, Skill } from "@devdigest/shared";

// next/link needs no App Router context in a unit test — render a plain anchor.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const CASES: EvalCase[] = [
  {
    id: "c1",
    owner_kind: "skill",
    owner_id: "sk1",
    name: "flags-secret-in-config",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [{ file: "src/config.ts", start_line: 12, end_line: 12 }],
    notes: null,
  },
  {
    id: "c2",
    owner_kind: "skill",
    owner_id: "sk1",
    name: "quiet-on-readme",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [], // must_not_flag → "expected 0"
    notes: null,
  },
];

const DASHBOARD: EvalDashboard = {
  owner_kind: "skill",
  owner_id: "sk1",
  cases_total: 2,
  current: { recall: 0.5, precision: 0.5, citation_accuracy: 1, traces_passed: 1, traces_total: 2, cost_usd: 0 },
  delta: { recall: 0, precision: 0, citation_accuracy: 0 },
  trend: [],
  alert: null,
  recent_runs: [
    {
      id: "r1",
      case_id: "c1",
      case_name: "flags-secret-in-config",
      ran_at: "2026-07-10T00:00:00.000Z",
      actual_output: null,
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 120,
      cost_usd: 0,
      run_group_id: "g1",
      agent_version: 3,
      system_prompt: "p",
    },
  ],
};

// Mock the eval hooks so the tab (and the editor it opens) render without a
// QueryClient / network. Arg-ignoring stubs cover the owner-generic signatures.
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: CASES, isLoading: false }),
  useEvalDashboard: () => ({ data: DASHBOARD, isLoading: false }),
  useRunEvals: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useCreateEvalCaseFromInput: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

const SKILL: Skill = {
  id: "sk1",
  name: "secret-scanner",
  description: "",
  type: "security",
  source: "manual",
  body: "",
  enabled: true,
  version: 3,
} as unknown as Skill;

afterEach(cleanup);

describe("Skill EvalsTab", () => {
  it("lists the skill's cases and opens the create editor from 'New eval case'", () => {
    render(<EvalsTab skill={SKILL} />);

    // Both cases (must_find + must_not_flag) render with their expectation summary.
    expect(screen.getByText("flags-secret-in-config")).toBeInTheDocument();
    expect(screen.getByText("quiet-on-readme")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding")).toBeInTheDocument();
    expect(screen.getByText("expected 0")).toBeInTheDocument();

    // Passing count: c1 passed, c2 never run → 1/2.
    expect(screen.getByText(/Eval cases · 1\/2 passing/)).toBeInTheDocument();

    // No editor open initially.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // "New eval case" opens the shared editor in CREATE mode (manual authoring —
    // skills have no PR-finding source to seed from).
    fireEvent.click(screen.getByRole("button", { name: /New eval case/i }));
    const dialog = screen.getByRole("dialog", { name: "New eval case" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Assert the expected output")).toBeInTheDocument();
  });
});
