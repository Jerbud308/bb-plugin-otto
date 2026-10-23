// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { followSelection, moveStage } from "../../ui/pipelineModel";
import { tabOf } from "../../ui/OttoPage";

afterEach(cleanup);

const T0 = 1_700_000_000_000;
const options = {
  providers: [
    { id: "claude-code", displayName: "Claude Code", available: true },
    { id: "codex", displayName: "Codex", available: true },
    { id: "gemini", displayName: "Gemini", available: false },
  ],
  projects: [{ id: "proj_1", name: "Demo" }],
};
const stage = (key: string, over: Record<string, unknown> = {}) => ({ key, label: key[0].toUpperCase() + key.slice(1), providerId: "claude-code", prompt: `Do ${key}`, gate: "none", ...over });
const saved = [{ id: "pip_1", name: "Mine", stages: [stage("plan"), stage("build"), stage("review")], createdAt: T0, updatedAt: T0 }];
const templates = [{ id: "plan-build-review-ship", name: "Plan, build, review, ship-check", description: "Four stages.", stages: [stage("plan"), stage("build")].map(({ providerId: _p, ...s }) => s) }];

async function page(subPath: string, rpc: Record<string, (input: never) => unknown>, mode = "operator") {
  const app = await loadPluginApp(() => import("../../app"));
  return renderSlot(
    app.navPanels[0],
    { subPath },
    { rpc: { "bakeoff.options": () => options, "pipeline.list": () => ({ pipelines: saved }), "pipeline.templates": () => ({ templates }), ...rpc } as never, settings: { mode } },
  );
}
const stageLabels = (slot: Awaited<ReturnType<typeof page>>) =>
  Array.from(slot.container.querySelectorAll(".otto-stagebox__main")).map((b) => b.querySelectorAll("span")[1].textContent);

