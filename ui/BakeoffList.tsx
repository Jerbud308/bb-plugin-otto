// Bake-off list: past bake-offs as ledger rows, then the scoreboard (BUILD_SPEC 14.5).
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { rpcContract } from "../src/shared/contract";
import { BAKEOFF_STATUS_WORD, percent, useBakeoffOptions } from "./bakeoffShared";
import { EmptyState } from "./EmptyState";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { NewBakeoffDialog } from "./NewBakeoffDialog";
import { Tally } from "./Tally";
import { useLoad } from "./useLoad";
import { formatTime } from "./verdict";

function Scoreboard({ tags, nameOf }: { tags: string[]; nameOf: (providerId: string) => string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [tag, setTag] = useState("");
  const board = useLoad(() => rpc.call("bakeoff.scoreboard", tag === "" ? {} : { taskTag: tag }), `board:${tag}`);
  useRealtime("otto.bakeoff", () => board.reload());
  const rows = board.data?.rows ?? [];
  return (
    <section aria-label="Scoreboard" className="otto-board">
      <div className="otto-board__head">
        <p className="otto-section-label">Scoreboard</p>
        <select
          className="otto-select"
          aria-label="Filter the scoreboard by task tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">All task tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {board.data === null ? (
        <LedgerSkeleton rows={2} />
      ) : rows.length === 0 ? (
        <p className="otto-marginalia">No decided bake-offs yet. Pick a winner to start the scoreboard.</p>
      ) : (
        <>
          <div className="otto-ledger">
            {rows.map((r) => (
              <div key={r.providerId} className="otto-row otto-board__row">
                <span className="otto-board__name">{nameOf(r.providerId)}</span>
                <Tally count={r.wins} />
                <span className="otto-mono otto-meta">{r.runs} runs</span>
                <span className="otto-mono otto-meta">{percent(r.winRate)} win rate</span>
                <span className="otto-mono otto-meta">{percent(r.verifiedRate)} verified</span>
              </div>
            ))}
          </div>
          <details className="otto-twin">
            <summary className="otto-textbtn">Scoreboard as a table</summary>
            <table className="otto-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Runs</th>
                  <th>Wins</th>
                  <th>Win rate</th>
                  <th>Verified rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.providerId}>
                    <td>{nameOf(r.providerId)}</td>
                    <td className="otto-mono">{r.runs}</td>
                    <td className="otto-mono">{r.wins}</td>
                    <td className="otto-mono">{percent(r.winRate)}</td>
                    <td className="otto-mono">{percent(r.verifiedRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

export function BakeoffList() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { options, nameOf } = useBakeoffOptions();
  const list = useLoad(() => rpc.call("bakeoff.list", { limit: 20 }), "bakeoff-list");
  useRealtime("otto.bakeoff", () => list.reload());
  const [creating, setCreating] = useState(false);
  const bakeoffs = list.data?.bakeoffs ?? [];
  const tags = [...new Set(bakeoffs.map((b) => b.taskTag))].sort();
  const open = (id: string): void => navigate.toPluginPanel("otto", { subPath: `bakeoff/${id}` });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <button type="button" className="otto-btn" onClick={() => setCreating(true)}>
          New bake-off
        </button>
      </div>
      {list.error !== null && list.data === null ? (
        <div role="alert">
          <p className="otto-claimline__status--bad">{list.error}</p>
          <button type="button" className="otto-btn" onClick={list.reload}>
            Retry
          </button>
        </div>
      ) : list.data === null ? (
        <LedgerSkeleton rows={3} />
      ) : bakeoffs.length === 0 ? (
        <EmptyState
          line="No bake-offs yet. Send one task to two agents and compare the receipts."
          action={{ label: "New bake-off", onClick: () => setCreating(true) }}
        />
      ) : (
        <div className="otto-ledger">
          {bakeoffs.map((b, i) => (
            <div key={b.id} className="otto-row" style={{ ["--otto-i" as string]: Math.min(i, 10) }}>
              <button type="button" className="otto-row__head" onClick={() => open(b.id)}>
                <span className="otto-chip">{b.taskTag}</span>
                <span className="otto-meta">{BAKEOFF_STATUS_WORD[b.status]}</span>
                <span className="otto-mono otto-meta">{formatTime(b.createdAt)}</span>
                <span className="otto-mono otto-meta">{b.contestantCount} agents</span>
                {b.winnerProviderId === null ? null : <span className="otto-meta">Winner: {nameOf(b.winnerProviderId)}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
      <Scoreboard tags={tags} nameOf={nameOf} />
      <NewBakeoffDialog open={creating} onOpenChange={setCreating} options={options.data} onCreated={open} />
    </div>
  );
}
