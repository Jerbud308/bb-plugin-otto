// Thread side panel: every proof card for one thread (BUILD_SPEC 12.7).
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { rpcContract } from "../src/shared/contract";
import { CardView } from "./CardView";
import { EmptyState } from "./EmptyState";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { Ribbon } from "./Ribbon";
import { Stamp } from "./Stamp";
import { messageOf, payloadThreadId, useLoad } from "./useLoad";

export function ProofPanel({ threadId }: { threadId: string; params?: unknown }) {
  const rpc = useRpc<typeof rpcContract>();
  const summary = useLoad(() => rpc.call("proof.threadSummary", { threadId }), `s:${threadId}`);
  const list = useLoad(() => rpc.call("proof.listCards", { threadId, limit: 50 }), `l:${threadId}`);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  useRealtime("otto.cards", (payload) => {
    if (payloadThreadId(payload) === threadId) {
      summary.reload();
      list.reload();
    }
  });

  const rescan = async (): Promise<void> => {
    setRescanning(true);
    setRescanError(null);
    try {
      await rpc.call("proof.rescanThread", { threadId });
      summary.reload();
      list.reload();
    } catch (cause) {
      setRescanError(messageOf(cause));
    } finally {
      setRescanning(false);
    }
  };

  const counts = summary.data?.counts;
  const turns = counts ? counts.VERIFIED + counts.UNVERIFIED + counts.CONTRADICTED + counts.NO_CLAIM : 0;
  const allClear = counts !== undefined && counts.VERIFIED >= 1 && counts.UNVERIFIED === 0 && counts.CONTRADICTED === 0;
  const failure = list.error ?? summary.error;

  return (
    <div className="otto" style={{ display: "grid", gap: 12 }}>
      {counts ? <Ribbon counts={counts} width="100%" height={8} /> : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span className="otto-meta">
          <span className="otto-mono">{turns}</span> {turns === 1 ? "turn" : "turns"} checked
        </span>
        <button type="button" className="otto-btn" disabled={rescanning} onClick={() => void rescan()}>
          Rescan
        </button>
      </div>
      {allClear ? <Stamp verdict="VERIFIED" size="md" label="All claims verified" cardId={`allclear:${threadId}`} /> : null}
      {rescanError === null ? null : (
        <p role="alert" className="otto-claimline__status--bad">
          {rescanError}
        </p>
      )}
      {failure !== null && list.data === null ? (
        <div role="alert">
          <p className="otto-claimline__status--bad">{failure}</p>
          <button
            type="button"
            className="otto-btn"
            onClick={() => {
              summary.reload();
              list.reload();
            }}
          >
            Retry
          </button>
        </div>
      ) : rescanning || list.data === null ? (
        <LedgerSkeleton rows={rescanning ? 3 : 4} />
      ) : list.data.cards.length === 0 ? (
        <EmptyState line="Nothing to check yet. Finish a turn and I'll read the receipts." />
      ) : (
        <div className="otto-ledger">
          {list.data.cards.map((card, i) => (
            <CardView key={card.id} summary={card} defaultOpen={i === 0} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
