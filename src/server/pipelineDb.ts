// Store queries for Pipelines (migrations 9 to 11). Mixed into the OttoStore by openStore.
import type { PipelineDef } from "../proof/pipeline";
import {
  pipelineDefSchema,
  pipelineRunStatusSchema,
  pipelineStageStatusSchema,
  stageDefSchema,
  verdictSchema,
  type Pipeline,
  type PipelineRun,
  type PipelineRunSummary,
  type PipelineStage,
} from "../shared/contract";
import type { OttoDatabase } from "./db";

// A run keeps its own copy of the definition it started from.
export interface RunRecord extends PipelineRun {
  definition: PipelineDef;
}

interface PipelineRow {
  id: string;
  name: string;
  definition_json: string;
  created_at: number;
  updated_at: number;
}
interface RunRow {
  id: string;
  pipeline_id: string | null;
  pipeline_name: string;
  project_id: string;
  input: string;
  base_branch: string | null;
  definition_json: string;
  status: string;
  environment_id: string | null;
  note: string | null;
  created_at: number;
  finished_at: number | null;
}
interface StageRow {
  id: string;
  run_id: string;
  idx: number;
  stage_key: string;
  label: string;
  provider_id: string;
  thread_id: string | null;
  status: string;
  verdict: string | null;
  output: string | null;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
}

