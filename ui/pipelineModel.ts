// Pure helpers for the Pipelines tab. No React.
import { keyFromLabel } from "../src/proof/pipeline";
import type { StageDefRecord } from "../src/shared/contract";

// Move one stage from index `from` to index `to`; out-of-range or equal indexes return the list unchanged.
export function moveStage<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// Where the selected index lands after a move, so the highlighted stage follows its box.
export function followSelection(selected: number, from: number, to: number): number {
  if (selected === from) return to;
  if (from < selected && to >= selected) return selected - 1;
  if (from > selected && to <= selected) return selected + 1;
  return selected;
}

export function blankStage(label: string, providerId: string, taken: StageDefRecord[]): StageDefRecord {
  return {
    key: keyFromLabel(label, taken.map((s) => s.key)),
    label,
    providerId,
    prompt: "{{input}}",
    gate: "none",
  };
}

export const GATE_WORD = {
  none: "Always continue",
  stop_on_contradicted: "Stop if the agent's claim is contradicted",
  require_not_unverified: "Stop unless the work is proven",
} as const;

export const STAGE_WORD = { pending: "Waiting", running: "Running", idle: "Done", failed: "Failed", skipped: "Skipped" } as const;
export const RUN_WORD = { running: "Running", done: "Finished", failed: "Failed", stopped: "Stopped" } as const;

export function payloadRunId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { runId?: unknown }).runId;
  return typeof id === "string" ? id : null;
}
