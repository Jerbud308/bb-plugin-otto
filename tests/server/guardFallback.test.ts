import { describe, expect, it, vi } from "vitest";
import { registerGuard } from "../../src/server/guard";
import type { OttoState } from "../../src/server/state";

const state = { mode: "operator", customRules: [], guard: { mode: "reject", windowPercent: 95, projectTokenCap: 0, projectIds: [], waitFallbackMs: 60_000 } } as OttoState;

describe("guard registration", () => {
  it("goes quiet instead of throwing when this bb has no message hook", () => {
    const warn = vi.fn();
    for (const hooks of [undefined, {}, { on: () => { throw new Error("renamed"); } }]) {
      const bb = { experimental_hooks: hooks, log: { warn }, realtime: { publish: vi.fn() } };
      const guard = registerGuard(bb as never, {} as never, {} as never, state);
      expect(() => guard.releaseWaits()).not.toThrow();
    }
    expect(warn).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[0][0])).toContain("proof cards are unaffected");
  });
});