function parseDefinition(json: string): PipelineDef | null {
  try {
    const r = pipelineDefSchema.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function createPipelineQueries(db: OttoDatabase, warn: (message: string) => void) {
  const toPipeline = (row: PipelineRow): Pipeline | null => {
    const def = parseDefinition(row.definition_json);
    if (!def) {
      warn(`dropping unreadable pipeline ${row.id}`);
      return null;
    }
    return { id: row.id, name: row.name, stages: def.stages, createdAt: row.created_at, updatedAt: row.updated_at };
  };
  const toRun = (row: RunRow): RunRecord | null => {
    const status = pipelineRunStatusSchema.safeParse(row.status);
    const definition = parseDefinition(row.definition_json);
    if (!status.success || !definition) {
      warn(`dropping unreadable pipeline run ${row.id}`);
      return null;
    }
    return {
      id: row.id,
      pipelineId: row.pipeline_id,
      pipelineName: row.pipeline_name,
      projectId: row.project_id,
      input: row.input,
      baseBranch: row.base_branch,
      status: status.data,
      environmentId: row.environment_id,
      note: row.note,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      definition,
    };
  };
  const toStage = (row: StageRow): PipelineStage | null => {
    const status = pipelineStageStatusSchema.safeParse(row.status);
    const verdict = row.verdict === null ? null : verdictSchema.safeParse(row.verdict);
    if (!status.success || (verdict !== null && !verdict.success)) {
      warn(`dropping unreadable pipeline stage ${row.id}`);
      return null;
    }
    return {
      id: row.id,
      runId: row.run_id,
      idx: row.idx,
      key: row.stage_key,
      label: row.label,
      providerId: row.provider_id,
      threadId: row.thread_id,
      status: status.data,
      verdict: verdict === null ? null : verdict.success ? verdict.data : null,
      output: row.output,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
    };
  };
  const stagesOf = (runId: string): PipelineStage[] =>
    (db.prepare(`SELECT * FROM pipeline_stages WHERE run_id = ? ORDER BY idx`).all(runId) as StageRow[]).flatMap((r) => {
      const s = toStage(r);
      return s ? [s] : [];
    });

  return {
    savePipeline(p: Pipeline): void {
      db.prepare(
        `INSERT INTO pipelines (id, name, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, definition_json = excluded.definition_json, updated_at = excluded.updated_at`,
      ).run(p.id, p.name, JSON.stringify({ name: p.name, stages: p.stages }), p.createdAt, p.updatedAt);
    },
    listPipelines(): Pipeline[] {
      return (db.prepare(`SELECT * FROM pipelines ORDER BY updated_at DESC, id DESC`).all() as PipelineRow[]).flatMap((r) => {
        const p = toPipeline(r);
        return p ? [p] : [];
      });
    },
    getPipeline(id: string): Pipeline | null {
      const row = db.prepare(`SELECT * FROM pipelines WHERE id = ?`).get(id) as PipelineRow | undefined;
      return row ? toPipeline(row) : null;
    },
    deletePipeline(id: string): void {
      db.prepare(`DELETE FROM pipelines WHERE id = ?`).run(id);
    },

    insertRun(run: RunRecord, stages: PipelineStage[]): void {
      db.prepare(
        `INSERT INTO pipeline_runs (id, pipeline_id, pipeline_name, project_id, input, base_branch, definition_json, status,
           environment_id, note, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        run.id,
        run.pipelineId,
        run.pipelineName,
        run.projectId,
        run.input,
        run.baseBranch,
        JSON.stringify(run.definition),
        run.status,
        run.environmentId,
        run.note,
        run.createdAt,
        run.finishedAt,
      );
      const insert = db.prepare(
        `INSERT INTO pipeline_stages (id, run_id, idx, stage_key, label, provider_id, thread_id, status, verdict, output,
           started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of stages) {
        insert.run(s.id, s.runId, s.idx, s.key, s.label, s.providerId, s.threadId, s.status, s.verdict, s.output, s.startedAt, s.finishedAt, s.error);
      }
    },
    updateRun(id: string, patch: Partial<Pick<PipelineRun, "status" | "environmentId" | "note" | "finishedAt">>): void {
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      const set = (column: string, value: string | number | null): void => {
        sets.push(`${column} = ?`);
        args.push(value);
      };
      if (patch.status !== undefined) set("status", patch.status);
      if (patch.environmentId !== undefined) set("environment_id", patch.environmentId);
      if (patch.note !== undefined) set("note", patch.note);
      if (patch.finishedAt !== undefined) set("finished_at", patch.finishedAt);
      if (sets.length === 0) return;
      db.prepare(`UPDATE pipeline_runs SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
    },
    getRun(id: string): RunRecord | null {
      const row = db.prepare(`SELECT * FROM pipeline_runs WHERE id = ?`).get(id) as RunRow | undefined;
      return row ? toRun(row) : null;
    },
    openRuns(): RunRecord[] {
      return (db.prepare(`SELECT * FROM pipeline_runs WHERE status = 'running'`).all() as RunRow[]).flatMap((r) => {
        const run = toRun(r);
        return run ? [run] : [];
      });
    },
    listRuns(limit: number): PipelineRunSummary[] {
      const rows = db.prepare(`SELECT * FROM pipeline_runs ORDER BY created_at DESC, id DESC LIMIT ?`).all(limit) as RunRow[];
      return rows.flatMap((r) => {
        const run = toRun(r);
        if (!run) return [];
        const { definition: _definition, ...rest } = run;
        return [{ ...rest, stages: stagesOf(run.id).map((s) => ({ idx: s.idx, label: s.label, status: s.status, verdict: s.verdict })) }];
      });
    },
    stagesFor: stagesOf,
    updateStage(
      id: string,
      patch: Partial<Pick<PipelineStage, "threadId" | "status" | "verdict" | "output" | "startedAt" | "finishedAt" | "error">>,
    ): void {
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      const set = (column: string, value: string | number | null): void => {
        sets.push(`${column} = ?`);
        args.push(value);
      };
      if (patch.threadId !== undefined) set("thread_id", patch.threadId);
      if (patch.status !== undefined) set("status", patch.status);
      if (patch.verdict !== undefined) set("verdict", patch.verdict);
      if (patch.output !== undefined) set("output", patch.output);
      if (patch.startedAt !== undefined) set("started_at", patch.startedAt);
      if (patch.finishedAt !== undefined) set("finished_at", patch.finishedAt);
      if (patch.error !== undefined) set("error", patch.error);
      if (sets.length === 0) return;
      db.prepare(`UPDATE pipeline_stages SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
    },
    stageByThread(threadId: string): PipelineStage | null {
      const row = db.prepare(`SELECT * FROM pipeline_stages WHERE thread_id = ?`).get(threadId) as StageRow | undefined;
      return row ? toStage(row) : null;
    },
    deleteRun(id: string): void {
      db.prepare(`DELETE FROM pipeline_stages WHERE run_id = ?`).run(id);
      db.prepare(`DELETE FROM pipeline_runs WHERE id = ?`).run(id);
    },
  };
}
