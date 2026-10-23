import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { tickOfRow } from "../../src/proof/lanes";
import { parseShortstat } from "../../src/server/bakeoff";
import { cmdRow, doneRow, msgRow, resetRows, startHost, type FakeRow } from "./helpers";

const SHORTSTAT = " 2 files changed, 10 insertions(+), 3 deletions(-)";

interface Created {
  bakeoffId: string;
}
interface Detail {
  bakeoff: { status: string; winnerContestantId: string | null };
  contestants: {
    id: string;
    providerId: string;
    threadId: string | null;
    status: string;
    verdict: string | null;
    filesChanged: number | null;
    insertions: number | null;
    deletions: number | null;
    error: string | null;
  }[];
}

const providers = [
  { id: "claude-code", displayName: "Claude Code", available: true },
  { id: "codex", displayName: "Codex", available: true },
  { id: "pi", displayName: "Pi", available: true },
  { id: "gemini", displayName: "Gemini", available: false },
];

function world(extra: { failProvider?: string; threadStatus?: Record<string, string> } = {}) {
  let n = 0;
  const events: Record<string, FakeRow[]> = {};
  const diffCalls: unknown[] = [];
  const spawnImpl = async (args: unknown) => {
    const a = args as { providerId: string };
    if (a.providerId === extra.failProvider) throw new Error("no worktree for you");
    n++;
    return makeThreadResponse({ id: `thr_${n}`, projectId: "proj_1", providerId: a.providerId, environmentId: null });
  };
  const areas = {
    providers: { list: async () => providers },
    projects: {
      list: async () => [{ id: "proj_1", name: "Demo" }],
      get: async () => ({
        id: "proj_1",
        name: "Demo",
        sources: [
          { id: "src_b", hostId: "host_other", isDefault: false },
          { id: "src_a", hostId: "host_1", isDefault: true },
        ],
      }),
    },
    environments: {
      get: async () => ({ mergeBaseBranch: "main", baseBranch: null, defaultBranch: "main" }),
      diff: async (args: unknown) => {
        diffCalls.push(args);
        return { outcome: "available", diff: { diff: "", files: "", mergeBaseRef: "abc", shortstat: SHORTSTAT, truncated: false } };
      },
    },
  };
  return { spawnImpl, areas, events, diffCalls, getThread: (id: string) => ({ status: extra.threadStatus?.[id] ?? "active", environmentId: id.replace("thr_", "env_") }) };
}

async function host(w = world(), settings: Record<string, unknown> = { mode: "operator" }) {
  return {
    w,
    ...(await startHost({
      rows: () => [],
      eventsByThread: w.events,
      settings,
      spawnImpl: w.spawnImpl,
      areas: w.areas,
      getThread: w.getThread,
    })),
  };
}

type H = Awaited<ReturnType<typeof host>>;
const call = (h: H, name: string, input: unknown) => h.harness.behavior.callRpc(name, input);
const create = async (h: H, providerIds = ["claude-code", "codex"], extra: Record<string, unknown> = {}) =>
  (await call(h, "bakeoff.create", {
    projectId: "proj_1",
    prompt: "Add HELLO.md",
    providerIds,
    taskTag: " Docs ",
    ...extra,
  })) as Created;
const get = async (h: H, bakeoffId: string) => (await call(h, "bakeoff.get", { bakeoffId })) as Detail;
const idle = (h: H, id: string) =>
  h.harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id }), lastAssistantText: null });

function finishWithCards(h: H) {
  h.w.events.thr_1 = [
    cmdRow("thr_1", "t1", "npm test", 0, "Tests 3 passed"),
    msgRow("thr_1", "t1", "All tests pass."),
    doneRow("thr_1", "t1"),
  ];
  h.w.events.thr_2 = [
    cmdRow("thr_2", "t1", "npm test 2>&1 | tail -3", 0, "Tests 3 passed"),
    msgRow("thr_2", "t1", "All tests pass."),
    doneRow("thr_2", "t1"),
  ];
}

