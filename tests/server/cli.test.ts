import { beforeEach, describe, expect, it } from "vitest";
import { cmdRow, doneRow, msgRow, resetRows, startHost } from "./helpers";

describe("bb otto CLI", () => {
  beforeEach(() => resetRows());

  it("lint exits 2 and names OTTO001 for a piped check", async () => {
    const { harness } = await startHost({ rows: () => [] });
    const r = await harness.behavior.runCli(["lint", "npm test 2>&1 | tail -3"]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain("OTTO001");
  });

  it("lint exits 0 with OK for a clean command", async () => {
    const { harness } = await startHost({ rows: () => [] });
    const r = await harness.behavior.runCli(["lint", "npm test"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("OK: no findings");
  });

  it("lint exits 0 for a medium-only finding", async () => {
    const { harness } = await startHost({ rows: () => [] });
    const r = await harness.behavior.runCli(["lint", "npm test; echo done"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("OTTO003");
  });

  it("lint --json prints the findings", async () => {
    const { harness } = await startHost({ rows: () => [] });
    const r = await harness.behavior.runCli(["lint", "npm test | tail -3", "--json"]);
    const parsed = JSON.parse(r.stdout) as { findings: { ruleId: string }[] };
    expect(parsed.findings.map((f) => f.ruleId)).toContain("OTTO001");
  });

  it("rules lists all 13 rules", async () => {
    const { harness } = await startHost({ rows: () => [] });
    const r = await harness.behavior.runCli(["rules"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.split("\n").filter((l: string) => /^OTTO\d{3}\s/.test(l))).toHaveLength(13);
    const json = JSON.parse((await harness.behavior.runCli(["rules", "--json"])).stdout) as { rules: unknown[] };
    expect(json.rules).toHaveLength(13);
  });

  it("proof needs a thread id", async () => {
    const { harness } = await startHost({ rows: () => [] });
    const r = await harness.behavior.runCli(["proof"]);
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("a thread id is required");
  });

  it("proof scans the thread and prints its newest cards", async () => {
    const rows = [
      cmdRow("thr_1", "turn-aaaaaaaa-bbbbbbbb", "npm test 2>&1 | tail -3", 0, "Tests 3 passed"),
      msgRow("thr_1", "turn-aaaaaaaa-bbbbbbbb", "All tests pass."),
      doneRow("thr_1", "turn-aaaaaaaa-bbbbbbbb"),
    ];
    const { harness } = await startHost({ rows: () => rows });
    const r = await harness.behavior.runCli(["proof", "thr_1"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Otto proof for "Fix it" (thr_1)');
    expect(r.stdout).toMatch(/^UNVERIFIED {4}turn turn\.\.\.bbbb {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2} {2}claims: tests {2}findings: 1 \(1 high\)$/m);
    expect(r.stdout).toContain("! OTTO001 high");
  });

  it("proof --json drops output tails", async () => {
    const rows = [
      cmdRow("thr_1", "t1", "npm test", 0, "Tests 3 passed"),
      msgRow("thr_1", "t1", "Tests pass."),
      doneRow("thr_1", "t1"),
    ];
    const { harness } = await startHost({ rows: () => rows });
    const r = await harness.behavior.runCli(["proof", "thr_1", "--json"]);
    const parsed = JSON.parse(r.stdout) as { threadId: string; cards: { evidence: { outputTail: string }[] }[] };
    expect(parsed.threadId).toBe("thr_1");
    expect(parsed.cards[0].evidence[0].outputTail).toBe("");
  });

  it("scan resets and reports the cards written", async () => {
    const rows = [cmdRow("thr_1", "t1", "npm test", 0, "ok"), msgRow("thr_1", "t1", "Tests pass."), doneRow("thr_1", "t1")];
    const { harness } = await startHost({ rows: () => rows });
    const first = await harness.behavior.runCli(["scan", "thr_1"]);
    expect(first.stdout).toBe("Scanned 1 thread, wrote 1 cards.");
    const again = await harness.behavior.runCli(["scan", "thr_1"]);
    expect(again.stdout).toBe("Scanned 1 thread, wrote 1 cards.");
  });
});
