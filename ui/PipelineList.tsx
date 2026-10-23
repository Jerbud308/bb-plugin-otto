// Pipelines list: saved pipelines with Edit and Run, templates to start from, and recent runs.
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import type { rpcContract } from "../src/shared/contract";
import { useBakeoffOptions } from "./bakeoffShared";
import { EmptyState } from "./EmptyState";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { RUN_WORD } from "./pipelineModel";
import { Stamp } from "./Stamp";
import { messageOf, useLoad } from "./useLoad";
import { formatTime } from "./verdict";

function RunForm({ pipelineId, projects, onStarted }: { pipelineId: string; projects: { id: string; name: string }[]; onStarted: (runId: string) => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [projectId, setProjectId] = useState("");
  const [task, setTask] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = projectId || projects[0]?.id || "";
  const valid = project !== "" && task.trim() !== "" && task.length <= 8000;
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { runId } = await rpc.call("pipeline.run", {
        pipelineId,
        projectId: project,
        input: task,
        ...(branch.trim() === "" ? {} : { baseBranch: branch.trim() }),
      });
      onStarted(runId);
    } catch (cause) {
      setError(messageOf(cause));
      toast.error(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="otto-form otto-runform">
      <div className="otto-field">
        <label htmlFor={`otto-pr-project-${pipelineId}`}>Project</label>
        <select id={`otto-pr-project-${pipelineId}`} className="otto-select" value={project} disabled={busy} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="otto-field">
        <label htmlFor={`otto-pr-task-${pipelineId}`}>Task</label>
        <textarea id={`otto-pr-task-${pipelineId}`} className="otto-textarea" rows={3} value={task} disabled={busy} onChange={(e) => setTask(e.target.value)} />
      </div>
      <div className="otto-field">
        <label htmlFor={`otto-pr-branch-${pipelineId}`}>Base branch</label>
        <Input id={`otto-pr-branch-${pipelineId}`} value={branch} placeholder="default branch" disabled={busy} onChange={(e) => setBranch(e.target.value)} />
      </div>
      <p className="otto-meta">Each stage is a visible thread and uses tokens on your account. All stages share one new worktree.</p>
      {error === null ? null : (
        <p role="alert" className="otto-claimline__status--bad">
          {error}
        </p>
      )}
      <div>
        <button type="button" className="otto-btn" disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? "Starting..." : "Start run"}
        </button>
      </div>
    </div>
  );
}

export function PipelineList() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const pipelines = useLoad(() => rpc.call("pipeline.list", null), "pipelines");
  const templates = useLoad(() => rpc.call("pipeline.templates", null), "pipeline-templates");
  const runs = useLoad(() => rpc.call("pipeline.runs", { limit: 15 }), "pipeline-runs");
  const { options } = useBakeoffOptions();
  useRealtime("otto.pipeline", () => runs.reload());
  const [running, setRunning] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const go = (subPath: string): void => navigate.toPluginPanel("otto", { subPath });
  const remove = async (pipelineId: string): Promise<void> => {
    try {
      await rpc.call("pipeline.delete", { pipelineId });
      setConfirming(null);
      pipelines.reload();
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  };
  const list = pipelines.data?.pipelines ?? [];
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <button type="button" className="otto-btn" onClick={() => go("pipelines/new")}>
          New pipeline
        </button>
      </div>
      {pipelines.error !== null && pipelines.data === null ? (
        <div role="alert">
          <p className="otto-claimline__status--bad">{pipelines.error}</p>
          <button type="button" className="otto-btn" onClick={pipelines.reload}>
            Retry
          </button>
        </div>
      ) : null}

      <section aria-label="Your pipelines">
        <p className="otto-section-label">Your pipelines</p>
        {pipelines.data === null ? (
          pipelines.error === null ? <LedgerSkeleton rows={2} /> : null
        ) : list.length === 0 ? (
          <EmptyState line="No pipelines yet. Start from a template below." />
        ) : (
          <div className="otto-ledger">
            {list.map((p) => (
              <div key={p.id} className="otto-row">
                <div className="otto-row__head otto-row__head--static">
                  <span className="otto-board__name">{p.name}</span>
                  <span className="otto-meta">{p.stages.map((s) => s.label).join(" → ")}</span>
                  <button type="button" className="otto-textbtn" onClick={() => go(`pipelines/edit/${p.id}`)}>
                    Edit
                  </button>
                  <button type="button" className="otto-textbtn" onClick={() => setRunning(running === p.id ? null : p.id)}>
                    Run
                  </button>
                  {confirming === p.id ? (
                    <button type="button" className="otto-textbtn otto-claimline__status--bad" onClick={() => void remove(p.id)}>
                      Confirm delete
                    </button>
                  ) : (
                    <button type="button" className="otto-textbtn" onClick={() => setConfirming(p.id)}>
                      Delete
                    </button>
                  )}
                </div>
                {running === p.id ? (
                  <RunForm pipelineId={p.id} projects={options.data?.projects ?? []} onStarted={(runId) => go(`pipelines/run/${runId}`)} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Templates">
        <p className="otto-section-label">Start from a template</p>
        <div className="otto-ledger">
          {(templates.data?.templates ?? []).map((t) => (
            <div key={t.id} className="otto-row">
              <div className="otto-row__head otto-row__head--static">
                <span className="otto-board__name">{t.name}</span>
                <span className="otto-meta">{t.description}</span>
                <button type="button" className="otto-textbtn" onClick={() => go(`pipelines/new/${t.id}`)}>
                  Use template
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Recent runs">
        <p className="otto-section-label">Recent runs</p>
        {runs.data === null ? (
          <LedgerSkeleton rows={2} />
        ) : runs.data.runs.length === 0 ? (
          <p className="otto-marginalia">No runs yet.</p>
        ) : (
          <div className="otto-ledger">
            {runs.data.runs.map((r) => (
              <div key={r.id} className="otto-row">
                <button type="button" className="otto-row__head" onClick={() => go(`pipelines/run/${r.id}`)}>
                  <span className="otto-board__name">{r.pipelineName}</span>
                  <span className="otto-meta">{RUN_WORD[r.status]}</span>
                  <span className="otto-mono otto-meta">{formatTime(r.createdAt)}</span>
                  {r.stages.map((s) =>
                    s.verdict === null ? (
                      <span key={s.idx} className="otto-chip">
                        {s.label}
                      </span>
                    ) : (
                      <Stamp key={s.idx} verdict={s.verdict} label={s.label} />
                    ),
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
