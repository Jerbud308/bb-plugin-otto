// Budget meter: tokens per project from thread token usage, plus each provider's own plan windows (V2 A2).
// Tokens and plan percent only. There is no per-thread dollar figure in bb, so Otto shows none.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { PlanWindowLike } from "../proof/guard";
import type { BudgetSummary } from "../shared/contract";
import type { OttoStore } from "./db";
import type { OttoState } from "./state";

const usageRowSchema = z.looseObject({
  tokenUsage: z.looseObject({
    total: z.looseObject({
      totalTokens: z.number(),
      inputTokens: z.number(),
      cachedInputTokens: z.number(),
      outputTokens: z.number(),
    }),
  }),
});

const BACKFILL_PER_RUN = 20;

export interface ThreadRef {
  id: string;
  projectId: string;
  providerId: string | null;
}

export interface ProviderUsage {
  planLabel: string | null;
  windows: PlanWindowLike[];
}

export interface Budget {
  recordThread(thread: ThreadRef): Promise<void>;
  refreshUsage(): Promise<void>;
  backfill(): Promise<number>;
  windowsFor(providerId: string): readonly PlanWindowLike[];
  projectTokens(projectId: string): number;
  summary(): BudgetSummary;
}

export function createBudget(
  bb: BbPluginApi,
  store: OttoStore,
  state: OttoState,
  now: () => number = () => Date.now(),
): Budget {
  const totals = new Map<string, number>(store.projectUsage().map((p) => [p.projectId, p.totalTokens]));
  let providers = new Map<string, ProviderUsage>();
  let checkedAt: number | null = null;

  const reload = (): void => {
    totals.clear();
    for (const p of store.projectUsage()) totals.set(p.projectId, p.totalTokens);
  };

  async function recordThread(thread: ThreadRef): Promise<void> {
    const rows = await bb.sdk.threads.events.list({
      threadId: thread.id,
      types: ["thread/tokenUsage/updated"] as const,
      order: "desc",
      limit: "1",
    });
    const parsed = rows.length > 0 ? usageRowSchema.safeParse(rows[0].data) : null;
    const t = parsed?.success ? parsed.data.tokenUsage.total : null;
    // A thread with no usage row is stored as zero so the backfill does not retry it forever.
    store.upsertUsage({
      threadId: thread.id,
      projectId: thread.projectId,
      providerId: thread.providerId,
      totalTokens: t?.totalTokens ?? 0,
      inputTokens: t?.inputTokens ?? 0,
      cachedTokens: t?.cachedInputTokens ?? 0,
      outputTokens: t?.outputTokens ?? 0,
      updatedAt: now(),
    });
    reload();
  }

  async function refreshUsage(): Promise<void> {
    const result = await bb.sdk.system.usageLimits();
    const next = new Map<string, ProviderUsage>();
    for (const [providerId, entry] of Object.entries(result)) {
      if (entry.status !== "ok") continue;
      next.set(providerId, {
        planLabel: entry.planLabel,
        windows: entry.windows.map((w) => ({ label: w.label, usedPercent: w.usedPercent, resetsAt: w.resetsAt })),
      });
    }
    providers = next;
    checkedAt = now();
  }

  async function backfill(): Promise<number> {
    let done = 0;
    for (const t of store.threadsWithoutUsage(BACKFILL_PER_RUN)) {
      try {
        await recordThread({ id: t.threadId, projectId: t.projectId, providerId: t.providerId });
        done++;
      } catch (cause) {
        // A deleted thread keeps failing; write a zero row so it is not retried.
        bb.log.debug(`usage backfill skipped ${t.threadId}: ${cause instanceof Error ? cause.message : String(cause)}`);
        store.upsertUsage({
          threadId: t.threadId,
          projectId: t.projectId,
          providerId: t.providerId,
          totalTokens: 0,
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          updatedAt: now(),
        });
      }
    }
    return done;
  }

  return {
    recordThread,
    refreshUsage,
    backfill,
    windowsFor: (providerId) => providers.get(providerId)?.windows ?? [],
    projectTokens: (projectId) => totals.get(projectId) ?? 0,
    summary() {
      return {
        projects: store.projectUsage(),
        providers: [...providers.entries()].map(([providerId, p]) => ({ providerId, planLabel: p.planLabel, windows: p.windows })),
        usageCheckedAt: checkedAt,
        guard: {
          mode: state.guard.mode,
          windowPercent: state.guard.windowPercent,
          projectTokenCap: state.guard.projectTokenCap,
          projectIds: state.guard.projectIds,
        },
      };
    },
  };
}
