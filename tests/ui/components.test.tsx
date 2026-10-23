// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClaimText } from "../../ui/ClaimText";
import { Ribbon } from "../../ui/Ribbon";
import { Stamp } from "../../ui/Stamp";
import type { ClaimResult, Verdict } from "../../src/shared/contract";

afterEach(cleanup);

describe("Stamp", () => {
  const cases: [Verdict, string, string][] = [
    ["VERIFIED", "Verified", "check"],
    ["UNVERIFIED", "Unverified", "circle"],
    ["CONTRADICTED", "Contradicted", "slash"],
    ["NO_CLAIM", "No claim", "none"],
  ];
  for (const [verdict, word, glyph] of cases) {
    it(`${verdict} shows the word "${word}" and the ${glyph} glyph`, () => {
      const { getByText, container } = render(<Stamp verdict={verdict} />);
      expect(getByText(word)).toBeTruthy();
      const stamp = container.querySelector(".otto-stamp");
      expect(stamp?.getAttribute("data-glyph")).toBe(glyph);
      expect(container.querySelectorAll("svg").length).toBe(glyph === "none" ? 0 : 1);
    });
  }

  it("uses the check path for VERIFIED and the slash path for CONTRADICTED", () => {
    const ok = render(<Stamp verdict="VERIFIED" />);
    expect(ok.container.querySelector("path")?.getAttribute("d")).toBe("M3 6.5 5 8.5 9.5 3.5");
    cleanup();
    const bad = render(<Stamp verdict="CONTRADICTED" />);
    expect(bad.container.querySelector("path")?.getAttribute("d")).toBe("M3 9 9 3");
  });
});

describe("Ribbon", () => {
  it("renders nothing when every count is zero", () => {
    const { container } = render(<Ribbon counts={{ VERIFIED: 0, UNVERIFIED: 0, CONTRADICTED: 0, NO_CLAIM: 9 }} />);
    expect(container.firstChild).toBeNull();
  });

  it("sizes segments in proportion and labels the numbers", () => {
    const { container } = render(<Ribbon counts={{ VERIFIED: 2, UNVERIFIED: 1, CONTRADICTED: 1, NO_CLAIM: 5 }} />);
    const segs = Array.from(container.querySelectorAll<HTMLElement>("[data-segment]"));
    expect(segs.map((s) => s.dataset.segment)).toEqual(["verified", "unverified", "contradicted"]);
    expect(segs.map((s) => s.style.width)).toEqual(["50%", "25%", "25%"]);
    expect(container.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("2 verified, 1 unverified, 1 contradicted");
  });

  it("omits zero-count segments", () => {
    const { container } = render(<Ribbon counts={{ VERIFIED: 3, UNVERIFIED: 0, CONTRADICTED: 0, NO_CLAIM: 0 }} />);
    expect(container.querySelectorAll("[data-segment]").length).toBe(1);
  });
});

describe("ClaimText", () => {
  const text = "Fixed it. All tests pass.";
  const claim = (status: ClaimResult["status"]): ClaimResult => ({
    claim: "tests",
    status,
    evidenceItemId: null,
    span: { start: 10, end: 24 },
  });

  it("wraps exactly the span in a marker and prints the margin note for an unsupported claim", () => {
    const { container, getByText } = render(<ClaimText text={text} claims={[claim("unsupported")]} />);
    const mark = container.querySelector(".otto-marker");
    expect(mark?.textContent).toBe(text.slice(10, 24));
    expect(getByText("no check ran for this")).toBeTruthy();
  });

  it("uses the wording for each flagged status", () => {
    const wording: [ClaimResult["status"], string][] = [
      ["untrustworthy", "the check hides its exit code"],
      ["stale", "files changed after this check"],
      ["contradicted", "the check says otherwise"],
    ];
    for (const [status, note] of wording) {
      const { getByText } = render(<ClaimText text={text} claims={[claim(status)]} />);
      expect(getByText(note)).toBeTruthy();
      cleanup();
    }
  });

  it("prints no marker and no note for a supported claim", () => {
    const { container } = render(<ClaimText text={text} claims={[claim("supported")]} />);
    expect(container.querySelector(".otto-marker")).toBeNull();
    expect(container.querySelector(".otto-note")).toBeNull();
    expect(container.textContent).toBe(text);
  });

  it("keeps the whole text when a claim has no span", () => {
    const { container } = render(<ClaimText text={text} claims={[{ ...claim("unsupported"), span: null }]} />);
    expect(container.querySelector(".otto-marker")).toBeNull();
    expect(container.textContent).toBe(text);
  });
});
