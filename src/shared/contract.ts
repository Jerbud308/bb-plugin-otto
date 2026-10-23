// Zod schemas and the RPC contract shared by server.ts and app.tsx (type-only on the app side).
import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";

export const verdictSchema = z.enum(["VERIFIED", "UNVERIFIED", "CONTRADICTED", "NO_CLAIM"]);
export const claimKindSchema = z.enum(["tests", "typecheck", "build", "lint", "ci", "done"]);
export const checkKindSchema = z.enum(["test", "typecheck", "build", "lint", "ci"]);
export const claimStatusSchema = z.enum(["supported", "unsupported", "untrustworthy", "stale", "contradicted"]);
export const severitySchema = z.enum(["high", "medium", "low"]);
export const effectSchema = z.enum(["failure", "masking", "info"]);

export const findingSchema = z.object({
  ruleId: z.string(),
  severity: severitySchema,
  effect: effectSchema,
  message: z.string(),
  fixHint: z.string(),
  itemId: z.string(),
});

export const countsSchema = z.object({
  failed: z.number().int().nullable(),
  passed: z.number().int().nullable(),
  failLines: z.number().int(),
  tsErrors: z.number().int(),
});

export const evidenceSchema = z.object({
  itemId: z.string(),
  seq: z.number().int(),
  command: z.string(),
  kinds: z.array(checkKindSchema),
  exitCode: z.number().int().nullable(),
  status: z.enum(["pending", "completed", "failed", "interrupted"]),
  durationMs: z.number().nullable(),
  counts: countsSchema,
  outputTail: z.string(),
  truncated: z.boolean(),
  viaSubagent: z.boolean(),
  findingRuleIds: z.array(z.string()),
});

export const claimResultSchema = z.object({
  claim: claimKindSchema,
  status: claimStatusSchema.nullable(),
  evidenceItemId: z.string().nullable(),
  span: z.object({ start: z.number().int(), end: z.number().int() }).nullable(), // into claimText, for the marker
});

export const cardSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  projectId: z.string(),
  threadTitle: z.string().nullable(),
  turnId: z.string(),
  providerId: z.string().nullable(),
  turnStatus: z.string(),
  verdict: verdictSchema,
  claimText: z.string(),
  claims: z.array(claimResultSchema),
  evidence: z.array(evidenceSchema),
  findings: z.array(findingSchema),
  editedFiles: z.number().int(),
  firstSeq: z.number().int(),
  lastSeq: z.number().int(),
  rulesetVersion: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const cardSummarySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  projectId: z.string(),
  threadTitle: z.string().nullable(),
  turnId: z.string(),
  verdict: verdictSchema,
  claimKinds: z.array(claimKindSchema),
  findingCount: z.number().int(),
  highFindingCount: z.number().int(),
  createdAt: z.number().int(),
});

export const verdictCountsSchema = z.object({
  VERIFIED: z.number().int(),
  UNVERIFIED: z.number().int(),
  CONTRADICTED: z.number().int(),
  NO_CLAIM: z.number().int(),
});

export const ruleInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  defaultSeverity: severitySchema,
  effect: effectSchema,
  description: z.string(),
  fixHint: z.string(),
});

export const advisorReviewSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  threadId: z.string(),
  advisorThreadId: z.string().nullable(),
  providerId: z.string(),
  model: z.string().nullable(),
  status: z.enum(["running", "done", "unparseable", "failed", "timed_out"]),
  sufficient: z.boolean().nullable(),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  missing: z.array(z.string()),
  suggestedCheck: z.string().nullable(),
  reasoning: z.string().nullable(),
  rawText: z.string().nullable(),
  tainted: z.boolean(),
  createdAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
});

export const bakeoffStatusSchema = z.enum(["running", "ready", "decided"]);
export const contestantStatusSchema = z.enum(["starting", "running", "idle", "failed"]);

export const bakeoffSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  prompt: z.string(),
  taskTag: z.string(),
  baseBranch: z.string().nullable(),
  status: bakeoffStatusSchema,
  winnerContestantId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.number().int(),
  decidedAt: z.number().int().nullable(),
});

export const contestantSchema = z.object({
  id: z.string(),
  bakeoffId: z.string(),
  providerId: z.string(),
  threadId: z.string().nullable(),
  environmentId: z.string().nullable(),
  status: contestantStatusSchema,
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
  verdict: verdictSchema.nullable(),
  filesChanged: z.number().int().nullable(),
  insertions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  error: z.string().nullable(),
});

export const bakeoffSummarySchema = z.object({
  id: z.string(),
  taskTag: z.string(),
  status: bakeoffStatusSchema,
  createdAt: z.number().int(),
  contestantCount: z.number().int(),
  winnerProviderId: z.string().nullable(),
});

export const laneSchema = z.object({
  contestantId: z.string(),
  providerId: z.string(),
  status: contestantStatusSchema,
  finishedAt: z.number().int().nullable(),
  ticks: z.array(z.object({ t: z.number(), kind: z.enum(["cmd", "check", "failedCheck"]) })),
});

