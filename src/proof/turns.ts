// Group raw thread events into complete turns. Pure: no bb imports.
import { z } from "zod";
import { classifyCommand, type CheckKind } from "./classify";
import { commandRules, type CommandItem } from "./rules";
import { unwrapCommand } from "./shell";

export interface CommandExecutionItem extends CommandItem {
  id: string;
  cwd?: string;
  durationMs?: number;
  parentToolCallId?: string;
}

export interface FileChangeItem {
  id: string;
  changes: { path: string; kind: "add" | "delete" | "update"; diff?: string }[];
}

export type TurnItem =
  | { kind: "cmd"; seq: number; item: CommandExecutionItem; kinds: CheckKind[]; findings: string[] }
  | { kind: "file"; seq: number; item: FileChangeItem }
  | { kind: "msg"; seq: number; text: string };

export interface TurnInput {
  threadId: string;
  turnId: string;
  turnStatus: string; // data.status of turn/completed
  firstSeq: number;
  lastSeq: number; // seq of the turn/completed row
  completedAt: number; // createdAt of the turn/completed row
  items: TurnItem[]; // ascending seq
}

// The slice of bb's ThreadEventRow that grouping reads.
export interface EventRowLike {
  threadId: string;
  seq: number;
  createdAt: number;
  type: string;
  scope?: unknown;
  data?: unknown;
}

const commandSchema = z.looseObject({
  type: z.literal("commandExecution"),
  id: z.string(),
  command: z.string(),
  cwd: z.string().nullish(),
  status: z.enum(["pending", "completed", "failed", "interrupted"]),
  exitCode: z.number().nullish(),
  aggregatedOutput: z.string().nullish(),
  durationMs: z.number().nullish(),
  parentToolCallId: z.string().nullish(),
  truncation: z.looseObject({ aggregatedOutput: z.looseObject({ originalLength: z.number() }).nullish() }).nullish(),
});

const fileChangeSchema = z.looseObject({
  type: z.literal("fileChange"),
  id: z.string(),
  changes: z.array(
    z.looseObject({
      path: z.string(),
      kind: z.enum(["add", "delete", "update"]),
      diff: z.string().nullish(),
    }),
  ),
});

const messageSchema = z.looseObject({ type: z.literal("agentMessage"), id: z.string(), text: z.string() });

const turnIdOf = (scope: unknown): string | null => {
  if (typeof scope !== "object" || scope === null) return null;
  const s = scope as { kind?: unknown; turnId?: unknown };
  return s.kind === "turn" && typeof s.turnId === "string" ? s.turnId : null;
};

interface Parsed {
  skipped: boolean;
  item: TurnItem | null;
}

export function parseItem(row: EventRowLike): Parsed {
  const data = row.data;
  const raw = typeof data === "object" && data !== null ? (data as { item?: unknown }).item : undefined;
  const type = typeof raw === "object" && raw !== null ? (raw as { type?: unknown }).type : undefined;
  if (type === "commandExecution") {
    const r = commandSchema.safeParse(raw);
    if (!r.success) return { skipped: true, item: null };
    const d = r.data;
    const item: CommandExecutionItem = {
      id: d.id,
      command: d.command,
      status: d.status,
      ...(d.cwd != null ? { cwd: d.cwd } : {}),
      ...(d.exitCode != null ? { exitCode: d.exitCode } : {}),
      ...(d.aggregatedOutput != null ? { aggregatedOutput: d.aggregatedOutput } : {}),
      ...(d.durationMs != null ? { durationMs: d.durationMs } : {}),
      ...(d.parentToolCallId != null ? { parentToolCallId: d.parentToolCallId } : {}),
      ...(d.truncation?.aggregatedOutput ? { truncation: { aggregatedOutput: d.truncation.aggregatedOutput as { originalLength: number } & Record<string, number> } } : {}),
    };
    return {
      skipped: false,
      item: {
        kind: "cmd",
        seq: row.seq,
        item,
        kinds: classifyCommand(unwrapCommand(item.command)),
        findings: commandRules(item),
      },
    };
  }
  if (type === "fileChange") {
    const r = fileChangeSchema.safeParse(raw);
    if (!r.success) return { skipped: true, item: null };
    const changes = r.data.changes.map((c) => ({
      path: c.path,
      kind: c.kind,
      ...(c.diff != null ? { diff: c.diff } : {}),
    }));
    return { skipped: false, item: { kind: "file", seq: row.seq, item: { id: r.data.id, changes } } };
  }
  if (type === "agentMessage") {
    const r = messageSchema.safeParse(raw);
    if (!r.success) return { skipped: true, item: null };
    return { skipped: false, item: { kind: "msg", seq: row.seq, text: r.data.text } };
  }
  return { skipped: false, item: null }; // other item types are ignored, not malformed
}

export function groupTurnsWithStats(rows: readonly EventRowLike[]): { turns: TurnInput[]; skipped: number } {
  const byTurn = new Map<string, { items: TurnItem[]; firstSeq: number; completed: EventRowLike | null }>();
  let skipped = 0;
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  for (const row of sorted) {
    const turnId = turnIdOf(row.scope);
    if (turnId === null) continue;
    let bucket = byTurn.get(turnId);
    if (!bucket) {
      bucket = { items: [], firstSeq: row.seq, completed: null };
      byTurn.set(turnId, bucket);
    }
    if (row.type === "turn/completed") {
      bucket.completed = row;
    } else if (row.type === "item/completed") {
      const parsed = parseItem(row);
      if (parsed.skipped) skipped++;
      else if (parsed.item) bucket.items.push(parsed.item);
    }
  }
  const turns: TurnInput[] = [];
  for (const [turnId, b] of byTurn) {
    if (!b.completed) continue;
    const data = b.completed.data;
    const status =
      typeof data === "object" && data !== null && typeof (data as { status?: unknown }).status === "string"
        ? (data as { status: string }).status
        : "unknown";
    turns.push({
      threadId: b.completed.threadId,
      turnId,
      turnStatus: status,
      firstSeq: b.firstSeq,
      lastSeq: b.completed.seq,
      completedAt: b.completed.createdAt,
      items: b.items,
    });
  }
  turns.sort((a, b) => a.lastSeq - b.lastSeq);
  return { turns, skipped };
}

export function groupTurns(rows: readonly EventRowLike[]): TurnInput[] {
  return groupTurnsWithStats(rows).turns;
}
