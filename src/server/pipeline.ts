// Pipelines: a chain of agent stages on Otto's own runner (a plugin cannot start a bb workflow, V2 LOOKUP L13).
// Stage 1 gets a fresh managed worktree; every later stage reuses it, so the chain works on one set of files.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { MAX_PROMPT, TEMPLATES, nextStep, renderPrompt, validatePipeline, type StageState } from "../proof/pipeline";
import { CHANNEL_PIPELINE } from "../shared/constants";
import type { Pipeline, PipelineRun, PipelineRunSummary, PipelineStage, PipelineTemplate, StageDefRecord } from "../shared/contract";
import { randomId } from "./advisor";
import type { OttoStore } from "./db";
import type { RunRecord } from "./pipelineDb";
import type { Scanner } from "./scanner";
import type { OttoSettings } from "./state";

export const OPERATOR_ONLY_PIPELINE = "Pipelines need Operator mode. Change Mode in Settings, Installed plugins, Otto.";
const STARTING_STALE_MS = 10 * 60_000;
const MAX_SAVED = 50;
const MAX_OUTPUT = 20_000;

export interface Pipelines {
  list(): Promise<{ pipelines: Pipeline[] }>;
  templates(): Promise<{ templates: PipelineTemplate[] }>;
  save(input: { id?: string | undefined; name: string; stages: StageDefRecord[] }): Promise<{ pipelineId: string }>;
  remove(pipelineId: string): Promise<{ ok: true }>;
  run(input: { pipelineId: string; projectId: string; input: string; baseBranch?: string | undefined }): Promise<{ runId: string }>;
  runs(limit: number): Promise<{ runs: PipelineRunSummary[] }>;
  getRun(runId: string): Promise<{ run: PipelineRun; stages: PipelineStage[] }>;
  stop(runId: string): Promise<{ ok: true }>;
  // Event handlers return true when the thread belongs to a pipeline stage.
  handleIdle(threadId: string, lastAssistantText: string | null): Promise<boolean>;
  handleFailed(threadId: string, error: string | null): Promise<boolean>;
  sweep(): Promise<number>;
}

