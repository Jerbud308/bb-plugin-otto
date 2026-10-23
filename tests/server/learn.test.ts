import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdRow, doneRow, msgRow, resetRows, startHost, type FakeRow } from "./helpers";

// Each thread: one turn that pipes its test run into tail, claims success => OTTO001 on every card.
function threadRows(): FakeRow[] {
  const rows: FakeRow[] = [];
  for (const id of ["thr_a", "thr_b", "thr_c"]) {
    rows.push(
      { ...cmdRow(id, `t_${id}`, "npm test 2>&1 | tail -3", 0, "Tests 3 passed"), threadId: id },
      { ...msgRow(id, `t_${id}`, "All tests pass."), threadId: id },
      { ...doneRow(id, `t_${id}`), threadId: id },
    );
  }
  return rows.map((r, i) => ({ ...r, seq: i + 1 }));
}
const idle = (id: string) => ({ thread: makeThreadResponse({ id }), lastAssistantText: null });
type Trends = { days: number; cardsInWindow: number; rules: { ruleId: string; title: string; count: number; threads: number; byProvider: { providerId: string; count: number }[]; weekly: number[] }[] };
type Sugg = { suggestions: { ruleId: string; title: string; count: number; line: string }[] };

// The fake rows are stamped 1_700_000_000_000 + seq, so pin the clock one day after them.
async function scanned(mode: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_700_000_000_000 + 86_400_000);
  const rows = threadRows();
  const h = await startHost({ rows: () => rows, settings: { mode } });
  for (const id of ["thr_a", "thr_b", "thr_c"]) await h.harness.behavior.emitThreadEvent("thread.idle", idle(id));
  return h;
}

describe("learn", () => {
  beforeEach(() => resetRows());
  afterEach(() => vi.useRealTimers());

  it("counts a rule once per card and suggests a line once it repeated three times", async () => {
    const { harness } = await scanned("pro");
    const t = (await harness.behavior.callRpc("learn.trends", { days: 30 })) as Trends;
    expect(t.cardsInWindow).toBe(3);
    const r = t.rules.find((x) => x.ruleId === "OTTO001");
    expect(r).toMatchObject({ title: "Pipe hides the check's exit code", count: 3, threads: 3 });
    expect(r?.weekly.reduce((a, b) => a + b, 0)).toBe(3);
    expect(r?.byProvider.reduce((a, b) => a + b.count, 0)).toBe(3);
    const s = (await harness.behavior.callRpc("learn.suggestions", { days: 30 })) as Sugg;
    expect(s.suggestions.map((x) => x.ruleId)).toEqual(["OTTO001"]);
    expect(s.suggestions[0].line).toContain("redirect its output to a file");
  });

  it("defaults the window to 30 days and works in Operator mode", async () => {
    const { harness } = await scanned("operator");
    expect(((await harness.behavior.callRpc("learn.trends", {})) as Trends).days).toBe(30);
  });

  it("is closed to Starter mode", async () => {
    const { harness } = await scanned("starter");
    await expect(harness.behavior.callRpc("learn.trends", { days: 30 })).rejects.toThrow(/Pro or Operator mode/);
    await expect(harness.behavior.callRpc("learn.suggestions", { days: 30 })).rejects.toThrow(/Pro or Operator mode/);
  });

  it("rejects a window other than 7, 30 or 90", async () => {
    const { harness } = await scanned("pro");
    await expect(harness.behavior.callRpc("learn.trends", { days: 14 })).rejects.toThrow();
  });

  it("bb otto learn prints the ledger and the lines, and --json carries both", async () => {
    const { harness } = await scanned("pro");
    const text = (await harness.behavior.runCli(["learn"])).stdout;
    expect(text).toContain("Otto learn: last 30 days, 3 cards");
    expect(text).toContain("OTTO001  3x in 3 threads");
    expect(text).toContain("Lines worth adding to your CLAUDE.md (Otto never writes the file):");
    const json = JSON.parse((await harness.behavior.runCli(["learn", "--days", "7", "--json"])).stdout) as Trends & Sugg;
    expect(json.days).toBe(7);
    expect(json.suggestions[0].ruleId).toBe("OTTO001");
  });

  it("bb otto learn refuses Starter mode and a bad window", async () => {
    const starter = await scanned("starter");
    const r = await starter.harness.behavior.runCli(["learn"]);
    expect(r.exitCode).not.toBe(0);
    expect(JSON.stringify(r)).toContain("Pro or Operator mode");
    const pro = await scanned("pro");
    expect((await pro.harness.behavior.runCli(["learn", "--days", "14"])).exitCode).not.toBe(0);
  });
});
