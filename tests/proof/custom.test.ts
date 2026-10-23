import { describe, expect, it } from "vitest";
import { buildCard } from "../../src/proof/card";
import { matchCustom, parseCustomRules } from "../../src/proof/custom";
import { classifyCommand } from "../../src/proof/classify";
import { commandRules } from "../../src/proof/rules";
import { unwrapCommand } from "../../src/proof/shell";
import type { TurnInput, TurnItem } from "../../src/proof/turns";

const good = { id: "USER1", title: "No force push", pattern: "git push.*--force", message: "Force push in a check.", fixHint: "Use a branch." };

describe("custom rules", () => {
  it("parses valid rules and drops bad ones with a warning each", () => {
    const warnings: string[] = [];
    const rules = parseCustomRules(
      JSON.stringify([good, { ...good, id: "bad" }, { ...good, id: "USER2", pattern: "(" }, { ...good }, { ...good, id: "USER3", title: "" }]),
      (m) => warnings.push(m),
    );
    expect(rules.map((r) => r.rule.id)).toEqual(["USER1"]);
    expect(warnings).toHaveLength(4);
  });
  it("ignores empty, invalid JSON and non-arrays", () => {
    const w: string[] = [];
    expect(parseCustomRules("", (m) => w.push(m))).toEqual([]);
    expect(parseCustomRules("[]", (m) => w.push(m))).toEqual([]);
    expect(parseCustomRules("{", (m) => w.push(m))).toEqual([]);
    expect(parseCustomRules('{"a":1}', (m) => w.push(m))).toEqual([]);
    expect(w).toHaveLength(2);
  });
  it("caps the rule list at 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...good, id: `USER${i + 1}` }));
    expect(parseCustomRules(JSON.stringify(many))).toHaveLength(20);
  });
  it("matches a command and yields an info finding with the title in the message", () => {
    const [c] = parseCustomRules(JSON.stringify([good]));
    expect(matchCustom([c], "git push origin x --force", "i1")).toEqual([
      { ruleId: "USER1", severity: "low", effect: "info", message: "No force push: Force push in a check.", fixHint: "Use a branch.", itemId: "i1" },
    ]);
    expect(matchCustom([c], "git status", "i1")).toEqual([]);
  });
  it("adds an info finding to a card without changing the verdict", () => {
    const command = "npm test && git push --force";
    const item = { id: "c1", command, exitCode: 0, aggregatedOutput: "Tests 1 passed", status: "completed" as const };
    const items: TurnItem[] = [
      { kind: "cmd", seq: 1, item, kinds: classifyCommand(unwrapCommand(command)), findings: commandRules(item) },
      { kind: "msg", seq: 2, text: "All tests pass." },
    ];
    const turn: TurnInput = { threadId: "t", turnId: "t1", turnStatus: "completed", firstSeq: 1, lastSeq: 3, completedAt: 1, items };
    const meta = { projectId: "p", providerId: null, threadTitle: null };
    const plain = buildCard(turn, meta, 1);
    const withCustom = buildCard(turn, meta, 1, parseCustomRules(JSON.stringify([good])));
    expect(withCustom.verdict).toBe(plain.verdict);
    expect(withCustom.findings.map((f) => f.ruleId)).toEqual([...plain.findings.map((f) => f.ruleId), "USER1"]);
  });
});
