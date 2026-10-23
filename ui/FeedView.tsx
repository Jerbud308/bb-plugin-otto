// Otto page, Feed tab: last-7-day ledger counts, verdict filters, and every proof card (BUILD_SPEC 12.9).
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { CardSummary, Verdict } from "../src/shared/contract";
import type { rpcContract } from "../src/shared/contract";
import { CardView } from "./CardView";
import { EmptyState } from "./EmptyState";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { messageOf, useLoad } from "./useLoad";

const FILTERS: { label: string; verdict: Verdict | null }[] = [
  { label: "All", verdict: null },
  { label: "Contradicted", verdict: "CONTRADICTED" },
  { label: "Unverified", verdict: "UNVERIFIED" },
  { label: "Verified", verdict: "VERIFIED" },
  { label: "No claim", verdict: "NO_CLAIM" },
];

const PAGE = 50;

export function FeedView() {
  const rpc = useRpc<typeof rpcContract>();
  const [filter, setFilter] = useState<Verdict | null>(null);
  const [more, setMore] = useState<CardSummary[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const stats = useLoad(() => rpc.call("proof.stats", null), "stats");
  const page = useLoad(
    () => rpc.call("proof.listCards", { limit: PAGE, ...(filter ? { verdict: filter } : {}) }),
    `feed:${filter ?? "all"}`,
  );

  // A new first page resets the appended pages and the cursor.
  useEffect(() => {
    setMore([]);
    setNextBefore(page.data?.nextBefore ?? null);
  }, [page.data]);

  useRealtime("otto.cards", () => {
    stats.reload();
    page.reload();
  });

  const loadMore = async (): Promise<void> => {
    if (nextBefore === null) return;
    setLoadingMore(true);
    setActionError(null);
    try {
      const r = await rpc.call("proof.listCards", { limit: PAGE, before: nextBefore, ...(filter ? { verdict: filter } : {}) });
      setMore((prev) => [...prev, ...r.cards]);
      setNextBefore(r.nextBefore);
    } catch (cause) {
      setActionError(messageOf(cause));
    } finally {
      setLoadingMore(false);
    }
  };

  const scanRecent = async (): Promise<void> => {
    setScanning(true);
    setActionError(null);
    try {
      const r = await rpc.call("proof.rescanRecent", null);
      setScanResult(`Scanned ${r.threads} threads, wrote ${r.cardsWritten} cards.`);
      stats.reload();
      page.reload();
    } catch (cause) {
      setActionError(messageOf(cause));
    } finally {
      setScanning(false);
    }
  };

  const cards = [...(page.data?.cards ?? []), ...more];
  const week = stats.data?.last7d;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="otto-stats">
        {(
          [
            ["Verified turns, last 7 days", week?.VERIFIED],
            ["Unverified turns, last 7 days", week?.UNVERIFIED],
            ["Contradicted turns, last 7 days", week?.CONTRADICTED],
            ["Turns with no claim, last 7 days", week?.NO_CLAIM],
          ] as const
        ).map(([label, n]) => (
          <span key={label} className="otto-stat">
            <label>{label}:</label>
            <span className="otto-count">{n ?? "-"}</span>
          </span>
        ))}
      </div>
      <div className="otto-filters" role="group" aria-label="Filter by verdict">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className="otto-filter"
            aria-pressed={filter === f.verdict}
            onClick={() => setFilter(f.verdict)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {actionError === null ? null : (
        <p role="alert" className="otto-claimline__status--bad">
          {actionError}
        </p>
      )}
      {page.error !== null && page.data === null ? (
        <div role="alert">
          <p className="otto-claimline__status--bad">{page.error}</p>
          <button type="button" className="otto-btn" onClick={page.reload}>
            Retry
          </button>
        </div>
      ) : page.data === null || scanning ? (
        <LedgerSkeleton rows={5} />
      ) : cards.length === 0 ? (
        filter === null ? (
          <div>
            <EmptyState
              line="No receipts yet. Otto checks every finished agent turn."
              action={{ label: "Scan recent threads", onClick: () => void scanRecent() }}
            />
            {scanResult === null ? null : <p className="otto-mono otto-meta">{scanResult}</p>}
          </div>
        ) : (
          <EmptyState line="Nothing with this verdict in the list." action={{ label: "Show all", onClick: () => setFilter(null) }} />
        )
      ) : (
        <>
          {scanResult === null ? null : <p className="otto-mono otto-meta">{scanResult}</p>}
          <div className="otto-ledger">
            {cards.map((card, i) => (
              <CardView key={card.id} summary={card} showThread index={i} />
            ))}
          </div>
          {nextBefore === null ? null : (
            <button type="button" className="otto-btn" disabled={loadingMore} onClick={() => void loadMore()}>
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}
