import { describe, expect, it } from "vitest";
import { groupTurns, groupTurnsWithStats, type EventRowLike } from "../../src/proof/turns";

let seq = 0;
const row = (type: string, turnId: string | null, data: unknown): EventRowLike => {
  seq++;
  return {
    threadId: "thr_1",
    seq,
    createdAt: 1_000 + seq,
    type,
    scope: turnId === null ? { kind: "thread" } : { kind: "turn", turnId },
    data,
  };
};
const command = (turnId: string, c: string, exitCode: number, output = "") =>
  row("item/completed", turnId, {
    item: { type: "commandExecution", id: `cmd${seq + 1}`, command: c, cwd: "/x", status: exitCode === 0 ? "completed" : "failed", exitCode, aggregatedOutput: output },
  });
const message = (turnId: string, text: string) =>
  row("item/completed", turnId, { item: { type: "agentMessage", id: `m${seq + 1}`, text } });
const done = (turnId: string, status = "completed") => row("turn/completed", turnId, { status });

describe("groupTurns", () => {
  it("does not emit a turn without turn/completed", () => {
    const rows = [command("t1", "npm test", 0), message("t1", "Tests pass.")];
    expect(groupTurns(rows)).toEqual([]);
  });

  it("emits a complete turn with items in seq order", () => {
    const rows = [command("t1", "npm test", 0, "Tests 3 passed"), message("t1", "Tests pass."), done("t1")];
    const turns = groupTurns(rows);
    expect(turns).toHaveLength(1);
    expect(turns[0].turnId).toBe("t1");
    expect(turns[0].turnStatus).toBe("completed");
    expect(turns[0].items.map((i) => i.kind)).toEqual(["cmd", "msg"]);
    expect(turns[0].lastSeq).toBe(rows[2].seq);
    expect(turns[0].completedAt).toBe(rows[2].createdAt);
  });

  it("skips and counts a malformed item/completed row", () => {
    const rows = [
      row("item/completed", "t1", { item: { type: "commandExecution", id: "bad" } }),
      command("t1", "npm test", 0),
      done("t1"),
    ];
    const { turns, skipped } = groupTurnsWithStats(rows);
    expect(skipped).toBe(1);
    expect(turns[0].items).toHaveLength(1);
  });

  it("ignores unknown item types without counting them as malformed", () => {
    const rows = [row("item/completed", "t1", { item: { type: "reasoning", id: "r" } }), done("t1")];
    const { turns, skipped } = groupTurnsWithStats(rows);
    expect(skipped).toBe(0);
    expect(turns[0].items).toEqual([]);
  });

  it("analyzes the unwrapped body of Codex-wrapped commands", () => {
    const rows = [command("t1", '/bin/zsh -lc "npm test 2>&1 | tail -3"', 0, "Tests 3 passed"), done("t1")];
    const first = groupTurns(rows)[0].items[0];
    expect(first.kind).toBe("cmd");
    if (first.kind === "cmd") {
      expect(first.kinds).toEqual(["test"]);
      expect(first.findings).toEqual(["OTTO001"]);
    }
  });

  it("ignores rows that are not turn scoped", () => {
    const rows = [row("item/completed", null, { item: { type: "agentMessage", id: "m", text: "hi" } })];
    expect(groupTurns(rows)).toEqual([]);
  });

  it("emits several turns ordered by their completion", () => {
    const rows = [command("t1", "npm test", 0), done("t1"), command("t2", "npm run build", 0), done("t2", "interrupted")];
    const turns = groupTurns(rows);
    expect(turns.map((t) => t.turnId)).toEqual(["t1", "t2"]);
    expect(turns[1].turnStatus).toBe("interrupted");
  });

  it("leaves an incomplete later turn for the next scan", () => {
    const rows = [command("t1", "npm test", 0), done("t1"), command("t2", "npm test", 0)];
    expect(groupTurns(rows).map((t) => t.turnId)).toEqual(["t1"]);
  });
});
