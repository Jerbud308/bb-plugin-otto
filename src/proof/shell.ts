// Shell text handling for the proof engine. Ported from docs/reference/proof-engine.reference.mjs.
// Pure: imports nothing from bb.

export type Joiner = "&&" | "||" | ";" | "\n";

export interface Segment {
  text: string;
  joiner: Joiner | null;
}

export function unwrapCommand(cmd: string): string {
  const m = cmd.match(/^(?:\/usr)?(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/);
  if (!m) return cmd;
  let body = m[2];
  if (m[1] === '"') body = body.replace(/\\(["\\$`])/g, "$1");
  else body = body.replace(/'\\''/g, "'");
  return body;
}

export function splitTopLevel(cmd: string): Segment[] {
  const segs: Segment[] = [];
  let cur = "";
  let joiner: Joiner | null = null;
  let i = 0;
  let sq = false;
  let dq = false;
  let depth = 0;
  const push = (j: Joiner | null): void => {
    if (cur.trim() !== "") segs.push({ text: cur.trim(), joiner });
    cur = "";
    joiner = j;
  };
  while (i < cmd.length) {
    const c = cmd[i];
    const n = cmd[i + 1];
    if (sq) {
      cur += c;
      if (c === "'") sq = false;
      i++;
      continue;
    }
    if (dq) {
      if (c === "\\") {
        cur += c + (n ?? "");
        i += 2;
        continue;
      }
      cur += c;
      if (c === '"') dq = false;
      i++;
      continue;
    }
    if (c === "\\") {
      cur += c + (n ?? "");
      i += 2;
      continue;
    }
    if (c === "'") {
      sq = true;
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      dq = true;
      cur += c;
      i++;
      continue;
    }
    if (c === "(") {
      depth++;
      cur += c;
      i++;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      cur += c;
      i++;
      continue;
    }
    if (depth === 0 && c === "<" && n === "<" && cmd[i + 2] !== "<") {
      const hm = cmd.slice(i).match(/^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
      if (hm) {
        const word = hm[2];
        const nl = cmd.indexOf("\n", i);
        if (nl === -1) {
          cur += cmd.slice(i);
          i = cmd.length;
          continue;
        }
        const lines = cmd.slice(nl + 1).split("\n");
        let consumed = nl + 1 - i;
        let found = false;
        for (const line of lines) {
          consumed += line.length + 1;
          if (line.trim() === word) {
            found = true;
            break;
          }
        }
        cur += cmd.slice(i, i + consumed - 1);
        i = i + consumed - 1;
        if (!found) i = cmd.length;
        continue;
      }
    }
    if (depth === 0) {
      if (c === "&" && n === "&") {
        push("&&");
        i += 2;
        continue;
      }
      if (c === "|" && n === "|") {
        push("||");
        i += 2;
        continue;
      }
      if (c === ";") {
        push(";");
        i++;
        continue;
      }
      if (c === "\n") {
        push("\n");
        i++;
        continue;
      }
      if (c === "&" && n !== ">" && cmd[i - 1] !== ">") {
        push(";");
        i++;
        continue;
      }
    }
    cur += c;
    i++;
  }
  push(null);
  if (segs.length) segs[0].joiner = null;
  return segs;
}

export function splitPipeline(text: string): string[] {
  const st: string[] = [];
  let cur = "";
  let sq = false;
  let dq = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (sq) {
      cur += c;
      if (c === "'") sq = false;
      continue;
    }
    if (dq) {
      if (c === "\\") {
        cur += c + (n ?? "");
        i++;
        continue;
      }
      cur += c;
      if (c === '"') dq = false;
      continue;
    }
    if (c === "\\") {
      cur += c + (n ?? "");
      i++;
      continue;
    }
    if (c === "'") {
      sq = true;
      cur += c;
      continue;
    }
    if (c === '"') {
      dq = true;
      cur += c;
      continue;
    }
    if (c === "(") {
      depth++;
      cur += c;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      cur += c;
      continue;
    }
    if (depth === 0 && c === "|" && n !== "|" && text[i - 1] !== "|") {
      st.push(cur.trim());
      cur = "";
      if (n === "&") i++;
      continue;
    }
    cur += c;
  }
  st.push(cur.trim());
  return st.filter((s) => s !== "");
}

// Remove heredoc bodies: keep the `<<'TAG'` marker line, drop lines up to and including TAG.
export function stripHeredocBodies(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let tag: string | null = null;
  for (const line of lines) {
    if (tag !== null) {
      if (line.trim() === tag) tag = null;
      continue;
    }
    out.push(line);
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (m) tag = m[2];
  }
  return out.join("\n");
}

export function segmentsOf(cmd: string, depth = 0): Segment[] {
  const segs = splitTopLevel(stripHeredocBodies(cmd));
  const out: Segment[] = [];
  for (const s of segs) {
    const m = s.text.match(/^\(\s*([\s\S]*?)\s*\)$/) || s.text.match(/^\{\s*([\s\S]*?);?\s*\}$/);
    if (m && depth < 3) {
      const inner = segmentsOf(m[1], depth + 1);
      if (inner.length) {
        inner[0] = { ...inner[0], joiner: s.joiner };
        out.push(...inner);
        continue;
      }
    }
    out.push(s);
  }
  return out;
}
