import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("app.css", () => {
  it("turns off every animation under prefers-reduced-motion", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThan(-1);
    const reduced = css.slice(start);
    const before = css.slice(0, start);
    // Every selector whose rule declares `animation:` outside the reduce block.
    const animated = [...before.matchAll(/([^{}]+)\{[^{}]*\banimation:[^{}]*\}/g)].map((m) => m[1].trim());
    expect(animated.length).toBeGreaterThan(0);
    for (const selector of animated) {
      expect(reduced, `reduce block must cover ${selector}`).toContain(selector.replace(/^\.dark\s+/, ""));
    }
  });

  it("uses only the five named animations", () => {
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["otto-circle-draw", "otto-live-breathe", "otto-marker-draw", "otto-row-enter", "otto-stamp-land"]);
  });
});
