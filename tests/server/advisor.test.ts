import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdvisorPrompt, parseAdvisorText } from "../../src/proof/advisor";
import { buildCard } from "../../src/proof/card";
import { cmdRow, doneRow, msgRow, resetRows, startHost, type FakeRow } from "./helpers";

const THREAD = "thr_1";
const CARD = `${THREAD}:t1`;
const GOOD = '{"sufficient": false, "confidence": "high", "missing": ["a real test run"], "suggestedCheck": "npm test", "reasoning": "The exit code belongs to tail."}';

function rows(): FakeRow[] {
  return [
    cmdRow(THREAD, "t1", "npm test 2>&1 | tail -3", 0, "Tests 3 passed"),
    msgRow(THREAD, "t1", "All tests pass."),
    doneRow(THREAD, "t1"),
  ];
}

const idle = (id: string, text: string | null = null) => ({ thread: makeThreadResponse({ id }), lastAssistantText: text });

async function operatorHost(extra: Parameters<typeof startHost>[0] extends infer O ? Partial<O> : never = {}) {
  const r = rows();
  const host = await startHost({ rows: () => r, settings: { mode: "operator" }, ...extra });
  await host.harness.behavior.emitThreadEvent("thread.idle", idle(THREAD)); // writes the card
  return host;
}

type Reviews = { reviews: { id: string; status: string; tainted: boolean; sufficient: boolean | null; rawText: string | null }[] };
const reviews = async (host: Awaited<ReturnType<typeof operatorHost>>): Promise<Reviews["reviews"]> =>
  ((await host.harness.behavior.callRpc("advisor.listForCard", { cardId: CARD })) as Reviews).reviews;

describe("advisor", () => {
  beforeEach(() => resetRows());
  afterEach(() => vi.useRealTimers());

  it("rejects both methods outside Operator mode", async () => {
    const r = rows();
    const { harness } = await startHost({ rows: () => r, settings: { mode: "pro" } });
    await expect(harness.behavior.callRpc("advisor.request", { cardId: CARD })).rejects.toThrow(/Operator mode/);
    await expect(harness.behavior.callRpc("advisor.listForCard", { cardId: CARD })).rejects.toThrow(/Operator mode/);
  });

  it("spawns one hidden thread that reuses the environment and has no parent", async () => {
    const host = await operatorHost();
    const { reviewId } = (await host.harness.behavior.callRpc("advisor.request", { cardId: CARD })) as { reviewId: string };
    expect(reviewId).toMatch(/^rev_[a-z0-9]{10}$/);
    expect(host.spawned).toHaveLength(1);
    const args = host.spawned[0] as Record<string, unknown>;
    expect(args.visibility).toBe("hidden");
    expect(args.environment).toEqual({ type: "reuse", environmentId: "env_1" });
    expect(args.parentThreadId).toBeUndefined();
    expect(args.pluginMetadata).toMatchObject({ ottoRole: "advisor", reviewId, cardId: CARD });
    expect(args.providerId).toBe("claude-code");
  });

  it("a second request for a running card returns the same review id", async () => {
    const host = await operatorHost();
    const a = (await host.harness.behavior.callRpc("advisor.request", { cardId: CARD })) as { reviewId: string };
    const b = (await host.harness.behavior.callRpc("advisor.request", { cardId: CARD })) as { reviewId: string };
    expect(b.reviewId).toBe(a.reviewId);
    expect(host.spawned).toHaveLength(1);
  });

  it("an unknown card is reported plainly", async () => {
    const host = await operatorHost();
    await expect(host.harness.behavior.callRpc("advisor.request", { cardId: "nope" })).rejects.toThrow("Card not found.");
  });

  it("finalizes a fenced json answer, then archives and stops the advisor thread", async () => {
    const host = await operatorHost();
    await host.harness.behavior.callRpc("advisor.request", { cardId: CARD });
    await host.harness.behavior.emitThreadEvent("thread.idle", idle("adv_1", `Looks masked.\n\`\`\`json\n${GOOD}\n\`\`\``));
    const [review] = await reviews(host);
    expect(review.status).toBe("done");
    expect(review.sufficient).toBe(false);
    expect(review.tainted).toBe(false);
    expect(host.released).toEqual(["archive:adv_1", "stop:adv_1"]);
  });

  it("finalizes an unfenced json object", async () => {
    const host = await operatorHost();
    await host.harness.behavior.callRpc("advisor.request", { cardId: CARD });
    await host.harness.behavior.emitThreadEvent("thread.idle", idle("adv_1", `My answer: ${GOOD}`));
    expect((await reviews(host))[0].status).toBe("done");
  });

  it("marks garbage as unparseable and keeps the raw text", async () => {
    const host = await operatorHost();
    await host.harness.behavior.callRpc("advisor.request", { cardId: CARD });
    await host.harness.behavior.emitThreadEvent("thread.idle", idle("adv_1", "I could not decide."));
    const [review] = await reviews(host);
    expect(review.status).toBe("unparseable");
    expect(review.rawText).toBe("I could not decide.");
    expect(host.released).toEqual(["archive:adv_1", "stop:adv_1"]);
  });

  it("marks the review tainted when the advisor thread changed a file", async () => {
    const fileRow: FakeRow = {
      id: "evx",
      threadId: "adv_1",
      seq: 1,
      createdAt: 1,
      type: "item/completed",
      scope: { kind: "turn", turnId: "a1" },
      data: { item: { type: "fileChange", id: "f1", changes: [{ path: "x.ts", kind: "update" }] } },
    };
    const host = await operatorHost({ eventsByThread: { adv_1: [fileRow] } });
    await host.harness.behavior.callRpc("advisor.request", { cardId: CARD });
    await host.harness.behavior.emitThreadEvent("thread.idle", idle("adv_1", GOOD));
    const [review] = await reviews(host);
    expect(review.status).toBe("done");
    expect(review.tainted).toBe(true);
  });

  it("a failed advisor thread is recorded and released", async () => {
    const host = await operatorHost();
    await host.harness.behavior.callRpc("advisor.request", { cardId: CARD });
    await host.harness.behavior.emitThreadEvent("thread.failed", { thread: makeThreadResponse({ id: "adv_1" }), error: "provider down" });
    const [review] = await reviews(host);
    expect(review.status).toBe("failed");
    expect(review.rawText).toBe("provider down");
    expect(host.released).toEqual(["archive:adv_1", "stop:adv_1"]);
  });

  it("a failing spawn marks the review failed", async () => {
    const host = await operatorHost({ spawnFails: true });
    await host.harness.behavior.callRpc("advisor.request", { cardId: CARD });
    const [review] = await reviews(host);
    expect(review.status).toBe("failed");
    expect(review.rawText).toBe("spawn exploded");
  });

  it("stops the thread even when archive throws", async () => {
    const host = await operatorHost({ archiveFails: true });
    await host.harness.behavior.callRpc("advisor.request", { cardId: CARD });
    await host.harness.behavior.emitThreadEvent("thread.idle", idle("adv_1", GOOD));
    expect(host.released).toEqual(["archive:adv_1", "stop:adv_1"]);
    expect((await reviews(host))[0].status).toBe("done");
  });

  it("the timeout schedule marks a stale review timed_out and releases the thread", async () => {
    const host = await operatorHost();
    await host.harness.behavior.callRpc("advisor.request", { cardId: CARD });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 21 * 60_000); // default timeout is 20 minutes
    await host.harness.behavior.runSchedule("advisor-timeouts");
    expect((await reviews(host))[0].status).toBe("timed_out");
    expect(host.released).toEqual(["archive:adv_1", "stop:adv_1"]);
  });

  it("an ordinary thread going idle is still scanned", async () => {
    const host = await operatorHost();
    const list = (await host.harness.behavior.callRpc("proof.listCards", { threadId: THREAD })) as { cards: unknown[] };
    expect(list.cards).toHaveLength(1);
  });
});

