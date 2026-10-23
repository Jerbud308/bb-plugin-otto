// The Advisor answers in the margin, like a colleague's pencil notes (BUILD_SPEC 13.6).
import { useBbNavigate, useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdvisorReview, Card } from "../src/shared/contract";
import type { rpcContract } from "../src/shared/contract";
import { Stamp } from "./Stamp";
import { messageOf, useLoad } from "./useLoad";

function payloadCardId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { cardId?: unknown }).cardId;
  return typeof id === "string" ? id : null;
}

function ReviewView({ review }: { review: AdvisorReview }) {
  const navigate = useBbNavigate();
  const link =
    review.advisorThreadId === null ? null : (
      <button type="button" className="otto-textbtn" onClick={() => navigate.toThread(review.advisorThreadId ?? "")}>
        Open advisor thread
      </button>
    );
  if (review.status === "running") {
    return (
      <>
        <p className="otto-advisor__running">
          <span className="otto-live" aria-hidden="true" /> Advisor reading the receipts...
        </p>
        {link}
      </>
    );
  }
  if (review.tainted) {
    return (
      <>
        <p className="otto-claimline__status--bad">The advisor changed files, so this review is invalid.</p>
        {link}
      </>
    );
  }
  if (review.status === "done") {
    const sufficient = review.sufficient === true;
    return (
      <>
        <Stamp
          verdict={sufficient ? "VERIFIED" : "UNVERIFIED"}
          label={sufficient ? "Evidence sufficient" : "Evidence is a proxy"}
        />
        {review.confidence === null ? null : <span className="otto-mono otto-meta"> confidence {review.confidence}</span>}
        {review.missing.length > 0 ? (
          <ul className="otto-marginalia otto-advisor__missing">
            {review.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
        {review.reasoning === null ? null : <p className="otto-marginalia otto-advisor__reasoning">{review.reasoning}</p>}
        {review.suggestedCheck === null ? null : (
          <div className="otto-receipt otto-advisor__check">
            <code>{review.suggestedCheck}</code>
            <button
              type="button"
              className="otto-textbtn"
              onClick={() => {
                void navigator.clipboard.writeText(review.suggestedCheck ?? "").then(
                  () => toast.success("Copied."),
                  () => toast.error("Could not copy."),
                );
              }}
            >
              Copy
            </button>
          </div>
        )}
      </>
    );
  }
  const words: Record<string, string> = {
    unparseable: "Could not read the advisor's answer",
    failed: "Advisor failed",
    timed_out: "Advisor timed out",
  };
  return (
    <>
      <p className="otto-claimline__status--bad">{words[review.status] ?? review.status}</p>
      {link}
    </>
  );
}

export function AdvisorBlock({ card }: { card: Card }) {
  const { values } = useSettings();
  const rpc = useRpc<typeof rpcContract>();
  const operator = values?.mode === "operator";
  const providerId = typeof values?.advisorProviderId === "string" ? values.advisorProviderId : "claude-code";
  const { data, reload } = useLoad(
    () => (operator ? rpc.call("advisor.listForCard", { cardId: card.id }) : Promise.resolve({ reviews: [] })),
    `adv:${card.id}:${operator}`,
  );
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useRealtime("otto.advisor", (payload) => {
    if (payloadCardId(payload) === card.id) reload();
  });
  if (!operator) return null;

  const latest = data?.reviews[0] ?? null;
  const running = latest?.status === "running";
  const ask = async (): Promise<void> => {
    setBusy(true);
    try {
      await rpc.call("advisor.request", { cardId: card.id });
      setConfirm(false);
      reload();
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="otto-advisor" aria-label="Advisor">
      <p className="otto-section-label">Advisor</p>
      {latest === null ? null : <ReviewView review={latest} />}
      {card.verdict === "NO_CLAIM" || running ? null : (
        <button type="button" className="otto-btn otto-advisor__ask" onClick={() => setConfirm(true)}>
          Ask advisor
        </button>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask the advisor?</DialogTitle>
            <DialogDescription>
              This starts a hidden {providerId} thread in this thread's workspace. It reads the evidence and files and
              reports whether the evidence is enough. It costs tokens on your account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="otto-btn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button type="button" className="otto-btn" disabled={busy} onClick={() => void ask()}>
              Ask advisor
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
