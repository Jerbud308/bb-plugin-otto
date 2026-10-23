import { makeMessageDispatchHookContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { resetRows, startHost, type FakeRow } from "./helpers";

const usageRow = (threadId: string, total: number): FakeRow => ({
  id: "u1",
  threadId,
  seq: 1,
  createdAt: 1_700_000_000_000,
  type: "thread/tokenUsage/updated",
  scope: { kind: "turn", turnId: "t1" },
  data: {
    tokenUsage: {
      last: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 2 },
      modelContextWindow: null,
      total: { inputTokens: total - 100, cachedInputTokens: 10, outputTokens: 100, reasoningOutputTokens: 0, totalTokens: total },
    },
  },
});

const limits = (percent: number, resetsAt: string | null = null) => ({
  "claude-code": { status: "ok", accountEmail: null, planLabel: "Max", windows: [{ label: "5h", usedPercent: percent, resetsAt }] },
  codex: { status: "not_installed" },
});

async function host(opts: { settings?: Record<string, unknown>; percent?: number; resetsAt?: string | null } = {}) {
  const events: Record<string, FakeRow[]> = { thr_1: [usageRow("thr_1", 1000)], thr_2: [usageRow("thr_2", 500)] };
  const h = await startHost({
    rows: () => [],
    eventsByThread: events,
    settings: { mode: "operator", ...opts.settings },
    areas: { system: { usageLimits: async () => limits(opts.percent ?? 10, opts.resetsAt ?? null) } },
  });
  return { ...h, events };
}
type H = Awaited<ReturnType<typeof host>>;
const idle = (h: H, id: string, projectId = "proj_1") =>
  h.harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id, projectId, providerId: "claude-code" }), lastAssistantText: null });
const summary = async (h: H) => (await h.harness.behavior.callRpc("budget.summary", null)) as {
  projects: { projectId: string; totalTokens: number; threads: number }[];
  providers: { providerId: string; planLabel: string | null; windows: { label: string; usedPercent: number }[] }[];
  usageCheckedAt: number | null;
  guard: { mode: string };
};
const hookOf = (h: H) => (h.harness.inspection.registrations as unknown as { hooks: Record<string, (ctx: unknown) => unknown> }).hooks["message.dispatch"];
const ctxOf = (over: Record<string, unknown> = {}) =>
  makeMessageDispatchHookContext({ thread: { id: "thr_x", projectId: "proj_1" }, requestedExecution: { providerId: "claude-code" }, ...over } as never);

describe("budget meter", () => {
  beforeEach(() => resetRows());

  it("is Operator only", async () => {
    const h = await startHost({ rows: () => [], settings: { mode: "pro" } });
    await expect(h.harness.behavior.callRpc("budget.summary", null)).rejects.toThrow(/Operator mode/);
    await expect(h.harness.behavior.callRpc("budget.events", {})).rejects.toThrow(/Operator mode/);
  });

  it("sums the latest token total of each thread per project", async () => {
    const h = await host();
    await idle(h, "thr_1");
    await idle(h, "thr_2");
    await idle(h, "thr_3", "proj_2"); // no usage row: stored as zero
    const s = await summary(h);
    expect(s.projects).toEqual([
      { projectId: "proj_1", totalTokens: 1500, threads: 2 },
      { projectId: "proj_2", totalTokens: 0, threads: 1 },
    ]);
  });

  it("re-reading a thread replaces its total instead of adding to it", async () => {
    const h = await host();
    await idle(h, "thr_1");
    h.events.thr_1 = [usageRow("thr_1", 4000)];
    await idle(h, "thr_1");
    expect((await summary(h)).projects).toEqual([{ projectId: "proj_1", totalTokens: 4000, threads: 1 }]);
  });

  it("shows plan windows of installed providers after the refresh", async () => {
    const h = await host({ percent: 42 });
    await h.harness.behavior.runSchedule("budget-refresh");
    const s = await summary(h);
    expect(s.providers).toEqual([{ providerId: "claude-code", planLabel: "Max", windows: [{ label: "5h", usedPercent: 42, resetsAt: null }] }]);
    expect(s.usageCheckedAt).not.toBeNull();
  });

  it("the schedule backfills threads that have cards but no usage row", async () => {
    const h = await host();
    h.harness.behavior.emitThreadEvent; // no-op reference to keep the harness alive
    const db = h.bb.storage.database();
    db.prepare(
      `INSERT INTO cards (id, thread_id, project_id, thread_title, turn_id, provider_id, turn_status, verdict, claim_text, claims_json, evidence_json, findings_json, high_findings, edited_files, first_seq, last_seq, ruleset_version, created_at, updated_at)
       VALUES ('thr_1:t1','thr_1','proj_1',NULL,'t1','claude-code','completed','NO_CLAIM','','[]','[]','[]',0,0,1,2,2,1,1)`,
    ).run();
    await h.harness.behavior.runSchedule("budget-refresh");
    expect((await summary(h)).projects).toEqual([{ projectId: "proj_1", totalTokens: 1000, threads: 1 }]);
  });
});

