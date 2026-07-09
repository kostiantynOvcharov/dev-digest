import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json";
import { estimateTokens } from "@/lib/tokens";
import { TraceBody } from "./TraceBody";

afterEach(cleanup);

const SPECS_BLOCK = '<untrusted source="spec-0">\nINVARIANT_MARKER: never call fs directly\n</untrusted>';

function makeTrace(overrides: Partial<RunTrace["prompt_assembly"]> = {}): RunTrace {
  return {
    config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
    stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 0, grounding: "2/2 passed" },
    prompt_assembly: { system: "You are a reviewer.", specs: null, user: "Review PR #482", ...overrides },
    tool_calls: [],
    raw_output: "{}",
    memory_pulled: [],
    specs_read: ["specs/SPEC-01.md"],
    log: [],
  };
}

function renderBody(trace: RunTrace) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">
        <TraceBody trace={trace} findings={[]} />
      </div>
    </NextIntlClientProvider>,
  );
}

describe("TraceBody — Project Context / attached specs (AC-14/15/16)", () => {
  it("lists specs_read paths, then expands the injected block to full text + token volume", () => {
    renderBody(makeTrace({ specs: SPECS_BLOCK }));

    // AC-14: injected paths shown under "Specs read" (Configuration is open by default).
    expect(screen.getByText("specs/SPEC-01.md")).toBeInTheDocument();

    // Prompt assembly is collapsed by default — the section body is not mounted.
    expect(screen.queryByText("Project Context / attached specs")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Prompt assembly"));

    // Relabelled section header + AC-16 token-volume readout appear (block still collapsed).
    expect(screen.getByText("Project Context / attached specs")).toBeInTheDocument();
    expect(screen.getByText(`~${estimateTokens(SPECS_BLOCK)} tokens injected`)).toBeInTheDocument();
    expect(screen.queryByText(/INVARIANT_MARKER/)).not.toBeInTheDocument();

    // AC-15: expanding the block reveals the FULL injected untrusted text.
    fireEvent.click(screen.getByText("Project Context / attached specs"));
    const full = screen.getByText(/INVARIANT_MARKER/);
    expect(full).toBeInTheDocument();
    expect(full).toHaveTextContent('<untrusted source="spec-0">');
  });

  it("hides the Project Context section when no specs were injected", () => {
    renderBody(makeTrace({ specs: null }));

    fireEvent.click(screen.getByText("Prompt assembly"));

    expect(screen.queryByText("Project Context / attached specs")).not.toBeInTheDocument();
    expect(screen.queryByText(/tokens injected/)).not.toBeInTheDocument();
  });
});