export const scoreboardRowSchema = z.object({
  providerId: z.string(),
  runs: z.number().int(),
  wins: z.number().int(),
  winRate: z.number(),
  verifiedRate: z.number(),
});

export const planWindowSchema = z.object({
  label: z.string(),
  usedPercent: z.number(),
  resetsAt: z.string().nullable(),
});
export const guardEventSchema = z.object({
  id: z.string(),
  at: z.number().int(),
  mode: z.string(),
  threadId: z.string(),
  projectId: z.string(),
  providerId: z.string().nullable(),
  reason: z.string(),
  action: z.string(),
});
export const budgetSummarySchema = z.object({
  projects: z.array(z.object({ projectId: z.string(), totalTokens: z.number(), threads: z.number().int() })),
  providers: z.array(z.object({ providerId: z.string(), planLabel: z.string().nullable(), windows: z.array(planWindowSchema) })),
  usageCheckedAt: z.number().int().nullable(),
  guard: z.object({
    mode: z.enum(["off", "warn", "wait", "reject"]),
    windowPercent: z.number(),
    projectTokenCap: z.number(),
    projectIds: z.array(z.string()),
  }),
});
export const learnDaysSchema = z.union([z.literal(7), z.literal(30), z.literal(90)]);
export const learnTrendSchema = z.object({
  ruleId: z.string(),
  title: z.string(),
  count: z.number().int(),
  threads: z.number().int(),
  byProvider: z.array(z.object({ providerId: z.string(), count: z.number().int() })),
  weekly: z.array(z.number().int()),
  lastAt: z.number().int(),
});
export const learnSuggestionSchema = z.object({
  ruleId: z.string(),
  title: z.string(),
  count: z.number().int(),
  line: z.string(),
});
export type LearnTrend = z.infer<typeof learnTrendSchema>;
export type LearnSuggestion = z.infer<typeof learnSuggestionSchema>;
export const gateSchema = z.enum(["none", "stop_on_contradicted", "require_not_unverified"]);
export const stageDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  providerId: z.string(),
  prompt: z.string(),
  gate: gateSchema,
});
export const pipelineDefSchema = z.object({ name: z.string(), stages: z.array(stageDefSchema) });
export const pipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  stages: z.array(stageDefSchema),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const pipelineRunStatusSchema = z.enum(["running", "done", "failed", "stopped"]);
export const pipelineStageStatusSchema = z.enum(["pending", "running", "idle", "failed", "skipped"]);
export const pipelineStageSchema = z.object({
  id: z.string(),
  runId: z.string(),
  idx: z.number().int(),
  key: z.string(),
  label: z.string(),
  providerId: z.string(),
  threadId: z.string().nullable(),
  status: pipelineStageStatusSchema,
  verdict: verdictSchema.nullable(),
  output: z.string().nullable(),
  startedAt: z.number().int().nullable(),
  finishedAt: z.number().int().nullable(),
  error: z.string().nullable(),
});
export const pipelineRunSchema = z.object({
  id: z.string(),
  pipelineId: z.string().nullable(),
  pipelineName: z.string(),
  projectId: z.string(),
  input: z.string(),
  baseBranch: z.string().nullable(),
  status: pipelineRunStatusSchema,
  environmentId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
});
export const pipelineRunSummarySchema = pipelineRunSchema.extend({
  stages: z.array(z.object({ idx: z.number().int(), label: z.string(), status: pipelineStageStatusSchema, verdict: verdictSchema.nullable() })),
});
export const pipelineTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  stages: z.array(stageDefSchema.omit({ providerId: true })),
});
export type StageDefRecord = z.infer<typeof stageDefSchema>;
export type Pipeline = z.infer<typeof pipelineSchema>;
export type PipelineRun = z.infer<typeof pipelineRunSchema>;
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export type PipelineRunSummary = z.infer<typeof pipelineRunSummarySchema>;
export type PipelineTemplate = z.infer<typeof pipelineTemplateSchema>;
export type GuardEventRow = z.infer<typeof guardEventSchema>;
export type BudgetSummary = z.infer<typeof budgetSummarySchema>;

export type Bakeoff = z.infer<typeof bakeoffSchema>;
export type Contestant = z.infer<typeof contestantSchema>;
export type BakeoffSummary = z.infer<typeof bakeoffSummarySchema>;
export type Lane = z.infer<typeof laneSchema>;
export type ScoreboardRow = z.infer<typeof scoreboardRowSchema>;

export type Verdict = z.infer<typeof verdictSchema>;
export type AdvisorReview = z.infer<typeof advisorReviewSchema>;
export type ClaimStatus = z.infer<typeof claimStatusSchema>;
export type Card = z.infer<typeof cardSchema>;
export type CardSummary = z.infer<typeof cardSummarySchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type ClaimResult = z.infer<typeof claimResultSchema>;
export type VerdictCounts = z.infer<typeof verdictCountsSchema>;
export type RuleInfo = z.infer<typeof ruleInfoSchema>;

