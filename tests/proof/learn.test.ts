import { describe, expect, it } from "vitest";
import { RULES } from "../../src/proof/rules";
import { SUGGESTION_LINES, suggestions, trends, type LearnRow } from "../../src/proof/learn";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-22T12:00:00Z");
const row = (ruleId: string, daysAgo: number, providerId = "claude-code", threadId = "thr_1"): LearnRow => ({
  ruleId,
  providerId,
  threadId,
  createdAt: NOW - daysAgo * DAY,
});

describe("trends", () => {
  it("counts per rule, ordered by count then id, with threads and provider split", () => {
    const rows = [
      row("OTTO001", 1, "claude-code", "thr_1"),
      row("OTTO001", 2, "claude-code", "thr_2"),
      row("OTTO001", 3, "codex", "thr_2"),
      row("OTTO004", 1),
      row("OTTO002", 1),
    ];
    const t = trends(rows, 30, NOW);
    expect(t.map((r) => [r.ruleId, r.count])).toEqual([["OTTO001", 3], ["OTTO002", 1], ["OTTO004", 1]]);
    expect(t[0].threads).toBe(2);
    expect(t[0].byProvider).toEqual([{ providerId: "claude-code", count: 2 }, { providerId: "codex", count: 1 }]);
    expect(t[0].lastAt).toBe(NOW - DAY);
  });

  it("drops rows older than the window and buckets by week, oldest first", () => {
    const rows = [row("OTTO001", 1), row("OTTO001", 8), row("OTTO001", 20), row("OTTO001", 40)];
    const t = trends(rows, 30, NOW)[0];
    expect(t.count).toBe(3);
    expect(t.weekly).toEqual([0, 0, 1, 1, 1]); // 5 weekly buckets: 20 days ago is week 2, 8 days is week 1, 1 day is this week
    expect(trends(rows, 7, NOW)[0].weekly).toEqual([1]);
  });

  it("puts the 90 day window in 13 weekly buckets", () => {
    expect(trends([row("OTTO001", 0)], 90, NOW)[0].weekly).toHaveLength(13);
  });

  it("returns nothing for no rows", () => {
    expect(trends([], 30, NOW)).toEqual([]);
  });
});

describe("suggestions", () => {
  it("suggests only rules that repeated at least three times and have a line", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => row("OTTO001", 1)),
      ...Array.from({ length: 2 }, () => row("OTTO004", 1)),
      ...Array.from({ length: 9 }, () => row("OTTO006", 1)), // outcome rule: no line
      ...Array.from({ length: 4 }, () => row("USER1", 1)),
    ];
    const s = suggestions(trends(rows, 30, NOW));
    expect(s).toEqual([{ ruleId: "OTTO001", count: 3, line: SUGGESTION_LINES.OTTO001 }]);
    expect(suggestions(trends(rows, 30, NOW), 2).map((x) => x.ruleId)).toEqual(["OTTO001", "OTTO004"]);
  });

  it("every line is one imperative sentence for a real rule, with no em dash", () => {
    const known = new Set(RULES.map((r) => r.id));
    for (const [id, line] of Object.entries(SUGGESTION_LINES)) {
      expect(known.has(id), id).toBe(true);
      expect(line, id).not.toContain("—");
      expect(line.endsWith("."), id).toBe(true);
      expect(line.length, id).toBeLessThan(220);
    }
  });
});
