// Scanner: read new thread events, build proof cards, store them (BUILD_SPEC 8).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { buildCard } from "../proof/card";
import type { CompiledRule } from "../proof/custom";
import { groupTurnsWithStats, type EventRowLike } from "../proof/turns";
import { CHANNEL_CARDS, EVENTS_MAX_PAGES, EVENTS_PAGE_LIMIT, RULESET_VERSION } from "../shared/constants";
import { parseRole } from "../shared/role";
import type { OttoStore } from "./db";

const MAX_CONCURRENT_SCANS = 2;
const MAX_RECONCILE_THREADS = 1000;
const RECONCILE_PAGE = 200;
const EVENT_TYPES = ["item/completed", "turn/completed"] as const;

export interface ScanResult {
  cardsWritten: number;
}

export interface ReconcileResult {
  threads: number;
  cardsWritten: number;
}

export interface Scanner {
  scanThread(threadId: string, opts?: { reset?: boolean }): Promise<ScanResult>;
  enqueue(threadId: string): Promise<number>;
  reconcile(hours: number, opts?: { reset?: boolean; wait?: boolean }): Promise<ReconcileResult>;
  // Rebuild threads whose cards were written under an older ruleset; returns how many threads were rebuilt.
  rescanStale(limit: number): Promise<number>;
}

export function createScanner(
  bb: BbPluginApi,
  store: OttoStore,
  now: () => number = () => Date.now(),
  getCustom: () => readonly CompiledRule[] = () => [],
): Scanner {
  async function readRows(threadId: string, cursor: number): Promise<EventRowLike[]> {
    const rows: EventRowLike[] = [];
    let last = cursor;
    // Page until an EMPTY page: the server may clamp `limit` below what we ask for.
    for (let page = 0; page < EVENTS_MAX_PAGES; page++) {
      const batch = await bb.sdk.threads.events.list({
        threadId,
        types: EVENT_TYPES,
        afterSeq: String(last),
        limit: String(EVENTS_PAGE_LIMIT),
        order: "asc",
      });
      if (batch.length === 0) break;
      rows.push(...batch);
      for (const r of batch) if (r.seq > last) last = r.seq;
    }
    return rows;
  }

  async function scanThread(threadId: string, opts: { reset?: boolean } = {}): Promise<ScanResult> {
    if (opts.reset) store.resetThread(threadId);
    const metadata = await bb.sdk.threads.getPluginMetadata({ threadId });
    if (parseRole(metadata) === "advisor") return { cardsWritten: 0 };

    const rows = await readRows(threadId, store.getCursor(threadId));
    const { turns, skipped } = groupTurnsWithStats(rows);
    if (skipped > 0) bb.log.debug(`thread ${threadId}: skipped ${skipped} unreadable event rows`);
    if (turns.length === 0) return { cardsWritten: 0 };

    const thread = await bb.sdk.threads.get({ threadId });
    const meta = { projectId: thread.projectId, providerId: thread.providerId ?? null, threadTitle: thread.title ?? null };
    const stamp = now();
    const cards = turns.map((turn) => buildCard(turn, meta, stamp, getCustom()));
    for (const card of cards) store.upsertCard(card);
    store.setCursor(threadId, Math.max(...turns.map((t) => t.lastSeq)), stamp);

    const latest = store.latestForThread(threadId);
    if (latest) {
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        set: { verdict: latest.verdict, cardId: latest.id, scannedAt: stamp },
      });
    }
    bb.realtime.publish(CHANNEL_CARDS, { threadId });
    return { cardsWritten: cards.length };
  }

  // ---- queue: one scan per thread at a time, at most 2 threads at once ----
  const tails = new Map<string, Promise<unknown>>();
  const queued = new Map<string, Promise<number>>();
  let running = 0;
  const slotWaiters: (() => void)[] = [];

  async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    while (running >= MAX_CONCURRENT_SCANS) await new Promise<void>((resolve) => slotWaiters.push(resolve));
    running++;
    try {
      return await fn();
    } finally {
      running--;
      slotWaiters.shift()?.();
    }
  }

  function locked<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(threadId) ?? Promise.resolve();
    const run = prev.then(
      () => withSlot(fn),
      () => withSlot(fn),
    );
    tails.set(threadId, run);
    const cleanup = (): void => {
      if (tails.get(threadId) === run) tails.delete(threadId);
    };
    run.then(cleanup, cleanup);
    return run;
  }

  async function safeScan(threadId: string, opts?: { reset?: boolean }): Promise<number> {
    try {
      return (await scanThread(threadId, opts)).cardsWritten;
    } catch (cause) {
      bb.log.warn(`scan failed for ${threadId}: ${cause instanceof Error ? cause.message : String(cause)}`);
      return 0;
    }
  }

  function enqueue(threadId: string): Promise<number> {
    const waiting = queued.get(threadId);
    if (waiting) return waiting; // extra requests coalesce into the one waiter
    const p = locked(threadId, () => {
      queued.delete(threadId);
      return safeScan(threadId);
    });
    queued.set(threadId, p);
    return p;
  }

  function scanLocked(threadId: string, opts: { reset?: boolean } = {}): Promise<ScanResult> {
    // Unlike the background queue, a direct request reports failures to its caller.
    return locked(threadId, () => scanThread(threadId, opts));
  }

  async function reconcile(
    hours: number,
    opts: { reset?: boolean; wait?: boolean } = {},
  ): Promise<ReconcileResult> {
    const cutoff = now() - hours * 3_600_000;
    const ids: string[] = [];
    let seen = 0;
    for (let offset = 0; seen < MAX_RECONCILE_THREADS; offset += RECONCILE_PAGE) {
      const page = await bb.sdk.threads.list({ limit: RECONCILE_PAGE, offset, archived: false });
      for (const t of page) {
        if (t.archivedAt === null && t.updatedAt >= cutoff) ids.push(t.id);
      }
      seen += page.length;
      if (page.length < RECONCILE_PAGE) break;
    }
    if (opts.wait !== true) {
      for (const id of ids) void (opts.reset ? safeScan(id, { reset: true }) : enqueue(id));
      return { threads: ids.length, cardsWritten: 0 };
    }
    let cardsWritten = 0;
    for (const id of ids) {
      cardsWritten += opts.reset
        ? await locked(id, () => safeScan(id, { reset: true }))
        : await enqueue(id);
    }
    return { threads: ids.length, cardsWritten };
  }

  async function rescanStale(limit: number): Promise<number> {
    let done = 0;
    for (const id of store.staleThreadIds(RULESET_VERSION, limit)) {
      await locked(id, () => safeScan(id, { reset: true }));
      done++;
    }
    return done;
  }

  return { scanThread: scanLocked, enqueue, reconcile, rescanStale };
}
