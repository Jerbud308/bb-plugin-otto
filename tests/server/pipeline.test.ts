import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { cmdRow, doneRow, msgRow, resetRows, startHost, type FakeRow } from "./helpers";

const providers = [
  { id: "claude-code", displayName: "Claude Code", available: true },
  { id: "codex", displayName: "Codex", available: true },
  { id: "gemini", displayName: "Gemini", available: false },
];
const stage = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  label: key[0].toUpperCase() + key.slice(1),
  providerId: "claude-code",
  prompt: `Do ${key}: {{input}}`,
  gate: "none",
  ...over,
});

interface RunDetail {
  run: { status: string; note: string | null; environmentId: string | null };
  stages: { idx: number; key: string; status: string; verdict: string | null; threadId: string | null; output: string | null; error: string | null }[];
}

function world(extra: { failSpawnAt?: number; status?: Record<string, string> } = {}) {
  let n = 0;
  const events: Record<string, FakeRow[]> = {};
  const status: Record<string, string> = { ...(extra.status ?? {}) };
  const spawnImpl = async (args: unknown) => {
    n++;
    if (extra.failSpawnAt === n) throw new Error("no room for another thread");
    const a = args as { providerId: string };
    return makeThreadResponse({ id: `thr_${n}`, projectId: "proj_1", providerId: a.providerId, environmentId: null });
  };
  const areas = {
    providers: { list: async () => providers },
    projects: {
      get: async () => ({ id: "proj_1", name: "Demo", sources: [{ id: "src_a", hostId: "host_1", isDefault: true }] }),
      list: async () => [{ id: "proj_1", name: "Demo" }],
    },
  };
  return { spawnImpl, areas, events, status, getThread: (id: string) => ({ status: status[id] ?? "active", environmentId: "env_1" }) };
}

async function host(w = world(), settings: Record<string, unknown> = { mode: "operator" }) {
  return { w, ...(await startHost({ rows: () => [], eventsByThread: w.events, settings, spawnImpl: w.spawnImpl, areas: w.areas, getThread: w.getThread })) };
}
type H = Awaited<ReturnType<typeof host>>;
const call = (h: H, name: string, input: unknown) => h.harness.behavior.callRpc(name, input);
const save = async (h: H, stages: unknown[], name = "Mine") => ((await call(h, "pipeline.save", { name, stages })) as { pipelineId: string }).pipelineId;
const start = async (h: H, pipelineId: string, input = "make a thing") =>
  ((await call(h, "pipeline.run", { pipelineId, projectId: "proj_1", input })) as { runId: string }).runId;
const detail = async (h: H, runId: string) => (await call(h, "pipeline.getRun", { runId })) as RunDetail;
const idle = (h: H, id: string, text: string | null = null) =>
  h.harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id }), lastAssistantText: text });
type Spawn = { environment: { type: string; environmentId?: string; hostId?: string; workspace?: { type: string } }; providerId: string; prompt: string; title: string; pluginMetadata: Record<string, string> };
const spawnArgs = (h: H) => h.spawned as Spawn[];

describe("pipeline definitions", () => {
  beforeEach(() => resetRows());

  it("saves, lists and deletes, and ships the built-in template", async () => {
    const h = await host();
    const id = await save(h, [stage("plan"), stage("build")]);
    const listed = (await call(h, "pipeline.list", null)) as { pipelines: { id: string; name: string; stages: unknown[] }[] };
    expect(listed.pipelines.map((p) => [p.id, p.name, p.stages.length])).toEqual([[id, "Mine", 2]]);
    await call(h, "pipeline.save", { id, name: "Renamed", stages: [stage("plan")] });
    expect(((await call(h, "pipeline.list", null)) as { pipelines: { name: string }[] }).pipelines[0].name).toBe("Renamed");
    await call(h, "pipeline.delete", { pipelineId: id });
    expect(((await call(h, "pipeline.list", null)) as { pipelines: unknown[] }).pipelines).toHaveLength(0);
    const t = (await call(h, "pipeline.templates", null)) as { templates: { name: string; stages: { key: string }[] }[] };
    expect(t.templates[0].name).toBe("Plan, build, review, ship-check");
    expect(t.templates[0].stages.map((s) => s.key)).toEqual(["plan", "build", "review", "ship_check"]);
  });

  it("refuses an invalid definition, an uninstalled agent, and a wrong id", async () => {
    const h = await host();
    await expect(call(h, "pipeline.save", { name: "", stages: [stage("a")] })).rejects.toThrow(/name/);
    await expect(call(h, "pipeline.save", { name: "X", stages: [stage("a"), stage("a")] })).rejects.toThrow(/already used/);
    await expect(call(h, "pipeline.save", { name: "X", stages: [stage("a", { providerId: "nope" })] })).rejects.toThrow(/not installed/);
    await expect(call(h, "pipeline.save", { id: "pip_x", name: "X", stages: [stage("a")] })).rejects.toThrow(/not found/);
  });

  it("is Operator only", async () => {
    const h = await host(world(), { mode: "pro" });
    for (const [name, input] of [["pipeline.list", null], ["pipeline.templates", null], ["pipeline.runs", {}]] as const) {
      await expect(call(h, name, input)).rejects.toThrow(/Operator mode/);
    }
  });
});

