import { describe, expect, it } from "vitest";
import { decideGuard, parseGuardMode, parseProjectIds, type GuardConfig, type GuardInput } from "../../src/proof/guard";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const config = (over: Partial<GuardConfig> = {}): GuardConfig => ({
  mode: "reject",
  windowPercent: 95,
  projectTokenCap: 0,
  projectIds: [],
  waitFallbackMs: 900_000,
  ...over,
});
const input = (over: Partial<GuardInput> = {}, c: Partial<GuardConfig> = {}): GuardInput => ({
  config: config(c),
  attempt: "start-turn",
  projectId: "proj_1",
  windows: [],
  projectTokens: 0,
  now: NOW,
  ...over,
});
const hot = [{ label: "5h", usedPercent: 97, resetsAt: "2026-10-22T14:00:00Z" }];

describe("decideGuard", () => {
  it("proceeds when off, even over the limit", () => {
    expect(decideGuard(input({ windows: hot }, { mode: "off" }))).toEqual({ action: "proceed" });
  });
  it("proceeds on join-turn", () => {
    expect(decideGuard(input({ windows: hot, attempt: "join-turn" }))).toEqual({ action: "proceed" });
  });
  it("proceeds when nothing is over a limit", () => {
    expect(decideGuard(input({ windows: [{ label: "5h", usedPercent: 94, resetsAt: null }], projectTokens: 5 }, { projectTokenCap: 100 }))).toEqual({
      action: "proceed",
    });
  });
  it("a window exactly at the percent is over", () => {
    expect(decideGuard(input({ windows: [{ label: "5h", usedPercent: 95, resetsAt: null }] })).action).toBe("reject");
  });
  it("rejects with Otto's message naming the window", () => {
    const d = decideGuard(input({ windows: hot }));
    expect(d).toEqual({
      action: "reject",
      message: 'Otto guard: plan window "5h" is at 97% (limit 95%). Change Guard mode in Settings, Installed plugins, Otto.',
    });
  });
  it("warn reports the reason and does not block", () => {
    expect(decideGuard(input({ windows: hot }, { mode: "warn" }))).toEqual({
      action: "warn",
      reason: 'Otto guard: plan window "5h" is at 97% (limit 95%).',
    });
  });
  it("wait uses the earliest future reset time", () => {
    const d = decideGuard(
      input({
        windows: [
          { label: "week", usedPercent: 99, resetsAt: "2026-10-25T00:00:00Z" },
          { label: "5h", usedPercent: 98, resetsAt: "2026-10-22T13:00:00Z" },
          { label: "past", usedPercent: 99, resetsAt: "2026-10-22T11:00:00Z" },
        ],
      }, { mode: "wait" }),
    );
    expect(d.action).toBe("wait");
    if (d.action === "wait") expect(d.sendAt).toBe(Date.parse("2026-10-22T13:00:00Z"));
  });
  it("wait falls back to now plus the configured time for a project cap", () => {
    const d = decideGuard(input({ projectTokens: 1_500_000 }, { mode: "wait", projectTokenCap: 1_000_000, waitFallbackMs: 60_000 }));
    expect(d).toEqual({
      action: "wait",
      reason: "Otto guard: this project has used 1,500,000 tokens (cap 1,000,000).",
      sendAt: NOW + 60_000,
    });
  });
  it("a cap of zero means no cap", () => {
    expect(decideGuard(input({ projectTokens: 9_999_999_999 }, { projectTokenCap: 0 }))).toEqual({ action: "proceed" });
  });
  it("only guards the listed projects", () => {
    expect(decideGuard(input({ windows: hot, projectId: "proj_2" }, { projectIds: ["proj_1"] }))).toEqual({ action: "proceed" });
    expect(decideGuard(input({ windows: hot, projectId: "proj_1" }, { projectIds: ["proj_1"] })).action).toBe("reject");
  });
  it("lists every reason", () => {
    const d = decideGuard(input({ windows: hot, projectTokens: 200 }, { projectTokenCap: 100 }));
    expect(d.action === "reject" && d.message).toContain("; this project has used 200 tokens (cap 100)");
  });
});

describe("guard setting parsers", () => {
  it("parses mode, falling back to off", () => {
    expect(["off", "warn", "wait", "reject", "x", undefined].map(parseGuardMode)).toEqual(["off", "warn", "wait", "reject", "off", "off"]);
  });
  it("splits and trims project ids", () => {
    expect(parseProjectIds(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(parseProjectIds("")).toEqual([]);
  });
});
