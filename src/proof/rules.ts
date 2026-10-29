// Finding rules. commandRules is ported from the reference engine; the Finding conversion,
// RULES metadata, and lintCommand follow BUILD_SPEC 6.6.
import type { Finding, RuleInfo } from "../shared/contract";
import { RULESET_VERSION } from "../shared/constants";
import { classifyCommand, classifyStage, normalizeStage } from "./classify";
import { parseCounts } from "./counts";
import { segmentsOf, splitPipeline, stripHeredocBodies, unwrapCommand } from "./shell";

export { RULESET_VERSION };

export type CommandStatus = "pending" | "completed" | "failed" | "interrupted";

export interface CommandItem {
  command: string;
  status: CommandStatus;
  exitCode?: number;
  aggregatedOutput?: string;
  truncation?: { aggregatedOutput?: { originalLength: number } & Record<string, number> };
}

// A command tagged `# otto:expect-fail` (or `# otto:baseline`) is meant to fail: a deliberate
// break, or a run on the old code to show a failure was already there. Its failures are not findings.
export const EXPECT_FAIL = /#\s*otto:(?:expect-fail|baseline)\b/;

const FAILURE_CODE = /^OTTO00[567]\b/;

// Returns finding codes. "OTTO003:medium" is rule OTTO003 at severity medium; a bare "OTTO001"
// uses the rule's default severity.
export function commandRules(item: CommandItem): string[] {
  const f = baseRules(item);
  return EXPECT_FAIL.test(item.command) ? f.filter((c) => !FAILURE_CODE.test(c)) : f;
}

