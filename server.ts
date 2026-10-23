// Otto backend entry: wiring only. Logic lives under src/.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createAdvisor } from "./src/server/advisor";
import { createBakeoff } from "./src/server/bakeoff";
import { createBudget } from "./src/server/budget";
import { registerGuard } from "./src/server/guard";
import { registerAgents } from "./src/server/agents";
import { registerCli } from "./src/server/cli";
import { createLearn } from "./src/server/learn";
import { createPipelines } from "./src/server/pipeline";
import { MIGRATIONS, openStore } from "./src/server/db";
import { registerRpc } from "./src/server/rpc";
import { createScanner } from "./src/server/scanner";
import { parseCustomRules } from "./src/proof/custom";
import { createState, guardConfigOf, parseMode, type OttoSettings } from "./src/server/state";

export { rpcContract } from "./src/shared/contract";

const STALE_RESCAN_LIMIT = 200;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    mode: {
      type: "select",
      label: "Mode",
      options: ["starter", "pro", "operator"],
      experimental_optionLabels: {
        starter: "Starter: proof cards only",
        pro: "Pro: also coach agents",
        operator: "Operator: also Advisor and Bake-off",
      },
      default: "starter",
    },
    reconcileWindowHours: {
      type: "number",
      label: "Scan threads updated in the last N hours on startup",
      experimental_schema: z.number().int().min(1).max(336),
      default: 48,
    },
    advisorProviderId: {
      type: "string",
      label: "Advisor provider id (Operator)",
      default: "claude-code",
    },
    advisorModel: {
      type: "string",
      label: "Advisor model id (Operator). Empty uses the provider default.",
      default: "",
    },
    customRulesJson: {
      type: "string",
      label: "Custom rules (JSON array of {id, title, pattern, message, fixHint}; id like USER1; informational only)",
      default: "[]",
    },
    guardMode: {
      type: "select",
      label: "Budget guard (Operator)",
      options: ["off", "warn", "wait", "reject"],
      experimental_optionLabels: {
        off: "Off",
        warn: "Warn: record it, let the message through",
        wait: "Wait: hold the message until the limit resets",
        reject: "Reject: refuse the message",
      },
      default: "off",
    },
    guardWindowPercent: {
      type: "number",
      label: "Guard: plan window percent that counts as over the limit",
      experimental_schema: z.number().int().min(1).max(100),
      default: 95,
    },
    guardProjectTokenCap: {
      type: "number",
      label: "Guard: token cap per project (0 means no cap)",
      experimental_schema: z.number().int().min(0),
      default: 0,
    },
    guardProjectIds: {
      type: "string",
      label: "Guard: only these project ids, comma separated (empty means every project)",
      default: "",
    },
    guardWaitSeconds: {
      type: "number",
      label: "Guard: seconds a held message waits when no plan window gives a reset time",
      experimental_schema: z.number().int().min(30).max(86400),
      default: 900,
    },
    advisorTimeoutMinutes: {
      type: "number",
      label: "Advisor timeout in minutes (Operator)",
      experimental_schema: z.number().int().min(5).max(120),
      default: 20,
    },
  });
  const getSettings = async (): Promise<OttoSettings> => {
    const s = await settings.get();
    return { ...s, mode: parseMode(s.mode) };
  };

  const warn = (message: string): void => bb.log.warn(message);
  const initial = await getSettings();
  const state = createState(initial);
  state.customRules = parseCustomRules(initial.customRulesJson, warn);
  settings.onChange((next) => {
    state.mode = parseMode(next.mode);
    state.customRules = parseCustomRules(typeof next.customRulesJson === "string" ? next.customRulesJson : "[]", warn);
    state.guard = guardConfigOf(next as unknown as OttoSettings);
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = openStore(db, (message) => bb.log.warn(message));
  const scanner = createScanner(bb, store, undefined, () => state.customRules);
  const advisor = createAdvisor(bb, store, getSettings);
  const bakeoff = createBakeoff(bb, store, scanner, getSettings);
  const budget = createBudget(bb, store, state);
  const guard = registerGuard(bb, store, budget, state);

  const learn = createLearn(store, getSettings);
  const pipelines = createPipelines(bb, store, scanner, getSettings);
  registerRpc(bb, store, scanner, advisor, bakeoff, budget, learn, pipelines, getSettings);
  registerCli(bb, store, scanner, advisor, learn, getSettings);
  registerAgents(bb, state);

  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    if (await advisor.handleIdle(thread.id, lastAssistantText)) return;
    const usage = budget
      .recordThread({ id: thread.id, projectId: thread.projectId, providerId: thread.providerId ?? null })
      .catch((cause: unknown) => bb.log.debug(`usage read failed for ${thread.id}: ${cause instanceof Error ? cause.message : String(cause)}`));
    if (await bakeoff.handleIdle(thread.id)) return void (await usage); // scans the contestant itself
    if (await pipelines.handleIdle(thread.id, lastAssistantText)) return void (await usage); // and the stage
    await scanner.enqueue(thread.id);
    await usage;
  });
  bb.events.on("thread.active", async ({ thread }) => {
    await bakeoff.handleActive(thread.id);
  });
  bb.events.on("thread.failed", async ({ thread, error }) => {
    if (await advisor.handleFailed(thread.id, error)) return;
    if (await bakeoff.handleFailed(thread.id, error)) return;
    await pipelines.handleFailed(thread.id, error);
  });

  bb.background.service("reconcile", {
    async start(signal) {
      await sleep(5_000, signal);
      if (signal.aborted) return;
      const { reconcileWindowHours } = await getSettings();
      await scanner.reconcile(reconcileWindowHours);
      await scanner.rescanStale(STALE_RESCAN_LIMIT);
      await budget.refreshUsage().catch((cause: unknown) => bb.log.warn(`usage limits unavailable: ${cause instanceof Error ? cause.message : String(cause)}`));
      await untilAborted(signal);
    },
  });
  bb.background.schedule("sweep", "*/15 * * * *", async () => {
    await scanner.reconcile(1);
  });

  bb.background.schedule("advisor-timeouts", "*/5 * * * *", async () => {
    await advisor.sweepTimeouts();
  });

  bb.background.schedule("budget-refresh", "*/5 * * * *", async () => {
    await budget.refreshUsage().catch((cause: unknown) => bb.log.warn(`usage limits unavailable: ${cause instanceof Error ? cause.message : String(cause)}`));
    await budget.backfill();
    guard.releaseWaits();
  });

  bb.background.schedule("bakeoff-sweep", "*/5 * * * *", async () => {
    await bakeoff.sweep();
  });

  bb.background.schedule("pipeline-sweep", "*/5 * * * *", async () => {
    await pipelines.sweep();
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
