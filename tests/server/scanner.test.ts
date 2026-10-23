import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cmdRow, doneRow, msgRow, resetRows, startHost, type FakeRow } from "./helpers";

const THREAD = "thr_1";

function oneTurn(): FakeRow[] {
  return [
    cmdRow(THREAD, "t1", "npm test 2>&1 | tail -3", 0, "Tests 3 passed"),
    msgRow(THREAD, "t1", "All tests pass."),
    doneRow(THREAD, "t1"),
  ];
}

// Each recorded call is its argument list; the first argument holds afterSeq.
// The budget meter also reads the newest event (order "desc"); only the scan's own paging calls count here.
const scanCalls = (harness: { inspection: { sdk: { callsTo(path: string): unknown[] } } }) =>
  harness.inspection.sdk.callsTo("threads.events.list").filter((c) => (c as { order?: string }[])[0].order !== "desc");
const afterSeqsOf = (harness: { inspection: { sdk: { callsTo(path: string): unknown[] } } }): (string | undefined)[] =>
  scanCalls(harness).map((c) => (c as { afterSeq?: string }[])[0].afterSeq);

const idle = (id: string) => ({ thread: makeThreadResponse({ id }), lastAssistantText: null });

describe("scanner", () => {
  beforeEach(() => resetRows());

  it("thread.idle writes one card, updates metadata, and publishes otto.cards", async () => {
    const rows = oneTurn();
    const { harness, updates } = await startHost({ rows: () => rows });
    await harness.behavior.emitThreadEvent("thread.idle", idle(THREAD));

    const list = (await harness.behavior.callRpc("proof.listCards", { threadId: THREAD })) as {
      cards: { id: string; verdict: string }[];
    };
    expect(list.cards).toHaveLength(1);
    expect(list.cards[0].id).toBe(`${THREAD}:t1`);
    expect(list.cards[0].verdict).toBe("UNVERIFIED");

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      threadId: THREAD,
      set: { verdict: "UNVERIFIED", cardId: `${THREAD}:t1` },
    });
    expect(harness.realtimeSignals.map((s: { channel: string }) => s.channel)).toContain("otto.cards");
  });

  it("scanning twice writes the same card once and resumes from the cursor", async () => {
    const rows = oneTurn();
    const { harness } = await startHost({ rows: () => rows });
    await harness.behavior.emitThreadEvent("thread.idle", idle(THREAD));
    await harness.behavior.emitThreadEvent("thread.idle", idle(THREAD));

    const list = (await harness.behavior.callRpc("proof.listCards", { threadId: THREAD })) as { cards: unknown[] };
    expect(list.cards).toHaveLength(1);

    const afterSeqs = afterSeqsOf(harness);
    const lastSeq = rows[rows.length - 1].seq;
    expect(afterSeqs[0]).toBe("0");
    expect(afterSeqs).toContain(String(lastSeq));
  });

  it("never writes a card for an advisor thread", async () => {
    const rows = oneTurn();
    const { harness } = await startHost({ rows: () => rows, metadata: { ottoRole: "advisor" } });
    await harness.behavior.emitThreadEvent("thread.idle", idle(THREAD));
    const list = (await harness.behavior.callRpc("proof.listCards", { threadId: THREAD })) as { cards: unknown[] };
    expect(list.cards).toHaveLength(0);
  });

  it("keeps paging until an empty page, even after a short page of 100", async () => {
    const rows: FakeRow[] = [];
    for (let i = 0; i < 250; i++) rows.push(cmdRow(THREAD, "t1", "ls", 0, "a"));
    rows.push(msgRow(THREAD, "t1", "Here is the summary."));
    rows.push(doneRow(THREAD, "t1"));
    const { harness } = await startHost({ rows: () => rows, clamp: 100 });
    await harness.behavior.emitThreadEvent("thread.idle", idle(THREAD));

    expect(afterSeqsOf(harness)).toEqual(["0", "100", "200", "252"]);
    const list = (await harness.behavior.callRpc("proof.listCards", { threadId: THREAD })) as { cards: unknown[] };
    expect(list.cards).toHaveLength(1);
  });

  it("stops after 50 pages", async () => {
    let seq = 0;
    const endless = async (): Promise<FakeRow[]> => {
      seq++;
      return [{ ...cmdRow(THREAD, "t1", "ls", 0, "a"), seq }];
    };
    const { harness } = await startHost({ rows: () => [] });
    // Replace the stub: every page returns one fresh row, forever.
    harness.inspection.sdk.stub("threads.events.list", endless);
    await harness.behavior.emitThreadEvent("thread.idle", idle(THREAD));
    expect(scanCalls(harness)).toHaveLength(50);
  });

  it("proof.listCards filters by thread and verdict and paginates with nextBefore", async () => {
    const rows: FakeRow[] = [
      cmdRow("thr_a", "t1", "npm test", 0, "Tests 3 passed"),
      msgRow("thr_a", "t1", "Tests pass."),
      doneRow("thr_a", "t1"),
      cmdRow("thr_a", "t2", "npm test | tail -3", 0, "Tests 3 passed"),
      msgRow("thr_a", "t2", "Tests pass."),
      doneRow("thr_a", "t2"),
      cmdRow("thr_b", "t3", "ls", 0, "a"),
      msgRow("thr_b", "t3", "Here is the summary."),
      doneRow("thr_b", "t3"),
    ].map((r, i) => ({ ...r, threadId: r.scope.turnId === "t3" ? "thr_b" : "thr_a", seq: i + 1 }));
    const { harness } = await startHost({ rows: () => rows });
    await harness.behavior.emitThreadEvent("thread.idle", idle("thr_a"));
    await harness.behavior.emitThreadEvent("thread.idle", idle("thr_b"));

    type List = { cards: { id: string; verdict: string; createdAt: number }[]; nextBefore: number | null };
    const all = (await harness.behavior.callRpc("proof.listCards", {})) as List;
    expect(all.cards).toHaveLength(3);

    const onlyA = (await harness.behavior.callRpc("proof.listCards", { threadId: "thr_a" })) as List;
    expect(onlyA.cards.map((c) => c.id).sort()).toEqual(["thr_a:t1", "thr_a:t2"]);

    const verified = (await harness.behavior.callRpc("proof.listCards", { verdict: "VERIFIED" })) as List;
    expect(verified.cards.map((c) => c.id)).toEqual(["thr_a:t1"]);

    const first = (await harness.behavior.callRpc("proof.listCards", { limit: 2 })) as List;
    expect(first.cards).toHaveLength(2);
    expect(first.nextBefore).toBe(first.cards[1].createdAt);
    const second = (await harness.behavior.callRpc("proof.listCards", { limit: 2, before: first.nextBefore })) as List;
    expect(second.cards).toHaveLength(1);
    expect(second.nextBefore).toBeNull();
  });
});