describe("guard hook", () => {
  beforeEach(() => resetRows());
  const configured = (mode: string, extra: Record<string, unknown> = {}) => ({ guardMode: mode, ...extra });

  it("registers the message.dispatch hook and proceeds when off", async () => {
    const h = await host({ percent: 99 });
    await h.harness.behavior.runSchedule("budget-refresh");
    expect(await hookOf(h)(ctxOf())).toEqual({ action: "proceed" });
  });

  it("rejects when the provider's plan window is over the limit", async () => {
    const h = await host({ settings: configured("reject"), percent: 99 });
    await h.harness.behavior.runSchedule("budget-refresh");
    const d = (await hookOf(h)(ctxOf())) as { action: string; message: string };
    expect(d.action).toBe("reject");
    expect(d.message).toContain('plan window "5h" is at 99%');
    const events = (await h.harness.behavior.callRpc("budget.events", {})) as { events: { action: string; threadId: string }[] };
    expect(events.events.map((e) => [e.action, e.threadId])).toEqual([["reject", "thr_x"]]);
  });

  it("does not record the same thread and action twice within a minute", async () => {
    const h = await host({ settings: configured("reject"), percent: 99 });
    await h.harness.behavior.runSchedule("budget-refresh");
    await hookOf(h)(ctxOf());
    await hookOf(h)(ctxOf());
    const events = (await h.harness.behavior.callRpc("budget.events", {})) as { events: unknown[] };
    expect(events.events).toHaveLength(1);
  });

  it("warn lets the message through and records it", async () => {
    const h = await host({ settings: configured("warn"), percent: 99 });
    await h.harness.behavior.runSchedule("budget-refresh");
    expect(await hookOf(h)(ctxOf())).toEqual({ action: "proceed" });
    const events = (await h.harness.behavior.callRpc("budget.events", {})) as { events: { action: string }[] };
    expect(events.events.map((e) => e.action)).toEqual(["warn"]);
  });

  it("wait holds the message until the window resets, then a refresh asks core to re-check", async () => {
    const resets = new Date(Date.now() + 3_600_000).toISOString();
    const h = await host({ settings: configured("wait"), percent: 99, resetsAt: resets });
    await h.harness.behavior.runSchedule("budget-refresh");
    const d = (await hookOf(h)(ctxOf())) as { action: string; sendAt: number; reason: string };
    expect(d.action).toBe("wait");
    expect(d.sendAt).toBe(Date.parse(resets));
    expect(d.reason).toContain("Otto guard");
    expect(h.harness.inspection.recheckCount).toBe(0); // the first refresh ran before any wait existed
    await h.harness.behavior.runSchedule("budget-refresh");
    expect(h.harness.inspection.recheckCount).toBe(1);
    await h.harness.behavior.runSchedule("budget-refresh");
    expect(h.harness.inspection.recheckCount).toBe(1); // nothing is waiting any more
  });

  it("a project token cap blocks only that project's start-turn attempts", async () => {
    const h = await host({ settings: configured("reject", { guardProjectTokenCap: 1200, guardProjectIds: "proj_1" }) });
    await idle(h, "thr_1");
    await idle(h, "thr_2"); // proj_1 total 1500
    expect(((await hookOf(h)(ctxOf())) as { action: string }).action).toBe("reject");
    expect(((await hookOf(h)(ctxOf({ attempt: "join-turn" }))) as { action: string }).action).toBe("proceed");
    expect(((await hookOf(h)(ctxOf({ thread: { id: "thr_y", projectId: "proj_2" } }))) as { action: string }).action).toBe("proceed");
  });

  it("answers proceed when anything inside the handler throws", async () => {
    const h = await host({ settings: configured("reject"), percent: 99 });
    await h.harness.behavior.runSchedule("budget-refresh");
    const bad = { ...ctxOf(), requestedExecution: undefined };
    expect(await hookOf(h)(bad)).toEqual({ action: "proceed" });
  });

  it("changing the setting takes effect without a reload", async () => {
    const h = await host({ settings: configured("off"), percent: 99 });
    await h.harness.behavior.runSchedule("budget-refresh");
    expect(((await hookOf(h)(ctxOf())) as { action: string }).action).toBe("proceed");
    await h.harness.behavior.setSettings?.({ guardMode: "reject" });
    expect(((await hookOf(h)(ctxOf())) as { action: string }).action).toBe("reject");
  });
});
