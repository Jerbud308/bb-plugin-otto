import type { CompiledRule } from "../proof/custom";
import { parseGuardMode, parseProjectIds, type GuardConfig } from "../proof/guard";

// Per-load state. Never hold the bb object in module scope: build this inside the factory.
export type Mode = "starter" | "pro" | "operator";

export interface OttoSettings {
  mode: Mode;
  reconcileWindowHours: number;
  advisorProviderId: string;
  advisorModel: string;
  advisorTimeoutMinutes: number;
  customRulesJson: string;
  guardMode: string;
  guardWindowPercent: number;
  guardProjectTokenCap: number;
  guardProjectIds: string;
  guardWaitSeconds: number;
}

export function parseMode(value: unknown): Mode {
  return value === "pro" || value === "operator" ? value : "starter";
}

export interface OttoState {
  // Cached for the synchronous bb.agents.configure callback. Updated in settings.onChange.
  mode: Mode;
  customRules: CompiledRule[];
  guard: GuardConfig;
}

export function guardConfigOf(s: Pick<OttoSettings, "guardMode" | "guardWindowPercent" | "guardProjectTokenCap" | "guardProjectIds" | "guardWaitSeconds">): GuardConfig {
  return {
    mode: parseGuardMode(s.guardMode),
    windowPercent: Number.isFinite(s.guardWindowPercent) ? s.guardWindowPercent : 95,
    projectTokenCap: Number.isFinite(s.guardProjectTokenCap) ? s.guardProjectTokenCap : 0,
    projectIds: parseProjectIds(typeof s.guardProjectIds === "string" ? s.guardProjectIds : ""),
    waitFallbackMs: (Number.isFinite(s.guardWaitSeconds) ? s.guardWaitSeconds : 900) * 1000,
  };
}

export function createState(initial: OttoSettings): OttoState {
  return { mode: initial.mode, customRules: [], guard: guardConfigOf(initial) };
}
