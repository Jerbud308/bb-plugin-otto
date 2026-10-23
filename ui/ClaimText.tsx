// The agent's claim with a marker on every claim that lacks backing (BUILD_SPEC 12.3).
import { useState, type ReactNode } from "react";
import type { ClaimResult, ClaimStatus } from "../src/shared/contract";
import { CLAIM_NOTE } from "./verdict";

const FLAGGED: ReadonlySet<ClaimStatus> = new Set(["unsupported", "untrustworthy", "stale", "contradicted"]);

export interface ClaimTextProps {
  text: string;
  claims: ClaimResult[];
}

export function ClaimText({ text, claims }: ClaimTextProps) {
  const [open, setOpen] = useState(false);
  const flagged = claims
    .filter((c): c is ClaimResult & { span: { start: number; end: number }; status: ClaimStatus } =>
      c.span !== null && c.status !== null && FLAGGED.has(c.status),
    )
    .sort((a, b) => a.span.start - b.span.start);

  const parts: ReactNode[] = [];
  let at = 0;
  flagged.forEach((c, i) => {
    const { start, end } = c.span;
    if (start < at) return; // overlaps the previous marker; its note already covers the sentence
    parts.push(text.slice(at, start));
    parts.push(
      <mark key={`m${i}`} className="otto-marker" data-claim={c.claim}>
        {text.slice(start, end)}
      </mark>,
    );
    const note = CLAIM_NOTE[c.status];
    if (note !== null) {
      parts.push(
        <span key={`n${i}`} className="otto-marginalia otto-note">
          {note}
        </span>,
      );
    }
    at = end;
  });
  parts.push(text.slice(at));

  const long = text.split("\n").length > 3 || text.length > 280;
  return (
    <div className="otto-claim">
      <p className={`otto-claim__text${open || !long ? "" : " otto-claim__text--clamp"}`}>{parts}</p>
      {long ? (
        <button type="button" className="otto-textbtn" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
