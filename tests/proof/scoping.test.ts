// Claim scoping and expected-failure runs. Both came from a real false CONTRADICTED on
// 2026-10-29: "GitHub's tests passed" was pinned to a local vitest diagnosis run (exit 1),
// and deliberate-break / baseline runs were counted as failures.
import { describe, expect, it } from "vitest";
import { classifyCommand } from "../../src/proof/classify";
import { extractClaims } from "../../src/proof/claims";
import { commandRules, type CommandStatus } from "../../src/proof/rules";
import { unwrapCommand } from "../../src/proof/shell";
import type { TurnItem } from "../../src/proof/turns";
import { decideVerdict } from "../../src/proof/verdict";

let n = 0;
const cmd = (command: string, exitCode: number, aggregatedOutput = ""): TurnItem => {
  n++;
  const status: CommandStatus = exitCode === 0 ? "completed" : "failed";
  const item = { id: `c${n}`, command, exitCode, aggregatedOutput, status };
  return { kind: "cmd", seq: n, item, kinds: classifyCommand(unwrapCommand(command)), findings: commandRules(item) };
};
const msg = (text: string): TurnItem => ({ kind: "msg", seq: 0, text });

describe("remote-scoped test claims", () => {
  it("GitHub's tests passed is a ci claim, not tests", () => {
    expect(extractClaims("PR merged. GitHub's tests passed.")).toEqual(["ci"]);
  });
  it("CI tests are green is a ci claim", () => {
    expect(extractClaims("CI tests are green on the PR.")).toEqual(["ci"]);
  });
  it("plain tests passed stays a tests claim", () => {
    expect(extractClaims("All tests passed.")).toEqual(["tests"]);
  });
  it("a local failing vitest run does not contradict a GitHub claim", () => {
    const items = [
      cmd("npx vitest run src/a.test.ts", 1, "Tests 2 failed | 10 passed"),
      cmd("gh pr checks 32", 0, "Linux / Node 24\tpass\t2m"),
      msg("GitHub's tests passed and the PR is merged."),
    ];
    const r = decideVerdict({ items });
    expect(r.claims).toContain("ci");
    expect(r.claims).not.toContain("tests");
    expect(r.verdict).not.toBe("CONTRADICTED");
  });
});

describe("expect-fail marker", () => {
  it("drops failure findings from a tagged run", () => {
    const item = { command: "npx vitest run # otto:expect-fail", exitCode: 1, aggregatedOutput: "Tests 1 failed", status: "failed" as const };
    expect(commandRules(item).filter((c) => /^OTTO00[567]/.test(c))).toEqual([]);
  });
  it("baseline marker works the same way", () => {
    const item = { command: "npx vitest run # otto:baseline", exitCode: 1, aggregatedOutput: "", status: "failed" as const };
    expect(commandRules(item).filter((c) => /^OTTO006/.test(c))).toEqual([]);
  });
  it("untagged failing run still fires OTTO006", () => {
    const item = { command: "npx vitest run", exitCode: 1, aggregatedOutput: "", status: "failed" as const };
    expect(commandRules(item)).toContain("OTTO006");
  });
  it("tagged run is never claim evidence: earlier green run decides", () => {
    const items = [
      cmd("npx vitest run", 0, "Tests 12 passed"),
      cmd("npx vitest run # otto:expect-fail", 1, "Tests 1 failed"),
      msg("All tests pass."),
    ];
    expect(decideVerdict({ items }).verdict).toBe("VERIFIED");
  });
  it("tagged run alone does not support a tests claim", () => {
    const items = [cmd("npx vitest run # otto:baseline", 0, "Tests 12 passed"), msg("All tests pass.")];
    expect(decideVerdict({ items }).status.tests).toBe("unsupported");
  });
});
