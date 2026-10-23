// Pure geometry for the Bake-off race (BUILD_SPEC 14.5). All times are elapsed milliseconds from startedAt.
import type { Lane } from "../src/shared/contract";

export interface LaneTick {
  ms: number;
  kind: "cmd" | "check" | "failedCheck";
}

export interface LaneView {
  contestantId: string;
  providerId: string;
  status: Lane["status"];
  running: boolean;
  failed: boolean;
  endMs: number;
  ticks: LaneTick[];
  // Commands this lane had run when the first lane finished; null when it finished first or no one has finished.
  atFirstFinish: number | null;
}

export interface RaceView {
  spanMs: number;
  axis: number[];
  firstFinishMs: number | null;
  lanes: LaneView[];
}

const MINUTE = 60_000;

export function axisTicks(spanMs: number): number[] {
  const step = spanMs > 20 * MINUTE ? 5 * MINUTE : MINUTE;
  const out: number[] = [];
  for (let ms = 0; ms <= spanMs; ms += step) out.push(ms);
  return out;
}

export function buildRace(startedAt: number, lanes: Lane[], now: number): RaceView {
  const running = (l: Lane): boolean => l.status === "starting" || l.status === "running";
  const elapsed = (epoch: number): number => Math.max(0, epoch - startedAt);
  const anyRunning = lanes.some(running);
  const endOf = (l: Lane): number => (running(l) || l.finishedAt === null ? elapsed(now) : elapsed(l.finishedAt));
  const finished = lanes.filter((l) => l.status === "idle" && l.finishedAt !== null);
  const firstFinishMs = finished.length > 0 ? Math.min(...finished.map((l) => elapsed(l.finishedAt ?? now))) : null;
  const latest = anyRunning ? elapsed(now) : Math.max(0, ...lanes.map(endOf));
  const spanMs = Math.max(1000, latest);
  return {
    spanMs,
    axis: axisTicks(spanMs),
    firstFinishMs,
    lanes: lanes.map((l) => {
      const ticks = l.ticks.map((t) => ({ ms: Math.min(elapsed(t.t), spanMs), kind: t.kind }));
      const endMs = Math.min(endOf(l), spanMs);
      const behind = firstFinishMs !== null && (running(l) || endMs > firstFinishMs);
      return {
        contestantId: l.contestantId,
        providerId: l.providerId,
        status: l.status,
        running: running(l),
        failed: l.status === "failed",
        endMs,
        ticks,
        atFirstFinish: behind ? ticks.filter((t) => t.ms <= (firstFinishMs ?? 0)).length : null,
      };
    }),
  };
}

export const pct = (ms: number, spanMs: number): number => Math.min(100, Math.max(0, (ms / spanMs) * 100));
