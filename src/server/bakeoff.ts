// Bake-off: the same prompt on 2 to 4 providers, one visible thread each, in separate worktrees (BUILD_SPEC 14).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { tickOfRow, type Tick } from "../proof/lanes";
import { CHANNEL_BAKEOFF, EVENTS_MAX_PAGES, EVENTS_PAGE_LIMIT } from "../shared/constants";
import type {
  Bakeoff as BakeoffRecord,
  BakeoffSummary,
  Contestant,
  Lane,
  ScoreboardRow,
} from "../shared/contract";
import { randomId } from "./advisor";
import type { OttoStore } from "./db";
import type { Scanner } from "./scanner";
import type { OttoSettings } from "./state";

export const OPERATOR_ONLY_BAKEOFF = "Bake-off needs Operator mode. Change Mode in Settings, Installed plugins, Otto.";

const MAX_TICKS_PER_LANE = 400;
const STARTING_STALE_MS = 10 * 60_000;

export interface CreateInput {
  projectId: string;
  prompt: string;
  providerIds: string[];
  taskTag: string;
  baseBranch?: string | undefined;
}

export interface DiffStats {
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
}

// " 3 files changed, 10 insertions(+), 2 deletions(-)"; an empty string means no changes.
export function parseShortstat(text: string): DiffStats {
  const grab = (re: RegExp): number => {
    const m = re.exec(text);
    return m ? Number(m[1]) : 0;
  };
  return {
    filesChanged: grab(/(\d+) files? changed/),
    insertions: grab(/(\d+) insertions?\(\+\)/),
    deletions: grab(/(\d+) deletions?\(-\)/),
  };
}

export interface Bakeoff {
  options(): Promise<{
    projects: { id: string; name: string }[];
    providers: { id: string; displayName: string; available: boolean }[];
  }>;
  create(input: CreateInput): Promise<{ bakeoffId: string }>;
  list(limit: number): Promise<{ bakeoffs: BakeoffSummary[] }>;
  get(bakeoffId: string): Promise<{ bakeoff: BakeoffRecord; contestants: Contestant[] }>;
  pickWinner(bakeoffId: string, contestantId: string, note?: string): Promise<{ ok: true }>;
  archiveLosers(bakeoffId: string): Promise<{ archived: number }>;
  lanes(bakeoffId: string): Promise<{ startedAt: number; lanes: Lane[] }>;
  scoreboard(taskTag?: string): Promise<{ rows: ScoreboardRow[] }>;
  delete(bakeoffId: string): Promise<{ ok: true }>;
  // Event handlers return true when the thread belongs to a bake-off contestant.
  handleIdle(threadId: string): Promise<boolean>;
  handleActive(threadId: string): Promise<boolean>;
  handleFailed(threadId: string, error: string | null): Promise<boolean>;
  sweep(): Promise<number>;
}

