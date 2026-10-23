// RPC handlers for the Proof panel, Otto page, and CLI (BUILD_SPEC 9). Thin: reads go to the store.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { RULES } from "../proof/rules";
import { RULESET_VERSION } from "../shared/constants";
import { rpcContract } from "../shared/contract";
import type { OttoSettings } from "./state";
import type { OttoStore } from "./db";
import type { Advisor } from "./advisor";
import type { Bakeoff } from "./bakeoff";
import type { Budget } from "./budget";
import type { Learn } from "./learn";
import type { Pipelines } from "./pipeline";
import type { Scanner } from "./scanner";

const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;

export function registerRpc(
  bb: BbPluginApi,
  store: OttoStore,
  scanner: Scanner,
  advisor: Advisor,
  bakeoff: Bakeoff,
  budget: Budget,
  learn: Learn,
  pipelines: Pipelines,
  getSettings: () => Promise<OttoSettings>,
  now: () => number = () => Date.now(),
): void {
  bb.rpc.register(rpcContract, {
    "proof.listCards": ({ threadId, projectId, verdict, limit, before }) => {
      const cards = store.listCards({
        ...(threadId !== undefined ? { threadId } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
        ...(verdict !== undefined ? { verdict } : {}),
        limit,
        ...(before !== undefined ? { before } : {}),
      });
      const nextBefore = cards.length === limit ? cards[cards.length - 1].createdAt : null;
      return { cards, nextBefore };
    },
    "proof.getCard": ({ cardId }) => ({ card: store.getCard(cardId) }),
    "proof.threadSummary": ({ threadId }) => ({
      latest: store.latestForThread(threadId),
      counts: store.countsForThread(threadId),
    }),
    "proof.rescanThread": async ({ threadId }) => scanner.scanThread(threadId, { reset: true }),
    "proof.stats": () => ({
      last7d: store.countsSince(now() - SEVEN_DAYS_MS),
      totalCards: store.totalCards(),
      threadsScanned: store.threadsScanned(),
    }),
    "learn.trends": ({ days }) => learn.trends(days),
    "learn.suggestions": ({ days }) => learn.suggestions(days),
    "pipeline.list": () => pipelines.list(),
    "pipeline.templates": () => pipelines.templates(),
    "pipeline.save": (input) => pipelines.save(input),
    "pipeline.delete": ({ pipelineId }) => pipelines.remove(pipelineId),
    "pipeline.run": (input) => pipelines.run(input),
    "pipeline.runs": ({ limit }) => pipelines.runs(limit),
    "pipeline.getRun": ({ runId }) => pipelines.getRun(runId),
    "pipeline.stop": ({ runId }) => pipelines.stop(runId),
    "proof.rules": () => ({ rulesetVersion: RULESET_VERSION, rules: RULES }),
    "advisor.request": ({ cardId }) => advisor.request(cardId),
    "advisor.listForCard": async ({ cardId }) => {
      await advisor.assertOperator();
      return { reviews: store.listReviewsForCard(cardId) };
    },
    "bakeoff.options": () => bakeoff.options(),
    "bakeoff.create": (input) => bakeoff.create(input),
    "bakeoff.list": ({ limit }) => bakeoff.list(limit),
    "bakeoff.get": ({ bakeoffId }) => bakeoff.get(bakeoffId),
    "bakeoff.pickWinner": ({ bakeoffId, contestantId, note }) => bakeoff.pickWinner(bakeoffId, contestantId, note),
    "bakeoff.archiveLosers": ({ bakeoffId }) => bakeoff.archiveLosers(bakeoffId),
    "bakeoff.lanes": ({ bakeoffId }) => bakeoff.lanes(bakeoffId),
    "budget.summary": async () => {
      await advisor.assertOperator();
      return budget.summary();
    },
    "budget.events": async ({ limit }) => {
      await advisor.assertOperator();
      return { events: store.listGuardEvents(limit) };
    },
    "bakeoff.delete": ({ bakeoffId }) => bakeoff.delete(bakeoffId),
    "bakeoff.scoreboard": ({ taskTag }) => bakeoff.scoreboard(taskTag),
    "proof.rescanRecent": async () => {
      const { reconcileWindowHours } = await getSettings();
      return scanner.reconcile(reconcileWindowHours, { reset: true, wait: true });
    },
  });
}
