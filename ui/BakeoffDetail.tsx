// One bake-off: the race on top, contact prints below, then the winner flow (BUILD_SPEC 14.5).
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Contestant, rpcContract } from "../src/shared/contract";
import { BAKEOFF_STATUS_WORD, payloadBakeoffId, useBakeoffOptions } from "./bakeoffShared";
import { HandCircle } from "./HandCircle";
import { Lanes } from "./Lanes";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { Stamp } from "./Stamp";
import { messageOf, useLoad } from "./useLoad";
import { formatDuration } from "./verdict";

const CONTESTANT_WORD = { starting: "Starting", running: "Running", idle: "Finished", failed: "Failed" } as const;

// Bar widths are relative to the largest total across contestants, so prints compare on one scale.
export function barWidths(c: Contestant, max: number): { add: number; del: number } {
  if (max <= 0) return { add: 0, del: 0 };
  return { add: ((c.insertions ?? 0) / max) * 100, del: ((c.deletions ?? 0) / max) * 100 };
}

export function BakeoffDetail({ bakeoffId }: { bakeoffId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { nameOf } = useBakeoffOptions();
  const detail = useLoad(() => rpc.call("bakeoff.get", { bakeoffId }), `bk:${bakeoffId}`);
  const race = useLoad(() => rpc.call("bakeoff.lanes", { bakeoffId }), `lanes:${bakeoffId}`);
  const [now, setNow] = useState(() => Date.now());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState<number | null>(null);
  const [pickTarget, setPickTarget] = useState<Contestant | null>(null);
  const [deleting, setDeleting] = useState(false);

  useRealtime("otto.bakeoff", (payload) => {
    if (payloadBakeoffId(payload) !== bakeoffId) return;
    detail.reload();
    race.reload();
  });

  const live = detail.data?.contestants.some((c) => c.status === "starting" || c.status === "running") ?? false;
  useEffect(() => {
    if (!live) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    // Commands do not raise a signal, so a running race polls for new ticks.
    const poll = setInterval(() => race.reload(), 10_000);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [live, race.reload]);

  if (detail.error !== null && detail.data === null) {
    return (
      <div role="alert">
        <p className="otto-claimline__status--bad">{detail.error}</p>
        <button type="button" className="otto-btn" onClick={detail.reload}>
          Retry
        </button>
      </div>
    );
  }
  if (detail.data === null) return <LedgerSkeleton rows={4} />;

  const { bakeoff, contestants } = detail.data;
  const max = Math.max(0, ...contestants.map((c) => (c.insertions ?? 0) + (c.deletions ?? 0)));
  const decided = bakeoff.status === "decided";

  const pick = async (c: Contestant): Promise<void> => {
    try {
      await rpc.call("bakeoff.pickWinner", { bakeoffId, contestantId: c.id });
      setPickTarget(null);
      detail.reload();
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  };
  const removeBakeoff = async (): Promise<void> => {
    setBusy(true);
    try {
      await rpc.call("bakeoff.delete", { bakeoffId });
      navigate.toPluginPanel("otto", { subPath: "bakeoff" });
    } catch (cause) {
      toast.error(messageOf(cause));
      setBusy(false);
    }
  };
  const archiveOthers = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await rpc.call("bakeoff.archiveLosers", { bakeoffId });
      setArchived(r.archived);
      setConfirm(false);
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <button type="button" className="otto-textbtn" onClick={() => navigate.toPluginPanel("otto", { subPath: "bakeoff" })}>
          All bake-offs
        </button>{" "}
        <button type="button" className="otto-textbtn" onClick={() => setDeleting(true)}>
          Delete bake-off
        </button>
        <h2 className="otto-bk__title">
          <span className="otto-chip">{bakeoff.taskTag}</span> <span className="otto-meta">{BAKEOFF_STATUS_WORD[bakeoff.status]}</span>
        </h2>
        <p className="otto-claim__text otto-claim__text--clamp otto-meta">{bakeoff.prompt}</p>
      </div>

      {race.data === null ? (
        <LedgerSkeleton rows={contestants.length} />
      ) : (
        <Lanes startedAt={race.data.startedAt} lanes={race.data.lanes} nameOf={nameOf} now={now} />
      )}

      <div className="otto-prints">
        {contestants.map((c) => {
          const w = barWidths(c, max);
          const won = decided && bakeoff.winnerContestantId === c.id;
          const end = c.finishedAt ?? now;
          const hasDiff = c.filesChanged !== null;
          return (
            <section key={c.id} className="otto-print" aria-label={nameOf(c.providerId)}>
              <div
                className="otto-print__bar"
                role="img"
                aria-label={hasDiff ? `${c.insertions} insertions, ${c.deletions} deletions` : "No diff data"}
              >
                <span className="otto-print__add" style={{ width: `${w.add}%` }} />
                <span className="otto-print__del" style={{ width: `${w.del}%` }} />
              </div>
              <p className="otto-mono otto-meta">
                {hasDiff ? `${c.filesChanged} files, +${c.insertions} -${c.deletions}` : "no diff data"}
              </p>
              <p className="otto-print__name">{won ? <HandCircle>{nameOf(c.providerId)}</HandCircle> : nameOf(c.providerId)}</p>
              {won ? (
                <p className="otto-marginalia">Merge from the winner&apos;s thread with bb&apos;s own merge controls.</p>
              ) : null}
              <p className="otto-print__status">
                {c.status === "running" || c.status === "starting" ? <span className="otto-live" aria-hidden="true" /> : null}
                <span className="otto-meta">{CONTESTANT_WORD[c.status]}</span>
                {c.verdict === null ? null : <Stamp verdict={c.verdict} />}
                <span className="otto-mono otto-meta">{formatDuration(end - c.startedAt)}</span>
              </p>
              {c.error === null ? null : <p className="otto-claimline__status--bad">{c.error}</p>}
              <div className="otto-print__actions">
                <button
                  type="button"
                  className="otto-btn"
                  disabled={c.threadId === null}
                  onClick={() => c.threadId !== null && navigate.toThread(c.threadId)}
                >
                  Open thread
                </button>
                {decided ? null : (
                  <button
                    type="button"
                    className="otto-btn"
                    disabled={bakeoff.status !== "ready" || c.status !== "idle"}
                    onClick={() => setPickTarget(c)}
                  >
                    Pick as winner
                  </button>
                )}
                {won ? (
                  <button type="button" className="otto-btn" disabled={archived !== null} onClick={() => setConfirm(true)}>
                    Archive the other threads
                  </button>
                ) : null}
              </div>
              {won && archived !== null ? <p className="otto-mono otto-meta">Archived {archived} threads.</p> : null}
            </section>
          );
        })}
      </div>

      <Dialog open={pickTarget !== null} onOpenChange={(open) => (open ? undefined : setPickTarget(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pick {pickTarget === null ? "" : nameOf(pickTarget.providerId)} as the winner?</DialogTitle>
            <DialogDescription>This cannot be undone. Otto does not merge anything; you merge from the winner's thread.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="otto-btn" onClick={() => setPickTarget(null)}>
              Cancel
            </button>
            <button type="button" className="otto-btn" onClick={() => pickTarget !== null && void pick(pickTarget)}>
              Confirm winner
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this bake-off?</DialogTitle>
            <DialogDescription>
              Removes the bake-off and its scores from Otto. The threads and worktrees stay in bb.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="otto-btn" onClick={() => setDeleting(false)}>
              Cancel
            </button>
            <button type="button" className="otto-btn" disabled={busy} onClick={() => void removeBakeoff()}>
              Delete bake-off
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive the other threads?</DialogTitle>
            <DialogDescription>
              The other agents' threads move to the archive. Their worktrees stay until you remove them in bb.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="otto-btn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button type="button" className="otto-btn" disabled={busy} onClick={() => void archiveOthers()}>
              Archive the other threads
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