export function createBakeoff(
  bb: BbPluginApi,
  store: OttoStore,
  scanner: Scanner,
  getSettings: () => Promise<OttoSettings>,
  now: () => number = () => Date.now(),
): Bakeoff {
  const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
  const publish = (bakeoffId: string): void => {
    bb.realtime.publish(CHANNEL_BAKEOFF, { bakeoffId });
  };

  async function assertOperator(): Promise<void> {
    if ((await getSettings()).mode !== "operator") throw new Error(OPERATOR_ONLY_BAKEOFF);
  }

  function need(bakeoffId: string): BakeoffRecord {
    const b = store.getBakeoff(bakeoffId);
    if (!b) throw new Error("Bake-off not found.");
    return b;
  }

  // ready when every contestant is idle or failed; running otherwise; decided is final.
  function refreshStatus(bakeoffId: string): void {
    const b = store.getBakeoff(bakeoffId);
    if (!b || b.status === "decided") return;
    const all = store.contestantsFor(bakeoffId);
    const settled = all.length > 0 && all.every((c) => c.status === "idle" || c.status === "failed");
    const next = settled ? "ready" : "running";
    if (next !== b.status) store.updateBakeoff(bakeoffId, { status: next });
  }

  async function diffStats(environmentId: string | null): Promise<DiffStats> {
    const none: DiffStats = { filesChanged: null, insertions: null, deletions: null };
    if (environmentId === null) return none;
    try {
      const env = await bb.sdk.environments.get({ environmentId });
      const base = env.mergeBaseBranch ?? env.baseBranch ?? env.defaultBranch;
      const result = await bb.sdk.environments.diff(
        base ? { environmentId, target: "all", mergeBaseBranch: base } : { environmentId, target: "uncommitted" },
      );
      return result.outcome === "available" ? parseShortstat(result.diff.shortstat) : none;
    } catch (cause) {
      bb.log.warn(`bake-off diff failed for ${environmentId}: ${message(cause)}`);
      return none;
    }
  }

  async function settle(c: Contestant): Promise<void> {
    if (c.threadId === null) return;
    try {
      await scanner.scanThread(c.threadId);
    } catch (cause) {
      bb.log.warn(`bake-off scan failed for ${c.threadId}: ${message(cause)}`);
    }
    const latest = store.latestForThread(c.threadId);
    // The worktree is provisioned after spawn returns, so the spawn response has no environment id yet (found live at M7).
    let environmentId = c.environmentId;
    if (environmentId === null) {
      try {
        environmentId = (await bb.sdk.threads.get({ threadId: c.threadId })).environmentId;
      } catch (cause) {
        bb.log.warn(`bake-off could not read ${c.threadId}: ${message(cause)}`);
      }
    }
    const stats = await diffStats(environmentId);
    store.updateContestant(c.id, {
      status: "idle",
      finishedAt: c.finishedAt ?? now(),
      verdict: latest?.verdict ?? null,
      ...(environmentId === null ? {} : { environmentId }),
      ...stats,
    });
    refreshStatus(c.bakeoffId);
    publish(c.bakeoffId);
  }

  async function readTicks(threadId: string): Promise<Tick[]> {
    const ticks: Tick[] = [];
    let last = 0;
    for (let page = 0; page < EVENTS_MAX_PAGES; page++) {
      const batch = await bb.sdk.threads.events.list({
        threadId,
        types: ["item/completed"] as const,
        afterSeq: String(last),
        limit: String(EVENTS_PAGE_LIMIT),
        order: "asc",
      });
      if (batch.length === 0) break;
      for (const row of batch) {
        if (row.seq > last) last = row.seq;
        const tick = tickOfRow(row);
        if (tick) ticks.push(tick);
      }
    }
    return ticks.slice(-MAX_TICKS_PER_LANE);
  }

  return {
    // Not Operator-gated: it only names projects and agents bb already shows, and the Learn tab (Pro) uses it for display names.
    async options() {
      const [projects, providers] = await Promise.all([bb.sdk.projects.list(), bb.sdk.providers.list()]);
      return {
        projects: projects.map((p) => ({ id: p.id, name: p.name })),
        providers: providers.map((p) => ({ id: p.id, displayName: p.displayName, available: p.available })),
      };
    },

    async create(input) {
      await assertOperator();
      const providers = await bb.sdk.providers.list();
      for (const id of input.providerIds) {
        if (!providers.some((p) => p.id === id && p.available)) throw new Error(`Provider ${id} is not available.`);
      }
      // The server refuses a managed worktree without a host (found live at M7): use the project's default source.
      const project = await bb.sdk.projects.get({ projectId: input.projectId });
      const hostId = (project.sources.find((src) => src.isDefault) ?? project.sources[0])?.hostId;
      if (hostId === undefined) throw new Error("This project has no workspace to start worktrees in.");
      const baseBranch = input.baseBranch ?? null;
      const bakeoff: BakeoffRecord = {
        id: randomId("bko_"),
        projectId: input.projectId,
        prompt: input.prompt,
        taskTag: input.taskTag,
        baseBranch,
        status: "running",
        winnerContestantId: null,
        note: null,
        createdAt: now(),
        decidedAt: null,
      };
      store.insertBakeoff(bakeoff);
      const contestants: Contestant[] = input.providerIds.map((providerId) => ({
        id: randomId("con_"),
        bakeoffId: bakeoff.id,
        providerId,
        threadId: null,
        environmentId: null,
        status: "starting",
        startedAt: now(),
        finishedAt: null,
        verdict: null,
        filesChanged: null,
        insertions: null,
        deletions: null,
        error: null,
      }));
      for (const c of contestants) store.insertContestant(c);
      publish(bakeoff.id);

      // Sequential on purpose: each spawn creates a worktree.
      for (const c of contestants) {
        const name = providers.find((p) => p.id === c.providerId)?.displayName ?? c.providerId;
        try {
          const thread = await bb.sdk.threads.spawn({
            projectId: input.projectId,
            environment: {
              type: "host",
              hostId,
              workspace: {
                type: "managed-worktree",
                baseBranch: baseBranch ? { kind: "named", name: baseBranch } : { kind: "default" },
              },
            },
            providerId: c.providerId,
            title: `Bake-off ${input.taskTag}: ${name}`.slice(0, 120),
            prompt: input.prompt,
            pluginMetadata: { ottoRole: "contestant", bakeoffId: bakeoff.id, contestantId: c.id },
          });
          store.updateContestant(c.id, { threadId: thread.id, environmentId: thread.environmentId, status: "running" });
        } catch (cause) {
          store.updateContestant(c.id, { status: "failed", error: message(cause), finishedAt: now() });
        }
        publish(bakeoff.id);
      }
      refreshStatus(bakeoff.id);
      publish(bakeoff.id);
      return { bakeoffId: bakeoff.id };
    },

    async list(limit) {
      await assertOperator();
      return { bakeoffs: store.listBakeoffs(limit) };
    },

    async get(bakeoffId) {
      await assertOperator();
      return { bakeoff: need(bakeoffId), contestants: store.contestantsFor(bakeoffId) };
    },

    async pickWinner(bakeoffId, contestantId, note) {
      await assertOperator();
      const b = need(bakeoffId);
      if (b.status === "decided") throw new Error("This bake-off already has a winner.");
      if (b.status !== "ready") throw new Error("Wait until every contestant has finished.");
      const c = store.getContestant(contestantId);
      if (!c || c.bakeoffId !== bakeoffId || c.status !== "idle") throw new Error("Pick a contestant that finished.");
      store.updateBakeoff(bakeoffId, {
        status: "decided",
        winnerContestantId: contestantId,
        note: note ?? null,
        decidedAt: now(),
      });
      publish(bakeoffId);
      return { ok: true };
    },

    async archiveLosers(bakeoffId) {
      await assertOperator();
      const b = need(bakeoffId);
      if (b.status !== "decided") throw new Error("Pick a winner first.");
      let archived = 0;
      for (const c of store.contestantsFor(bakeoffId)) {
        if (c.id === b.winnerContestantId || c.threadId === null) continue;
        try {
          await bb.sdk.threads.archive({ threadId: c.threadId });
          archived++;
        } catch (cause) {
          bb.log.warn(`bake-off archive failed for ${c.threadId}: ${message(cause)}`);
        }
      }
      publish(bakeoffId);
      return { archived };
    },

    async lanes(bakeoffId) {
      await assertOperator();
      const contestants = store.contestantsFor(bakeoffId);
      need(bakeoffId);
      const lanes: Lane[] = [];
      for (const c of contestants) {
        let ticks: Tick[] = [];
        if (c.threadId !== null) {
          try {
            ticks = await readTicks(c.threadId);
          } catch (cause) {
            bb.log.warn(`bake-off lane read failed for ${c.threadId}: ${message(cause)}`);
          }
        }
        lanes.push({
          contestantId: c.id,
          providerId: c.providerId,
          status: c.status,
          finishedAt: c.finishedAt,
          ticks,
        });
      }
      const startedAt = contestants.length > 0 ? Math.min(...contestants.map((c) => c.startedAt)) : now();
      return { startedAt, lanes };
    },

    async scoreboard(taskTag) {
      await assertOperator();
      return { rows: store.scoreboard(taskTag) };
    },

    async delete(bakeoffId) {
      await assertOperator();
      need(bakeoffId);
      store.deleteBakeoff(bakeoffId);
      publish(bakeoffId);
      return { ok: true };
    },

    async handleIdle(threadId) {
      const c = store.contestantByThread(threadId);
      if (!c) return false;
      await settle(c);
      return true;
    },

    async handleActive(threadId) {
      const c = store.contestantByThread(threadId);
      if (!c) return false;
      if (c.status !== "failed") {
        store.updateContestant(c.id, { status: "running", finishedAt: null });
        refreshStatus(c.bakeoffId);
        publish(c.bakeoffId);
      }
      return true;
    },

    async handleFailed(threadId, error) {
      const c = store.contestantByThread(threadId);
      if (!c) return false;
      store.updateContestant(c.id, {
        status: "failed",
        error: error ?? "The thread failed.",
        finishedAt: c.finishedAt ?? now(),
      });
      refreshStatus(c.bakeoffId);
      publish(c.bakeoffId);
      return true;
    },

    // Events are fire-and-forget: catch up on contestants whose idle or failed signal was missed.
    async sweep() {
      let touched = 0;
      for (const c of store.openContestants()) {
        try {
          if (c.threadId === null) {
            if (now() - c.startedAt > STARTING_STALE_MS) {
              store.updateContestant(c.id, { status: "failed", error: "Start was interrupted.", finishedAt: now() });
              refreshStatus(c.bakeoffId);
              publish(c.bakeoffId);
              touched++;
            }
            continue;
          }
          const thread = await bb.sdk.threads.get({ threadId: c.threadId });
          if (thread.status === "idle") {
            await settle(c);
            touched++;
          } else if (thread.status === "error") {
            await this.handleFailed(c.threadId, null);
            touched++;
          }
        } catch (cause) {
          bb.log.warn(`bake-off sweep failed for ${c.id}: ${message(cause)}`);
        }
      }
      return touched;
    },
  };
}
