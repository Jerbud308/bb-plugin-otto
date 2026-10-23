// One proof card as a ledger row: collapsed summary, expanded claim, claims, and receipt (BUILD_SPEC 12.8).
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useState, type KeyboardEvent } from "react";
import type { Card, CardSummary } from "../src/shared/contract";
import type { rpcContract } from "../src/shared/contract";
import { AdvisorBlock } from "./AdvisorBlock";
import { ClaimText } from "./ClaimText";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { Receipt } from "./Receipt";
import { Stamp } from "./Stamp";
import { useLoad } from "./useLoad";
import { CLAIM_NAME, CLAIM_STATUS_LABEL, formatTime, shortId } from "./verdict";

function scrollToReceipt(itemId: string): void {
  document.getElementById(`receipt-${itemId}`)?.scrollIntoView({ block: "center" });
}

function ExpandedCard({ cardId }: { cardId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const { data, error, reload } = useLoad(() => rpc.call("proof.getCard", { cardId }), cardId);
  if (error !== null && data === null) {
    return (
      <div className="otto-row__body" role="alert">
        <p className="otto-claimline__status--bad">{error}</p>
        <button type="button" className="otto-btn" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }
  if (data === null) return <LedgerSkeleton rows={3} />;
  const card: Card | null = data.card;
  if (card === null) return <p className="otto-marginalia">This card is gone. Rescan the thread to rebuild it.</p>;
  return (
    <div className="otto-row__body otto-row__body--margin">
      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
        <div>
          <p className="otto-section-label">Claim</p>
          {card.claimText === "" ? (
            <p className="otto-marginalia">The agent sent no final message.</p>
          ) : (
            <ClaimText text={card.claimText} claims={card.claims} />
          )}
        </div>
        {card.claims.length > 0 ? (
          <div>
            <p className="otto-section-label">Claims</p>
            {card.claims.map((c) => (
              <div key={c.claim} className="otto-claimline">
                <span>{CLAIM_NAME[c.claim]}</span>
                {c.status === null ? (
                  <span className="otto-meta">claimed, nothing specific to check</span>
                ) : (
                  <span className={c.status === "supported" ? "otto-meta" : "otto-claimline__status--bad"}>
                    {CLAIM_STATUS_LABEL[c.status]}
                  </span>
                )}
                {c.evidenceItemId === null ? null : (
                  <button type="button" className="otto-textbtn" onClick={() => scrollToReceipt(c.evidenceItemId ?? "")}>
                    Show receipt
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}
        <div>
          <p className="otto-section-label">Receipt</p>
          {card.evidence.length === 0 ? (
            <p className="otto-marginalia">No verification command ran in this turn.</p>
          ) : (
            <Receipt evidence={card.evidence} findings={card.findings} />
          )}
        </div>
      </div>
      <AdvisorBlock card={card} />
    </div>
  );
}

export interface CardViewProps {
  summary: CardSummary;
  defaultOpen?: boolean;
  showThread?: boolean;
  index?: number;
}

export function CardView({ summary, defaultOpen = false, showThread = false, index = 0 }: CardViewProps) {
  const [open, setOpen] = useState(defaultOpen);
  const navigate = useBbNavigate();
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((v) => !v);
    }
  };
  return (
    <div className="otto-row" style={{ ["--otto-i" as string]: Math.min(index, 10) }} data-card-id={summary.id}>
      <div
        className="otto-row__head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
      >
        <Stamp verdict={summary.verdict} cardId={summary.id} />
        {showThread ? (
          <button
            type="button"
            className="otto-textbtn otto-row__title"
            onClick={(event) => {
              event.stopPropagation();
              navigate.toThread(summary.threadId);
            }}
          >
            {summary.threadTitle ?? summary.threadId}
          </button>
        ) : (
          <span className="otto-mono otto-meta">Turn {shortId(summary.turnId)}</span>
        )}
        <span className="otto-mono otto-meta">{formatTime(summary.createdAt)}</span>
        {summary.claimKinds.map((k) => (
          <span key={k} className="otto-chip">
            {CLAIM_NAME[k]}
          </span>
        ))}
        <span className={`otto-mono otto-meta${summary.highFindingCount > 0 ? " otto-findings--high" : ""}`}>
          {summary.findingCount} {summary.findingCount === 1 ? "finding" : "findings"}
        </span>
      </div>
      {open ? <ExpandedCard cardId={summary.id} /> : null}
    </div>
  );
}