describe("reconcile service", () => {
  beforeEach(() => resetRows());

  it("scans recent threads after 5 seconds, then stays alive until aborted", async () => {
    vi.useFakeTimers();
    try {
      const rows = oneTurn();
      const { harness } = await startHost({
        rows: () => rows,
        threads: [
          { id: THREAD, updatedAt: Date.now(), archivedAt: null },
          { id: "thr_old", updatedAt: Date.now() - 10 * 24 * 3_600_000, archivedAt: null },
        ],
      });
      const svc = harness.behavior.runService("reconcile");
      let settled = false;
      void svc.done.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(1_000);
      const list = (await harness.behavior.callRpc("proof.listCards", {})) as { cards: { threadId: string }[] };
      expect(list.cards.map((c) => c.threadId)).toEqual([THREAD]);
      expect(settled).toBe(false);
      svc.controller.abort();
      await svc.done;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("stale rescan and custom rules", () => {
  beforeEach(() => resetRows());

  it("the startup service rebuilds only threads whose cards carry an older ruleset version", async () => {
    vi.useFakeTimers();
    try {
      const r = oneTurn();
      const { harness, bb } = await startHost({ rows: () => r });
      await harness.behavior.emitThreadEvent("thread.idle", idle(THREAD));
      const db = bb.storage.database();
      db.prepare("UPDATE cards SET ruleset_version = 1, verdict = 'VERIFIED'").run();
      const svc = harness.behavior.runService("reconcile");
      await vi.advanceTimersByTimeAsync(6_000);
      const list = (await harness.behavior.callRpc("proof.listCards", {})) as { cards: { verdict: string }[] };
      expect(list.cards.map((c) => c.verdict)).toEqual(["UNVERIFIED"]);
      svc.controller.abort();
      await svc.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("a custom rule from settings adds an info finding on the next scan", async () => {
    const rule = { id: "USER1", title: "Tail", pattern: "tail -3", message: "uses tail", fixHint: "" };
    const r = oneTurn();
    const { harness } = await startHost({ rows: () => r, settings: { customRulesJson: JSON.stringify([rule]) } });
    await harness.behavior.emitThreadEvent("thread.idle", idle(THREAD));
    const card = (await harness.behavior.callRpc("proof.getCard", { cardId: `${THREAD}:t1` })) as { card: { findings: { ruleId: string }[] } };
    expect(card.card.findings.map((f) => f.ruleId)).toContain("USER1");
  });
});
