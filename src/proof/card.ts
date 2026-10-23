// Build a proof card from one complete turn (BUILD_SPEC 6.8). Pure.
import type { Card, ClaimResult, Evidence, Finding } from "../shared/contract";
import {
  CLAIM_TEXT_CAP,
  COMMAND_CAP,
  EVIDENCE_CAP,
  FINDINGS_CAP,
  OUTPUT_TAIL_CAP,
  RULESET_VERSION,
} from "../shared/constants";
import { extractClaimSpans } from "./claims";
import { matchCustom, type CompiledRule } from "./custom";
import { parseCounts } from "./counts";
import { codesToFindings, severityRank } from "./rules";
import { unwrapCommand } from "./shell";
import type { TurnInput, TurnItem } from "./turns";
import { CLAIM_TO_KIND, decideVerdict, lastCheckIndex, lastMessageText, type SpecificClaim } from "./verdict";

export interface CardMeta {
  projectId: string;
  providerId: string | null;
  threadTitle: string | null;
}

type CmdItem = Extract<TurnItem, { kind: "cmd" }>;

const bareRuleId = (code: string): string => code.split(":")[0];

export function buildCard(turn: TurnInput, meta: CardMeta, now: number, custom: readonly CompiledRule[] = []): Card {
  const fullClaimText = lastMessageText(turn.items);
  const result = decideVerdict(turn);
  const spans = extractClaimSpans(fullClaimText);

  const kept: CmdItem[] = turn.items
    .filter((x): x is CmdItem => x.kind === "cmd" && (x.kinds.length > 0 || x.findings.length > 0))
    .slice(-EVIDENCE_CAP);

  const evidence: Evidence[] = kept.map((x) => {
    const output = x.item.aggregatedOutput ?? "";
    return {
      itemId: x.item.id,
      seq: x.seq,
      command: unwrapCommand(x.item.command).slice(0, COMMAND_CAP),
      kinds: x.kinds,
      exitCode: x.item.exitCode ?? null,
      status: x.item.status,
      durationMs: x.item.durationMs ?? null,
      counts: parseCounts(output),
      outputTail: output.slice(-OUTPUT_TAIL_CAP),
      truncated: x.item.truncation?.aggregatedOutput !== undefined,
      viaSubagent: x.item.parentToolCallId !== undefined,
      findingRuleIds: [...new Set(x.findings.map(bareRuleId))],
    };
  });

  const allFindings: Finding[] = kept.flatMap((x) => [
    ...codesToFindings(x.findings, x.item, x.item.id),
    ...matchCustom(custom, unwrapCommand(x.item.command), x.item.id),
  ]);
  const findings = allFindings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => severityRank(a.f.severity) - severityRank(b.f.severity) || a.i - b.i)
    .map((e) => e.f)
    .slice(0, FINDINGS_CAP);

  const claims: ClaimResult[] = result.claims.map((claim) => {
    const hit = spans.find((s) => s.claim === claim);
    const span = hit && hit.end <= CLAIM_TEXT_CAP ? { start: hit.start, end: hit.end } : null;
    if (claim === "done") return { claim, status: null, evidenceItemId: null, span };
    const specific: SpecificClaim = claim;
    const idx = lastCheckIndex(turn.items, CLAIM_TO_KIND[specific]);
    const at = idx >= 0 ? turn.items[idx] : undefined;
    return {
      claim,
      status: result.status[specific] ?? null,
      evidenceItemId: at && at.kind === "cmd" ? at.item.id : null,
      span,
    };
  });

  const editedFiles = turn.items.reduce((n, x) => (x.kind === "file" ? n + x.item.changes.length : n), 0);

  return {
    id: `${turn.threadId}:${turn.turnId}`,
    threadId: turn.threadId,
    projectId: meta.projectId,
    threadTitle: meta.threadTitle,
    turnId: turn.turnId,
    providerId: meta.providerId,
    turnStatus: turn.turnStatus,
    verdict: result.verdict,
    claimText: fullClaimText.slice(0, CLAIM_TEXT_CAP),
    claims,
    evidence,
    findings,
    editedFiles,
    firstSeq: turn.firstSeq,
    lastSeq: turn.lastSeq,
    rulesetVersion: RULESET_VERSION,
    createdAt: turn.completedAt,
    updatedAt: now,
  };
}
