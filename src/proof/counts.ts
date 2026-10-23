// Parse failure and pass counts out of check output. Ported from the reference engine.

export interface Counts {
  failed: number | null;
  passed: number | null;
  failLines: number;
  tsErrors: number;
}

function maxMatch(out: string, re: RegExp): number | null {
  let v: number | null = null;
  for (const m of out.matchAll(re)) {
    const n = +m[1];
    if (v === null || n > v) v = n;
  }
  return v;
}

export function parseCounts(out: string): Counts {
  const failed = maxMatch(out, /\b(\d+)\s+(?:failed|failing|failures?)\b/gi);
  const passed = maxMatch(out, /\b(\d+)\s+(?:passed|passing)\b/gi);
  const failLines = (out.match(/^\s*(?:FAIL|✗|×|✕)\s/gm) || []).length;
  const tsErr = (out.match(/\berror TS\d{3,5}\b/g) || []).length;
  const found = maxMatch(out, /\bFound (\d+) errors?\b/g);
  return { failed, passed, failLines, tsErrors: Math.max(tsErr, found ?? 0) };
}