describe("pipeline model", () => {
  it("moves a stage and keeps the selection on its box", () => {
    expect(moveStage(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveStage(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveStage(["a", "b"], 0, 0)).toEqual(["a", "b"]);
    expect(moveStage(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(followSelection(0, 0, 2)).toBe(2);
    expect(followSelection(1, 0, 2)).toBe(0);
    expect(followSelection(1, 2, 0)).toBe(2);
    expect(followSelection(3, 0, 2)).toBe(3);
  });
  it("routes every pipelines sub path to the tab", () => {
    for (const p of ["pipelines", "pipelines/new", "pipelines/edit/pip_1", "pipelines/run/run_1"]) expect(tabOf(p)).toBe("pipelines");
  });
});

describe("Pipelines tab", () => {
  it("is closed outside Operator mode", async () => {
    const slot = await page("pipelines", {}, "pro");
    expect(await slot.findByText(/Pipelines needs Operator mode/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("lists pipelines, templates and recent runs, and opens each", async () => {
    const slot = await page("pipelines", {
      "pipeline.runs": () => ({
        runs: [{ id: "run_1", pipelineId: "pip_1", pipelineName: "Mine", projectId: "proj_1", input: "x", baseBranch: null, status: "stopped", environmentId: null, note: null, createdAt: T0, finishedAt: null, stages: [{ idx: 0, label: "Plan", status: "idle", verdict: "VERIFIED" }, { idx: 1, label: "Build", status: "skipped", verdict: null }] }],
      }),
    });
    expect(await slot.findByText("Plan → Build → Review")).toBeTruthy();
    expect(slot.getByText("Plan, build, review, ship-check")).toBeTruthy();
    expect(slot.getByText("Stopped")).toBeTruthy();
    expect(slot.container.querySelectorAll(".otto-stamp")).toHaveLength(1);
    fireEvent.click(slot.getByText("Edit"));
    expect(slot.navigateCalls.at(-1)).toEqual({ method: "toPluginPanel", path: "otto", options: { subPath: "pipelines/edit/pip_1" } });
    fireEvent.click(slot.getByText("Use template"));
    expect(slot.navigateCalls.at(-1)).toEqual({ method: "toPluginPanel", path: "otto", options: { subPath: "pipelines/new/plan-build-review-ship" } });
    fireEvent.click(slot.container.querySelector('section[aria-label="Recent runs"] button.otto-row__head') as HTMLElement);
    expect(slot.navigateCalls.at(-1)).toEqual({ method: "toPluginPanel", path: "otto", options: { subPath: "pipelines/run/run_1" } });
    slot.lifecycle.unmount();
  });

  it("starts a run from the form and opens the run", async () => {
    const slot = await page("pipelines", { "pipeline.runs": () => ({ runs: [] }), "pipeline.run": () => ({ runId: "run_9" }) });
    fireEvent.click(await slot.findByText("Run"));
    const start = (await slot.findByText("Start run")) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(slot.getByLabelText("Task"), { target: { value: "add a login page" } });
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await new Promise((r) => setTimeout(r, 20));
    expect(slot.rpcCalls.find((c) => c.method === "pipeline.run")?.input).toEqual({ pipelineId: "pip_1", projectId: "proj_1", input: "add a login page" });
    expect(slot.navigateCalls.at(-1)).toEqual({ method: "toPluginPanel", path: "otto", options: { subPath: "pipelines/run/run_9" } });
    slot.lifecycle.unmount();
  });

  it("deletes only after a second click", async () => {
    const slot = await page("pipelines", { "pipeline.runs": () => ({ runs: [] }), "pipeline.delete": () => ({ ok: true }) });
    fireEvent.click(await slot.findByText("Delete"));
    expect(slot.rpcCalls.some((c) => c.method === "pipeline.delete")).toBe(false);
    fireEvent.click(slot.getByText("Confirm delete"));
    await new Promise((r) => setTimeout(r, 20));
    expect(slot.rpcCalls.find((c) => c.method === "pipeline.delete")?.input).toEqual({ pipelineId: "pip_1" });
    slot.lifecycle.unmount();
  });

  it("the builder starts from a template with the first available agent", async () => {
    const slot = await page("pipelines/new/plan-build-review-ship", {});
    await slot.findByText("Stages, in order");
    expect(stageLabels(slot)).toEqual(["Plan", "Build"]);
    expect((slot.getByLabelText("Pipeline name") as HTMLInputElement).value).toBe("Plan, build, review, ship-check");
    expect((slot.getByLabelText("Agent") as HTMLSelectElement).value).toBe("claude-code");
    slot.lifecycle.unmount();
  });

  it("drag and drop reorders the stages, and the buttons do the same", async () => {
    const slot = await page("pipelines/edit/pip_1", {});
    await slot.findByText("Stages, in order");
    expect(stageLabels(slot)).toEqual(["Plan", "Build", "Review"]);
    const boxes = Array.from(slot.container.querySelectorAll("li.otto-stagebox"));
    const data = { setData: () => undefined, effectAllowed: "" };
    fireEvent.dragStart(boxes[0], { dataTransfer: data });
    fireEvent.dragOver(boxes[2], { dataTransfer: data });
    fireEvent.drop(boxes[2], { dataTransfer: data });
    expect(stageLabels(slot)).toEqual(["Build", "Review", "Plan"]);
    expect((slot.getByLabelText("Label") as HTMLInputElement).value).toBe("Plan"); // selection followed the dragged box
    fireEvent.click(slot.getByText("Move earlier"));
    expect(stageLabels(slot)).toEqual(["Build", "Plan", "Review"]);
    expect((slot.getByText("Move earlier") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(slot.getByText("Move later"));
    expect(stageLabels(slot)).toEqual(["Build", "Review", "Plan"]);
    slot.lifecycle.unmount();
  });

  it("adds and removes stages, edits fields, and saves the new order", async () => {
    const slot = await page("pipelines/edit/pip_1", { "pipeline.save": () => ({ pipelineId: "pip_1" }) });
    await slot.findByText("Stages, in order");
    fireEvent.click(slot.getByText("Codex", { selector: "button" }));
    expect(stageLabels(slot)).toEqual(["Plan", "Build", "Review", "Codex"]);
    expect(slot.queryByText("Gemini", { selector: "button" })).toBeNull(); // unavailable agents are not offered
    fireEvent.change(slot.getByLabelText("Prompt"), { target: { value: "Ship {{stage.review}}" } });
    fireEvent.change(slot.getByLabelText("After this stage"), { target: { value: "require_not_unverified" } });
    fireEvent.click(slot.getAllByRole("button", { name: /Plan/ })[0]);
    fireEvent.click(slot.getByText("Remove stage"));
    expect(stageLabels(slot)).toEqual(["Build", "Review", "Codex"]);
    fireEvent.click(slot.getByText("Save"));
    await new Promise((r) => setTimeout(r, 20));
    const sent = slot.rpcCalls.find((c) => c.method === "pipeline.save")?.input as { id: string; name: string; stages: { key: string; gate: string; prompt: string; providerId: string }[] };
    expect(sent.id).toBe("pip_1");
    expect(sent.stages.map((s) => s.key)).toEqual(["build", "review", "codex"]);
    expect(sent.stages[2]).toMatchObject({ gate: "require_not_unverified", prompt: "Ship {{stage.review}}", providerId: "codex" });
    expect(slot.navigateCalls.at(-1)).toEqual({ method: "toPluginPanel", path: "otto", options: { subPath: "pipelines" } });
    slot.lifecycle.unmount();
  });

  it("Save stays off until the definition is valid, and says why", async () => {
    const slot = await page("pipelines/new", {});
    await slot.findByText("Stages, in order");
    expect((slot.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(slot.getByText("Claude Code", { selector: "button" }));
    fireEvent.change(slot.getByLabelText("Pipeline name"), { target: { value: "New one" } });
    expect((slot.getByText("Save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(slot.getByLabelText("Prompt"), { target: { value: "   " } });
    expect((slot.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    expect(slot.getByText(/the prompt must be 1 to 8000 characters/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  const runDetail = (status: string, over: Record<string, unknown> = {}) => ({
    "pipeline.getRun": () => ({
      run: { id: "run_1", pipelineId: "pip_1", pipelineName: "Mine", projectId: "proj_1", input: "add a login page", baseBranch: null, status, environmentId: "env_1", note: status === "stopped" ? 'Stage "Build" was CONTRADICTED, so the pipeline stopped.' : null, createdAt: T0, finishedAt: null, ...over },
      stages: [
        { id: "s1", runId: "run_1", idx: 0, key: "plan", label: "Plan", providerId: "claude-code", threadId: "thr_1", status: "idle", verdict: "VERIFIED", output: "1. do it", startedAt: T0, finishedAt: T0 + 65_000, error: null },
        { id: "s2", runId: "run_1", idx: 1, key: "build", label: "Build", providerId: "codex", threadId: "thr_2", status: status === "running" ? "running" : "idle", verdict: status === "running" ? null : "CONTRADICTED", output: null, startedAt: T0 + 66_000, finishedAt: null, error: null },
        { id: "s3", runId: "run_1", idx: 2, key: "review", label: "Review", providerId: "claude-code", threadId: null, status: "skipped", verdict: null, output: null, startedAt: null, finishedAt: null, error: null },
      ],
    }),
  });

  it("a running run shows lanes, stamps, durations, and can be stopped", async () => {
    const slot = await page("pipelines/run/run_1", { ...runDetail("running"), "pipeline.stop": () => ({ ok: true }) });
    expect(await slot.findByText("add a login page")).toBeTruthy();
    expect(slot.getByText("1:05")).toBeTruthy();
    expect(Array.from(slot.container.querySelectorAll(".otto-stamp")).map((s) => (s as HTMLElement).dataset.verdict)).toEqual(["VERIFIED"]);
    expect(slot.getByText("Running", { selector: ".otto-meta" })).toBeTruthy();
    expect(slot.getByText("Skipped")).toBeTruthy();
    expect(slot.container.querySelector("details pre")?.textContent).toBe("1. do it");
    fireEvent.click(slot.getAllByText("Open thread")[1]);
    expect(slot.navigateCalls.at(-1)).toMatchObject({ method: "toThread" });
    fireEvent.click(slot.getByText("Stop run"));
    await new Promise((r) => setTimeout(r, 20));
    expect(slot.rpcCalls.find((c) => c.method === "pipeline.stop")?.input).toEqual({ runId: "run_1" });
    slot.lifecycle.unmount();
  });

  it("a stopped run shows why and no Stop button", async () => {
    const slot = await page("pipelines/run/run_1", runDetail("stopped"));
    expect(await slot.findByText('Stage "Build" was CONTRADICTED, so the pipeline stopped.')).toBeTruthy();
    expect(slot.queryByText("Stop run")).toBeNull();
    expect(Array.from(slot.container.querySelectorAll(".otto-stamp")).map((s) => (s as HTMLElement).dataset.verdict)).toEqual(["VERIFIED", "CONTRADICTED"]);
    slot.lifecycle.unmount();
  });
});
