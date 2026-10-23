// The Learn tab: which traps repeat, per provider, and a CLAUDE.md line to copy for each habit worth dropping.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import type { rpcContract } from "../src/shared/contract";
import { useBakeoffOptions } from "./bakeoffShared";
import { EmptyState } from "./EmptyState";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { Tally } from "./Tally";
import { useLoad } from "./useLoad";
import { formatTime } from "./verdict";

type Days = 7 | 30 | 90;
const WINDOWS: Days[] = [7, 30, 90];

export function WeekBars({ weekly }: { weekly: number[] }) {
  const max = Math.max(1, ...weekly);
  const w = 6;
  const label = `Per week, oldest first: ${weekly.join(", ")}`;
  return (
    <svg className="otto-weekbars" width={weekly.length * (w + 2)} height="14" role="img" aria-label={label}>
      <title>{label}</title>
      {weekly.map((n, i) => {
        const h = n === 0 ? 1 : Math.max(2, Math.round((n / max) * 13));
        return <rect key={i} x={i * (w + 2)} y={14 - h} width={w} height={h} fill="currentColor" />;
      })}
    </svg>
  );
}

function CopyLine({ line }: { line: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const copy = () => {
    void navigator.clipboard?.writeText(line).then(
      () => {
        setCopied(true);
        timer.current = setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  };
  return (
    <button type="button" className="otto-textbtn" onClick={copy}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function LearnView() {
  const rpc = useRpc<typeof rpcContract>();
  const [days, setDays] = useState<Days>(30);
  const trends = useLoad(() => rpc.call("learn.trends", { days }), `learn-trends:${days}`);
  const sugg = useLoad(() => rpc.call("learn.suggestions", { days }), `learn-sugg:${days}`);
  const { nameOf } = useBakeoffOptions();
  if (trends.error !== null && trends.data === null) {
    return (
      <div role="alert">
        <p className="otto-claimline__status--bad">{trends.error}</p>
        <button type="button" className="otto-btn" onClick={trends.reload}>
          Retry
        </button>
      </div>
    );
  }
  const t = trends.data;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="otto-board__head">
        <p className="otto-marginalia">Traps that keep coming back, counted from the proof cards Otto already holds.</p>
        <select className="otto-select" aria-label="Window" value={days} onChange={(e) => setDays(Number(e.target.value) as Days)}>
          {WINDOWS.map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
      </div>

      <section aria-label="Trends">
        <p className="otto-section-label">Trends</p>
        {t === null ? (
          <LedgerSkeleton rows={4} />
        ) : t.rules.length === 0 ? (
          <EmptyState line={`No rule fired in the last ${t.days} days.`} />
        ) : (
          <>
            <p className="otto-meta">{t.cardsInWindow} cards in this window.</p>
            <div className="otto-ledger">
              {t.rules.map((r) => (
                <div key={r.ruleId} className="otto-row otto-board__row">
                  <span className="otto-mono">{r.ruleId}</span>
                  <span className="otto-board__name">{r.title}</span>
                  <Tally count={r.count} noun={["time", "times"]} />
                  <span className="otto-meta">
                    {r.count === 1 ? "1 time" : `${r.count} times`}, last {t.days} days
                  </span>
                  <WeekBars weekly={r.weekly} />
                  <span className="otto-meta">{r.byProvider.map((p) => `${nameOf(p.providerId)} ${p.count}`).join(", ")}</span>
                  <span className="otto-mono otto-meta">last {formatTime(r.lastAt)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section aria-label="Suggested lines">
        <p className="otto-section-label">Lines worth adding to your CLAUDE.md</p>
        {sugg.data === null ? (
          <LedgerSkeleton rows={2} />
        ) : sugg.data.suggestions.length === 0 ? (
          <p className="otto-marginalia">Nothing has repeated three times yet.</p>
        ) : (
          <div className="otto-ledger">
            {sugg.data.suggestions.map((s) => (
              <div key={s.ruleId} className="otto-row otto-board__row">
                <span className="otto-mono">{s.ruleId}</span>
                <span className="otto-chip">{s.count} times</span>
                <span className="otto-suggestion">{s.line}</span>
                <CopyLine line={s.line} />
              </div>
            ))}
          </div>
        )}
        <p className="otto-meta">Otto never edits your files. Paste a line into CLAUDE.md yourself.</p>
      </section>
    </div>
  );
}
