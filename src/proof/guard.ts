// Budget guard decision (V2 A3). Pure: no bb imports, so it can be fixture-tested.
export type GuardMode = "off" | "warn" | "wait" | "reject";

export interface GuardConfig {
  mode: GuardMode;
  windowPercent: number; // a plan window at or above this percent is "over"
  projectTokenCap: number; // 0 means no cap
  projectIds: string[]; // empty means every project
  waitFallbackMs: number; // how long a wait lasts when no plan window gives a reset time
}

export interface PlanWindowLike {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}

export interface GuardInput {
  config: GuardConfig;
  attempt: "start-turn" | "join-turn";
  projectId: string;
  windows: readonly PlanWindowLike[]; // the plan windows of the thread's provider
  projectTokens: number;
  now: number;
}

export type GuardDecision =
  | { action: "proceed" }
  | { action: "warn"; reason: string }
  | { action: "wait"; reason: string; sendAt: number }
  | { action: "reject"; message: string };

export const parseGuardMode = (value: unknown): GuardMode =>
  value === "warn" || value === "wait" || value === "reject" ? value : "off";

export function parseProjectIds(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

export function overLimitReasons(input: GuardInput): { reasons: string[]; resets: number[] } {
  const { config, windows, projectTokens } = input;
  const reasons: string[] = [];
  const resets: number[] = [];
  for (const w of windows) {
    if (w.usedPercent >= config.windowPercent) {
      reasons.push(`plan window "${w.label}" is at ${Math.round(w.usedPercent)}% (limit ${config.windowPercent}%)`);
      const t = w.resetsAt === null ? Number.NaN : Date.parse(w.resetsAt);
      if (Number.isFinite(t) && t > input.now) resets.push(t);
    }
  }
  if (config.projectTokenCap > 0 && projectTokens >= config.projectTokenCap) {
    reasons.push(`this project has used ${fmt(projectTokens)} tokens (cap ${fmt(config.projectTokenCap)})`);
  }
  return { reasons, resets };
}

export function decideGuard(input: GuardInput): GuardDecision {
  const { config } = input;
  if (config.mode === "off") return { action: "proceed" };
  if (input.attempt === "join-turn") return { action: "proceed" }; // the thread already holds its slot
  if (config.projectIds.length > 0 && !config.projectIds.includes(input.projectId)) return { action: "proceed" };
  const { reasons, resets } = overLimitReasons(input);
  if (reasons.length === 0) return { action: "proceed" };
  const text = `Otto guard: ${reasons.join("; ")}.`;
  if (config.mode === "warn") return { action: "warn", reason: text };
  if (config.mode === "wait") {
    const sendAt = resets.length > 0 ? Math.min(...resets) : input.now + config.waitFallbackMs;
    return { action: "wait", reason: text, sendAt };
  }
  return { action: "reject", message: `${text} Change Guard mode in Settings, Installed plugins, Otto.` };
}