export function createPipelines(
  bb: BbPluginApi,
  store: OttoStore,
  scanner: Scanner,
  getSettings: () => Promise<OttoSettings>,
  now: () => number = () => Date.now(),
): Pipelines {
  const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
  const publish = (runId: string): void => {
    bb.realtime.publish(CHANNEL_PIPELINE, { runId });
  };
  async function assertOperator(): Promise<void> {
    if ((await getSettings()).mode !== "operator") throw new Error(OPERATOR_ONLY_PIPELINE);
  }
  function needRun(runId: string): RunRecord {
    const run = store.getRun(runId);
    if (!run) throw new Error("Pipeline run not found.");
    return run;
  }
  const publicRun = ({ definition: _definition, ...run }: RunRecord): PipelineRun => run;

  // One chain of work per run at a time: an idle event and the sweep can arrive together.
  const locks = new Map<string, Promise<unknown>>();
  function locked<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(runId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const tail = next.catch(() => undefined);
    locks.set(runId, tail);
    void tail.then(() => {
      if (locks.get(runId) === tail) locks.delete(runId);
    });
    return next;
  }

  function stateOf(stages: PipelineStage[], run: RunRecord): StageState[] {
    return stages.map((s) => ({ status: s.status, verdict: s.verdict, gate: run.definition.stages[s.idx]?.gate ?? "none", label: s.label }));
  }

  async function startStage(run: RunRecord, stage: PipelineStage): Promise<void> {
    const def = run.definition.stages[stage.idx];
    if (!def) {
      store.updateStage(stage.id, { status: "failed", error: "The stage is missing from the definition.", finishedAt: now() });
      return;
    }
    // Claim the stage before spawning, so a second advance cannot start it twice.
    store.updateStage(stage.id, { status: "running", startedAt: now(), error: null });
    const outputs: Record<string, string> = {};
    for (const s of store.stagesFor(run.id)) if (s.status === "idle" && s.output !== null) outputs[s.key] = s.output;
    try {
      let environment;
      if (stage.idx === 0) {
        const project = await bb.sdk.projects.get({ projectId: run.projectId });
        const hostId = (project.sources.find((src) => src.isDefault) ?? project.sources[0])?.hostId;
        if (hostId === undefined) throw new Error("This project has no workspace to start worktrees in.");
        environment = {
          type: "host" as const,
          hostId,
          workspace: {
            type: "managed-worktree" as const,
            baseBranch: run.baseBranch ? { kind: "named" as const, name: run.baseBranch } : { kind: "default" as const },
          },
        };
      } else {
        if (run.environmentId === null) throw new Error("The first stage left no workspace to continue in.");
        environment = { type: "reuse" as const, environmentId: run.environmentId };
      }
      const thread = await bb.sdk.threads.spawn({
        projectId: run.projectId,
        environment,
        providerId: stage.providerId,
        title: `${run.pipelineName}: ${stage.label}`.slice(0, 120),
        prompt: renderPrompt(def.prompt, run.input, outputs),
        pluginMetadata: { ottoRole: "stage", runId: run.id, stageId: stage.id },
      });
      store.updateStage(stage.id, { threadId: thread.id });
      if (stage.idx === 0 && thread.environmentId) store.updateRun(run.id, { environmentId: thread.environmentId });
    } catch (cause) {
      store.updateStage(stage.id, { status: "failed", error: message(cause), finishedAt: now() });
    }
  }

  function closeRun(run: RunRecord, outcome: "done" | "failed" | "stopped", note: string | null): void {
    for (const s of store.stagesFor(run.id)) {
      if (s.status === "pending") store.updateStage(s.id, { status: "skipped" });
    }
    store.updateRun(run.id, { status: outcome, note, finishedAt: now() });
  }

  // Decide and do the next thing for a run. Safe to call at any time and more than once.
  async function advance(runId: string): Promise<void> {
    await locked(runId, async () => {
      for (let guardLoops = 0; guardLoops < 20; guardLoops++) {
        const run = store.getRun(runId);
        if (!run || run.status !== "running") return;
        const stages = store.stagesFor(runId);
        const step = nextStep(stateOf(stages, run));
        if (step.kind === "wait") return;
        if (step.kind === "finish") {
          closeRun(run, "done", null);
          break;
        }
        if (step.kind === "stop") {
          closeRun(run, step.outcome, step.reason);
          break;
        }
        await startStage(run, stages[step.index]);
        publish(runId);
        // A stage that failed to start is decided on the next loop; a started one is waited for.
        if (store.stagesFor(runId)[step.index]?.status === "running") return;
      }
      publish(runId);
    });
  }

  async function settle(stage: PipelineStage, lastText: string | null): Promise<void> {
    if (stage.threadId === null) return;
    const threadId = stage.threadId;
    try {
      await scanner.scanThread(threadId);
    } catch (cause) {
      bb.log.warn(`pipeline scan failed for ${threadId}: ${message(cause)}`);
    }
    const verdict = store.latestForThread(threadId)?.verdict ?? null;
    let output = lastText;
    if (output === null) {
      try {
        output = (await bb.sdk.threads.output({ threadId })).output;
      } catch (cause) {
        bb.log.warn(`pipeline could not read the output of ${threadId}: ${message(cause)}`);
      }
    }
    const run = store.getRun(stage.runId);
    if (run && run.environmentId === null) {
      try {
        const environmentId = (await bb.sdk.threads.get({ threadId })).environmentId;
        if (environmentId !== null) store.updateRun(run.id, { environmentId });
      } catch (cause) {
        bb.log.warn(`pipeline could not read ${threadId}: ${message(cause)}`);
      }
    }
    store.updateStage(stage.id, {
      status: "idle",
      verdict,
      output: (output ?? "").slice(0, MAX_OUTPUT),
      finishedAt: now(),
    });
    publish(stage.runId);
    await advance(stage.runId);
  }

  return {
    async list() {
      await assertOperator();
      return { pipelines: store.listPipelines() };
    },

    async templates() {
      await assertOperator();
      return { templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, stages: t.stages })) };
    },

    async save(input) {
      await assertOperator();
      const v = validatePipeline({ name: input.name, stages: input.stages });
      if (!v.ok) throw new Error(v.errors[0]);
      const existing = input.id === undefined ? null : store.getPipeline(input.id);
      if (input.id !== undefined && !existing) throw new Error("Pipeline not found.");
      if (!existing && store.listPipelines().length >= MAX_SAVED) throw new Error(`You can keep up to ${MAX_SAVED} pipelines. Delete one first.`);
      const providers = await bb.sdk.providers.list();
      for (const s of v.def.stages) {
        if (!providers.some((p) => p.id === s.providerId)) throw new Error(`Stage "${s.label}": agent ${s.providerId} is not installed.`);
      }
      const at = now();
      const id = existing?.id ?? randomId("pip_");
      store.savePipeline({ id, name: v.def.name, stages: v.def.stages, createdAt: existing?.createdAt ?? at, updatedAt: at });
      return { pipelineId: id };
    },

    async remove(pipelineId) {
      await assertOperator();
      store.deletePipeline(pipelineId);
      return { ok: true };
    },

    async run(input) {
      await assertOperator();
      const pipeline = store.getPipeline(input.pipelineId);
      if (!pipeline) throw new Error("Pipeline not found.");
      const v = validatePipeline({ name: pipeline.name, stages: pipeline.stages });
      if (!v.ok) throw new Error(v.errors[0]);
      const task = input.input.trim();
      if (task.length < 1 || task.length > MAX_PROMPT) throw new Error(`Describe the task in 1 to ${MAX_PROMPT} characters.`);
      const providers = await bb.sdk.providers.list();
      for (const s of v.def.stages) {
        if (!providers.some((p) => p.id === s.providerId && p.available)) throw new Error(`Stage "${s.label}": agent ${s.providerId} is not available.`);
      }
      const run: RunRecord = {
        id: randomId("run_"),
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        projectId: input.projectId,
        input: task,
        baseBranch: input.baseBranch ?? null,
        status: "running",
        environmentId: null,
        note: null,
        createdAt: now(),
        finishedAt: null,
        definition: v.def,
      };
      const stages: PipelineStage[] = v.def.stages.map((s, idx) => ({
        id: randomId("stg_"),
        runId: run.id,
        idx,
        key: s.key,
        label: s.label,
        providerId: s.providerId,
        threadId: null,
        status: "pending",
        verdict: null,
        output: null,
        startedAt: null,
        finishedAt: null,
        error: null,
      }));
      store.insertRun(run, stages);
      publish(run.id);
      await advance(run.id);
      return { runId: run.id };
    },

    async runs(limit) {
      await assertOperator();
      return { runs: store.listRuns(limit) };
    },

    async getRun(runId) {
      await assertOperator();
      return { run: publicRun(needRun(runId)), stages: store.stagesFor(runId) };
    },

    async stop(runId) {
      await assertOperator();
      await locked(runId, async () => {
        const run = needRun(runId);
        if (run.status !== "running") throw new Error("This run already finished.");
        // Close the run first, so the stopped threads' events cannot start anything else.
        const running = store.stagesFor(runId).filter((s) => s.status === "running");
        closeRun(run, "stopped", "Stopped by you.");
        for (const s of running) {
          store.updateStage(s.id, { status: "failed", error: "Stopped by you.", finishedAt: now() });
          if (s.threadId !== null) {
            await bb.sdk.threads.stop({ threadId: s.threadId }).catch((cause: unknown) => bb.log.warn(`pipeline stop failed for ${s.threadId}: ${message(cause)}`));
          }
        }
        publish(runId);
      });
      return { ok: true };
    },

    async handleIdle(threadId, lastAssistantText) {
      const stage = store.stageByThread(threadId);
      if (!stage) return false;
      if (stage.status === "running") await settle(stage, lastAssistantText);
      return true;
    },

    async handleFailed(threadId, error) {
      const stage = store.stageByThread(threadId);
      if (!stage) return false;
      if (stage.status === "running") {
        store.updateStage(stage.id, { status: "failed", error: error ?? "The thread failed.", finishedAt: now() });
        publish(stage.runId);
        await advance(stage.runId);
      }
      return true;
    },

    // Events are fire-and-forget: catch up on stages whose idle or failed signal was missed.
    async sweep() {
      let touched = 0;
      for (const run of store.openRuns()) {
        try {
          const stages = store.stagesFor(run.id);
          const running = stages.filter((s) => s.status === "running");
          if (running.length === 0) {
            await advance(run.id);
            touched++;
            continue;
          }
          for (const s of running) {
            if (s.threadId === null) {
              if (now() - (s.startedAt ?? now()) > STARTING_STALE_MS) {
                store.updateStage(s.id, { status: "failed", error: "Start was interrupted.", finishedAt: now() });
                await advance(run.id);
                touched++;
              }
              continue;
            }
            const thread = await bb.sdk.threads.get({ threadId: s.threadId });
            if (thread.status === "idle") {
              await settle(s, null);
              touched++;
            } else if (thread.status === "error") {
              await this.handleFailed(s.threadId, null);
              touched++;
            }
          }
        } catch (cause) {
          bb.log.warn(`pipeline sweep failed for ${run.id}: ${message(cause)}`);
        }
      }
      return touched;
    },
  };
}
