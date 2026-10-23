// The budget guard hook (V2 A3). It runs before EVERY message in the user's bb, so it is fail-open for Otto's own bugs:
// it reads only in-memory caches, never throws, and answers proceed on any internal error.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CHANNEL_GUARD } from "../shared/constants";
import { decideGuard } from "../proof/guard";
import { randomId } from "./advisor";
import type { Budget } from "./budget";
import type { OttoStore } from "./db";
import type { OttoState } from "./state";

const DEDUPE_MS = 60_000;

export interface Guard {
  // After a usage refresh: ask core to re-attempt messages Otto is holding, when any are.
  releaseWaits(): void;
}

export function registerGuard(
  bb: BbPluginApi,
  store: OttoStore,
  budget: Budget,
  state: OttoState,
  now: () => number = () => Date.now(),
): Guard {
  const lastRecorded = new Map<string, number>();
  let pendingWaits = 0;

  // bb names this hook experimental_. If a future bb removes or renames it, Guard goes quiet; proof cards must not.
  let registered = false;
  try {
    if (typeof (bb.experimental_hooks as { on?: unknown } | undefined)?.on !== "function") throw new Error("the message hook is not available in this bb");
    bb.experimental_hooks.on("message.dispatch", (ctx) => {
      try {
        const config = state.guard;
        if (config.mode === "off") return { action: "proceed" };
        const providerId = ctx.requestedExecution.providerId;
        const decision = decideGuard({
          config,
          attempt: ctx.attempt,
          projectId: ctx.thread.projectId,
          windows: budget.windowsFor(providerId),
          projectTokens: budget.projectTokens(ctx.thread.projectId),
          now: now(),
        });
        if (decision.action === "proceed") return { action: "proceed" };
        const reason = decision.action === "reject" ? decision.message : decision.reason;
        const key = `${ctx.thread.id}:${decision.action}`;
        const stamp = now();
        if (stamp - (lastRecorded.get(key) ?? 0) > DEDUPE_MS) {
          lastRecorded.set(key, stamp);
          store.insertGuardEvent({
            id: randomId("grd_"),
            at: stamp,
            mode: config.mode,
            threadId: ctx.thread.id,
            projectId: ctx.thread.projectId,
            providerId,
            reason,
            action: decision.action,
          });
          bb.realtime.publish(CHANNEL_GUARD, { threadId: ctx.thread.id });
        }
        if (decision.action === "warn") return { action: "proceed" };
        if (decision.action === "wait") {
          pendingWaits++;
          return { action: "wait", reason: decision.reason, sendAt: decision.sendAt };
        }
        return { action: "reject", message: decision.message };
      } catch (cause) {
        bb.log.warn(`guard error, letting the message through: ${cause instanceof Error ? cause.message : String(cause)}`);
        return { action: "proceed" };
      }
    });
    registered = true;
  } catch (cause) {
    bb.log.warn(`guard unavailable, proof cards are unaffected: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  return {
    releaseWaits() {
      if (!registered || pendingWaits === 0) return;
      pendingWaits = 0;
      try {
        void bb.experimental_hooks.recheck("message.dispatch").catch((cause: unknown) => {
          bb.log.warn(`guard recheck failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        });
      } catch (cause) {
        bb.log.warn(`guard recheck failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
  };
}
