// One pipeline run: its stages as lanes, each with status, an Otto stamp, duration and a link to the thread.
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { toast } from "sonner";
import type { rpcContract } from "../src/shared/contract";
import { useBakeoffOptions } from "./bakeoffShared";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { RUN_WORD, STAGE_WORD, payloadRunId } from "./pipelineModel";
import { Stamp } from "./Stamp";
import { messageOf, useLoad } from "./useLoad";
import { formatDuration, formatTime } from "./verdict";

export function PipelineRunView({ runId }: { runId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const run = useLoad(() => rpc.call("pipeline.getRun", { runId }), `pipeline-run:${runId}`);
  const { nameOf } = useBakeoffOptions();
  const [stopping, setStopping] = useState(false);
  useRealtime("otto.pipeline", (payload) => {
    if (payloadRunId(payload) === runId) run.reload();
  });
  if (run.error !== null && run.data === null) {
    return (
      <div role="alert">
        <p className="otto-claimline__status--bad">{run.error}</p>
        <button type="button" className="otto-btn" onClick={run.reload}>
          Retry
        </button>
      </div>
    );
  }
  if (run.data === null) return <LedgerSkeleton rows={3} />;
  const { run: r, stages } = run.data;
  const stop = async (): Promise<void> => {
    setStopping(true);
    try {
      await rpc.call("pipeline.stop", { runId });
      run.reload();
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setStopping(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="otto-bk__title">
        <button type="button" className="otto-textbtn" onClick={() => navigate.toPluginPanel("otto", { subPath: "pipelines" })}>
          Pipelines
        </button>
        <span>{r.pipelineName}</span>
        <span className="otto-chip">{RUN_WORD[r.status]}</span>
        <span className="otto-mono otto-meta">{formatTime(r.createdAt)}</span>
        {r.status === "running" ? (
          <button type="button" className="otto-btn" disabled={stopping} onClick={() => void stop()}>
            Stop run
          </button>
        ) : null}
      </div>
      <p className="otto-marginalia">{r.input}</p>
      {r.note === null ? null : <p className="otto-meta">{r.note}</p>}
      <div className="otto-ledger">
        {stages.map((s) => (
          <div key={s.id} className="otto-row">
            <div className="otto-row__head otto-row__head--static">
              <span className="otto-mono otto-meta">{s.idx + 1}</span>
              <span className="otto-board__name">{s.label}</span>
              <span className="otto-meta">{nameOf(s.providerId)}</span>
              <span className="otto-meta">{STAGE_WORD[s.status]}</span>
              {s.verdict === null ? null : <Stamp verdict={s.verdict} />}
              {s.startedAt !== null && s.finishedAt !== null ? <span className="otto-mono otto-meta">{formatDuration(s.finishedAt - s.startedAt)}</span> : null}
              {s.threadId === null ? null : (
                <button type="button" className="otto-textbtn" onClick={() => navigate.toThread(s.threadId ?? "")}>
                  Open thread
                </button>
              )}
            </div>
            {s.error === null ? null : <p className="otto-claimline__status--bad otto-meta">{s.error}</p>}
            {s.output === null || s.output === "" ? null : (
              <details className="otto-twin">
                <summary>Reply</summary>
                <pre className="otto-mono otto-pre">{s.output}</pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
