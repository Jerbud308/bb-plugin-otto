// Otto proof engine: VALIDATED REFERENCE (spec artifact, not product code).
//
// This file is part of docs/BUILD_SPEC.md. Port it to TypeScript under src/proof/
// with IDENTICAL behavior. Every regex here was validated against
// docs/reference/proof-engine.fixtures.mjs (run: node docs/reference/proof-engine.fixtures.mjs)
// and against 134 real bb turns (Claude Code + Codex) on 2026-10-22.
// Do not "improve" a regex while porting. If you believe one is wrong, add a failing
// fixture first, then change it, then rerun every fixture.
//
// commandRules() returns finding codes as strings: "OTTO003:medium" means rule OTTO003
// at severity medium; a bare "OTTO001" means the rule's default severity (see the
// rules table in BUILD_SPEC.md section 6.6).
export function unwrapCommand(cmd) {
  const m = cmd.match(/^(?:\/usr)?(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/);
  if (!m) return cmd;
  let body = m[2];
  if (m[1] === '"') body = body.replace(/\\(["\\$`])/g, '$1');
  else body = body.replace(/'\\''/g, "'");
  return body;
}
export function splitTopLevel(cmd) {
  const segs = []; let cur = ''; let joiner = null; let i = 0; let sq = false, dq = false, depth = 0;
  const push = (j) => { if (cur.trim() !== '') segs.push({ text: cur.trim(), joiner }); else if (segs.length===0) {} cur=''; joiner = j; };
  while (i < cmd.length) {
    const c = cmd[i], n = cmd[i+1];
    if (sq) { cur += c; if (c === "'") sq = false; i++; continue; }
    if (dq) { if (c === '\\') { cur += c + (n ?? ''); i += 2; continue; } cur += c; if (c === '"') dq = false; i++; continue; }
    if (c === '\\') { cur += c + (n ?? ''); i += 2; continue; }
    if (c === "'") { sq = true; cur += c; i++; continue; }
    if (c === '"') { dq = true; cur += c; i++; continue; }
    if (c === '(' ) { depth++; cur += c; i++; continue; }
    if (c === ')' ) { depth = Math.max(0, depth-1); cur += c; i++; continue; }
    if (depth === 0 && c === '<' && n === '<' && cmd[i+2] !== '<') {
      const hm = cmd.slice(i).match(/^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
      if (hm) {
        const word = hm[2];
        const nl = cmd.indexOf('\n', i);
        if (nl === -1) { cur += cmd.slice(i); i = cmd.length; continue; }
        const lines = cmd.slice(nl+1).split('\n'); let consumed = nl+1 - i; let found = false; let body='';
        for (const line of lines) { consumed += line.length + 1; body += line + '\n'; if (line.trim() === word) { found = true; break; } }
        cur += cmd.slice(i, i + consumed - 1); i = i + consumed - 1; if (!found) i = cmd.length; continue;
      }
    }
    if (depth === 0) {
      if (c === '&' && n === '&') { push('&&'); i += 2; continue; }
      if (c === '|' && n === '|') { push('||'); i += 2; continue; }
      if (c === ';') { push(';'); i++; continue; }
      if (c === '\n') { push('\n'); i++; continue; }
      if (c === '&' && n !== '>' && cmd[i-1] !== '>' ) { push(';'); i++; continue; }
    }
    cur += c; i++;
  }
  push(null);
  if (segs.length) segs[0].joiner = null;
  return segs;
}
export function splitPipeline(text) {
  const st = []; let cur = ''; let sq=false,dq=false,depth=0;
  for (let i=0;i<text.length;i++){ const c=text[i], n=text[i+1];
    if (sq){cur+=c; if(c==="'")sq=false; continue;}
    if (dq){ if(c==='\\'){cur+=c+(n??'');i++;continue;} cur+=c; if(c==='"')dq=false; continue;}
    if (c==='\\'){cur+=c+(n??'');i++;continue;}
    if (c==="'"){sq=true;cur+=c;continue;} if(c==='"'){dq=true;cur+=c;continue;}
    if (c==='('){depth++;cur+=c;continue;} if(c===')'){depth=Math.max(0,depth-1);cur+=c;continue;}
    if (depth===0 && c==='|' && n!=='|' && text[i-1]!=='|'){ st.push(cur.trim()); cur=''; if(n==='&') i++; continue; }
    cur+=c; }
  st.push(cur.trim()); return st.filter(s=>s!=='');
}
export function stripHeredocBodies(text){
  // Remove heredoc bodies: keep the `<<'TAG'` marker line, drop lines up to and including TAG.
  const lines=text.split('\n'); const out=[]; let tag=null;
  for (const line of lines){
    if (tag!==null){ if (line.trim()===tag) tag=null; continue; }
    out.push(line);
    const m=line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/); if (m) tag=m[2];
  }
  return out.join('\n');
}
export function normalizeStage(stage){
  let s=stage.trim().replace(/^[({]\s*/,'');
  for (let i=0;i<8;i++){
    const before=s;
    s=s.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+/,'');
    s=s.replace(/^(?:sudo|time|env|nice|command|exec|nohup)\s+/,'');
    s=s.replace(/^(?:npx|bunx|pnpx)\s+(?:-{1,2}\S+\s+)*/,'');
    s=s.replace(/^(?:pnpm|yarn|npm)\s+exec\s+/,'');
    s=s.replace(/^(?:pnpm|yarn)\s+dlx\s+/,'');
    s=s.replace(/^\S*\/(?=\S)/,'');
    if (s===before) break;
  }
  return s;
}
const K = {
  test: [/^(?:vitest|jest|pytest|mocha|rspec|phpunit)\b/, /^(?:cargo|go|deno|bun)\s+test\b/, /^playwright\s+test\b/, /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w:-]+)?\b/, /^npm\s+t\b/, /^make\s+test\b/, /^python3?\s+-m\s+(?:pytest|unittest)\b/],
  typecheck: [/^tsc\b/, /^vue-tsc\b/, /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:typecheck|type-check|tsc|check-types)\b/, /^(?:mypy|pyright)\b/],
  build: [/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/, /^(?:cargo|go)\s+build\b/, /^bb\s+plugin\s+build\b/, /^(?:next|vite)\s+build\b/],
  lint: [/^(?:eslint|ruff|biome|golangci-lint)\b/, /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b/, /^prettier\s+(?:--check|-c)\b/],
  ci: [/^gh\s+pr\s+checks\b/, /^gh\s+run\s+(?:view|watch|list)\b/, /^gh\s+(?:pr\s+view|api)\b.*\b(?:statusCheckRollup|check-runs|check-suites|statuses)\b/],
};
export function classifyStage(stage){ const s=normalizeStage(stage); const out=[]; for (const [k,rs] of Object.entries(K)) if (rs.some(r=>r.test(s))) out.push(k); return out; }
export function segmentsOf(cmd, depth=0){
  const segs=splitTopLevel(stripHeredocBodies(cmd)); const out=[];
  for (const s of segs){
    const m=s.text.match(/^\(\s*([\s\S]*?)\s*\)$/) || s.text.match(/^\{\s*([\s\S]*?);?\s*\}$/);
    if (m && depth<3){ const inner=segmentsOf(m[1],depth+1); if (inner.length){ inner[0]={...inner[0], joiner:s.joiner}; out.push(...inner); continue; } }
    out.push(s);
  }
  return out;
}
export function classifyCommand(cmd){ const s=new Set(); for (const seg of segmentsOf(cmd)) for (const st of splitPipeline(seg.text)) for (const k of classifyStage(st)) s.add(k); return ['test','typecheck','build','lint','ci'].filter(k=>s.has(k)); }

const GUARD = /\b(?:not|never|no|without|cannot|can't|couldn't|didn't|don't|doesn't|isn't|aren't|wasn't|weren't|haven't|hasn't|won't|fail(?:s|ed|ing)?|unable|if|once|until|unless|should|will|would|could|might|may|needs? to|to make|ensure|verify that|check (?:that|whether|if))\b/;
const CLAIMS = {
  tests: [/\btests?\s+and\s+(?:the\s+)?(?:typecheck|type-check|types|lint|build)\s+(?:all\s+)?(?:pass(?:es|ed|ing)?|green)\b/g, /\btests?\s+(?:all\s+|now\s+|still\s+)?(?:are\s+|were\s+|is\s+)?(?:pass(?:es|ed|ing)?|green)\b/g, /\b\d+\s*\/\s*\d+\s+tests?\s+pass(?:es|ed|ing)?\b/g, /\b\d+\s+(?:tests?\s+)?passed\b/g, /\btest suite\s+(?:is\s+)?(?:green|pass(?:es|ed|ing)?)\b/g],
  typecheck: [/\b(?:typecheck|type-check|type check|tsc)\b[^.\n]{0,40}?\b(?:clean|pass(?:es|ed|ing)?|green|no errors|0 errors)\b/g, /\bno type errors\b/g],
  build: [/\bbuild\s+(?:is\s+|was\s+|now\s+)?(?:green|pass(?:es|ed|ing)?|succeed(?:s|ed)?|successful|clean)\b/g, /\bbuilds?\s+(?:cleanly|successfully)\b/g],
  lint: [/\blint(?:ing|er)?\s+(?:is\s+|now\s+)?(?:clean|pass(?:es|ed|ing)?|green)\b/g],
  ci: [/\bci\s+(?:is\s+|now\s+)?(?:green|pass(?:es|ed|ing)?)\b/g, /\b(?:all\s+)?checks\s+(?:are\s+|now\s+)?(?:green|pass(?:es|ed|ing)?)\b/g],
  done: [/\b(?:done|completed?|finished|fixed|resolved|implemented|shipped|verified|works|working)\b/g, /✅/g],
};
export function extractClaims(text){
  const t = text.replace(/[\u2018\u2019]/g,"'").toLowerCase(); const found=[];
  for (const [k,rs] of Object.entries(CLAIMS)) for (const r of rs) { r.lastIndex=0; let m; while((m=r.exec(t))){ const before=t.slice(0,m.index); const b=Math.max(before.lastIndexOf('.'),before.lastIndexOf('!'),before.lastIndexOf('?'),before.lastIndexOf('\n')); const prefix=before.slice(b+1); if(!GUARD.test(prefix)){found.push(k);break;} } if (found.includes(k)) break; }
  return [...new Set(found)];
}
// Same matching as extractClaims, but returns where each claim was found in the ORIGINAL text,
// so the UI can highlight the phrase (BUILD_SPEC 12.6 "highlighter on the gap").
// Lowercasing and the apostrophe swap keep string length, so indices map 1:1.
// One span per claim kind (the first unguarded match), in the same fixed kind order.
export function extractClaimSpans(text){
  const t = text.replace(/[\u2018\u2019]/g,"'").toLowerCase(); const out=[];
  for (const [k,rs] of Object.entries(CLAIMS)) {
    let hit=null;
    for (const r of rs) { r.lastIndex=0; let m; while((m=r.exec(t))){ const before=t.slice(0,m.index); const b=Math.max(before.lastIndexOf('.'),before.lastIndexOf('!'),before.lastIndexOf('?'),before.lastIndexOf('\n')); const prefix=before.slice(b+1); if(!GUARD.test(prefix)){ hit={claim:k,start:m.index,end:m.index+m[0].length}; break; } } if (hit) break; }
    if (hit) out.push(hit);
  }
  return out;
}
export function parseCounts(out){
  const max=(re)=>{let v=null; for(const m of out.matchAll(re)){const n=+m[1]; if(v===null||n>v)v=n;} return v;};
  const failed=max(/\b(\d+)\s+(?:failed|failing|failures?)\b/gi);
  const passed=max(/\b(\d+)\s+(?:passed|passing)\b/gi);
  const failLines=(out.match(/^\s*(?:FAIL|✗|×|✕)\s/gm)||[]).length;
  const tsErr=(out.match(/\berror TS\d{3,5}\b/g)||[]).length;
  const found=max(/\bFound (\d+) errors?\b/g);
  return {failed,passed,failLines,tsErrors:Math.max(tsErr,found??0)};
}
const VER = new Set(['test','typecheck','build','lint','ci']);
export function commandRules(item){
  const cmd=unwrapCommand(item.command); const out=item.aggregatedOutput??''; const f=[];
  const stripped=stripHeredocBodies(cmd); const segs=segmentsOf(cmd); const kinds=classifyCommand(cmd); const isVer=kinds.length>0;
  const hasPipefail=/\bpipefail\b/.test(stripped); const pipestatus=/PIPESTATUS|pipestatus/.test(stripped);
  const segStages=segs.map(s=>splitPipeline(s.text));
  const segVer=segStages.map(st=>st.map(classifyStage));
  // 001
  segStages.forEach((st,i)=>{ if(st.length>=2 && !hasPipefail && !pipestatus && segVer[i].slice(0,-1).some(k=>k.length>0)) f.push('OTTO001'); });
  // 002
  for(let j=1;j<segs.length;j++){ if(/\$\?/.test(segs[j].text) && !pipestatus && segStages[j-1].length>=2) { f.push('OTTO002'); break; } }
  // 003
  let v=-1; segVer.forEach((ks,i)=>{ if(ks.some(k=>k.length>0)) v=i; });
  if (v>=0 && v<segs.length-1){ const after=segs.slice(v+1); const printed=/^(?:echo|printf)\b[^>]*\$\?[^>]*$/.test(segs[v+1].text) && segStages[v].length===1; if(!printed){ if(after.some(s=>s.joiner==='||')) f.push('OTTO003:high'); else if(after.some(s=>s.joiner===';'||s.joiner==='\n')) f.push('OTTO003:medium'); } }
  // 004
  const grepStages=segStages.flat().filter(st=>/^(?:grep|egrep|rg)\b/.test(normalizeStage(st)));
  const looksForFail=grepStages.some(st=>/fail|error/i.test(st));
  if (isVer && !looksForFail && (grepStages.some(st=>/pass|success|\bok\b|green/i.test(st)) || /(?:==|=~)\s*["']?\*?pass/i.test(stripped))) f.push('OTTO004');
  const c=parseCounts(out);
  const attributable=segs.every((sg,i)=>segVer[i].some(k=>k.length>0) || /^(?:cd|set|export|echo|printf|true|:)\b/.test(sg.text) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(sg.text));
  if (isVer && item.exitCode===0 && ((c.failed??0)>0 || c.failLines>0 || c.tsErrors>0)) f.push(attributable?'OTTO005':'OTTO005:medium');
  // Ruleset 2: a non-zero exit that belongs to a trailing `;` command (not the check) is masking, not failure.
  const lastSeg=segs[segs.length-1];
  const ownedByTrailing=item.exitCode!==undefined && item.exitCode!==0 && v>=0 && v<segs.length-1 && (lastSeg.joiner===';'||lastSeg.joiner==='\n') && !/^(?:cd|set|export|echo|printf|true|:)\b/.test(lastSeg.text) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(lastSeg.text);
  if (isVer && ((item.exitCode!==undefined && item.exitCode!==0) || item.status==='failed')) f.push(ownedByTrailing?'OTTO006:medium':'OTTO006');
  const re007=/^\s*(?:\S+\s+)?(?:(?:exit(?:[ _-]?code)?|rc)\s*[=:]?|(?:status|code)\s*[=:])\s*[1-9]\d{0,2}\s*$/im;
  if (isVer && re007.test(out)) {
    const wrapperOnly=ownedByTrailing && out.split(/\r?\n/).filter(l=>re007.test(l)).every(l=>new RegExp('^\\s*exit code\\s+'+item.exitCode+'\\s*$','i').test(l));
    f.push(wrapperOnly?'OTTO007:medium':'OTTO007');
  }
  if (kinds.includes('ci') && (/"conclusion"\s*:\s*(?:""|null)/.test(out) || /"status"\s*:\s*"(?:IN_PROGRESS|QUEUED|PENDING|WAITING|REQUESTED)"/.test(out) || /\.conclusion\s*\/\//.test(stripped) || (/\bgh\s+pr\s+checks\b/.test(stripped) && /\b(?:pending|queued|in_progress)\b/i.test(out)))) f.push('OTTO008');
  if (/statusCheckRollup/.test(stripped) && /conclusion/.test(stripped) && !/__typename/.test(stripped) && !/\.state\b|"state"/.test(stripped)) f.push('OTTO009');
  if (isVer && item.truncation?.aggregatedOutput) f.push('OTTO010');
  if (isVer && (item.status==='completed'||item.status==='failed') && item.exitCode===undefined) f.push('OTTO011');
  if (/--include=(?!['"])[^\s'"]*[*?[]/.test(stripped)) f.push('OTTO012');
  if (isVer && (item.status==='interrupted'||item.status==='pending')) f.push('OTTO013');
  return f;
}

// ---- Verdict (BUILD_SPEC.md section 6.7) ----
// A turn is { items: TurnItem[] } in event-sequence order, where TurnItem is one of
//   { kind: "cmd", item: <commandExecution item>, kinds: CheckKind[], findings: string[] }
//   { kind: "file" }               (a fileChange item)
//   { kind: "msg", text: string }  (an agentMessage item)
export const FAILURE_CODES = new Set(['OTTO005','OTTO006','OTTO007']);
export const MASKING_CODES = new Set(['OTTO001','OTTO002','OTTO003:medium','OTTO003:high','OTTO004','OTTO005:medium','OTTO006:medium','OTTO007:medium','OTTO008','OTTO011','OTTO013']);
const CLAIM_TO_KIND = { tests:'test', typecheck:'typecheck', build:'build', lint:'lint', ci:'ci' };
export function decideVerdict(turn){
  const msgs = turn.items.filter(x=>x.kind==='msg');
  const claimText = msgs.length ? msgs[msgs.length-1].text : '';
  const claims = extractClaims(claimText);
  const specific = claims.filter(c=>c!=='done');
  const generic = claims.includes('done');
  const lastFile = turn.items.reduce((acc,x,i)=> x.kind==='file' ? i : acc, -1);
  const edited = lastFile >= 0;
  const status = {};
  for (const c of specific){
    const k = CLAIM_TO_KIND[c];
    let idx = -1; turn.items.forEach((x,i)=>{ if (x.kind==='cmd' && x.kinds.includes(k)) idx = i; });
    if (idx < 0) { status[c] = 'unsupported'; continue; }
    const f = turn.items[idx].findings;
    if (f.some(x=>FAILURE_CODES.has(x))) status[c] = 'contradicted';
    else if (f.some(x=>MASKING_CODES.has(x))) status[c] = 'untrustworthy';
    else if (lastFile > idx) status[c] = 'stale';
    else status[c] = 'supported';
  }
  if (specific.length === 0 && !(generic && edited)) return { verdict:'NO_CLAIM', claims, status };
  if (Object.values(status).includes('contradicted')) return { verdict:'CONTRADICTED', claims, status };
  if (Object.values(status).some(s=>s!=='supported')) return { verdict:'UNVERIFIED', claims, status };
  if (specific.length === 0) {
    const ok = turn.items.some((x,i)=> i>lastFile && x.kind==='cmd' && x.kinds.length>0 && x.item.exitCode===0
      && !x.findings.some(f=>FAILURE_CODES.has(f)||MASKING_CODES.has(f)));
    return { verdict: ok ? 'VERIFIED' : 'UNVERIFIED', claims, status };
  }
  return { verdict:'VERIFIED', claims, status };
}
