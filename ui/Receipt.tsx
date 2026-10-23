// The raw-evidence block: mono, perforated edge, one line per command, trap tags for findings (BUILD_SPEC 12.3).
import { useState } from "react";
import { RULES } from "../src/proof/rules";
import type { Evidence, Finding } from "../src/shared/contract";

const RULE_TITLE = new Map(RULES.map((r) => [r.id, r.title]));

function countsText(e: Evidence): string {
  const parts: string[] = [];
  if (e.counts.failed !== null) parts.push(`${e.counts.failed} failed`);
  if (e.counts.passed !== null) parts.push(`${e.counts.passed} passed`);
  if (e.counts.tsErrors > 0) parts.push(`${e.counts.tsErrors} TS errors`);
  if (e.counts.failLines > 0) parts.push(`${e.counts.failLines} FAIL lines`);
  return parts.join(" · ");
}

function ExitLabel({ e }: { e: Evidence }) {
  if (e.exitCode === null) return <span className="otto-exit otto-exit--none">no exit</span>;
  return (
    <span className={`otto-exit ${e.exitCode === 0 ? "otto-exit--ok" : "otto-exit--bad"}`}>exit {e.exitCode}</span>
  );
}

function ReceiptRow({ evidence, findings }: { evidence: Evidence; findings: Finding[] }) {
  const [wide, setWide] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const lines = evidence.command.split("\n");
  const long = lines.length > 3;
  const shown = wide || !long ? evidence.command : lines.slice(0, 3).join("\n");
  const counts = countsText(evidence);
  return (
    <div className="otto-receipt__row" id={`receipt-${evidence.itemId}`}>
      <div className="otto-receipt__line">
        <ExitLabel e={evidence} />
        <code className="otto-receipt__cmd">{shown}</code>
        {counts === "" ? null : <span className="otto-receipt__counts">{counts}</span>}
        {evidence.truncated ? <span className="otto-tag">truncated</span> : null}
        {evidence.viaSubagent ? <span className="otto-tag">subagent</span> : null}
      </div>
      {long ? (
        <button type="button" className="otto-textbtn" onClick={() => setWide((v) => !v)}>
          {wide ? "Show less" : "Show more"}
        </button>
      ) : null}
      {findings.map((f, i) => (
        <div key={`${f.ruleId}-${i}`} className="otto-trap">
          <span className="otto-trap__tag">
            Caught: {RULE_TITLE.get(f.ruleId) ?? f.ruleId} <span className="otto-trap__id">{f.ruleId}</span>
          </span>
          <span className="otto-trap__msg">{f.message}</span>
          <span className="otto-trap__fix">{f.fixHint}</span>
        </div>
      ))}
      {evidence.outputTail === "" ? null : (
        <>
          <button type="button" className="otto-textbtn" onClick={() => setShowOutput((v) => !v)}>
            {showOutput ? "Hide output" : "Show output"}
          </button>
          {showOutput ? <pre className="otto-receipt__output">{evidence.outputTail}</pre> : null}
        </>
      )}
    </div>
  );
}

export interface ReceiptProps {
  evidence: Evidence[];
  findings: Finding[];
}

export function Receipt({ evidence, findings }: ReceiptProps) {
  if (evidence.length === 0) return null;
  return (
    <div className="otto-receipt">
      {evidence.map((e) => (
        <ReceiptRow key={e.itemId} evidence={e} findings={findings.filter((f) => f.itemId === e.itemId)} />
      ))}
    </div>
  );
}
