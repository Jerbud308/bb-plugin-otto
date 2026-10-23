// Plain-text formatting shared by the CLI and the agent tool (BUILD_SPEC 10, 11.1). Pure.
import type { Card, Finding, RuleInfo } from "../shared/contract";

export function formatLintText(findings: Finding[]): string {
  if (findings.length === 0) return "OK: no findings";
  return findings.map((f) => `${f.ruleId} ${f.severity}  ${f.message} Fix: ${f.fixHint}`).join("\n");
}

export function shortTurnId(turnId: string): string {
  return turnId.length > 16 ? `${turnId.slice(0, 4)}...${turnId.slice(-4)}` : turnId;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

// Local time, YYYY-MM-DD HH:mm.
export function formatLocalTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatProofText(threadId: string, cards: Card[]): string {
  const title = cards[0]?.threadTitle ?? threadId;
  const lines = [`Otto proof for "${title}" (${threadId})`];
  if (cards.length === 0) {
    lines.push("No proof cards yet for this thread.");
    return lines.join("\n");
  }
  for (const card of cards) {
    const high = card.findings.filter((f) => f.severity === "high").length;
    const claims = card.claims.length ? card.claims.map((c) => c.claim).join(", ") : "none";
    const findings = card.findings.length === 0 ? "0" : high > 0 ? `${card.findings.length} (${high} high)` : String(card.findings.length);
    lines.push(
      `${card.verdict.padEnd(12)}  turn ${shortTurnId(card.turnId)}  ${formatLocalTime(card.createdAt)}  claims: ${claims}  findings: ${findings}`,
    );
    for (const f of card.findings) {
      if (f.severity === "low") continue;
      lines.push(`  ! ${f.ruleId} ${f.severity}  ${f.message}`);
    }
  }
  return lines.join("\n");
}

export function formatRulesText(rulesetVersion: number, rules: RuleInfo[]): string {
  const lines = [`Ruleset version ${rulesetVersion}`];
  for (const r of rules) {
    lines.push(`${r.id}  ${r.defaultSeverity.padEnd(6)}  ${r.effect.padEnd(7)}  ${r.title}`);
  }
  return lines.join("\n");
}

export interface LearnText {
  days: number;
  cardsInWindow: number;
  rules: { ruleId: string; title: string; count: number; threads: number; byProvider: { providerId: string; count: number }[] }[];
  suggestions: { ruleId: string; line: string }[];
}

export function formatLearnText(r: LearnText): string {
  const lines = [`Otto learn: last ${r.days} days, ${r.cardsInWindow} cards`];
  if (r.rules.length === 0) lines.push("No rule fired in this window.");
  for (const t of r.rules) {
    const split = t.byProvider.map((p) => `${p.providerId} ${p.count}`).join(", ");
    lines.push(`${t.ruleId}  ${t.count}x in ${t.threads} ${t.threads === 1 ? "thread" : "threads"}  (${split})  ${t.title}`);
  }
  if (r.suggestions.length > 0) {
    lines.push("", "Lines worth adding to your CLAUDE.md (Otto never writes the file):");
    for (const s of r.suggestions) lines.push(`- ${s.line}`);
  }
  return lines.join("\n");
}
