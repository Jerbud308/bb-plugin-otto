// Learns: how often each rule fires, and a ready-to-copy CLAUDE.md line for the traps that repeat. Pure.
// Otto never writes the line anywhere; the user copies it.
export interface LearnRow {
  ruleId: string;
  providerId: string;
  threadId: string;
  createdAt: number;
}

export interface RuleTrend {
  ruleId: string;
  count: number;
  threads: number;
  byProvider: { providerId: string; count: number }[];
  // Oldest week first; the last entry is the most recent seven days.
  weekly: number[];
  lastAt: number;
}

export interface Suggestion {
  ruleId: string;
  count: number;
  line: string;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export function trends(rows: LearnRow[], windowDays: number, now: number): RuleTrend[] {
  const since = now - windowDays * DAY_MS;
  const weeks = Math.ceil(windowDays / 7);
  const byRule = new Map<string, { count: number; threads: Set<string>; providers: Map<string, number>; weekly: number[]; lastAt: number }>();
  for (const row of rows) {
    if (row.createdAt < since) continue;
    let t = byRule.get(row.ruleId);
    if (!t) {
      t = { count: 0, threads: new Set(), providers: new Map(), weekly: new Array<number>(weeks).fill(0), lastAt: 0 };
      byRule.set(row.ruleId, t);
    }
    t.count += 1;
    t.threads.add(row.threadId);
    t.providers.set(row.providerId, (t.providers.get(row.providerId) ?? 0) + 1);
    const ago = Math.max(0, Math.floor((now - row.createdAt) / WEEK_MS));
    t.weekly[Math.max(0, weeks - 1 - Math.min(ago, weeks - 1))] += 1;
    t.lastAt = Math.max(t.lastAt, row.createdAt);
  }
  return [...byRule.entries()]
    .map(([ruleId, t]) => ({
      ruleId,
      count: t.count,
      threads: t.threads.size,
      byProvider: [...t.providers.entries()]
        .map(([providerId, count]) => ({ providerId, count }))
        .sort((a, b) => b.count - a.count || a.providerId.localeCompare(b.providerId)),
      weekly: t.weekly,
      lastAt: t.lastAt,
    }))
    .sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId));
}

// One imperative sentence per rule that describes a habit an agent can drop. Outcome rules
// (a check failed, output reports failures) are not habits, so they have no line.
export const SUGGESTION_LINES: Readonly<Record<string, string>> = {
  OTTO001: "Never pipe a verification command into tail or head and trust the result; redirect its output to a file and read the exit status on its own line.",
  OTTO002: "Never read $? after a pipeline; use ${PIPESTATUS[0]} in bash or ${pipestatus[1]} in zsh, or redirect the check to a file first.",
  OTTO003: 'End a verification command with the check itself, or print its status with echo "exit=$?" right after it, because a later command overwrites the exit code.',
  OTTO004: "Never decide that tests passed by matching the word passed; assert a zero exit status and count lines containing failed separately.",
  OTTO008: "Wait on .status for CI checks and count unsettled checks; treat a check as green only when its conclusion is SUCCESS.",
  OTTO009: "Branch on __typename when reading statusCheckRollup, because StatusContext entries carry state and have no conclusion.",
  OTTO010: "Write long check output to a file and print only its summary lines, so the output is never truncated.",
  OTTO012: "Quote every --include glob, for example --include='*.ts', so the shell cannot expand it.",
};

export function suggestions(list: RuleTrend[], minCount = 3): Suggestion[] {
  return list
    .filter((t) => t.count >= minCount && SUGGESTION_LINES[t.ruleId] !== undefined)
    .map((t) => ({ ruleId: t.ruleId, count: t.count, line: SUGGESTION_LINES[t.ruleId] }));
}
