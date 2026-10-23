import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";

export interface FakeRow {
  id: string;
  threadId: string;
  seq: number;
  createdAt: number;
  type: string;
  scope: { kind: "turn"; turnId: string };
  data: unknown;
}

let rowSeq = 0;
export const resetRows = (): void => {
  rowSeq = 0;
};

export function cmdRow(threadId: string, turnId: string, command: string, exitCode: number, output = ""): FakeRow {
  rowSeq++;
  return {
    id: `ev${rowSeq}`,
    threadId,
    seq: rowSeq,
    createdAt: 1_700_000_000_000 + rowSeq,
    type: "item/completed",
    scope: { kind: "turn", turnId },
    data: {
      item: {
        type: "commandExecution",
        id: `cmd${rowSeq}`,
        command,
        cwd: "/work",
        status: exitCode === 0 ? "completed" : "failed",
        exitCode,
        aggregatedOutput: output,
      },
    },
  };
}

export function msgRow(threadId: string, turnId: string, text: string): FakeRow {
  rowSeq++;
  return {
    id: `ev${rowSeq}`,
    threadId,
    seq: rowSeq,
    createdAt: 1_700_000_000_000 + rowSeq,
    type: "item/completed",
    scope: { kind: "turn", turnId },
    data: { item: { type: "agentMessage", id: `msg${rowSeq}`, text } },
  };
}

export function doneRow(threadId: string, turnId: string): FakeRow {
  rowSeq++;
  return {
    id: `ev${rowSeq}`,
    threadId,
    seq: rowSeq,
    createdAt: 1_700_000_000_000 + rowSeq,
    type: "turn/completed",
    scope: { kind: "turn", turnId },
    data: { status: "completed" },
  };
}

export interface EventsArgs {
  afterSeq?: string;
  limit?: string;
}

// A events.list stub that honors afterSeq and clamps the page size, like a server might.
export function eventsStub(rows: () => FakeRow[], clamp = 200) {
  return async (args: EventsArgs): Promise<FakeRow[]> => {
    const after = Number(args.afterSeq ?? "0");
    const limit = Math.min(Number(args.limit ?? "200"), clamp);
    return rows()
      .filter((r) => r.seq > after)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
  };
}

export interface HostOptions {
  rows: () => FakeRow[];
  metadata?: Record<string, unknown>;
  clamp?: number;
  settings?: Record<string, unknown>;
  threads?: { id: string; updatedAt: number; archivedAt: number | null }[];
  // Events returned for specific thread ids (for example an advisor thread); other threads use `rows`.
  eventsByThread?: Record<string, FakeRow[]>;
  spawnFails?: boolean;
  archiveFails?: boolean;
  // Replaces the default spawn (for example to fail one provider or to return distinct ids).
  spawnImpl?: (args: unknown) => Promise<unknown>;
  // Extra sdk areas (providers, projects, environments, thread status overrides).
  areas?: Record<string, unknown>;
  getThread?: (threadId: string) => Record<string, unknown>;
  // threads.output text per thread id (default: "final text").
  outputs?: Record<string, string | null>;
}

export async function startHost(opts: HostOptions) {
  const updates: unknown[] = [];
  const spawned: unknown[] = [];
  const released: string[] = [];
  const base = eventsStub(opts.rows, opts.clamp);
  const { bb, harness } = createFakePluginHost({
    pluginId: "otto",
    settings: opts.settings ?? {},
    agentSkillIds: ["otto-evidence"],
    sdk: {
      threads: {
        events: {
          list: async (args: EventsArgs & { threadId: string }) => {
            const own = opts.eventsByThread?.[args.threadId];
            return own ? eventsStub(() => own)(args) : base(args);
          },
        },
        spawn: async (args: unknown) => {
          spawned.push(args);
          if (opts.spawnImpl) return opts.spawnImpl(args);
          if (opts.spawnFails) throw new Error("spawn exploded");
          return makeThreadResponse({ id: "adv_1", projectId: "proj_1" });
        },
        archive: async ({ threadId }: { threadId: string }) => {
          released.push(`archive:${threadId}`);
          if (opts.archiveFails) throw new Error("archive exploded");
          return {};
        },
        stop: async ({ threadId }: { threadId: string }) => {
          released.push(`stop:${threadId}`);
          return {};
        },
        get: async ({ threadId }: { threadId: string }) =>
          makeThreadResponse({
            id: threadId,
            projectId: "proj_1",
            providerId: "claude-code",
            title: "Fix it",
            environmentId: "env_1",
            ...(opts.getThread?.(threadId) ?? {}),
          }),
        output: async ({ threadId }: { threadId: string }) => ({ output: opts.outputs && threadId in opts.outputs ? opts.outputs[threadId] : "final text" }),
        getPluginMetadata: async () => opts.metadata ?? {},
        updatePluginMetadata: async (args: unknown) => {
          updates.push(args);
          return {};
        },
        list: async () =>
          (opts.threads ?? []).map((t) => ({ ...makeThreadResponse({ id: t.id }), updatedAt: t.updatedAt, archivedAt: t.archivedAt })),
      },
      ...(opts.areas ?? {}),
    },
  } as never);
  await plugin(bb);
  return { bb, harness, updates, spawned, released };
}
