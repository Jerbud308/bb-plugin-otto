// SQLite storage for cards and scan cursors (BUILD_SPEC 7). Migrations are append-only.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import {
  advisorReviewSchema,
  claimResultSchema,
  evidenceSchema,
  findingSchema,
  type AdvisorReview,
  type Bakeoff,
  type BakeoffSummary,
  type Card,
  type Contestant,
  type ScoreboardRow,
  type CardSummary,
  type Verdict,
  type VerdictCounts,
} from "../shared/contract";
import type { LearnRow } from "../proof/learn";
import { createPipelineQueries } from "./pipelineDb";
import { bakeoffStatusSchema, claimKindSchema, contestantStatusSchema, verdictSchema } from "../shared/contract";

export type OttoDatabase = ReturnType<BbPluginApi["storage"]["database"]>;

export const MIGRATIONS = [
  // 0
  `CREATE TABLE IF NOT EXISTS cards (
     id TEXT PRIMARY KEY,
     thread_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     thread_title TEXT,
     turn_id TEXT NOT NULL,
     provider_id TEXT,
     turn_status TEXT NOT NULL,
     verdict TEXT NOT NULL CHECK (verdict IN ('VERIFIED','UNVERIFIED','CONTRADICTED','NO_CLAIM')),
     claim_text TEXT NOT NULL,
     claims_json TEXT NOT NULL,
     evidence_json TEXT NOT NULL,
     findings_json TEXT NOT NULL,
     high_findings INTEGER NOT NULL,
     edited_files INTEGER NOT NULL,
     first_seq INTEGER NOT NULL,
     last_seq INTEGER NOT NULL,
     ruleset_version INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  // 1
  `CREATE INDEX IF NOT EXISTS cards_thread ON cards(thread_id, created_at DESC)`,
  // 2
  `CREATE INDEX IF NOT EXISTS cards_created ON cards(created_at DESC)`,
  // 3
  `CREATE TABLE IF NOT EXISTS scan_cursor (
     thread_id TEXT PRIMARY KEY,
     last_seq INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  // 4 (phase 2, BUILD_SPEC 13.2)
  `CREATE TABLE IF NOT EXISTS advisor_reviews (
     id TEXT PRIMARY KEY,
     card_id TEXT NOT NULL,
     thread_id TEXT NOT NULL,
     advisor_thread_id TEXT,
     provider_id TEXT NOT NULL,
     model TEXT,
     status TEXT NOT NULL CHECK (status IN ('running','done','unparseable','failed','timed_out')),
     sufficient INTEGER,
     confidence TEXT,
     missing_json TEXT,
     suggested_check TEXT,
     reasoning TEXT,
     raw_text TEXT,
     tainted INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     finished_at INTEGER
   )`,
  // 5 (phase 3, BUILD_SPEC 14.2)
  `CREATE TABLE IF NOT EXISTS bakeoffs (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     prompt TEXT NOT NULL,
     task_tag TEXT NOT NULL,
     base_branch TEXT,
     status TEXT NOT NULL CHECK (status IN ('running','ready','decided')),
     winner_contestant_id TEXT,
     note TEXT,
     created_at INTEGER NOT NULL,
     decided_at INTEGER
   )`,
  // 6
  `CREATE TABLE IF NOT EXISTS contestants (
     id TEXT PRIMARY KEY,
     bakeoff_id TEXT NOT NULL,
     provider_id TEXT NOT NULL,
     thread_id TEXT,
     environment_id TEXT,
     status TEXT NOT NULL CHECK (status IN ('starting','running','idle','failed')),
     started_at INTEGER NOT NULL,
     finished_at INTEGER,
     verdict TEXT,
     files_changed INTEGER,
     insertions INTEGER,
     deletions INTEGER,
     error TEXT
   )`,
  // 7 (V2 A2)
  `CREATE TABLE IF NOT EXISTS thread_usage (
     thread_id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     provider_id TEXT,
     total_tokens INTEGER NOT NULL,
     input_tokens INTEGER NOT NULL,
     cached_tokens INTEGER NOT NULL,
     output_tokens INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  // 8 (V2 A3)
  `CREATE TABLE IF NOT EXISTS guard_events (
     id TEXT PRIMARY KEY,
     at INTEGER NOT NULL,
     mode TEXT NOT NULL,
     thread_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     provider_id TEXT,
     reason TEXT NOT NULL,
     action TEXT NOT NULL
   )`,
  // 9 (V2 C1)
  `CREATE TABLE IF NOT EXISTS pipelines (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     definition_json TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  // 10: a run keeps its own copy of the definition, so editing or deleting a pipeline never changes a run in flight
  `CREATE TABLE IF NOT EXISTS pipeline_runs (
     id TEXT PRIMARY KEY,
     pipeline_id TEXT,
     pipeline_name TEXT NOT NULL,
     project_id TEXT NOT NULL,
     input TEXT NOT NULL,
     base_branch TEXT,
     definition_json TEXT NOT NULL,
     status TEXT NOT NULL,
     environment_id TEXT,
     note TEXT,
     created_at INTEGER NOT NULL,
     finished_at INTEGER
   )`,
  // 11
  `CREATE TABLE IF NOT EXISTS pipeline_stages (
     id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL,
     idx INTEGER NOT NULL,
     stage_key TEXT NOT NULL,
     label TEXT NOT NULL,
     provider_id TEXT NOT NULL,
     thread_id TEXT,
     status TEXT NOT NULL,
     verdict TEXT,
     output TEXT,
     started_at INTEGER,
     finished_at INTEGER,
     error TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS pipeline_stages_run ON pipeline_stages (run_id, idx)`,
  `CREATE INDEX IF NOT EXISTS pipeline_stages_thread ON pipeline_stages (thread_id)`,
];

export interface ListCardsQuery {
  threadId?: string;
  projectId?: string;
  verdict?: Verdict;
  limit: number;
  before?: number;
}

interface CardRow {
  id: string;
  thread_id: string;
  project_id: string;
  thread_title: string | null;
  turn_id: string;
  provider_id: string | null;
  turn_status: string;
  verdict: string;
  claim_text: string;
  claims_json: string;
  evidence_json: string;
  findings_json: string;
  high_findings: number;
  edited_files: number;
  first_seq: number;
  last_seq: number;
  ruleset_version: number;
  created_at: number;
  updated_at: number;
}

interface SummaryRow {
  id: string;
  thread_id: string;
  project_id: string;
  thread_title: string | null;
  turn_id: string;
  verdict: string;
  claims_json: string;
  findings_json: string;
  high_findings: number;
  created_at: number;
}

export type PipelineQueries = ReturnType<typeof createPipelineQueries>;

export interface OttoStore extends PipelineQueries {
  upsertCard(card: Card): void;
  getCard(id: string): Card | null;
  listCards(q: ListCardsQuery): CardSummary[];
  latestForThread(threadId: string): CardSummary | null;
  countsForThread(threadId: string): VerdictCounts;
  countsSince(since: number): VerdictCounts;
  totalCards(): number;
  learnRows(since: number): LearnRow[];
  staleThreadIds(version: number, limit: number): string[];
  threadsScanned(): number;
  getCursor(threadId: string): number;
  setCursor(threadId: string, lastSeq: number, now: number): void;
  resetThread(threadId: string): void;
  insertReview(review: AdvisorReview): void;
  updateReview(id: string, patch: Partial<AdvisorReview>): void;
  getReview(id: string): AdvisorReview | null;
  runningReviewForCard(cardId: string): AdvisorReview | null;
  reviewByAdvisorThread(advisorThreadId: string): AdvisorReview | null;
  listReviewsForCard(cardId: string): AdvisorReview[];
  runningReviewsOlderThan(cutoff: number): AdvisorReview[];
  insertBakeoff(b: Bakeoff): void;
  updateBakeoff(id: string, patch: Partial<Pick<Bakeoff, "status" | "winnerContestantId" | "note" | "decidedAt">>): void;
  getBakeoff(id: string): Bakeoff | null;
  listBakeoffs(limit: number): BakeoffSummary[];
  insertContestant(c: Contestant): void;
  updateContestant(
    id: string,
    patch: Partial<Omit<Contestant, "id" | "bakeoffId" | "providerId" | "startedAt">>,
  ): void;
  getContestant(id: string): Contestant | null;
  contestantsFor(bakeoffId: string): Contestant[];
  contestantByThread(threadId: string): Contestant | null;
  // Contestants of undecided bake-offs that still need a status or verdict refresh.
  openContestants(): Contestant[];
  scoreboard(taskTag?: string): ScoreboardRow[];
  deleteBakeoff(id: string): void;
  upsertUsage(u: ThreadUsage): void;
  projectUsage(): { projectId: string; totalTokens: number; threads: number }[];
  threadsWithoutUsage(limit: number): { threadId: string; projectId: string; providerId: string | null }[];
  insertGuardEvent(e: GuardEvent): void;
  listGuardEvents(limit: number): GuardEvent[];
}

export interface ThreadUsage {
  threadId: string;
  projectId: string;
  providerId: string | null;
  totalTokens: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  updatedAt: number;
}

export interface GuardEvent {
  id: string;
  at: number;
  mode: string;
  threadId: string;
  projectId: string;
  providerId: string | null;
  reason: string;
  action: string;
}

interface ReviewRow {
  id: string;
  card_id: string;
  thread_id: string;
  advisor_thread_id: string | null;
  provider_id: string;
  model: string | null;
  status: string;
  sufficient: number | null;
  confidence: string | null;
  missing_json: string | null;
  suggested_check: string | null;
  reasoning: string | null;
  raw_text: string | null;
  tainted: number;
  created_at: number;
  finished_at: number | null;
}

interface BakeoffRow {
  id: string;
  project_id: string;
  prompt: string;
  task_tag: string;
  base_branch: string | null;
  status: string;
  winner_contestant_id: string | null;
  note: string | null;
  created_at: number;
  decided_at: number | null;
}

interface ContestantRow {
  id: string;
  bakeoff_id: string;
  provider_id: string;
  thread_id: string | null;
  environment_id: string | null;
  status: string;
  started_at: number;
  finished_at: number | null;
  verdict: string | null;
  files_changed: number | null;
  insertions: number | null;
  deletions: number | null;
  error: string | null;
}

const emptyCounts = (): VerdictCounts => ({ VERIFIED: 0, UNVERIFIED: 0, CONTRADICTED: 0, NO_CLAIM: 0 });

function parseJson<S extends z.ZodType>(schema: S, text: string): z.infer<S> | null {
  try {
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

function toReview(row: ReviewRow, warn: (message: string) => void): AdvisorReview | null {
  let missing: unknown = [];
  if (row.missing_json !== null) {
    try {
      missing = JSON.parse(row.missing_json);
    } catch {
      missing = [];
    }
  }
  const r = advisorReviewSchema.safeParse({
    id: row.id,
    cardId: row.card_id,
    threadId: row.thread_id,
    advisorThreadId: row.advisor_thread_id,
    providerId: row.provider_id,
    model: row.model,
    status: row.status,
    sufficient: row.sufficient === null ? null : row.sufficient === 1,
    confidence: row.confidence,
    missing,
    suggestedCheck: row.suggested_check,
    reasoning: row.reasoning,
    rawText: row.raw_text,
    tainted: row.tainted === 1,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  });
  if (!r.success) {
    warn(`dropping unreadable advisor review ${row.id}`);
    return null;
  }
  return r.data;
}

function toBakeoff(row: BakeoffRow, warn: (message: string) => void): Bakeoff | null {
  const status = bakeoffStatusSchema.safeParse(row.status);
  if (!status.success) {
    warn(`dropping unreadable bake-off ${row.id}`);
    return null;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    prompt: row.prompt,
    taskTag: row.task_tag,
    baseBranch: row.base_branch,
    status: status.data,
    winnerContestantId: row.winner_contestant_id,
    note: row.note,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function toContestant(row: ContestantRow, warn: (message: string) => void): Contestant | null {
  const status = contestantStatusSchema.safeParse(row.status);
  const verdict = row.verdict === null ? null : verdictSchema.safeParse(row.verdict);
  if (!status.success || (verdict !== null && !verdict.success)) {
    warn(`dropping unreadable contestant ${row.id}`);
    return null;
  }
  return {
    id: row.id,
    bakeoffId: row.bakeoff_id,
    providerId: row.provider_id,
    threadId: row.thread_id,
    environmentId: row.environment_id,
    status: status.data,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    verdict: verdict === null ? null : verdict.success ? verdict.data : null,
    filesChanged: row.files_changed,
    insertions: row.insertions,
    deletions: row.deletions,
    error: row.error,
  };
}

export function openStore(db: OttoDatabase, warn: (message: string) => void): OttoStore {
  const upsert = db.prepare(
    `INSERT INTO cards (id, thread_id, project_id, thread_title, turn_id, provider_id, turn_status, verdict,
       claim_text, claims_json, evidence_json, findings_json, high_findings, edited_files, first_seq, last_seq,
       ruleset_version, created_at, updated_at)
     VALUES (@id, @thread_id, @project_id, @thread_title, @turn_id, @provider_id, @turn_status, @verdict,
       @claim_text, @claims_json, @evidence_json, @findings_json, @high_findings, @edited_files, @first_seq, @last_seq,
       @ruleset_version, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       thread_id = excluded.thread_id, project_id = excluded.project_id, thread_title = excluded.thread_title,
       turn_id = excluded.turn_id, provider_id = excluded.provider_id, turn_status = excluded.turn_status,
       verdict = excluded.verdict, claim_text = excluded.claim_text, claims_json = excluded.claims_json,
       evidence_json = excluded.evidence_json, findings_json = excluded.findings_json,
       high_findings = excluded.high_findings, edited_files = excluded.edited_files,
       first_seq = excluded.first_seq, last_seq = excluded.last_seq, ruleset_version = excluded.ruleset_version,
       created_at = excluded.created_at, updated_at = excluded.updated_at`,
  );

  function toSummary(row: SummaryRow): CardSummary | null {
    const verdict = verdictSchema.safeParse(row.verdict);
    const claims = parseJson(claimResultSchema.array(), row.claims_json);
    const findings = parseJson(findingSchema.array(), row.findings_json);
    if (!verdict.success || !claims || !findings) {
      warn(`dropping unreadable card ${row.id}`);
      return null;
    }
    return {
      id: row.id,
      threadId: row.thread_id,
      projectId: row.project_id,
      threadTitle: row.thread_title,
      turnId: row.turn_id,
      verdict: verdict.data,
      claimKinds: claims.map((c) => claimKindSchema.parse(c.claim)),
      findingCount: findings.length,
      highFindingCount: row.high_findings,
      createdAt: row.created_at,
    };
  }

  const summaryColumns = `id, thread_id, project_id, thread_title, turn_id, verdict, claims_json, findings_json,
    high_findings, created_at`;

  function countsFrom(rows: { verdict: string; n: number }[]): VerdictCounts {
    const counts = emptyCounts();
    for (const r of rows) {
      const v = verdictSchema.safeParse(r.verdict);
      if (v.success) counts[v.data] = r.n;
    }
    return counts;
  }

  return {
    ...createPipelineQueries(db, warn),
    upsertCard(card) {
      upsert.run({
        id: card.id,
        thread_id: card.threadId,
        project_id: card.projectId,
        thread_title: card.threadTitle,
        turn_id: card.turnId,
        provider_id: card.providerId,
        turn_status: card.turnStatus,
        verdict: card.verdict,
        claim_text: card.claimText,
        claims_json: JSON.stringify(card.claims),
        evidence_json: JSON.stringify(card.evidence),
        findings_json: JSON.stringify(card.findings),
        high_findings: card.findings.filter((f) => f.severity === "high").length,
        edited_files: card.editedFiles,
        first_seq: card.firstSeq,
        last_seq: card.lastSeq,
        ruleset_version: card.rulesetVersion,
        created_at: card.createdAt,
        updated_at: card.updatedAt,
      });
    },

    getCard(id) {
      const row = db.prepare(`SELECT * FROM cards WHERE id = ?`).get(id) as CardRow | undefined;
      if (!row) return null;
      const verdict = verdictSchema.safeParse(row.verdict);
      const claims = parseJson(claimResultSchema.array(), row.claims_json);
      const evidence = parseJson(evidenceSchema.array(), row.evidence_json);
      const findings = parseJson(findingSchema.array(), row.findings_json);
      if (!verdict.success || !claims || !evidence || !findings) {
        warn(`dropping unreadable card ${row.id}`);
        return null;
      }
      return {
        id: row.id,
        threadId: row.thread_id,
        projectId: row.project_id,
        threadTitle: row.thread_title,
        turnId: row.turn_id,
        providerId: row.provider_id,
        turnStatus: row.turn_status,
        verdict: verdict.data,
        claimText: row.claim_text,
        claims,
        evidence,
        findings,
        editedFiles: row.edited_files,
        firstSeq: row.first_seq,
        lastSeq: row.last_seq,
        rulesetVersion: row.ruleset_version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    listCards(q) {
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (q.threadId !== undefined) {
        where.push("thread_id = ?");
        args.push(q.threadId);
      }
      if (q.projectId !== undefined) {
        where.push("project_id = ?");
        args.push(q.projectId);
      }
      if (q.verdict !== undefined) {
        where.push("verdict = ?");
        args.push(q.verdict);
      }
      if (q.before !== undefined) {
        where.push("created_at < ?");
        args.push(q.before);
      }
      const sql = `SELECT ${summaryColumns} FROM cards ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY created_at DESC, id DESC LIMIT ?`;
      const rows = db.prepare(sql).all(...args, q.limit) as SummaryRow[];
      return rows.flatMap((r) => {
        const s = toSummary(r);
        return s ? [s] : [];
      });
    },

    latestForThread(threadId) {
      const row = db
        .prepare(`SELECT ${summaryColumns} FROM cards WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
        .get(threadId) as SummaryRow | undefined;
      return row ? toSummary(row) : null;
    },

    countsForThread(threadId) {
      return countsFrom(
        db.prepare(`SELECT verdict, COUNT(*) AS n FROM cards WHERE thread_id = ? GROUP BY verdict`).all(threadId) as {
          verdict: string;
          n: number;
        }[],
      );
    },

    countsSince(since) {
      return countsFrom(
        db.prepare(`SELECT verdict, COUNT(*) AS n FROM cards WHERE created_at >= ? GROUP BY verdict`).all(since) as {
          verdict: string;
          n: number;
        }[],
      );
    },

    learnRows(since) {
      const rows = db
        .prepare(`SELECT thread_id, provider_id, created_at, findings_json FROM cards WHERE created_at >= ? AND findings_json != '[]'`)
        .all(since) as { thread_id: string; provider_id: string; created_at: number; findings_json: string }[];
      const out: LearnRow[] = [];
      for (const row of rows) {
        const findings = parseJson(findingSchema.array(), row.findings_json);
        if (!findings) continue;
        // One entry per rule per card: a rule firing on three commands of one turn is one habit, once.
        for (const ruleId of new Set(findings.map((f) => f.ruleId))) {
          out.push({ ruleId, providerId: row.provider_id, threadId: row.thread_id, createdAt: row.created_at });
        }
      }
      return out;
    },

    staleThreadIds(version, limit) {
      return (
        db
          .prepare(`SELECT DISTINCT thread_id FROM cards WHERE ruleset_version < ? ORDER BY thread_id LIMIT ?`)
          .all(version, limit) as { thread_id: string }[]
      ).map((r) => r.thread_id);
    },

    totalCards() {
      return (db.prepare(`SELECT COUNT(*) AS n FROM cards`).get() as { n: number }).n;
    },

    threadsScanned() {
      return (db.prepare(`SELECT COUNT(*) AS n FROM scan_cursor`).get() as { n: number }).n;
    },

    getCursor(threadId) {
      const row = db.prepare(`SELECT last_seq FROM scan_cursor WHERE thread_id = ?`).get(threadId) as
        | { last_seq: number }
        | undefined;
      return row?.last_seq ?? 0;
    },

    setCursor(threadId, lastSeq, now) {
      db.prepare(
        `INSERT INTO scan_cursor (thread_id, last_seq, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET last_seq = excluded.last_seq, updated_at = excluded.updated_at`,
      ).run(threadId, lastSeq, now);
    },

    resetThread(threadId) {
      db.prepare(`DELETE FROM cards WHERE thread_id = ?`).run(threadId);
      db.prepare(`DELETE FROM scan_cursor WHERE thread_id = ?`).run(threadId);
    },

    insertReview(r) {
      db.prepare(
        `INSERT INTO advisor_reviews (id, card_id, thread_id, advisor_thread_id, provider_id, model, status, sufficient,
           confidence, missing_json, suggested_check, reasoning, raw_text, tainted, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        r.id,
        r.cardId,
        r.threadId,
        r.advisorThreadId,
        r.providerId,
        r.model,
        r.status,
        r.sufficient === null ? null : r.sufficient ? 1 : 0,
        r.confidence,
        JSON.stringify(r.missing),
        r.suggestedCheck,
        r.reasoning,
        r.rawText,
        r.tainted ? 1 : 0,
        r.createdAt,
        r.finishedAt,
      );
    },

    updateReview(id, patch) {
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      const set = (column: string, value: string | number | null): void => {
        sets.push(`${column} = ?`);
        args.push(value);
      };
      if (patch.advisorThreadId !== undefined) set("advisor_thread_id", patch.advisorThreadId);
      if (patch.status !== undefined) set("status", patch.status);
      if (patch.sufficient !== undefined) set("sufficient", patch.sufficient === null ? null : patch.sufficient ? 1 : 0);
      if (patch.confidence !== undefined) set("confidence", patch.confidence);
      if (patch.missing !== undefined) set("missing_json", JSON.stringify(patch.missing));
      if (patch.suggestedCheck !== undefined) set("suggested_check", patch.suggestedCheck);
      if (patch.reasoning !== undefined) set("reasoning", patch.reasoning);
      if (patch.rawText !== undefined) set("raw_text", patch.rawText);
      if (patch.tainted !== undefined) set("tainted", patch.tainted ? 1 : 0);
      if (patch.finishedAt !== undefined) set("finished_at", patch.finishedAt);
      if (sets.length === 0) return;
      db.prepare(`UPDATE advisor_reviews SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
    },

    getReview(id) {
      const row = db.prepare(`SELECT * FROM advisor_reviews WHERE id = ?`).get(id) as ReviewRow | undefined;
      return row ? toReview(row, warn) : null;
    },

    runningReviewForCard(cardId) {
      const row = db
        .prepare(`SELECT * FROM advisor_reviews WHERE card_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1`)
        .get(cardId) as ReviewRow | undefined;
      return row ? toReview(row, warn) : null;
    },

    reviewByAdvisorThread(advisorThreadId) {
      const row = db.prepare(`SELECT * FROM advisor_reviews WHERE advisor_thread_id = ?`).get(advisorThreadId) as
        | ReviewRow
        | undefined;
      return row ? toReview(row, warn) : null;
    },

    listReviewsForCard(cardId) {
      const rows = db
        .prepare(`SELECT * FROM advisor_reviews WHERE card_id = ? ORDER BY created_at DESC, id DESC`)
        .all(cardId) as ReviewRow[];
      return rows.flatMap((r) => {
        const v = toReview(r, warn);
        return v ? [v] : [];
      });
    },

    insertBakeoff(b) {
      db.prepare(
        `INSERT INTO bakeoffs (id, project_id, prompt, task_tag, base_branch, status, winner_contestant_id, note,
           created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        b.id,
        b.projectId,
        b.prompt,
        b.taskTag,
        b.baseBranch,
        b.status,
        b.winnerContestantId,
        b.note,
        b.createdAt,
        b.decidedAt,
      );
    },

    updateBakeoff(id, patch) {
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      const set = (column: string, value: string | number | null): void => {
        sets.push(`${column} = ?`);
        args.push(value);
      };
      if (patch.status !== undefined) set("status", patch.status);
      if (patch.winnerContestantId !== undefined) set("winner_contestant_id", patch.winnerContestantId);
      if (patch.note !== undefined) set("note", patch.note);
      if (patch.decidedAt !== undefined) set("decided_at", patch.decidedAt);
      if (sets.length === 0) return;
      db.prepare(`UPDATE bakeoffs SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
    },

    getBakeoff(id) {
      const row = db.prepare(`SELECT * FROM bakeoffs WHERE id = ?`).get(id) as BakeoffRow | undefined;
      return row ? toBakeoff(row, warn) : null;
    },

    listBakeoffs(limit) {
      const rows = db
        .prepare(
          `SELECT b.*, (SELECT COUNT(*) FROM contestants c WHERE c.bakeoff_id = b.id) AS contestant_count,
             (SELECT w.provider_id FROM contestants w WHERE w.id = b.winner_contestant_id) AS winner_provider_id
           FROM bakeoffs b ORDER BY b.created_at DESC, b.id DESC LIMIT ?`,
        )
        .all(limit) as (BakeoffRow & { contestant_count: number; winner_provider_id: string | null })[];
      return rows.flatMap((r) => {
        const b = toBakeoff(r, warn);
        return b
          ? [
              {
                id: b.id,
                taskTag: b.taskTag,
                status: b.status,
                createdAt: b.createdAt,
                contestantCount: r.contestant_count,
                winnerProviderId: r.winner_provider_id,
              },
            ]
          : [];
      });
    },

    insertContestant(c) {
      db.prepare(
        `INSERT INTO contestants (id, bakeoff_id, provider_id, thread_id, environment_id, status, started_at,
           finished_at, verdict, files_changed, insertions, deletions, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        c.id,
        c.bakeoffId,
        c.providerId,
        c.threadId,
        c.environmentId,
        c.status,
        c.startedAt,
        c.finishedAt,
        c.verdict,
        c.filesChanged,
        c.insertions,
        c.deletions,
        c.error,
      );
    },

    updateContestant(id, patch) {
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      const set = (column: string, value: string | number | null): void => {
        sets.push(`${column} = ?`);
        args.push(value);
      };
      if (patch.threadId !== undefined) set("thread_id", patch.threadId);
      if (patch.environmentId !== undefined) set("environment_id", patch.environmentId);
      if (patch.status !== undefined) set("status", patch.status);
      if (patch.finishedAt !== undefined) set("finished_at", patch.finishedAt);
      if (patch.verdict !== undefined) set("verdict", patch.verdict);
      if (patch.filesChanged !== undefined) set("files_changed", patch.filesChanged);
      if (patch.insertions !== undefined) set("insertions", patch.insertions);
      if (patch.deletions !== undefined) set("deletions", patch.deletions);
      if (patch.error !== undefined) set("error", patch.error);
      if (sets.length === 0) return;
      db.prepare(`UPDATE contestants SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
    },

    getContestant(id) {
      const row = db.prepare(`SELECT * FROM contestants WHERE id = ?`).get(id) as ContestantRow | undefined;
      return row ? toContestant(row, warn) : null;
    },

    contestantsFor(bakeoffId) {
      const rows = db
        .prepare(`SELECT * FROM contestants WHERE bakeoff_id = ? ORDER BY rowid ASC`)
        .all(bakeoffId) as ContestantRow[];
      return rows.flatMap((r) => {
        const c = toContestant(r, warn);
        return c ? [c] : [];
      });
    },

    contestantByThread(threadId) {
      const row = db.prepare(`SELECT * FROM contestants WHERE thread_id = ?`).get(threadId) as ContestantRow | undefined;
      return row ? toContestant(row, warn) : null;
    },

    openContestants() {
      const rows = db
        .prepare(
          `SELECT c.* FROM contestants c JOIN bakeoffs b ON b.id = c.bakeoff_id
           WHERE b.status != 'decided' AND (c.status IN ('starting','running') OR (c.status = 'idle' AND (c.verdict IS NULL OR c.files_changed IS NULL)))`,
        )
        .all() as ContestantRow[];
      return rows.flatMap((r) => {
        const c = toContestant(r, warn);
        return c ? [c] : [];
      });
    },

    upsertUsage(u) {
      db.prepare(
        `INSERT INTO thread_usage (thread_id, project_id, provider_id, total_tokens, input_tokens, cached_tokens, output_tokens, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET project_id = excluded.project_id, provider_id = excluded.provider_id,
           total_tokens = excluded.total_tokens, input_tokens = excluded.input_tokens, cached_tokens = excluded.cached_tokens,
           output_tokens = excluded.output_tokens, updated_at = excluded.updated_at`,
      ).run(u.threadId, u.projectId, u.providerId, u.totalTokens, u.inputTokens, u.cachedTokens, u.outputTokens, u.updatedAt);
    },

    projectUsage() {
      return (
        db
          .prepare(`SELECT project_id, SUM(total_tokens) AS total, COUNT(*) AS n FROM thread_usage GROUP BY project_id ORDER BY total DESC`)
          .all() as { project_id: string; total: number; n: number }[]
      ).map((r) => ({ projectId: r.project_id, totalTokens: r.total, threads: r.n }));
    },

    threadsWithoutUsage(limit) {
      return (
        db
          .prepare(
            `SELECT c.thread_id AS thread_id, MAX(c.project_id) AS project_id, MAX(c.provider_id) AS provider_id
             FROM cards c LEFT JOIN thread_usage u ON u.thread_id = c.thread_id
             WHERE u.thread_id IS NULL GROUP BY c.thread_id ORDER BY MAX(c.created_at) DESC LIMIT ?`,
          )
          .all(limit) as { thread_id: string; project_id: string; provider_id: string | null }[]
      ).map((r) => ({ threadId: r.thread_id, projectId: r.project_id, providerId: r.provider_id }));
    },

    insertGuardEvent(e) {
      db.prepare(
        `INSERT INTO guard_events (id, at, mode, thread_id, project_id, provider_id, reason, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(e.id, e.at, e.mode, e.threadId, e.projectId, e.providerId, e.reason, e.action);
      // Keep the table small: only the newest 500 events matter.
      db.prepare(`DELETE FROM guard_events WHERE id NOT IN (SELECT id FROM guard_events ORDER BY at DESC, id DESC LIMIT 500)`).run();
    },

    listGuardEvents(limit) {
      return (
        db.prepare(`SELECT * FROM guard_events ORDER BY at DESC, id DESC LIMIT ?`).all(limit) as {
          id: string;
          at: number;
          mode: string;
          thread_id: string;
          project_id: string;
          provider_id: string | null;
          reason: string;
          action: string;
        }[]
      ).map((r) => ({
        id: r.id,
        at: r.at,
        mode: r.mode,
        threadId: r.thread_id,
        projectId: r.project_id,
        providerId: r.provider_id,
        reason: r.reason,
        action: r.action,
      }));
    },

    deleteBakeoff(id) {
      db.prepare(`DELETE FROM contestants WHERE bakeoff_id = ?`).run(id);
      db.prepare(`DELETE FROM bakeoffs WHERE id = ?`).run(id);
    },

    scoreboard(taskTag) {
      const rows = db
        .prepare(
          `SELECT c.provider_id AS provider_id, COUNT(*) AS runs,
             SUM(CASE WHEN b.winner_contestant_id = c.id THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN c.verdict = 'VERIFIED' THEN 1 ELSE 0 END) AS verified
           FROM contestants c JOIN bakeoffs b ON b.id = c.bakeoff_id
           WHERE b.status = 'decided' ${taskTag !== undefined ? "AND b.task_tag = ?" : ""}
           GROUP BY c.provider_id ORDER BY wins DESC, runs DESC, c.provider_id ASC`,
        )
        .all(...(taskTag !== undefined ? [taskTag] : [])) as {
        provider_id: string;
        runs: number;
        wins: number;
        verified: number;
      }[];
      return rows.map((r) => ({
        providerId: r.provider_id,
        runs: r.runs,
        wins: r.wins,
        winRate: r.runs === 0 ? 0 : r.wins / r.runs,
        verifiedRate: r.runs === 0 ? 0 : r.verified / r.runs,
      }));
    },

    runningReviewsOlderThan(cutoff) {
      const rows = db
        .prepare(`SELECT * FROM advisor_reviews WHERE status = 'running' AND created_at < ?`)
        .all(cutoff) as ReviewRow[];
      return rows.flatMap((r) => {
        const v = toReview(r, warn);
        return v ? [v] : [];
      });
    },
  };
}
