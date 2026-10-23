// The Budget tab: plan windows as meters, project token ledger, guard line, recent guard events.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../src/shared/contract";
import { CHANNEL_GUARD } from "../src/shared/constants";
import { useBakeoffOptions } from "./bakeoffShared";
import { EmptyState } from "./EmptyState";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { useLoad } from "./useLoad";
import { formatTime } from "./verdict";

const MODE_LINE = {
  off: "Guard is off. Otto only watches usage and never holds a message.",
  warn: "Guard warns: a message over a limit is let through and noted below.",
  wait: "Guard waits: a message over a limit is held until the window resets.",
  reject: "Guard rejects: a message over a limit is refused with a reason.",
} as const;

export const tokens = (n: number): string => n.toLocaleString("en-US");

export function Meter({ label, percent, limit }: { label: string; percent: number; limit: number }) {
  const shown = Math.max(0, Math.min(100, percent));
  return (
    <div className="otto-meter" role="img" aria-label={`${label} ${Math.round(percent)} percent used, guard limit ${limit} percent`}>
      <span className="otto-meter__label">{label}</span>
      <span className="otto-meter__track">
        <span className="otto-meter__fill" data-over={percent >= limit ? "true" : "false"} style={{ width: `${shown}%` }} />
        <span className="otto-meter__limit" style={{ left: `${Math.min(100, limit)}%` }} />
      </span>
      <span className="otto-mono otto-meta">{Math.round(percent)}%</span>
    </div>
  );
}

export function BudgetView() {
  const rpc = useRpc<typeof rpcContract>();
  const summary = useLoad(() => rpc.call("budget.summary", null), "budget-summary");
  const events = useLoad(() => rpc.call("budget.events", { limit: 20 }), "budget-events");
  const { options, nameOf } = useBakeoffOptions();
  useRealtime(CHANNEL_GUARD, () => {
    summary.reload();
    events.reload();
  });
  if (summary.error !== null && summary.data === null) {
    return (
      <div role="alert">
        <p className="otto-claimline__status--bad">{summary.error}</p>
        <button type="button" className="otto-btn" onClick={summary.reload}>
          Retry
        </button>
      </div>
    );
  }
  const s = summary.data;
  if (s === null) return <LedgerSkeleton rows={4} />;
  const projectName = (id: string): string => options.data?.projects.find((p) => p.id === id)?.name ?? id;
  const windows = s.providers.flatMap((p) => p.windows.map((w) => ({ p, w })));
  const cap = s.guard.projectTokenCap;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p className="otto-marginalia">{MODE_LINE[s.guard.mode]}</p>
      <p className="otto-meta">
        Limit <span className="otto-mono">{s.guard.windowPercent}%</span> of a plan window
        {cap > 0 ? (
          <>
            , cap <span className="otto-mono">{tokens(cap)}</span> tokens per project
          </>
        ) : (
          ", no project token cap"
        )}
        {s.guard.projectIds.length > 0 ? `, guarding ${s.guard.projectIds.length} project${s.guard.projectIds.length === 1 ? "" : "s"}` : ", guarding every project"}.
      </p>

      <section aria-label="Plan windows">
        <p className="otto-section-label">Plan windows</p>
        {windows.length === 0 ? (
          <p className="otto-marginalia">No provider has reported a plan window yet. Otto asks every five minutes.</p>
        ) : (
          <div className="otto-ledger">
            {windows.map(({ p, w }) => (
              <div key={`${p.providerId}:${w.label}`} className="otto-row otto-board__row">
                <span className="otto-board__name">{nameOf(p.providerId)}</span>
                <Meter label={w.label} percent={w.usedPercent} limit={s.guard.windowPercent} />
                {w.resetsAt === null ? null : <span className="otto-mono otto-meta">resets {formatTime(Date.parse(w.resetsAt))}</span>}
                {p.planLabel === null ? null : <span className="otto-chip">{p.planLabel}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Project tokens">
        <p className="otto-section-label">Tokens by project</p>
        {s.projects.length === 0 ? (
          <p className="otto-marginalia">No token counts yet. They appear after a thread finishes a turn.</p>
        ) : (
          <div className="otto-ledger">
            {s.projects.map((p) => (
              <div key={p.projectId} className="otto-row otto-board__row">
                <span className="otto-board__name">{projectName(p.projectId)}</span>
                <span className="otto-mono otto-count">{tokens(p.totalTokens)}</span>
                <span className="otto-mono otto-meta">{p.threads} {p.threads === 1 ? "thread" : "threads"}</span>
                {cap > 0 && p.totalTokens >= cap ? <span className="otto-claimline__status--bad otto-meta">over cap</span> : null}
              </div>
            ))}
          </div>
        )}
        <p className="otto-meta">Tokens and the provider's own plan percent only. Otto shows no dollar figures because bb reports none per thread.</p>
      </section>

      <section aria-label="Recent guard events">
        <p className="otto-section-label">Guard events</p>
        {events.data === null ? (
          <LedgerSkeleton rows={2} />
        ) : events.data.events.length === 0 ? (
          <EmptyState line="Nothing held or flagged." />
        ) : (
          <div className="otto-ledger">
            {events.data.events.map((e) => (
              <div key={e.id} className="otto-row otto-board__row">
                <span className="otto-mono otto-meta">{formatTime(e.at)}</span>
                <span className="otto-chip">{e.action}</span>
                <span>{e.reason}</span>
                <span className="otto-mono otto-meta">{e.threadId}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
