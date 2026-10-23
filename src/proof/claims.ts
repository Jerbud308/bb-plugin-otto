// Claim extraction from an agent's final message. Ported from the reference engine.

export type ClaimKind = "tests" | "typecheck" | "build" | "lint" | "ci" | "done";

export interface ClaimSpan {
  claim: ClaimKind;
  start: number;
  end: number;
}

const GUARD =
  /\b(?:not|never|no|without|cannot|can't|couldn't|didn't|don't|doesn't|isn't|aren't|wasn't|weren't|haven't|hasn't|won't|fail(?:s|ed|ing)?|unable|if|once|until|unless|should|will|would|could|might|may|needs? to|to make|ensure|verify that|check (?:that|whether|if))\b/;

const CLAIM_ORDER: ClaimKind[] = ["tests", "typecheck", "build", "lint", "ci", "done"];

const CLAIMS: Record<ClaimKind, RegExp[]> = {
  tests: [
    /\btests?\s+and\s+(?:the\s+)?(?:typecheck|type-check|types|lint|build)\s+(?:all\s+)?(?:pass(?:es|ed|ing)?|green)\b/g,
    /\btests?\s+(?:all\s+|now\s+|still\s+)?(?:are\s+|were\s+|is\s+)?(?:pass(?:es|ed|ing)?|green)\b/g,
    /\b\d+\s*\/\s*\d+\s+tests?\s+pass(?:es|ed|ing)?\b/g,
    /\b\d+\s+(?:tests?\s+)?passed\b/g,
    /\btest suite\s+(?:is\s+)?(?:green|pass(?:es|ed|ing)?)\b/g,
  ],
  typecheck: [
    /\b(?:typecheck|type-check|type check|tsc)\b[^.\n]{0,40}?\b(?:clean|pass(?:es|ed|ing)?|green|no errors|0 errors)\b/g,
    /\bno type errors\b/g,
  ],
  build: [
    /\bbuild\s+(?:is\s+|was\s+|now\s+)?(?:green|pass(?:es|ed|ing)?|succeed(?:s|ed)?|successful|clean)\b/g,
    /\bbuilds?\s+(?:cleanly|successfully)\b/g,
  ],
  lint: [/\blint(?:ing|er)?\s+(?:is\s+|now\s+)?(?:clean|pass(?:es|ed|ing)?|green)\b/g],
  ci: [
    /\bci\s+(?:is\s+|now\s+)?(?:green|pass(?:es|ed|ing)?)\b/g,
    /\b(?:all\s+)?checks\s+(?:are\s+|now\s+)?(?:green|pass(?:es|ed|ing)?)\b/g,
  ],
  done: [/\b(?:done|completed?|finished|fixed|resolved|implemented|shipped|verified|works|working)\b/g, /✅/g],
};

function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'").toLowerCase();
}

// First match of this kind that is not guarded by negation, condition, or intent in its sentence.
function firstUnguarded(t: string, kind: ClaimKind): { start: number; end: number } | null {
  for (const r of CLAIMS[kind]) {
    r.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.exec(t))) {
      const before = t.slice(0, m.index);
      const b = Math.max(
        before.lastIndexOf("."),
        before.lastIndexOf("!"),
        before.lastIndexOf("?"),
        before.lastIndexOf("\n"),
      );
      const prefix = before.slice(b + 1);
      if (!GUARD.test(prefix)) return { start: m.index, end: m.index + m[0].length };
    }
  }
  return null;
}

export function extractClaims(text: string): ClaimKind[] {
  const t = normalize(text);
  return CLAIM_ORDER.filter((k) => firstUnguarded(t, k) !== null);
}

// Same matching as extractClaims, but returns where each claim was found in the ORIGINAL text.
// Lowercasing and the apostrophe swap keep string length, so indices map 1:1.
export function extractClaimSpans(text: string): ClaimSpan[] {
  const t = normalize(text);
  const out: ClaimSpan[] = [];
  for (const k of CLAIM_ORDER) {
    const hit = firstUnguarded(t, k);
    if (hit) out.push({ claim: k, start: hit.start, end: hit.end });
  }
  return out;
}