function baseRules(item: CommandItem): string[] {
  const cmd = unwrapCommand(item.command);
  const out = item.aggregatedOutput ?? "";
  const f: string[] = [];
  const stripped = stripHeredocBodies(cmd);
  const segs = segmentsOf(cmd);
  const kinds = classifyCommand(cmd);
  const isVer = kinds.length > 0;
  const hasPipefail = /\bpipefail\b/.test(stripped);
  const pipestatus = /PIPESTATUS|pipestatus/.test(stripped);
  const segStages = segs.map((s) => splitPipeline(s.text));
  const segVer = segStages.map((st) => st.map(classifyStage));
  // 001
  segStages.forEach((st, i) => {
    if (st.length >= 2 && !hasPipefail && !pipestatus && segVer[i].slice(0, -1).some((k) => k.length > 0)) f.push("OTTO001");
  });
  // 002
  for (let j = 1; j < segs.length; j++) {
    if (/\$\?/.test(segs[j].text) && !pipestatus && segStages[j - 1].length >= 2) {
      f.push("OTTO002");
      break;
    }
  }
  // 003
  let v = -1;
  segVer.forEach((ks, i) => {
    if (ks.some((k) => k.length > 0)) v = i;
  });
  if (v >= 0 && v < segs.length - 1) {
    const after = segs.slice(v + 1);
    const printed = /^(?:echo|printf)\b[^>]*\$\?[^>]*$/.test(segs[v + 1].text) && segStages[v].length === 1;
    if (!printed) {
      if (after.some((s) => s.joiner === "||")) f.push("OTTO003:high");
      else if (after.some((s) => s.joiner === ";" || s.joiner === "\n")) f.push("OTTO003:medium");
    }
  }
  // 004
  const grepStages = segStages.flat().filter((st) => /^(?:grep|egrep|rg)\b/.test(normalizeStage(st)));
  const looksForFail = grepStages.some((st) => /fail|error/i.test(st));
  if (
    isVer &&
    !looksForFail &&
    (grepStages.some((st) => /pass|success|\bok\b|green/i.test(st)) || /(?:==|=~)\s*["']?\*?pass/i.test(stripped))
  )
    f.push("OTTO004");
  const c = parseCounts(out);
  const attributable = segs.every(
    (sg, i) =>
      segVer[i].some((k) => k.length > 0) ||
      /^(?:cd|set|export|echo|printf|true|:)\b/.test(sg.text) ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(sg.text),
  );
  if (isVer && item.exitCode === 0 && ((c.failed ?? 0) > 0 || c.failLines > 0 || c.tsErrors > 0))
    f.push(attributable ? "OTTO005" : "OTTO005:medium");
  // Ruleset 2: a non-zero exit that belongs to a trailing `;` command (not the check) is masking, not failure.
  const lastSeg = segs[segs.length - 1];
  const ownedByTrailing =
    item.exitCode !== undefined &&
    item.exitCode !== 0 &&
    v >= 0 &&
    v < segs.length - 1 &&
    (lastSeg.joiner === ";" || lastSeg.joiner === "\n") &&
    !/^(?:cd|set|export|echo|printf|true|:)\b/.test(lastSeg.text) &&
    !/^[A-Za-z_][A-Za-z0-9_]*=/.test(lastSeg.text);
  if (isVer && ((item.exitCode !== undefined && item.exitCode !== 0) || item.status === "failed")) {
    f.push(ownedByTrailing ? "OTTO006:medium" : "OTTO006");
  }
  if (isVer && OTTO007_LINE.test(out)) {
    const wrapperLine = new RegExp(`^\\s*exit code\\s+${item.exitCode}\\s*$`, "i");
    const wrapperOnly =
      ownedByTrailing &&
      out
        .split(/\r?\n/)
        .filter((l) => OTTO007_LINE.test(l))
        .every((l) => wrapperLine.test(l));
    f.push(wrapperOnly ? "OTTO007:medium" : "OTTO007");
  }
  if (
    kinds.includes("ci") &&
    (/"conclusion"\s*:\s*(?:""|null)/.test(out) ||
      /"status"\s*:\s*"(?:IN_PROGRESS|QUEUED|PENDING|WAITING|REQUESTED)"/.test(out) ||
      /\.conclusion\s*\/\//.test(stripped) ||
      (/\bgh\s+pr\s+checks\b/.test(stripped) && /\b(?:pending|queued|in_progress)\b/i.test(out)))
  )
    f.push("OTTO008");
  if (
    /statusCheckRollup/.test(stripped) &&
    /conclusion/.test(stripped) &&
    !/__typename/.test(stripped) &&
    !/\.state\b|"state"/.test(stripped)
  )
    f.push("OTTO009");
  if (isVer && item.truncation?.aggregatedOutput) f.push("OTTO010");
  if (isVer && (item.status === "completed" || item.status === "failed") && item.exitCode === undefined) f.push("OTTO011");
  if (/--include=(?!['"])[^\s'"]*[*?[]/.test(stripped)) f.push("OTTO012");
  if (isVer && (item.status === "interrupted" || item.status === "pending")) f.push("OTTO013");
  return f;
}

const OTTO007_LINE = /^\s*(?:\S+\s+)?(?:(?:exit(?:[ _-]?code)?|rc)\s*[=:]?|(?:status|code)\s*[=:])\s*[1-9]\d{0,2}\s*$/im;

// ---- Metadata ----

export const RULES: RuleInfo[] = [
  {
    id: "OTTO001",
    title: "Pipe hides the check's exit code",
    defaultSeverity: "high",
    effect: "masking",
    description: "Exit code belongs to the last stage of the pipe, not to the check.",
    fixHint: 'Add "set -o pipefail", or redirect the check to a file and read its exit status on its own line.',
  },
  {
    id: "OTTO002",
    title: "$? read after a pipe",
    defaultSeverity: "high",
    effect: "masking",
    description: '"$?" after a pipe reports the last stage of the pipe, not the check.',
    fixHint: "Use ${PIPESTATUS[0]} in bash or ${pipestatus[1]} in zsh, or redirect the check to a file first.",
  },
  {
    id: "OTTO003",
    title: "A later command owns the exit code",
    defaultSeverity: "medium",
    effect: "masking",
    description: "The reported exit code belongs to a command that ran after the check.",
    fixHint: 'End the command with the check, or print its status with echo "exit=$?" right after it.',
  },
  {
    id: "OTTO004",
    title: "Success asserted by matching a word",
    defaultSeverity: "high",
    effect: "masking",
    description: 'Matching a success word also matches a failing summary such as "Tests 2 failed | 284 passed".',
    fixHint: 'Assert the exit status, and count lines containing "failed" separately.',
  },
  {
    id: "OTTO005",
    title: "Output reports failures",
    defaultSeverity: "high",
    effect: "failure",
    description: "Exit code was 0 but the output reports failures.",
    fixHint: "Run the check on its own and read its exit status.",
  },
  {
    id: "OTTO006",
    title: "The check failed",
    defaultSeverity: "high",
    effect: "failure",
    description: "The check exited non-zero.",
    fixHint: "Fix the failure, then rerun the check.",
  },
  {
    id: "OTTO007",
    title: "Output prints a non-zero status",
    defaultSeverity: "high",
    effect: "failure",
    description: "The output prints a non-zero exit status.",
    fixHint: "Fix the failure, then rerun the check.",
  },
  {
    id: "OTTO008",
    title: "CI still running read as settled",
    defaultSeverity: "high",
    effect: "masking",
    description: 'A CI check that is still running reads as settled (empty "conclusion" or a pending status).',
    fixHint: 'Wait on ".status", count unsettled checks, and treat only conclusion == "SUCCESS" as green.',
  },
  {
    id: "OTTO009",
    title: "StatusContext entries dropped",
    defaultSeverity: "medium",
    effect: "info",
    description: 'Filtering statusCheckRollup on "conclusion" drops StatusContext entries, which carry "state" instead.',
    fixHint: 'Branch on "__typename".',
  },
  {
    id: "OTTO010",
    title: "Output truncated",
    defaultSeverity: "low",
    effect: "info",
    description: "bb truncated this output, so failure counts may be incomplete.",
    fixHint: "Write the check's output to a file and print only its summary lines.",
  },
  {
    id: "OTTO011",
    title: "No exit code recorded",
    defaultSeverity: "medium",
    effect: "masking",
    description: "The check finished but no exit code was recorded.",
    fixHint: "Rerun the check.",
  },
  {
    id: "OTTO012",
    title: "Unquoted --include glob",
    defaultSeverity: "medium",
    effect: "info",
    description: 'Unquoted --include glob: zsh expands it before grep runs, so "no matches" may mean grep never ran.',
    fixHint: "Quote the glob: --include='*.ts'.",
  },
  {
    id: "OTTO013",
    title: "The check never finished",
    defaultSeverity: "medium",
    effect: "masking",
    description: "The check never finished.",
    fixHint: "Rerun the check.",
  },
];

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

const rank = { high: 0, medium: 1, low: 2 } as const;
export function severityRank(s: Finding["severity"]): number {
  return rank[s];
}

function summaryOf(output: string): string {
  const c = parseCounts(output);
  const parts: string[] = [];
  if ((c.failed ?? 0) > 0) parts.push(`${c.failed} failed`);
  if (c.tsErrors > 0) parts.push(`${c.tsErrors} TypeScript ${c.tsErrors === 1 ? "error" : "errors"}`);
  if (c.failLines > 0) parts.push(`${c.failLines} FAIL ${c.failLines === 1 ? "line" : "lines"}`);
  return parts.join(", ");
}

function statusLine(output: string): string {
  for (const line of output.split(/\r?\n/)) if (OTTO007_LINE.test(line)) return line.trim().slice(0, 80);
  return "";
}

function messageFor(id: string, severity: string, item: CommandItem): string {
  const cmd = unwrapCommand(item.command);
  const segs = segmentsOf(cmd);
  const exit = item.exitCode === undefined ? "none" : String(item.exitCode);
  const out = item.aggregatedOutput ?? "";
  switch (id) {
    case "OTTO001": {
      const hit = segs
        .map((s) => splitPipeline(s.text))
        .find((st) => st.length >= 2 && st.slice(0, -1).some((s) => classifyStage(s).length > 0));
      const last = (hit ?? splitPipeline(segs[segs.length - 1]?.text ?? cmd)).slice(-1)[0] ?? "";
      return `Exit code ${exit} belongs to "${last.slice(0, 60)}", the last stage of the pipe, not to the check.`;
    }
    case "OTTO002":
      return '"$?" after a pipe reports the last stage of the pipe, not the check.';
    case "OTTO003": {
      if (severity === "high") return '"|| ..." after the check turns a failure into exit 0.';
      const last = segs[segs.length - 1]?.text ?? "";
      return `The reported exit code belongs to "${last.slice(0, 60)}", which ran after the check.`;
    }
    case "OTTO004":
      return 'Matching a success word also matches a failing summary such as "Tests 2 failed | 284 passed".';
    case "OTTO005":
      return severity === "medium"
        ? `The output reports failures (${summaryOf(out)}), but other commands' output is mixed in, so it cannot be tied to the check.`
        : `Exit code was 0 but the output reports failures (${summaryOf(out)}).`;
    case "OTTO006":
      return severity === "medium"
        ? `The command exited ${exit}, but "${(segs[segs.length - 1]?.text ?? "").slice(0, 60)}" ran after the check and may own that exit code.`
        : `The check exited ${exit}.`;
    case "OTTO007":
      return severity === "medium"
        ? `bb reports a non-zero exit, but "${(segs[segs.length - 1]?.text ?? "").slice(0, 60)}" ran after the check and may own it.`
        : `The output prints a non-zero exit status: "${statusLine(out)}".`;
    case "OTTO010":
      return `bb truncated this output (${item.truncation?.aggregatedOutput?.originalLength ?? 0} characters), so failure counts may be incomplete.`;
    case "OTTO013":
      return `The check never finished (status ${item.status}).`;
    default:
      return RULE_BY_ID.get(id)?.description ?? id;
  }
}

// One Finding per rule per command: duplicate codes (one per pipe segment) collapse to the first.
export function codesToFindings(codes: string[], item: CommandItem, itemId: string): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    const [id, sev] = code.split(":");
    const meta = RULE_BY_ID.get(id);
    if (!meta) continue;
    const severity = (sev as Finding["severity"] | undefined) ?? meta.defaultSeverity;
    const effect: Finding["effect"] =
      (id === "OTTO005" || id === "OTTO006" || id === "OTTO007") && sev === "medium" ? "masking" : meta.effect;
    out.push({ ruleId: id, severity, effect, message: messageFor(id, severity, item), fixHint: meta.fixHint, itemId });
  }
  return out;
}

const LINT_RULES = new Set(["OTTO001", "OTTO002", "OTTO003", "OTTO004", "OTTO008", "OTTO009", "OTTO012"]);

export function lintCommand(command: string): Finding[] {
  const item: CommandItem = { command, status: "completed", exitCode: 0, aggregatedOutput: "" };
  return codesToFindings(commandRules(item), item, "lint").filter((f) => LINT_RULES.has(f.ruleId));
}
