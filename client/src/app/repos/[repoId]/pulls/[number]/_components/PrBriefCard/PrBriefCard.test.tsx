import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { BriefResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

// Mock at the network + toast boundaries; the real hooks run against these.
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { get: h.get, post: h.post },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/lib/toast", () => ({
  notify: { error: h.notifyError, success: vi.fn(), info: vi.fn(), toast: vi.fn() },
}));

import { PrBriefCard } from "./PrBriefCard";

const AGENTS = [{ id: "a1", name: "Security", enabled: true }];

// The GET stub returns whatever brief is "cached" server-side; a successful POST
// updates it — so the post-generate refetch (invalidateQueries) stays consistent.
let cached: BriefResponse | null = null;

beforeEach(() => {
  cached = null;
  h.get.mockImplementation(async (path: string) =>
    path === "/agents" ? AGENTS : cached,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const POPULATED: BriefResponse = {
  brief: {
    what: "Adds a public webhook receiver.",
    why: "Customers need real-time delivery events.",
    risk_level: "high",
    risks: [
      {
        kind: "security",
        title: "Unauthenticated endpoint",
        explanation: "The webhook route has no auth.",
        severity: "high",
        file_refs: ["src/server/webhook.ts:88", "POST /api/public/webhooks"],
      },
      {
        kind: "perf",
        title: "N+1 query",
        explanation: "Loops a DB call per event.",
        severity: "medium",
        file_refs: [],
      },
    ],
    review_focus: [
      { file: "src/server/routes.ts", line: 42, reason: "Start here — the new route." },
      { file: "src/server/handler.ts", reason: "Then the handler." },
    ],
  },
  head_sha: "deadbeef",
  outdated: false,
  generated_at: "2026-07-09T00:00:00Z",
  model: "openai/gpt-4.1",
  cost: 0.0021,
  tokens: { in: 1200, out: 300 },
};

function stubBrief(brief: BriefResponse | null) {
  cached = brief;
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <PrBriefCard prId="pr1" repoFullName="acme/app" headSha="deadbeef" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PrBriefCard", () => {
  it("shows the empty state with a working Generate button and no spinner (AC-1)", async () => {
    stubBrief(null);
    renderCard();

    expect(await screen.findByText("No brief yet")).toBeInTheDocument();
    expect(screen.getByText("Generate a Why+Risk brief for this PR.")).toBeInTheDocument();
    // no loading spinner / error surfaced in the empty state
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    const buttons = screen.getAllByRole("button", { name: /generate brief/i });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith("/pulls/pr1/brief", { context_agent_id: undefined }),
    );
  });

  it("renders what/why, a text risk label, all risks, and review_focus in order after a generate (AC-2/3/4)", async () => {
    stubBrief(null);
    h.post.mockImplementation(async () => {
      cached = POPULATED;
      return POPULATED;
    });
    renderCard();

    await screen.findByText("No brief yet");
    fireEvent.click(screen.getAllByRole("button", { name: /generate brief/i })[0]!);

    expect(await screen.findByText("Adds a public webhook receiver.")).toBeInTheDocument();
    expect(screen.getByText("Customers need real-time delivery events.")).toBeInTheDocument();
    // risk level conveyed as TEXT, not color alone (AC-17)
    expect(screen.getByText("Risk: High")).toBeInTheDocument();
    // all risks rendered
    expect(screen.getByText("Unauthenticated endpoint")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    // review_focus rendered in ARRAY order (most-important-first)
    const first = screen.getByText("Start here — the new route.");
    const second = screen.getByText("Then the handler.");
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders a text 'Outdated' badge when the brief is outdated (AC-8/AC-17)", async () => {
    stubBrief({ ...POPULATED, outdated: true });
    renderCard();
    expect(await screen.findByText("Outdated")).toBeInTheDocument();
  });

  it("surfaces an error toast when generation fails (AC-10)", async () => {
    stubBrief(null);
    h.post.mockRejectedValue(new Error("No API key configured"));
    renderCard();

    await screen.findByText("No brief yet");
    fireEvent.click(screen.getAllByRole("button", { name: /generate brief/i })[0]!);

    await waitFor(() => expect(h.notifyError).toHaveBeenCalledWith("No API key configured"));
  });

  it("renders a file-path ref as a link and an endpoint-shaped ref as non-clickable text (AC-5)", async () => {
    stubBrief(POPULATED);
    renderCard();

    // the label is shortened for display (…/lastTwoSegments) but the link still
    // targets the FULL path, and the full ref is exposed via title on the wrapper
    const fileLink = await screen.findByRole("link", { name: "…/server/webhook.ts:88" });
    expect(fileLink.getAttribute("href")).toContain(
      "/acme/app/blob/deadbeef/src/server/webhook.ts",
    );
    expect(screen.getByTitle("src/server/webhook.ts:88")).toBeInTheDocument();
    // the endpoint-shaped ref is a plain (non-clickable) label, never a link
    expect(
      screen.queryByRole("link", { name: /POST \/api\/public\/webhooks/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("POST /api/public/webhooks")).toBeInTheDocument();
  });
});
