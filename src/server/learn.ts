// Learns service: trends and suggestions over the cards Otto already stores. Pro and Operator only.
import { suggestions as suggest, trends as trend } from "../proof/learn";
import { RULES } from "../proof/rules";
import type { LearnSuggestion, LearnTrend } from "../shared/contract";
import type { OttoStore } from "./db";
import type { OttoSettings } from "./state";

export const PRO_ONLY_LEARN = "Learn needs Pro or Operator mode. Change Mode in Settings, Installed plugins, Otto.";
const DAY_MS = 86_400_000;
const TITLES = new Map(RULES.map((r) => [r.id, r.title]));
const titleOf = (ruleId: string): string => TITLES.get(ruleId) ?? (ruleId.startsWith("USER") ? "Custom rule" : ruleId);

export interface Learn {
  trends(days: 7 | 30 | 90): Promise<{ days: 7 | 30 | 90; cardsInWindow: number; rules: LearnTrend[] }>;
  suggestions(days: 7 | 30 | 90): Promise<{ days: 7 | 30 | 90; suggestions: LearnSuggestion[] }>;
}

export function createLearn(store: OttoStore, getSettings: () => Promise<OttoSettings>, now: () => number = () => Date.now()): Learn {
  const load = async (days: 7 | 30 | 90) => {
    if ((await getSettings()).mode === "starter") throw new Error(PRO_ONLY_LEARN);
    const at = now();
    const rules = trend(store.learnRows(at - days * DAY_MS), days, at);
    return { at, rules };
  };
  return {
    async trends(days) {
      const { at, rules } = await load(days);
      const cardsInWindow = Object.values(store.countsSince(at - days * DAY_MS)).reduce((a, b) => a + b, 0);
      return { days, cardsInWindow, rules: rules.map((r) => ({ ...r, title: titleOf(r.ruleId) })) };
    },
    async suggestions(days) {
      const { rules } = await load(days);
      return { days, suggestions: suggest(rules).map((s) => ({ ...s, title: titleOf(s.ruleId) })) };
    },
  };
}
