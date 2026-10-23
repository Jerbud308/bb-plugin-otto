// Small helpers shared by the Bake-off views.
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../src/shared/contract";
import { useLoad } from "./useLoad";

export function payloadBakeoffId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { bakeoffId?: unknown }).bakeoffId;
  return typeof id === "string" ? id : null;
}

export const percent = (rate: number): string => `${Math.round(rate * 100)}%`;

export function useBakeoffOptions() {
  const rpc = useRpc<typeof rpcContract>();
  const options = useLoad(() => rpc.call("bakeoff.options", null), "bakeoff-options");
  const providers = options.data?.providers ?? [];
  const nameOf = (providerId: string): string => providers.find((p) => p.id === providerId)?.displayName ?? providerId;
  return { options, nameOf };
}

export const BAKEOFF_STATUS_WORD = { running: "Running", ready: "Ready to compare", decided: "Decided" } as const;