export const rpcContract = defineRpcContract({
  "proof.listCards": {
    input: z
      .object({
        threadId: z.string().optional(),
        projectId: z.string().optional(),
        verdict: verdictSchema.optional(),
        limit: z.number().int().min(1).max(200).default(50),
        before: z.number().int().optional(), // createdAt cursor, exclusive
      })
      .strict(),
    output: z.object({ cards: z.array(cardSummarySchema), nextBefore: z.number().int().nullable() }),
  },
  "proof.getCard": {
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ card: cardSchema.nullable() }),
  },
  "proof.threadSummary": {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ latest: cardSummarySchema.nullable(), counts: verdictCountsSchema }),
  },
  "proof.rescanThread": {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ cardsWritten: z.number().int() }),
  },
  "proof.stats": {
    input: z.null(),
    output: z.object({ last7d: verdictCountsSchema, totalCards: z.number().int(), threadsScanned: z.number().int() }),
  },
  "proof.rules": {
    input: z.null(),
    output: z.object({ rulesetVersion: z.number().int(), rules: z.array(ruleInfoSchema) }),
  },
  "advisor.request": {
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ reviewId: z.string() }),
  },
  "advisor.listForCard": {
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ reviews: z.array(advisorReviewSchema) }),
  },
  "bakeoff.options": {
    input: z.null(),
    output: z.object({
      projects: z.array(z.object({ id: z.string(), name: z.string() })),
      providers: z.array(z.object({ id: z.string(), displayName: z.string(), available: z.boolean() })),
    }),
  },
  "bakeoff.create": {
    input: z
      .object({
        projectId: z.string().min(1),
        prompt: z.string().min(1).max(20000),
        providerIds: z
          .array(z.string().min(1))
          .min(2)
          .max(4)
          .refine((ids) => new Set(ids).size === ids.length, "Pick each provider only once."),
        taskTag: z.string().trim().toLowerCase().min(1).max(40),
        baseBranch: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
    output: z.object({ bakeoffId: z.string() }),
  },
  "bakeoff.list": {
    input: z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ bakeoffs: z.array(bakeoffSummarySchema) }),
  },
  "bakeoff.get": {
    input: z.object({ bakeoffId: z.string() }).strict(),
    output: z.object({ bakeoff: bakeoffSchema, contestants: z.array(contestantSchema) }),
  },
  "bakeoff.pickWinner": {
    input: z
      .object({ bakeoffId: z.string(), contestantId: z.string(), note: z.string().max(500).optional() })
      .strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  "bakeoff.archiveLosers": {
    input: z.object({ bakeoffId: z.string() }).strict(),
    output: z.object({ archived: z.number().int() }),
  },
  "bakeoff.lanes": {
    input: z.object({ bakeoffId: z.string() }).strict(),
    output: z.object({ startedAt: z.number().int(), lanes: z.array(laneSchema) }),
  },
  "bakeoff.scoreboard": {
    input: z.object({ taskTag: z.string().optional() }).strict(),
    output: z.object({ rows: z.array(scoreboardRowSchema) }),
  },
  "bakeoff.delete": {
    input: z.object({ bakeoffId: z.string() }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  "budget.summary": {
    input: z.null(),
    output: budgetSummarySchema,
  },
  "budget.events": {
    input: z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ events: z.array(guardEventSchema) }),
  },
  "learn.trends": {
    input: z.object({ days: learnDaysSchema.default(30) }).strict(),
    output: z.object({ days: learnDaysSchema, cardsInWindow: z.number().int(), rules: z.array(learnTrendSchema) }),
  },
  "learn.suggestions": {
    input: z.object({ days: learnDaysSchema.default(30) }).strict(),
    output: z.object({ days: learnDaysSchema, suggestions: z.array(learnSuggestionSchema) }),
  },
  "pipeline.list": {
    input: z.null(),
    output: z.object({ pipelines: z.array(pipelineSchema) }),
  },
  "pipeline.templates": {
    input: z.null(),
    output: z.object({ templates: z.array(pipelineTemplateSchema) }),
  },
  "pipeline.save": {
    input: z.object({ id: z.string().optional(), name: z.string(), stages: z.array(stageDefSchema) }).strict(),
    output: z.object({ pipelineId: z.string() }),
  },
  "pipeline.delete": {
    input: z.object({ pipelineId: z.string() }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  "pipeline.run": {
    input: z
      .object({ pipelineId: z.string(), projectId: z.string(), input: z.string().max(8000), baseBranch: z.string().optional() })
      .strict(),
    output: z.object({ runId: z.string() }),
  },
  "pipeline.runs": {
    input: z.object({ limit: z.number().int().min(1).max(100).default(30) }).strict(),
    output: z.object({ runs: z.array(pipelineRunSummarySchema) }),
  },
  "pipeline.getRun": {
    input: z.object({ runId: z.string() }).strict(),
    output: z.object({ run: pipelineRunSchema, stages: z.array(pipelineStageSchema) }),
  },
  "pipeline.stop": {
    input: z.object({ runId: z.string() }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  "proof.rescanRecent": {
    // Feed empty-state action (12.4); same work as `bb otto scan --all`
    input: z.null(),
    output: z.object({ threads: z.number().int(), cardsWritten: z.number().int() }),
  },
});
