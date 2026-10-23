// User-defined rules (BUILD V2 A1). They only ever add informational findings: a custom rule never changes a verdict.
import { z } from "zod";
import type { Finding } from "../shared/contract";

export const customRuleSchema = z.object({
  id: z.string().regex(/^USER\d{1,3}$/),
  title: z.string().min(1).max(80),
  pattern: z.string().min(1).max(200),
  message: z.string().min(1).max(300),
  fixHint: z.string().max(300).default(""),
});

export type CustomRule = z.infer<typeof customRuleSchema>;
export interface CompiledRule {
  rule: CustomRule;
  re: RegExp;
}

const MAX_RULES = 20;

// Invalid JSON, an invalid rule, a bad regex, or a repeated id drops that rule (reported through warn), never the rest.
export function parseCustomRules(json: string, warn: (message: string) => void = () => undefined): CompiledRule[] {
  const text = json.trim();
  if (text === "" || text === "[]") return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    warn("customRulesJson is not valid JSON; custom rules ignored");
    return [];
  }
  if (!Array.isArray(raw)) {
    warn("customRulesJson must be a JSON array; custom rules ignored");
    return [];
  }
  const seen = new Set<string>();
  const out: CompiledRule[] = [];
  for (const entry of raw.slice(0, MAX_RULES)) {
    const parsed = customRuleSchema.safeParse(entry);
    if (!parsed.success) {
      warn("a custom rule is invalid and was ignored");
      continue;
    }
    if (seen.has(parsed.data.id)) {
      warn(`custom rule ${parsed.data.id} is repeated and was ignored`);
      continue;
    }
    try {
      out.push({ rule: parsed.data, re: new RegExp(parsed.data.pattern) });
      seen.add(parsed.data.id);
    } catch {
      warn(`custom rule ${parsed.data.id} has an invalid pattern and was ignored`);
    }
  }
  return out;
}

export function matchCustom(rules: readonly CompiledRule[], command: string, itemId: string): Finding[] {
  return rules
    .filter((c) => c.re.test(command))
    .map((c) => ({
      ruleId: c.rule.id,
      severity: "low" as const,
      effect: "info" as const,
      message: `${c.rule.title}: ${c.rule.message}`,
      fixHint: c.rule.fixHint,
      itemId,
    }));
}
