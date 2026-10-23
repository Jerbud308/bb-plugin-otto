// Otto page, Rules tab: every rule in the ruleset (BUILD_SPEC 12.9).
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../src/shared/contract";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { useLoad } from "./useLoad";

export function RulesView() {
  const rpc = useRpc<typeof rpcContract>();
  const { data, error, reload } = useLoad(() => rpc.call("proof.rules", null), "rules");
  if (error !== null && data === null) {
    return (
      <div role="alert">
        <p className="otto-claimline__status--bad">{error}</p>
        <button type="button" className="otto-btn" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }
  if (data === null) return <LedgerSkeleton rows={6} />;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p className="otto-meta">
        Ruleset version <span className="otto-mono">{data.rulesetVersion}</span>
      </p>
      <table className="otto-table">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Title</th>
            <th>Severity</th>
            <th>Effect</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody>
          {data.rules.map((r) => (
            <tr key={r.id}>
              <td className="otto-mono">{r.id}</td>
              <td>{r.title}</td>
              <td>{r.defaultSeverity}</td>
              <td>{r.effect}</td>
              <td>{r.fixHint}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
