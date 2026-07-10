import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiffGroup } from "@devdigest/shared";
import shellMessages from "../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(() => cleanup());

const FILES: PrFile[] = [
  {
    path: "src/foo.ts",
    additions: 5,
    deletions: 1,
    patch: "@@ -1,1 +1,5 @@\n+const a = 1;",
  },
  {
    path: "src/bar.ts",
    additions: 2,
    deletions: 0,
    patch: "@@ -1,1 +1,2 @@\n+const b = 2;",
  },
];

function groupsWithSummaries(fooSummary: string | null): SmartDiffGroup[] {
  return [
    {
      role: "core",
      files: [
        {
          path: "src/foo.ts",
          pseudocode_summary: fooSummary,
          additions: 5,
          deletions: 1,
          finding_lines: [],
        },
        {
          path: "src/bar.ts",
          pseudocode_summary: null,
          additions: 2,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
  ];
}

function renderViewer(groups: SmartDiffGroup[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      <SmartDiffViewer groups={groups} files={FILES} findings={[]} />
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer per-file summary", () => {
  it("renders the 'What this does' line and a summary badge only for the file with a pseudocode_summary", () => {
    renderViewer(groupsWithSummaries("Adds a caching layer to the fetch handler."));

    // Body line — only ONE file has a summary.
    expect(screen.getByText("What this does:")).toBeInTheDocument();
    expect(
      screen.getByText("Adds a caching layer to the fetch handler."),
    ).toBeInTheDocument();

    // Header badge — exactly one "summary" badge (foo.ts only, not bar.ts).
    expect(screen.getAllByText("summary")).toHaveLength(1);
  });

  it("renders neither the summary line nor the badge when pseudocode_summary is null", () => {
    renderViewer(groupsWithSummaries(null));

    expect(screen.queryByText("What this does:")).not.toBeInTheDocument();
    expect(screen.queryByText("summary")).not.toBeInTheDocument();
  });
});
