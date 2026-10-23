// Pipelines: a linear chain of agent stages, each a visible thread in one shared worktree. Pure.
export type Gate = "none" | "stop_on_contradicted" | "require_not_unverified";
export const GATES: readonly Gate[] = ["none", "stop_on_contradicted", "require_not_unverified"];

export interface StageDef {
  key: string;
  label: string;
  providerId: string;
  prompt: string;
  gate: Gate;
}
export interface PipelineDef {
  name: string;
  stages: StageDef[];
}

export const MAX_STAGES = 8;
export const MAX_PROMPT = 8000;
export const MAX_SUBSTITUTION = 8000;
const KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;

export type Validation = { ok: true; def: PipelineDef } | { ok: false; errors: string[] };

export function validatePipeline(input: unknown): Validation {
  const errors: string[] = [];
  const raw = (typeof input === "object" && input !== null ? input : {}) as { name?: unknown; stages?: unknown };
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length < 1 || name.length > 80) errors.push("Give the pipeline a name of 1 to 80 characters.");
  const list = Array.isArray(raw.stages) ? (raw.stages as unknown[]) : [];
  if (list.length < 1 || list.length > MAX_STAGES) errors.push(`A pipeline needs 1 to ${MAX_STAGES} stages.`);
  const stages: StageDef[] = [];
  const seen = new Set<string>();
  list.slice(0, MAX_STAGES).forEach((item, i) => {
    const n = i + 1;
    const s = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const key = typeof s.key === "string" ? s.key : "";
    const label = typeof s.label === "string" ? s.label.trim() : "";
    const providerId = typeof s.providerId === "string" ? s.providerId.trim() : "";
    const prompt = typeof s.prompt === "string" ? s.prompt : "";
    const gate = typeof s.gate === "string" ? s.gate : "none";
    if (!KEY_RE.test(key)) errors.push(`Stage ${n}: the name used in prompts must be lower case letters, digits or underscores, starting with a letter (up to 24).`);
    else if (seen.has(key)) errors.push(`Stage ${n}: the name "${key}" is already used by another stage.`);
    seen.add(key);
    if (label.length < 1 || label.length > 60) errors.push(`Stage ${n}: give it a label of 1 to 60 characters.`);
    if (providerId === "") errors.push(`Stage ${n}: pick an agent.`);
    if (prompt.trim().length < 1 || prompt.length > MAX_PROMPT) errors.push(`Stage ${n}: the prompt must be 1 to ${MAX_PROMPT} characters.`);
    if (!GATES.includes(gate as Gate)) errors.push(`Stage ${n}: unknown gate "${gate}".`);
    stages.push({ key, label, providerId, prompt, gate: GATES.includes(gate as Gate) ? (gate as Gate) : "none" });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, def: { name, stages } };
}

const cap = (text: string): string => (text.length > MAX_SUBSTITUTION ? `${text.slice(0, MAX_SUBSTITUTION)}\n[truncated]` : text);

// {{input}} and {{stage.<key>}}; a key with no output yet is left as written.
export function renderPrompt(template: string, input: string, outputs: Record<string, string>): string {
  return template.replace(/\{\{\s*(input|stage\.([a-z][a-z0-9_]*))\s*\}\}/g, (whole, name: string, key: string | undefined) => {
    if (name === "input") return cap(input);
    return key !== undefined && Object.prototype.hasOwnProperty.call(outputs, key) ? cap(outputs[key]) : whole;
  });
}

export type StageStatus = "pending" | "running" | "idle" | "failed" | "skipped";
export interface StageState {
  status: StageStatus;
  verdict: string | null;
  gate: Gate;
  label: string;
}
export type Step =
  | { kind: "start"; index: number }
  | { kind: "wait" }
  | { kind: "finish" }
  | { kind: "stop"; outcome: "failed" | "stopped"; reason: string };

// A finished stage with no card yet counts as UNVERIFIED for require_not_unverified, and passes stop_on_contradicted.
export function gateFailure(stage: StageState): string | null {
  if (stage.gate === "stop_on_contradicted" && stage.verdict === "CONTRADICTED") {
    return `Stage "${stage.label}" was CONTRADICTED, so the pipeline stopped.`;
  }
  if (stage.gate === "require_not_unverified" && (stage.verdict === null || stage.verdict === "UNVERIFIED" || stage.verdict === "CONTRADICTED")) {
    return `Stage "${stage.label}" was ${stage.verdict ?? "UNVERIFIED"}, so the pipeline stopped.`;
  }
  return null;
}

export function nextStep(stages: StageState[]): Step {
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (s.status === "failed") return { kind: "stop", outcome: "failed", reason: `Stage "${s.label}" failed.` };
    if (s.status === "running") return { kind: "wait" };
    if (s.status === "pending") return { kind: "start", index: i };
    if (s.status === "idle") {
      const reason = gateFailure(s);
      if (reason !== null) return { kind: "stop", outcome: "stopped", reason };
    }
  }
  return { kind: "finish" };
}

// A prompt-safe name from a label: "Ship check" becomes "ship_check", made unique among `taken`.
export function keyFromLabel(label: string, taken: readonly string[]): string {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
  if (!/^[a-z]/.test(base)) base = `stage_${base}`.replace(/_$/, "");
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
  return key;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  stages: Omit<StageDef, "providerId">[];
}

export const TEMPLATES: readonly Template[] = [
  {
    id: "plan-build-review-ship",
    name: "Plan, build, review, ship-check",
    description: "One agent plans, one builds from the plan, one reviews the change, one checks it is ready to ship.",
    stages: [
      {
        key: "plan",
        label: "Plan",
        gate: "none",
        prompt: "You are planning, not coding. Read the code that matters for this task and write a short numbered plan: the files to change, the steps in order, and how to check the result.\n\nTask: {{input}}",
      },
      {
        key: "build",
        label: "Build",
        gate: "stop_on_contradicted",
        prompt: "Build this task by following the plan. Run the project's own checks when you finish, and say plainly what passed and what did not.\n\nTask: {{input}}\n\nPlan:\n{{stage.plan}}",
      },
      {
        key: "review",
        label: "Review",
        gate: "none",
        prompt: "Review the change in this working folder as a careful second pair of eyes. List real problems first, then small suggestions. Do not rewrite the work.\n\nTask: {{input}}\n\nThe builder reported:\n{{stage.build}}",
      },
      {
        key: "ship_check",
        label: "Ship check",
        gate: "require_not_unverified",
        prompt: "Decide whether this is ready to ship. Run the project's tests and build yourself and report the real results. Answer READY or NOT READY with the reasons.\n\nReview notes:\n{{stage.review}}",
      },
    ],
  },
];
