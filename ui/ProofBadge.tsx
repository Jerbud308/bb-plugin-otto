// Thread header badge: newest verdict plus a ribbon of the thread's counts (BUILD_SPEC 12.6).
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../src/shared/contract";
import { Ribbon } from "./Ribbon";
import { Stamp } from "./Stamp";
import { payloadThreadId, useLoad } from "./useLoad";
import { VERDICT_WORD } from "./verdict";

export function ProofBadge({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { data, error, reload } = useLoad(() => rpc.call("proof.threadSummary", { threadId }), threadId);
  useRealtime("otto.cards", (payload) => {
    if (payloadThreadId(payload) === threadId) reload();
  });
  if (error !== null || data === null || data.latest === null) return null;
  const { latest, counts } = data;
  return (
    <button
      type="button"
      className="otto-badge"
      aria-label={`Otto proof: ${VERDICT_WORD[latest.verdict]}. ${counts.VERIFIED} verified, ${counts.UNVERIFIED} unverified, ${counts.CONTRADICTED} contradicted. Open the Proof panel.`}
      onClick={() => {
        if (!navigate.openThreadPanel({ actionId: "proof", title: "Proof" })) {
          toast.error("Could not open the Proof panel here.");
        }
      }}
    >
      <Stamp verdict={latest.verdict} size="sm" />
      <Ribbon counts={counts} width={48} />
    </button>
  );
}
