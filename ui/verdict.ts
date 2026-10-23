// Words, glyph geometry, and labels for verdicts and claim statuses (BUILD_SPEC 12.3). No React.
import type { ClaimKind } from "../src/proof/claims";
import type { ClaimStatus, Verdict } from "../src/shared/contract";

export const VERDICT_WORD: Record<Verdict, string> = {
  VERIFIED: "Verified",
  UNVERIFIED: "Unverified",
  CONTRADICTED: "Contradicted",
  NO_CLAIM: "No claim",
};

export const VERDICT_CLASS: Record<Verdict, string> = {
  VERIFIED: "otto-stamp--verified",
  UNVERIFIED: "otto-stamp--unverified",
  CONTRADICTED: "otto-stamp--contradicted",
  NO_CLAIM: "otto-stamp--noclaim",
};

export type GlyphName = "check" | "circle" | "slash";

export const VERDICT_GLYPH: Record<Verdict, GlyphName | null> = {
  VERIFIED: "check",
  UNVERIFIED: "circle",
  CONTRADICTED: "slash",
  NO_CLAIM: null,
};

export const GLYPH_PATH = {
  check: "M3 6.5 5 8.5 9.5 3.5",
  slash: "M3 9 9 3",
} as const;

export const GLYPH_CIRCLE = { cx: 6, cy: 6, r: 4 } as const;

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  supported: "Backed by evidence",
  unsupported: "No check ran",
  untrustworthy: "Check hides its result",
  stale: "Files changed after the check",
  contradicted: "Evidence shows failure",
};

// Marginalia under a flagged claim. A supported claim gets no note.
export const CLAIM_NOTE: Record<ClaimStatus, string | null> = {
  supported: null,
  unsupported: "no check ran for this",
  untrustworthy: "the check hides its exit code",
  stale: "files changed after this check",
  contradicted: "the check says otherwise",
};

export const CLAIM_NAME: Record<ClaimKind, string> = {
  tests: "Tests",
  typecheck: "Typecheck",
  build: "Build",
  lint: "Lint",
  ci: "CI",
  done: "Done",
};

export const VERDICT_ORDER: Verdict[] = ["CONTRADICTED", "UNVERIFIED", "VERIFIED", "NO_CLAIM"];

export function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 4)}...${id.slice(-4)}` : id;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

// Local time, YYYY-MM-DD HH:mm.
export function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}
