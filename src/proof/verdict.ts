// Turn verdict. Ported from the reference engine (BUILD_SPEC 6.7).
import type { ClaimStatus, Verdict } from "../shared/contract";
import type { CheckKind } from "./classify";
import { extractClaims, type ClaimKind } from "./claims";
import { EXPECT_FAIL } from "./rules";
import type { TurnItem } from "./turns";

export const FAILURE_CODES = new Set(["OTTO005", "OTTO006", "OTTO007"]);
export const MASKING_CODES = new Set([
  "OTTO001",
  "OTTO002",
  "OTTO003:medium",
  "OTTO003:high",
  "OTTO004",
  "OTTO005:medium",
  "OTTO006:medium",
  "OTTO007:medium",
  "OTTO008",
  "OTTO011",
  "OTTO013",
]);

export type SpecificClaim = Exclude<ClaimKind, "done">;

export const CLAIM_TO_KIND: Record<SpecificClaim, CheckKind> = {
  tests: "test",
  typecheck: "typecheck",
  build: "build",
  lint: "lint",
  ci: "ci",
};

export interface VerdictResult {
  verdict: Verdict;
  claims: ClaimKind[];
  status: Partial<Record<SpecificClaim, ClaimStatus>>;
}

export function lastMessageText(items: readonly TurnItem[]): string {
  let text = "";
  for (const x of items) if (x.kind === "msg") text = x.text;
  return text;
}

// Index of the last command in the turn whose kinds include the check kind, or -1. A run tagged
// expect-fail is never evidence for a claim, in either direction.
export function lastCheckIndex(items: readonly TurnItem[], kind: CheckKind): number {
  let idx = -1;
  items.forEach((x, i) => {
    if (x.kind === "cmd" && x.kinds.includes(kind) && !EXPECT_FAIL.test(x.item.command)) idx = i;
  });
  return idx;
}

export function decideVerdict(turn: { items: readonly TurnItem[] }): VerdictResult {
  const claimText = lastMessageText(turn.items);
  const claims = extractClaims(claimText);
  const specific = claims.filter((c): c is SpecificClaim => c !== "done");
  const generic = claims.includes("done");
  const lastFile = turn.items.reduce((acc, x, i) => (x.kind === "file" ? i : acc), -1);
  const edited = lastFile >= 0;
  const status: Partial<Record<SpecificClaim, ClaimStatus>> = {};
  for (const c of specific) {
    const idx = lastCheckIndex(turn.items, CLAIM_TO_KIND[c]);
    if (idx < 0) {
      status[c] = "unsupported";
      continue;
    }
    const at = turn.items[idx];
    const f = at.kind === "cmd" ? at.findings : [];
    if (f.some((x) => FAILURE_CODES.has(x))) status[c] = "contradicted";
    else if (f.some((x) => MASKING_CODES.has(x))) status[c] = "untrustworthy";
    else if (lastFile > idx) status[c] = "stale";
    else status[c] = "supported";
  }
  if (specific.length === 0 && !(generic && edited)) return { verdict: "NO_CLAIM", claims, status };
  if (Object.values(status).includes("contradicted")) return { verdict: "CONTRADICTED", claims, status };
  if (Object.values(status).some((s) => s !== "supported")) return { verdict: "UNVERIFIED", claims, status };
  if (specific.length === 0) {
    const ok = turn.items.some(
      (x, i) =>
        i > lastFile &&
        x.kind === "cmd" &&
        x.kinds.length > 0 &&
        x.item.exitCode === 0 &&
        !x.findings.some((f) => FAILURE_CODES.has(f) || MASKING_CODES.has(f)),
    );
    return { verdict: ok ? "VERIFIED" : "UNVERIFIED", claims, status };
  }
  return { verdict: "VERIFIED", claims, status };
}