describe("pipeline runs", () => {
  beforeEach(() => resetRows());

  it("starts stage 1 in a new worktree on the project's default host, with the task in the prompt", async () => {
    const h = await host();
    const runId = await start(h, await save(h, [stage("plan"), stage("build")]), "add a login page");
    const s = spawnArgs(h);
    expect(s).toHaveLength(1);
    expect(s[0].environment).toMatchObject({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree" } });
    expect(s[0].prompt).toBe("Do plan: add a login page");
    expect(s[0].title).toBe("Mine: Plan");
    expect(s[0].pluginMetadata).toMatchObject({ ottoRole: "stage", runId });
    const d = await detail(h, runId);
    expect(d.run.status).toBe("running");
    expect(d.stages.map((x) => x.status)).toEqual(["running", "pending"]);
  });

  it("runs the stages in order in one worktree, passing each output forward, then finishes", async () => {
    const h = await host();
    const runId = await start(h, await save(h, [stage("plan"), stage("build", { prompt: "Build from {{stage.plan}} for {{input}}" }), stage("check")]), "T");
    await idle(h, "thr_1", "STEP LIST");
    let s = spawnArgs(h);
    expect(s).toHaveLength(2);
    expect(s[1].environment).toEqual({ type: "reuse", environmentId: "env_1" }); // env read from threads.get, spawn returned null
    expect(s[1].prompt).toBe("Build from STEP LIST for T");
    await idle(h, "thr_2", "BUILT");
    await idle(h, "thr_3", "CHECKED");
    s = spawnArgs(h);
    expect(s.map((x) => x.environment.type)).toEqual(["host", "reuse", "reuse"]);
    const d = await detail(h, runId);
    expect(d.run).toMatchObject({ status: "done", note: null, environmentId: "env_1" });
    expect(d.stages.map((x) => [x.status, x.output])).toEqual([["idle", "STEP LIST"], ["idle", "BUILT"], ["idle", "CHECKED"]]);
  });

  it("a repeated idle event does not start the next stage twice", async () => {
    const h = await host();
    await start(h, await save(h, [stage("a"), stage("b")]));
    await idle(h, "thr_1", "x");
    await idle(h, "thr_1", "x");
    expect(spawnArgs(h)).toHaveLength(2);
  });

  it("falls back to the thread output when the idle event carries no text", async () => {
    const h = await host();
    const runId = await start(h, await save(h, [stage("a")]));
    await idle(h, "thr_1", null);
    expect((await detail(h, runId)).stages[0].output).toBe("final text");
  });

  it("stores the Otto verdict of each stage", async () => {
    const h = await host();
    const runId = await start(h, await save(h, [stage("a"), stage("b")]));
    h.w.events.thr_1 = [cmdRow("thr_1", "t1", "npm test", 0, "Tests 3 passed"), msgRow("thr_1", "t1", "All tests pass."), doneRow("thr_1", "t1")];
    await idle(h, "thr_1", "ok");
    expect((await detail(h, runId)).stages[0].verdict).toBe("VERIFIED");
  });

  it("stop_on_contradicted ends the run before the next stage, skipping the rest", async () => {
    const h = await host();
    const runId = await start(h, await save(h, [stage("build", { gate: "stop_on_contradicted" }), stage("review"), stage("ship")]));
    h.w.events.thr_1 = [cmdRow("thr_1", "t1", "npm test", 1, "Tests 2 failed"), msgRow("thr_1", "t1", "All tests pass."), doneRow("thr_1", "t1")];
    await idle(h, "thr_1", "done");
    const d = await detail(h, runId);
    expect(d.run).toMatchObject({ status: "stopped", note: 'Stage "Build" was CONTRADICTED, so the pipeline stopped.' });
    expect(d.stages.map((x) => x.status)).toEqual(["idle", "skipped", "skipped"]);
    expect(spawnArgs(h)).toHaveLength(1);
  });

  it("require_not_unverified stops on a turn with no proof", async () => {
    const h = await host();
    const runId = await start(h, await save(h, [stage("build", { gate: "require_not_unverified" }), stage("review")]));
    h.w.events.thr_1 = [cmdRow("thr_1", "t1", "npm test 2>&1 | tail -3", 0, "Tests 3 passed"), msgRow("thr_1", "t1", "All tests pass."), doneRow("thr_1", "t1")];
    await idle(h, "thr_1", "done");
    const d = await detail(h, runId);
    expect(d.run.status).toBe("stopped");
    expect(d.run.note).toContain("UNVERIFIED");
  });

  it("a stage that cannot start fails the run with the reason", async () => {
    const h = await host(world({ failSpawnAt: 2 }));
    const runId = await start(h, await save(h, [stage("a"), stage("b"), stage("c")]));
    await idle(h, "thr_1", "x");
    const d = await detail(h, runId);
    expect(d.run).toMatchObject({ status: "failed", note: 'Stage "B" failed.' });
    expect(d.stages.map((x) => x.status)).toEqual(["idle", "failed", "skipped"]);
    expect(d.stages[1].error).toBe("no room for another thread");
  });

  it("a first stage that cannot start fails the run at once", async () => {
    const h = await host(world({ failSpawnAt: 1 }));
    const runId = await start(h, await save(h, [stage("a"), stage("b")]));
    expect((await detail(h, runId)).run.status).toBe("failed");
  });

  it("a failed thread fails the run", async () => {
    const h = await host();
    const runId = await start(h, await save(h, [stage("a"), stage("b")]));
    await h.harness.behavior.emitThreadEvent("thread.failed", { thread: makeThreadResponse({ id: "thr_1" }), error: "provider crashed" });
    const d = await detail(h, runId);
    expect(d.run.status).toBe("failed");
    expect(d.stages[0]).toMatchObject({ status: "failed", error: "provider crashed" });
  });

  it("stop stops the running thread and ends the run", async () => {
    const h = await host();
    const runId = await start(h, await save(h, [stage("a"), stage("b")]));
    await call(h, "pipeline.stop", { runId });
    expect(h.released).toContain("stop:thr_1");
    const d = await detail(h, runId);
    expect(d.run).toMatchObject({ status: "stopped", note: "Stopped by you." });
    expect(d.stages.map((x) => x.status)).toEqual(["failed", "skipped"]);
    await expect(call(h, "pipeline.stop", { runId })).rejects.toThrow(/already finished/);
    // a late idle event from the stopped thread changes nothing
    await idle(h, "thr_1", "late");
    expect(spawnArgs(h)).toHaveLength(1);
  });

  it("the sweep catches a stage whose idle event was missed", async () => {
    const w = world();
    const h = await host(w);
    const runId = await start(h, await save(h, [stage("a"), stage("b")]));
    w.status.thr_1 = "idle";
    await h.harness.behavior.runSchedule("pipeline-sweep");
    expect(spawnArgs(h)).toHaveLength(2);
    expect((await detail(h, runId)).stages.map((x) => x.status)).toEqual(["idle", "running"]);
    w.status.thr_2 = "error";
    await h.harness.behavior.runSchedule("pipeline-sweep");
    expect((await detail(h, runId)).run.status).toBe("failed");
  });

  it("lists runs newest first with stage summaries, and leaves non-stage threads alone", async () => {
    const h = await host();
    const id = await save(h, [stage("a"), stage("b")]);
    await start(h, id, "first");
    const second = await start(h, id, "second");
    const r = (await call(h, "pipeline.runs", {})) as { runs: { id: string; stages: { label: string; status: string }[] }[] };
    expect(r.runs[0].id).toBe(second);
    expect(r.runs[0].stages.map((x) => x.label)).toEqual(["A", "B"]);
    await idle(h, "thr_other", "x");
    expect(spawnArgs(h)).toHaveLength(2);
  });

  it("validates the task and the agent when starting", async () => {
    const h = await host();
    const id = await save(h, [stage("a")]);
    await expect(call(h, "pipeline.run", { pipelineId: id, projectId: "proj_1", input: "  " })).rejects.toThrow(/Describe the task/);
    await expect(call(h, "pipeline.run", { pipelineId: "pip_none", projectId: "proj_1", input: "x" })).rejects.toThrow(/not found/);
    const gid = await save(h, [stage("a", { providerId: "gemini" })], "G");
    await expect(call(h, "pipeline.run", { pipelineId: gid, projectId: "proj_1", input: "x" })).rejects.toThrow(/not available/);
  });
});