describe("bake-off", () => {
  beforeEach(() => resetRows());

  it("every method rejects outside Operator mode", async () => {
    const h = await host(world(), { mode: "pro" });
    const calls: [string, unknown][] = [
      ["bakeoff.create", { projectId: "p", prompt: "x", providerIds: ["a", "b"], taskTag: "t" }],
      ["bakeoff.list", {}],
      ["bakeoff.get", { bakeoffId: "x" }],
      ["bakeoff.pickWinner", { bakeoffId: "x", contestantId: "y" }],
      ["bakeoff.archiveLosers", { bakeoffId: "x" }],
      ["bakeoff.lanes", { bakeoffId: "x" }],
      ["bakeoff.scoreboard", {}],
    ];
    for (const [name, input] of calls) {
      await expect(call(h, name, input), name).rejects.toThrow(
        "Bake-off needs Operator mode. Change Mode in Settings, Installed plugins, Otto.",
      );
    }
  });

  it("options is open to Pro mode, because the Learn tab uses it for names", async () => {
    const h = await host(world(), { mode: "pro" });
    expect(((await call(h, "bakeoff.options", null)) as { providers: unknown[] }).providers.length).toBeGreaterThan(0);
  });

  it("options lists projects and providers", async () => {
    const h = await host();
    const o = (await call(h, "bakeoff.options", null)) as { projects: unknown[]; providers: { id: string }[] };
    expect(o.projects).toEqual([{ id: "proj_1", name: "Demo" }]);
    expect(o.providers.map((p) => p.id)).toEqual(["claude-code", "codex", "pi", "gemini"]);
  });

  it("create validates 2 to 4 distinct available providers", async () => {
    const h = await host();
    await expect(create(h, ["codex"])).rejects.toThrow();
    await expect(create(h, ["codex", "codex"])).rejects.toThrow();
    await expect(create(h, ["a", "b", "c", "d", "e"])).rejects.toThrow();
    await expect(create(h, ["codex", "gemini"])).rejects.toThrow("Provider gemini is not available.");
    await expect(create(h, ["codex", "nope"])).rejects.toThrow("Provider nope is not available.");
    expect(h.spawned).toHaveLength(0);
  });

  it("spawns once per provider in a managed worktree with contestant metadata", async () => {
    const h = await host();
    const { bakeoffId } = await create(h, ["claude-code", "codex", "pi"], { baseBranch: "develop" });
    expect(bakeoffId).toMatch(/^bko_[a-z0-9]{10}$/);
    expect(h.spawned).toHaveLength(3);
    const first = h.spawned[0] as Record<string, unknown>;
    expect(first.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "develop" } },
    });
    expect(first.title).toBe("Bake-off docs: Claude Code");
    expect(first.prompt).toBe("Add HELLO.md");
    const { contestants } = await get(h, bakeoffId);
    expect(contestants.map((c) => c.providerId)).toEqual(["claude-code", "codex", "pi"]);
    expect(first.pluginMetadata).toMatchObject({ ottoRole: "contestant", bakeoffId, contestantId: contestants[0].id });
    expect(contestants.every((c) => c.status === "running" && /^thr_/.test(c.threadId ?? ""))).toBe(true);
  });

  it("uses the default branch when none is given", async () => {
    const h = await host();
    await create(h);
    expect((h.spawned[0] as { environment: unknown }).environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
  });

  it("refuses a project that has no workspace source, before anything is stored", async () => {
    const w = world();
    w.areas.projects.get = async () => ({ id: "proj_1", name: "Demo", sources: [] }) as never;
    const h = await host(w);
    await expect(create(h)).rejects.toThrow("This project has no workspace to start worktrees in.");
    expect(h.spawned).toHaveLength(0);
    expect(((await call(h, "bakeoff.list", {})) as { bakeoffs: unknown[] }).bakeoffs).toEqual([]);
  });

  it("one failing spawn marks only that contestant failed", async () => {
    const h = await host(world({ failProvider: "codex" }));
    const { bakeoffId } = await create(h);
    const { bakeoff, contestants } = await get(h, bakeoffId);
    expect(contestants.map((c) => c.status)).toEqual(["running", "failed"]);
    expect(contestants[1].error).toBe("no worktree for you");
    expect(contestants[0].error).toBeNull();
    expect(bakeoff.status).toBe("running");
  });

  it("all contestants idle sets ready, with verdict and diff stats", async () => {
    const h = await host();
    finishWithCards(h);
    const { bakeoffId } = await create(h);
    await idle(h, "thr_1");
    expect((await get(h, bakeoffId)).bakeoff.status).toBe("running");
    await idle(h, "thr_2");
    const { bakeoff, contestants } = await get(h, bakeoffId);
    expect(bakeoff.status).toBe("ready");
    expect(contestants.map((c) => c.status)).toEqual(["idle", "idle"]);
    expect(contestants.map((c) => c.verdict)).toEqual(["VERIFIED", "UNVERIFIED"]);
    expect(contestants[0]).toMatchObject({ filesChanged: 2, insertions: 10, deletions: 3 });
    expect(h.w.diffCalls[0]).toEqual({ environmentId: "env_1", target: "all", mergeBaseBranch: "main" });
    // The spawn response has no environment id yet; it is read from the thread once it settles.
    const rpcDetail = await get(h, bakeoffId);
    expect(rpcDetail.contestants.map((c) => (c as { environmentId?: string }).environmentId)).toEqual(["env_1", "env_2"]);
  });

  it("a failed contestant plus an idle one is ready", async () => {
    const h = await host(world({ failProvider: "codex" }));
    finishWithCards(h);
    const { bakeoffId } = await create(h);
    await idle(h, "thr_1");
    expect((await get(h, bakeoffId)).bakeoff.status).toBe("ready");
  });

  it("thread.active sets a contestant back to running and the bake-off with it", async () => {
    const h = await host();
    finishWithCards(h);
    const { bakeoffId } = await create(h);
    await idle(h, "thr_1");
    await idle(h, "thr_2");
    await h.harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "thr_2" }) });
    const { bakeoff, contestants } = await get(h, bakeoffId);
    expect(contestants.map((c) => c.status)).toEqual(["idle", "running"]);
    expect(bakeoff.status).toBe("running");
  });

  it("a thread that errors becomes a failed contestant", async () => {
    const h = await host();
    const { bakeoffId } = await create(h);
    await h.harness.behavior.emitThreadEvent("thread.failed", { thread: makeThreadResponse({ id: "thr_2" }), error: "boom" });
    const { contestants } = await get(h, bakeoffId);
    expect(contestants[1]).toMatchObject({ status: "failed", error: "boom" });
  });

  it("pickWinner needs a ready bake-off and a finished contestant, and only works once", async () => {
    const h = await host(world({ failProvider: "codex" }));
    finishWithCards(h);
    const { bakeoffId } = await create(h);
    const { contestants } = await get(h, bakeoffId);
    const [a, b] = contestants;
    await expect(call(h, "bakeoff.pickWinner", { bakeoffId, contestantId: a.id })).rejects.toThrow("Wait until");
    await idle(h, "thr_1");
    await expect(call(h, "bakeoff.pickWinner", { bakeoffId, contestantId: b.id })).rejects.toThrow("finished");
    await expect(call(h, "bakeoff.pickWinner", { bakeoffId, contestantId: "con_zzz" })).rejects.toThrow("finished");
    await call(h, "bakeoff.pickWinner", { bakeoffId, contestantId: a.id, note: "cleaner diff" });
    const after = await get(h, bakeoffId);
    expect(after.bakeoff).toMatchObject({ status: "decided", winnerContestantId: a.id });
    await expect(call(h, "bakeoff.pickWinner", { bakeoffId, contestantId: a.id })).rejects.toThrow("already has a winner");
  });

  async function decided(h: H, winnerIndex: number, taskTag: string, providerIds = ["claude-code", "codex"]) {
    const { bakeoffId } = await create(h, providerIds, { taskTag });
    const { contestants } = await get(h, bakeoffId);
    for (const c of contestants) await idle(h, c.threadId as string);
    await call(h, "bakeoff.pickWinner", { bakeoffId, contestantId: contestants[winnerIndex].id });
    return { bakeoffId, contestants };
  }

  it("scoreboard counts wins, runs, win rate and verified rate per provider and tag", async () => {
    const h = await host();
    finishWithCards(h); // thr_1 VERIFIED (claude-code) in the first bake-off; later threads have no cards
    await decided(h, 0, "docs"); // claude wins
    await decided(h, 0, "docs"); // claude wins
    await decided(h, 1, "bugs"); // codex wins
    const all = (await call(h, "bakeoff.scoreboard", {})) as { rows: { providerId: string; runs: number; wins: number; winRate: number; verifiedRate: number }[] };
    const claude = all.rows.find((r) => r.providerId === "claude-code");
    const codex = all.rows.find((r) => r.providerId === "codex");
    expect(claude).toMatchObject({ runs: 3, wins: 2 });
    expect(claude?.winRate).toBeCloseTo(2 / 3);
    expect(claude?.verifiedRate).toBeCloseTo(1 / 3); // only thr_1 has a VERIFIED card
    expect(codex).toMatchObject({ runs: 3, wins: 1 });
    expect(codex?.winRate).toBeCloseTo(1 / 3);
    expect(all.rows[0].providerId).toBe("claude-code");
    const docs = (await call(h, "bakeoff.scoreboard", { taskTag: "docs" })) as { rows: { providerId: string; runs: number; wins: number }[] };
    expect(docs.rows.find((r) => r.providerId === "claude-code")).toMatchObject({ runs: 2, wins: 2 });
    expect(docs.rows.find((r) => r.providerId === "codex")).toMatchObject({ runs: 2, wins: 0 });
  });

  it("scoreboard ignores bake-offs that are not decided", async () => {
    const h = await host();
    await create(h);
    expect(((await call(h, "bakeoff.scoreboard", {})) as { rows: unknown[] }).rows).toEqual([]);
  });

  it("list returns newest first with the winner provider", async () => {
    const h = await host();
    await decided(h, 1, "first");
    await new Promise((r) => setTimeout(r, 3));
    await decided(h, 0, "second");
    const l = (await call(h, "bakeoff.list", {})) as { bakeoffs: { taskTag: string; status: string; contestantCount: number; winnerProviderId: string | null }[] };
    expect(l.bakeoffs.map((b) => b.taskTag)).toEqual(["second", "first"]);
    expect(l.bakeoffs[0]).toMatchObject({ status: "decided", contestantCount: 2, winnerProviderId: "claude-code" });
    expect(l.bakeoffs[1].winnerProviderId).toBe("codex");
  });

  it("archiveLosers archives only the non-winners, and only once decided", async () => {
    const h = await host();
    const { bakeoffId } = await create(h, ["claude-code", "codex", "pi"]);
    await expect(call(h, "bakeoff.archiveLosers", { bakeoffId })).rejects.toThrow("Pick a winner first.");
    const { contestants } = await get(h, bakeoffId);
    for (const c of contestants) await idle(h, c.threadId as string);
    await call(h, "bakeoff.pickWinner", { bakeoffId, contestantId: contestants[1].id });
    const r = (await call(h, "bakeoff.archiveLosers", { bakeoffId })) as { archived: number };
    expect(r.archived).toBe(2);
    expect(h.released).toEqual(["archive:thr_1", "archive:thr_3"]);
  });

  it("lanes return one tick per finished command, sorted into cmd, check and failedCheck", async () => {
    const h = await host();
    const { bakeoffId } = await create(h);
    h.w.events.thr_1 = [
      cmdRow("thr_1", "t1", "ls", 0, "a"),
      cmdRow("thr_1", "t1", "npm test", 1, "Tests 1 failed"),
      cmdRow("thr_1", "t1", "npm test | tail -3", 0, "Tests 3 passed"),
      cmdRow("thr_1", "t1", "npm run build", 0, "ok"),
      msgRow("thr_1", "t1", "done"),
    ];
    const lanes = (await call(h, "bakeoff.lanes", { bakeoffId })) as {
      startedAt: number;
      lanes: { providerId: string; status: string; finishedAt: number | null; ticks: { t: number; kind: string }[] }[];
    };
    expect(lanes.lanes.map((l) => l.providerId)).toEqual(["claude-code", "codex"]);
    expect(lanes.lanes[0].ticks.map((t) => t.kind)).toEqual(["cmd", "failedCheck", "check", "check"]);
    expect(lanes.lanes[1].ticks).toEqual([]);
    expect(lanes.startedAt).toBeGreaterThan(0);
  });

  it("lanes keep only the last 400 ticks", async () => {
    const h = await host();
    const { bakeoffId } = await create(h);
    h.w.events.thr_1 = Array.from({ length: 450 }, () => cmdRow("thr_1", "t1", "ls", 0, ""));
    const lanes = (await call(h, "bakeoff.lanes", { bakeoffId })) as { lanes: { ticks: unknown[] }[] };
    expect(lanes.lanes[0].ticks).toHaveLength(400);
  });

  it("the sweep settles a contestant whose idle signal was missed", async () => {
    const h = await host(world({ threadStatus: { thr_1: "idle", thr_2: "idle" } }));
    finishWithCards(h);
    const { bakeoffId } = await create(h);
    expect((await get(h, bakeoffId)).bakeoff.status).toBe("running");
    await h.harness.behavior.runSchedule("bakeoff-sweep");
    const { bakeoff, contestants } = await get(h, bakeoffId);
    expect(bakeoff.status).toBe("ready");
    expect(contestants.map((c) => c.verdict)).toEqual(["VERIFIED", "UNVERIFIED"]);
  });

  it("a diff that is unavailable leaves the stats empty", async () => {
    const w = world();
    w.areas.environments.diff = async () => ({ outcome: "not_applicable", reason: "non_git_environment", message: "x" }) as never;
    const h = await host(w);
    finishWithCards(h);
    const { bakeoffId } = await create(h);
    await idle(h, "thr_1");
    const { contestants } = await get(h, bakeoffId);
    expect(contestants[0]).toMatchObject({ status: "idle", filesChanged: null, insertions: null, deletions: null });
  });

  it("the sweep fills in diff stats that were unavailable when the thread went idle", async () => {
    const w = world({ threadStatus: { thr_1: "idle", thr_2: "idle" } });
    let up = false;
    const original = w.areas.environments.diff;
    w.areas.environments.diff = (async (args: unknown) =>
      up ? original(args) : { outcome: "not_applicable", reason: "non_git_environment", message: "x" }) as never;
    const h = await host(w);
    finishWithCards(h);
    const { bakeoffId } = await create(h);
    await idle(h, "thr_1");
    await idle(h, "thr_2");
    expect((await get(h, bakeoffId)).contestants[0].filesChanged).toBeNull();
    up = true;
    await h.harness.behavior.runSchedule("bakeoff-sweep");
    expect((await get(h, bakeoffId)).contestants.map((c) => c.filesChanged)).toEqual([2, 2]);
  });

  it("threads that are not contestants fall through to the normal scan", async () => {
    const h = await host();
    await idle(h, "thr_other"); // must not throw
    expect(((await call(h, "bakeoff.list", {})) as { bakeoffs: unknown[] }).bakeoffs).toEqual([]);
  });
});

describe("parseShortstat", () => {
  it("reads files, insertions and deletions", () => {
    expect(parseShortstat(SHORTSTAT)).toEqual({ filesChanged: 2, insertions: 10, deletions: 3 });
    expect(parseShortstat(" 1 file changed, 1 insertion(+)")).toEqual({ filesChanged: 1, insertions: 1, deletions: 0 });
    expect(parseShortstat(" 4 files changed, 7 deletions(-)")).toEqual({ filesChanged: 4, insertions: 0, deletions: 7 });
    expect(parseShortstat("")).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });
});

describe("tickOfRow", () => {
  it("ignores non-command rows", () => {
    expect(tickOfRow(msgRow("t", "t1", "hi"))).toBeNull();
    expect(tickOfRow(doneRow("t", "t1"))).toBeNull();
  });
});
