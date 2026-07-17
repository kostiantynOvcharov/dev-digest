import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SafeDocPreview } from "./SafeDocPreview";

afterEach(cleanup);

// A doc authored in the repo is UNTRUSTED input (OWASP A05 stored-XSS). It may
// carry a raw <script>, inline HTML, and a javascript: link. This is the exact
// payload a malicious/compromised repo could ship.
const XSS_DOC = [
  "# Title",
  "",
  "<script>alert(1)</script>",
  "",
  "<img src=x onerror=alert(2)>",
  "",
  "[x](javascript:alert(1))",
  "",
  "[safe link](https://example.com/ok)",
].join("\n");

describe("SafeDocPreview", () => {
  it("renders untrusted markdown as inert text: no <script>, javascript: link neutered, path escaped", () => {
    const { container } = render(
      <SafeDocPreview content={XSS_DOC} path="specs/<b>evil</b>.md" />,
    );

    // Landmark region with an accessible name (a11y).
    const region = screen.getByRole("region", { name: /evil/i });
    expect(region).toBeInTheDocument();

    // The raw <script> is NOT parsed into the DOM — it renders as literal text.
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();

    // The inline <img onerror> HTML never becomes a real element.
    expect(container.querySelector("img")).toBeNull();

    // The javascript: link is NOT a live href — the default urlTransform
    // stripped the dangerous protocol (renders as an empty href, which also
    // drops the ARIA link role, so query by its text). It is inert.
    const jsLink = screen.getByText("x").closest("a");
    expect(jsLink).not.toBeNull();
    const jsHref = jsLink!.getAttribute("href") ?? "";
    expect(jsHref.toLowerCase()).not.toContain("javascript:");
    expect(jsHref).toBe("");

    // A legitimate https link is preserved (not over-blocked).
    const okLink = screen.getByRole("link", { name: /safe link/i });
    expect(okLink).toHaveAttribute("href", "https://example.com/ok");

    // The doc path is shown as ESCAPED React text, not injected as HTML.
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("specs/<b>evil</b>.md")).toBeInTheDocument();
  });

  it("does not use dangerouslySetInnerHTML anywhere in the component source", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/SafeDocPreview/SafeDocPreview.tsx"),
      "utf8",
    );
    // Guard against actual USAGE (JSX prop / object key), while allowing the
    // word to appear in the "NEVER dangerouslySetInnerHTML" doc comment.
    expect(src).not.toMatch(/dangerouslySetInnerHTML\s*[=:]/);
  });
});
