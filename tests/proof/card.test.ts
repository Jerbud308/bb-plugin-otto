import { describe, expect, it } from "vitest";
import { buildCard } from "../../src/proof/card";
import { classifyCommand } from "../../src/proof/classify";
import { commandRules, type CommandStatus } from "../../src/proof/rules";
import { unwrapCommand } from "../../src/proof/shell";
import type { TurnInput, TurnItem } from "../../src/proof/turns";

let seq = 0;
const cmd = (
  command: string,
  exitCode: number,
  aggregatedOutput = "",
  extra: { parentToolCallId?: string } = {},
): TurnItem => {
  seq++;
  const status: CommandStatus = exitCode === 0 ? "completed" : "failed";
  const item = { id: `c${seq}`, command, exitCode, aggregatedOutput, status, ...extra };
  return { kind: "cmd", seq, item, kinds: classifyCommand(unwrapCommand(command)), findings: commandRules(item) };
};
const file = (paths: number): TurnItem => {
  seq++;
  return {
    kind: "file",
    seq,
    item: { id: `f${seq}`, changes: Array.from({ length: paths }, (_, i) => ({ path: `a${i}.ts`, kind: "update" as const })) },
  };
};
const msg = (text: string): TurnItem => {
  seq++;
  return { kind: "msg", seq, text };
};
const turn = (items: TurnItem[]): TurnInput => ({
  threadId: "thr_abc",
  turnId: "turn_1",
  turnStatus: "completed",
  firstSeq: 1,
  lastSeq: 1000,
  completedAt: 1_700_000_000_000,
  items,
});
const meta = { projectId: "proj_1", providerId: "claude-code", threadTitle: "Fix it" };
const NOW = 1_700_000_999_000;

describe("buildCard", () => {
  it("uses the thread:turn id format and copies meta", () => {
    const card = buildCard(turn([cmd("npm test", 0, "Tests 3 passed"), msg("Tests pass.")]), meta, NOW);
    expect(card.id).toBe("thr_abc:turn_1");
    expect(card.projectId).toBe("proj_1");
    expect(card.providerId).toBe("claude-code");
    expect(card.threadTitle).toBe("Fix it");
    expect(card.createdAt).toBe(1_700_000_000_000);
    expect(card.updatedAt).toBe(NOW);
    expect(card.rulesetVersion).toBe(2);
    expect(card.verdict).toBe("VERIFIED");
  });

  it("keeps only the last 60 evidence items", () => {
    const items: TurnItem[] = [];
    for (let i = 0; i < 70; i++) items.push(cmd(`npm test -- run${i}`, 0, "Tests 1 passed"));
    items.push(msg("Tests pass."));
    const card = buildCard(turn(items), meta, NOW);
    expect(card.evidence).toHaveLength(60);
    expect(card.evidence[0].command).toBe("npm test -- run10");
    expect(card.evidence[59].command).toBe("npm test -- run69");
  });

  it("caps findings at 100", () => {
    const items: TurnItem[] = [];
    for (let i = 0; i < 60; i++) items.push(cmd(`npm test ${i} 2>&1 | tail -3; echo "exit=$?"`, 1, "Tests 1 failed"));
    items.push(msg("Tests pass."));
    const card = buildCard(turn(items), meta, NOW);
    expect(card.findings).toHaveLength(100);
    expect(card.verdict).toBe("CONTRADICTED");
  });

  it("keeps the last 1500 chars of output", () => {
    const output = `${"x".repeat(1500)}${"y".repeat(1500)}`;
    const card = buildCard(turn([cmd("npm test", 0, output), msg("Tests pass.")]), meta, NOW);
    expect(card.evidence[0].outputTail).toHaveLength(1500);
    expect(card.evidence[0].outputTail).toBe("y".repeat(1500));
  });

  it("caps claimText at 4000 chars and nulls spans past the cap", () => {
    const text = `${"a".repeat(4500)} Tests pass.`;
    const card = buildCard(turn([cmd("npm test", 0, "ok"), msg(text)]), meta, NOW);
    expect(card.claimText).toHaveLength(4000);
    const tests = card.claims.find((c) => c.claim === "tests");
    expect(tests?.span).toBeNull();
    expect(tests?.status).toBe("supported");
  });

  it("sorts findings high first, then by seq", () => {
    const card = buildCard(
      turn([cmd("npm test; echo done", 0, "Tests 3 passed"), cmd("npx vitest run", 1, "Tests 1 failed"), msg("Tests pass.")]),
      meta,
      NOW,
    );
    const severities = card.findings.map((f) => f.severity);
    expect(severities[0]).toBe("high");
    expect(severities).toContain("medium");
    expect(severities.indexOf("medium")).toBeGreaterThan(severities.lastIndexOf("high"));
  });

  it("stores bare rule ids on evidence and findings", () => {
    const card = buildCard(turn([cmd("npm test; echo done", 0, "Tests 3 passed"), msg("Tests pass.")]), meta, NOW);
    expect(card.evidence[0].findingRuleIds).toEqual(["OTTO003"]);
    expect(card.findings[0].ruleId).toBe("OTTO003");
    expect(card.findings[0].severity).toBe("medium");
  });

  it("links claims to their evidence item and leaves done unlinked", () => {
    const card = buildCard(turn([file(2), cmd("npm test", 0, "Tests 3 passed"), msg("Done. Tests pass.")]), meta, NOW);
    const tests = card.claims.find((c) => c.claim === "tests");
    const done = card.claims.find((c) => c.claim === "done");
    expect(tests?.evidenceItemId).toBe(card.evidence[0].itemId);
    expect(done?.status).toBeNull();
    expect(done?.evidenceItemId).toBeNull();
    expect(card.editedFiles).toBe(2);
  });

  it("records subagent commands and null exit codes", () => {
    const sub = cmd("npm test", 0, "Tests 3 passed", { parentToolCallId: "call_1" });
    const card = buildCard(turn([sub, msg("Tests pass.")]), meta, NOW);
    expect(card.evidence[0].viaSubagent).toBe(true);
    expect(card.evidence[0].exitCode).toBe(0);
    expect(card.evidence[0].durationMs).toBeNull();
  });

  it("emits a NO_CLAIM card with no evidence for a plain turn", () => {
    const card = buildCard(turn([cmd("ls", 0, "a"), msg("Here is the summary.")]), meta, NOW);
    expect(card.verdict).toBe("NO_CLAIM");
    expect(card.evidence).toEqual([]);
    expect(card.claims).toEqual([]);
  });
});