describe("advisor prompt and parsing", () => {
  const card = buildCard(
    {
      threadId: "thr_1",
      turnId: "t1",
      turnStatus: "completed",
      firstSeq: 1,
      lastSeq: 3,
      completedAt: 1,
      items: [
        { kind: "cmd", seq: 1, item: { id: "c1", command: "npm test | tail -3", status: "completed", exitCode: 0, aggregatedOutput: "Tests 3 passed" }, kinds: ["test"], findings: ["OTTO001"] },
        { kind: "msg", seq: 2, text: "Tests pass." },
      ],
    },
    { projectId: "p", providerId: null, threadTitle: null },
    2,
  );

  it("fills the template exactly where the spec says", () => {
    const prompt = buildAdvisorPrompt(card);
    expect(prompt).toContain("<<<CLAIM\nTests pass.\nCLAIM>>>");
    expect(prompt).toContain("Claims Otto found and their status: tests: untrustworthy");
    expect(prompt).toContain("Files changed in the turn: 0");
    expect(prompt).toContain("- command: npm test | tail -3\n  exit code: 0; status: completed; counts: 3 passed\n  findings: OTTO001 high");
    expect(prompt).toContain("Otto's verdict was UNVERIFIED. Decide independently.");
    expect(prompt.trimEnd().endsWith("```")).toBe(true);
  });

  it("takes the last fenced block", () => {
    expect(parseAdvisorText(`\`\`\`json\n{"x":1}\n\`\`\`\nthen\n\`\`\`json\n${GOOD}\n\`\`\``)?.confidence).toBe("high");
  });

  it("rejects an answer that fails validation", () => {
    expect(parseAdvisorText('{"sufficient": "yes"}')).toBeNull();
    expect(parseAdvisorText("no json here")).toBeNull();
  });
});
