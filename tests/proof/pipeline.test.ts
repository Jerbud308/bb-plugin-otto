import { describe, expect, it } from "vitest";
import {
  MAX_SUBSTITUTION,
  TEMPLATES,
  gateFailure,
  keyFromLabel,
  nextStep,
  renderPrompt,
  validatePipeline,
  type StageState,
} from "../../src/proof/pipeline";

const stage = (over: Partial<Record<string, unknown>> = {}) => ({ key: "plan", label: "Plan", providerId: "claude-code", prompt: "Do {{input}}", gate: "none", ...over });
const def = (stages: unknown[] = [stage()], name: unknown = "Mine") => ({ name, stages });

describe("validatePipeline", () => {
  it("accepts a good definition and trims the name", () => {
    const r = validatePipeline(def([stage()], "  Mine  "));
    expect(r.ok && r.def.name).toBe("Mine");
  });
  it("accepts the built-in template once providers are filled in", () => {
    const t = TEMPLATES[0];
    const r = validatePipeline({ name: t.name, stages: t.stages.map((s) => ({ ...s, providerId: "claude-code" })) });
    expect(r.ok).toBe(true);
  });
  it("needs 1 to 8 stages and a name", () => {
    expect(validatePipeline(def([])).ok).toBe(false);
    expect(validatePipeline(def(Array.from({ length: 9 }, (_, i) => stage({ key: `s${i}` })))).ok).toBe(false);
    expect(validatePipeline(def([stage()], "")).ok).toBe(false);
    expect(validatePipeline(null).ok).toBe(false);
  });
  it("rejects duplicate or malformed keys", () => {
    const dup = validatePipeline(def([stage(), stage()]));
    expect(!dup.ok && dup.errors.join(" ")).toContain('"plan" is already used');
    expect(validatePipeline(def([stage({ key: "Plan" })])).ok).toBe(false);
    expect(validatePipeline(def([stage({ key: "1a" })])).ok).toBe(false);
    expect(validatePipeline(def([stage({ key: "a".repeat(25) })])).ok).toBe(false);
  });
  it("checks agent, prompt length and gate for every stage", () => {
    expect(validatePipeline(def([stage({ providerId: " " })])).ok).toBe(false);
    expect(validatePipeline(def([stage({ prompt: "   " })])).ok).toBe(false);
    expect(validatePipeline(def([stage({ prompt: "x".repeat(8001) })])).ok).toBe(false);
    expect(validatePipeline(def([stage({ gate: "sometimes" })])).ok).toBe(false);
    const r = validatePipeline(def([stage({ gate: "sometimes", key: "a" }), stage({ providerId: "", key: "b" })]));
    expect(!r.ok && r.errors.length).toBe(2);
  });
});

describe("renderPrompt", () => {
  it("fills input and earlier stage outputs", () => {
    expect(renderPrompt("A {{input}} B {{ stage.plan }}", "task", { plan: "steps" })).toBe("A task B steps");
  });
  it("leaves unknown stage keys literal", () => {
    expect(renderPrompt("{{stage.later}} {{other}}", "x", {})).toBe("{{stage.later}} {{other}}");
  });
  it("is not fooled by dollar patterns in the substituted text", () => {
    expect(renderPrompt("{{input}}", "$& $1 $$", {})).toBe("$& $1 $$");
  });
  it("caps a long substitution", () => {
    const out = renderPrompt("{{input}}", "y".repeat(MAX_SUBSTITUTION + 500), {});
    expect(out.length).toBe(MAX_SUBSTITUTION + "\n[truncated]".length);
    expect(out.endsWith("[truncated]")).toBe(true);
  });
  it("does not substitute inside substituted output again", () => {
    expect(renderPrompt("{{stage.a}}", "i", { a: "{{input}}" })).toBe("{{input}}");
  });
});

const st = (status: StageState["status"], verdict: string | null = null, gate: StageState["gate"] = "none", label = "S"): StageState => ({ status, verdict, gate, label });

describe("nextStep", () => {
  it("starts the first pending stage when nothing is running", () => {
    expect(nextStep([st("pending"), st("pending")])).toEqual({ kind: "start", index: 0 });
    expect(nextStep([st("idle", "VERIFIED"), st("pending")])).toEqual({ kind: "start", index: 1 });
  });
  it("waits while a stage runs", () => {
    expect(nextStep([st("idle"), st("running"), st("pending")])).toEqual({ kind: "wait" });
  });
  it("finishes when every stage is idle or skipped", () => {
    expect(nextStep([st("idle"), st("skipped")])).toEqual({ kind: "finish" });
  });
  it("fails the run when a stage failed", () => {
    expect(nextStep([st("idle"), st("failed", null, "none", "Build"), st("pending")])).toEqual({
      kind: "stop",
      outcome: "failed",
      reason: 'Stage "Build" failed.',
    });
  });
  it("stops on a CONTRADICTED stage with that gate, but not on UNVERIFIED", () => {
    const stop = nextStep([st("idle", "CONTRADICTED", "stop_on_contradicted", "Build"), st("pending")]);
    expect(stop).toEqual({ kind: "stop", outcome: "stopped", reason: 'Stage "Build" was CONTRADICTED, so the pipeline stopped.' });
    expect(nextStep([st("idle", "UNVERIFIED", "stop_on_contradicted"), st("pending")])).toEqual({ kind: "start", index: 1 });
  });
  it("require_not_unverified stops on UNVERIFIED, CONTRADICTED and a missing card", () => {
    for (const v of ["UNVERIFIED", "CONTRADICTED", null]) {
      expect(nextStep([st("idle", v, "require_not_unverified"), st("pending")]).kind).toBe("stop");
    }
    for (const v of ["VERIFIED", "NO_CLAIM"]) {
      expect(nextStep([st("idle", v, "require_not_unverified"), st("pending")]).kind).toBe("start");
    }
  });
  it("applies the gate of the last stage too", () => {
    expect(nextStep([st("idle", "UNVERIFIED", "require_not_unverified", "Ship")]).kind).toBe("stop");
    expect(gateFailure(st("idle", "VERIFIED", "require_not_unverified"))).toBeNull();
  });
});

describe("keyFromLabel", () => {
  it("makes a prompt-safe, unique name", () => {
    expect(keyFromLabel("Ship check", [])).toBe("ship_check");
    expect(keyFromLabel("Plan", ["plan"])).toBe("plan_2");
    expect(keyFromLabel("3rd pass!", [])).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(keyFromLabel("???", [])).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
