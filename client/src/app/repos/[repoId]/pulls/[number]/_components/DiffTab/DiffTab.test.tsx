import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import shellMessages from "../../../../../../../../messages/en/shell.json";

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

import { DiffTab } from "./DiffTab";

const EMPTY_SMART_DIFF: SmartDiff = {
  groups: [],
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
};

const FILES: PrFile[] = [
  { path: "src/foo.ts", additions: 5, deletions: 1, patch: "@@ -1,1 +1,5 @@\n+const a = 1;" },
];

beforeEach(() => {
  h.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/comments")) return [];
    if (path.endsWith("/smart-diff")) return EMPTY_SMART_DIFF;
    if (path.endsWith("/reviews")) return [];
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
        <DiffTab prId="pr1" filesCount={FILES.length} files={FILES} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("DiffTab — Generate summaries button", () => {
  it("calls the POST endpoint when 'Generate summaries' is clicked", async () => {
    h.post.mockResolvedValue({});
    renderTab();

    const button = await screen.findByRole("button", { name: /generate summaries/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith("/pulls/pr1/smart-diff/summaries"),
    );
  });

  it("surfaces an error toast when generation fails", async () => {
    h.post.mockRejectedValue(new Error("No API key configured"));
    renderTab();

    const button = await screen.findByRole("button", { name: /generate summaries/i });
    fireEvent.click(button);

    await waitFor(() => expect(h.notifyError).toHaveBeenCalledWith("No API key configured"));
  });
});
