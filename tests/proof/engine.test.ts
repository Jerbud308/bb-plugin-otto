// Port of docs/reference/proof-engine.fixtures.mjs: one it() per reference check, same inputs,
// same expected values. Do not edit an expectation to make code pass.
import { describe, expect, it } from "vitest";
import { classifyCommand } from "../../src/proof/classify";
import { extractClaimSpans, extractClaims } from "../../src/proof/claims";
import { parseCounts } from "../../src/proof/counts";
import { commandRules, type CommandItem, type CommandStatus } from "../../src/proof/rules";
import { segmentsOf, splitPipeline, splitTopLevel, unwrapCommand } from "../../src/proof/shell";
import type { TurnItem } from "../../src/proof/turns";
import { decideVerdict } from "../../src/proof/verdict";

const S = (c: string) => splitTopLevel(c).map((s) => [s.joiner, s.text]);
const R = (
  command: string,
  exitCode: number | undefined,
  aggregatedOutput = "",
  status: CommandStatus = exitCode === 0 ? "completed" : "failed",
  extra: Partial<CommandItem> = {},
) => commandRules({ command, exitCode, aggregatedOutput, status, ...extra });

let nextId = 0;
const cmd = (
  command: string,
  exitCode: number,
  aggregatedOutput = "",
  status: CommandStatus = exitCode === 0 ? "completed" : "failed",
): TurnItem => {
  nextId++;
  const item = { id: `c${nextId}`, command, exitCode, aggregatedOutput, status };
  return { kind: "cmd", seq: nextId, item, kinds: classifyCommand(unwrapCommand(command)), findings: commandRules(item) };
};
const file: TurnItem = { kind: "file", seq: 0, item: { id: "f", changes: [] } };
const msg = (text: string): TurnItem => ({ kind: "msg", seq: 0, text });
const V = (items: TurnItem[]) => decideVerdict({ items }).verdict;
const VS = (items: TurnItem[]) => decideVerdict({ items }).status;

describe("proof engine reference fixtures", () => {
  it('unwrap dq', () => {
    expect(unwrapCommand(`/bin/zsh -lc "rg -n \\"foo\\" src | head -5"`)).toEqual(`rg -n "foo" src | head -5`);
  });
  it('unwrap sq', () => {
    expect(unwrapCommand(`/bin/zsh -lc 'cat a'\\''b'`)).toEqual(`cat a'b`);
  });
  it('unwrap bash', () => {
    expect(unwrapCommand(`bash -lc 'npm test'`)).toEqual(`npm test`);
  });
  it('unwrap none', () => {
    expect(unwrapCommand(`npm test`)).toEqual(`npm test`);
  });
  it('split1', () => {
    expect(S(`cd app && npm test | tail -3; echo "exit=$?"`)).toEqual([[null,'cd app'],['&&','npm test | tail -3'],[';','echo "exit=$?"']]);
  });
  it('split2', () => {
    expect(S(`echo "a;b" && echo 'c&&d'`)).toEqual([[null,'echo "a;b"'],['&&',"echo 'c&&d'"]]);
  });
  it('split3', () => {
    expect(S(`npm test || true`)).toEqual([[null,'npm test'],['||','true']]);
  });
  it('split4', () => {
    expect(S(`python3 - <<'PY'\nprint(1); print(2)\nPY\necho done`)).toEqual([[null,`python3 - <<'PY'\nprint(1); print(2)\nPY`],['\n','echo done']]);
  });
  it('split5', () => {
    expect(S(`x=$(npm test; echo hi) && echo ok`)).toEqual([[null,'x=$(npm test; echo hi)'],['&&','echo ok']]);
  });
  it('split6', () => {
    expect(S(`npm test 2>&1 | tail -5`)).toEqual([[null,'npm test 2>&1 | tail -5']]);
  });
  it('pipe1', () => {
    expect(splitPipeline(`npm test 2>&1 | tail -5`)).toEqual(['npm test 2>&1','tail -5']);
  });
  it('pipe2', () => {
    expect(splitPipeline(`echo "a|b" | wc -l`)).toEqual(['echo "a|b"','wc -l']);
  });
  it('pipe3', () => {
    expect(splitPipeline(`npm test |& tee log`)).toEqual(['npm test','tee log']);
  });
  it('cls1', () => {
    expect(classifyCommand('npx vitest run')).toEqual(['test']);
  });
  it('cls2', () => {
    expect(classifyCommand('npm run typecheck && npm run build')).toEqual(['typecheck','build']);
  });
  it('cls3', () => {
    expect(classifyCommand('pnpm test:unit')).toEqual(['test']);
  });
  it('cls4', () => {
    expect(classifyCommand('gh pr checks 42')).toEqual(['ci']);
  });
  it('cls5', () => {
    expect(classifyCommand('ls -la && cat README.md')).toEqual([]);
  });
  it('cls6', () => {
    expect(classifyCommand('npx tsc --noEmit')).toEqual(['typecheck']);
  });
  it('cls7', () => {
    expect(classifyCommand('cat attestation.txt')).toEqual([]);
  });
  it('cls8', () => {
    expect(classifyCommand('bb plugin build')).toEqual(['build']);
  });
  it('cl1', () => {
    expect(extractClaims('Fixed the bug. All 284 tests pass.')).toEqual(['tests','done']);
  });
  it('cl2', () => {
    expect(extractClaims("Tests don't pass yet, still investigating.")).toEqual([]);
  });
  it('cl3', () => {
    expect(extractClaims('Once the tests pass I will merge.')).toEqual([]);
  });
  it('cl4', () => {
    expect(extractClaims('Typecheck is clean and the build succeeded.')).toEqual(['typecheck','build']);
  });
  it('cl5', () => {
    expect(extractClaims('CI is green on the PR.')).toEqual(['ci']);
  });
  it('cl6', () => {
    expect(extractClaims('Here is a summary of the file.')).toEqual([]);
  });
  it('cl7', () => {
    expect(extractClaims('Done ✅')).toEqual(['done']);
  });
  it('cl8', () => {
    expect(extractClaims('I could not verify that tests pass because the DB is down.')).toEqual([]);
  });
  it('cl9', () => {
    expect(extractClaims('Tests: 12 passed. Lint is clean.')).toEqual(['tests','lint']);
  });
  it('cl10', () => {
    expect(extractClaims('Implemented the endpoint.')).toEqual(['done']);
  });
  it('cnt vitest', () => {
    expect(parseCounts(' Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 284 passed (286)')).toEqual({failed:2,passed:284,failLines:0,tsErrors:0});
  });
  it('cnt jest', () => {
    expect(parseCounts('Tests:       1 failed, 41 passed, 42 total')).toEqual({failed:1,passed:41,failLines:0,tsErrors:0});
  });
  it('cnt pytest', () => {
    expect(parseCounts('==== 3 failed, 120 passed in 4.2s ====')).toEqual({failed:3,passed:120,failLines:0,tsErrors:0});
  });
  it('cnt tsc', () => {
    expect(parseCounts("src/a.ts(3,1): error TS2322: Type 'x'.\nsrc/b.ts(9,2): error TS2345: bad\nFound 2 errors in 2 files.")).toEqual({failed:null,passed:null,failLines:0,tsErrors:2});
  });
  it('cnt fail lines', () => {
    expect(parseCounts(' FAIL  src/a.test.ts > adds\n ✓ src/b.test.ts')).toEqual({failed:null,passed:null,failLines:1,tsErrors:0});
  });
  it('cnt clean', () => {
    expect(parseCounts('      Tests  286 passed (286)')).toEqual({failed:null,passed:286,failLines:0,tsErrors:0});
  });
  it('r clean', () => {
    expect(R('npm test',0,'Tests  286 passed (286)')).toEqual([]);
  });
  it('r001', () => {
    expect(R('npm test 2>&1 | tail -3',0,'Tests  2 failed | 284 passed (286)')).toEqual(['OTTO001','OTTO005']);
  });
  it('r001 pipefail', () => {
    expect(R('set -o pipefail; npm test 2>&1 | tail -3',0,'Tests  286 passed (286)')).toEqual([]);
  });
  it('r002', () => {
    expect(R('npm test 2>&1 | tail -3; echo "exit=$?"',0,'Tests  286 passed\nexit=0')).toEqual(['OTTO001','OTTO002','OTTO003:medium']);
  });
  it('r003 semi', () => {
    expect(R('npm test; echo done',0,'Tests  286 passed\ndone')).toEqual(['OTTO003:medium']);
  });
  it('r003 or', () => {
    expect(R('npm test || true',0,'')).toEqual(['OTTO003:high']);
  });
  it('r003 printed', () => {
    expect(R('npm test; echo "exit=$?"',0,'Tests 1 failed | 3 passed\nexit=1')).toEqual(['OTTO005','OTTO007']);
  });
  it('r003 and ok', () => {
    expect(R('npm test && echo ok',0,'Tests  3 passed\nok')).toEqual([]);
  });
  it('r004', () => {
    expect(R('npm test 2>&1 | grep -q passed && echo OK',0,'OK')).toEqual(['OTTO001','OTTO004']);
  });
  it('r004 neg', () => {
    expect(R('npm test 2>&1 | grep -E "failed|passed"',0,'Tests 3 passed')).toEqual(['OTTO001']);
  });
  it('r004 nonver', () => {
    expect(R('grep -c passed results.log',0,'1')).toEqual([]);
  });
  it('r006', () => {
    expect(R('npx vitest run',1,'Tests  1 failed | 3 passed')).toEqual(['OTTO006']);
  });
  it('r006 trailing', () => {
    expect(R('(tsc --noEmit > /tmp/a.txt 2>&1; echo "tsc exit $?"; grep -c "error TS" /tmp/a.txt)',1,'Exit code 1\ntsc exit 0\n0')).toEqual(['OTTO006:medium','OTTO007:medium']);
  });
  it('r006 trailing and', () => {
    expect(R('tsc --noEmit > /tmp/a.txt 2>&1 && grep -c "error TS" /tmp/a.txt',1,'Exit code 1\n0')).toEqual(['OTTO006','OTTO007']);
  });
  it('r006 trailing printed fail', () => {
    expect(R('(tsc --noEmit > /tmp/a.txt 2>&1; echo "tsc exit $?"; grep -c "error TS" /tmp/a.txt)',1,'Exit code 1\ntsc exit 2\n0')).toEqual(['OTTO006:medium','OTTO007']);
  });
  it('r006 trailing echo', () => {
    expect(R('npm test; echo done',1,'Exit code 1\nTests 1 failed')).toEqual(['OTTO003:medium','OTTO006','OTTO007']);
  });
  it('r006 trailing check', () => {
    expect(R('npm run build; npm test',1,'Exit code 1\nTests 1 failed')).toEqual(['OTTO006','OTTO007']);
  });
  it('r008', () => {
    expect(R(`gh pr view 7 --json statusCheckRollup --jq '.statusCheckRollup[] | .conclusion // "-"'`,0,'SUCCESS\n\n')).toEqual(['OTTO008','OTTO009']);
  });
  it('r008 out', () => {
    expect(R('gh pr checks 7',0,'build\tpending\t0\thttps://x\nlint\tpass\t1m\thttps://y')).toEqual(['OTTO008']);
  });
  it('r009 ok', () => {
    expect(R(`gh pr view 7 --json statusCheckRollup --jq '.statusCheckRollup[] | [.__typename, .conclusion, .state]'`,0,'["CheckRun","SUCCESS",null]')).toEqual([]);
  });
  it('r010', () => {
    expect(R('npm test',0,'Tests 3 passed','completed',{truncation:{aggregatedOutput:{originalLength:9,retainedHeadLength:1,retainedTailLength:1,truncatedAt:2}}})).toEqual(['OTTO010']);
  });
  it('r011', () => {
    expect(commandRules({command:'npm test',status:'completed',aggregatedOutput:'ok'})).toEqual(['OTTO011']);
  });
  it('r012', () => {
    expect(R('grep -rn foo --include=*.ts src',1,'')).toEqual(['OTTO012']);
  });
  it('r012 quoted', () => {
    expect(R(`grep -rn foo --include='*.ts' src`,1,'')).toEqual([]);
  });
  it('r013', () => {
    expect(R('npm test',undefined,'','interrupted')).toEqual(['OTTO013']);
  });
  it('r codex wrap', () => {
    expect(R(`/bin/zsh -lc "npm test 2>&1 | tail -3"`,0,'Tests 3 passed')).toEqual(['OTTO001']);
  });
  it('r heredoc ok', () => {
    expect(R(`python3 - <<'PY'\nimport sys; print('passed')\nPY`,0,'passed')).toEqual([]);
  });
  it('fp filename', () => {
    expect(classifyCommand('cat /tmp/mixer-foundation-tsc.log; tail -25 /tmp/tests.log')).toEqual([]);
  });
  it('fp heredoc', () => {
    expect(classifyCommand("cat > a.ts <<'EOF'\nnpm test | grep passed\nEOF")).toEqual([]);
  });
  it('bin path', () => {
    expect(classifyCommand('node_modules/.bin/tsc -p web/tsconfig.json --noEmit > /tmp/x.log 2>&1')).toEqual(['typecheck']);
  });
  it('env prefix', () => {
    expect(classifyCommand('CI=1 npx vitest run')).toEqual(['test']);
  });
  it('subshell', () => {
    expect(segmentsOf('(npm run build > /tmp/b.txt 2>&1; echo $?) && echo ok').map(s=>[s.joiner,s.text])).toEqual([[null,'npm run build > /tmp/b.txt 2>&1'],[';','echo $?'],['&&','echo ok']]);
  });
  it('r heredoc grep', () => {
    expect(R("cat > notes.md <<'EOF'\ngrep passed\nEOF",0,'')).toEqual([]);
  });
  it('real1', () => {
    expect(R('tsc -p web --noEmit > /tmp/w.log 2>&1\ncode=$?\necho "$code" > /tmp/w.exit\ncat /tmp/w.log',0,"a.tsx(1,1): error TS2339: x")).toEqual(['OTTO003:medium','OTTO005:medium']);
  });
  it('real3', () => {
    expect(R('npm run build > b.txt 2>&1; echo "build exit $?"; npm test > t.txt 2>&1; echo "test exit $?"; grep -c "ok" t.txt; grep FAIL t.txt',0,'build exit 0\ntest exit 1\n3\nFAIL x')).toEqual(['OTTO005:medium','OTTO007']);
  });
  it('r007 status200', () => {
    expect(R('npm test',0,'expected status 200\nTests 3 passed')).toEqual([]);
  });
  it('r007 exiteq', () => {
    expect(R('npm test; echo "exit=$?"',0,'exit=1')).toEqual(['OTTO007']);
  });
  it('r005 mixed', () => {
    expect(R('cat old.log && npm run build',0,'error TS2339: x\nbuilt')).toEqual(['OTTO005:medium']);
  });
  it('cl11', () => {
    expect(extractClaims('Tests and typecheck pass.')).toEqual(['tests','typecheck']);
  });
  it('cl12', () => {
    expect(extractClaims('Typecheck and tests pass.')).toEqual(['tests','typecheck']);
  });
  it('v1 verified', () => {
    expect(V([file, cmd('npm test',0,'Tests  12 passed (12)'), msg('All tests pass.')])).toEqual('VERIFIED');
  });
  it('v2 stale', () => {
    expect(V([cmd('npm test',0,'Tests  12 passed (12)'), file, msg('Tests pass.')])).toEqual('UNVERIFIED');
  });
  it('v2 stale status', () => {
    expect(VS([cmd('npm test',0,'Tests  12 passed (12)'), file, msg('Tests pass.')])).toEqual({tests:'stale'});
  });
  it('v3 unsupported', () => {
    expect(VS([file, msg('Tests pass.')])).toEqual({tests:'unsupported'});
  });
  it('v4 masked', () => {
    expect(VS([file, cmd('npm test | tail -3',0,'Tests  12 passed (12)'), msg('Tests pass.')])).toEqual({tests:'untrustworthy'});
  });
  it('v5 contradicted', () => {
    expect(V([file, cmd('npm test',1,'Tests  1 failed | 11 passed'), msg('Tests pass.')])).toEqual('CONTRADICTED');
  });
  it('v6 last run wins', () => {
    expect(V([file, cmd('npm test',1,'Tests 1 failed | 11 passed'), file, cmd('npm test',0,'Tests 12 passed'), msg('Fixed it, tests pass.')])).toEqual('VERIFIED');
  });
  it('v7 no edit generic', () => {
    expect(V([msg('Done.')])).toEqual('NO_CLAIM');
  });
  it('v8 edit generic no check', () => {
    expect(V([file, msg('Done.')])).toEqual('UNVERIFIED');
  });
  it('v9 edit generic with check', () => {
    expect(V([file, cmd('npx tsc --noEmit',0,''), msg('Implemented it.')])).toEqual('VERIFIED');
  });
  it('v10 no claim', () => {
    expect(V([cmd('ls',0,'a'), msg("Here's the summary.")])).toEqual('NO_CLAIM');
  });
  it('v11 partial', () => {
    expect(VS([file, cmd('npm test',0,'Tests 3 passed'), msg('Tests pass and lint is clean.')])).toEqual({tests:'supported',lint:'unsupported'});
  });
  it('v12 build errors', () => {
    expect(V([file, cmd('npm run build',0,'Found 3 errors in 2 files.'), msg('The build succeeded.')])).toEqual('CONTRADICTED');
  });
  it('v13 precedence', () => {
    expect(V([file, cmd('npm test',1,'Tests 1 failed'), msg('Tests pass and the build succeeded.')])).toEqual('CONTRADICTED');
  });
  it('v14 last message only', () => {
    expect(V([msg('All tests pass.'), cmd('ls',0,''), msg('Here is what I looked at.')])).toEqual('NO_CLAIM');
  });
  it('v15 trailing grep', () => {
    expect(V([file, cmd('(tsc --noEmit > /tmp/a.txt 2>&1; echo "tsc exit $?"; grep -c "error TS" /tmp/a.txt)',1,'Exit code 1\ntsc exit 0\n0'), msg('Typecheck is clean.')])).toEqual('UNVERIFIED');
  });
  it('v15 trailing grep status', () => {
    expect(VS([file, cmd('(tsc --noEmit > /tmp/a.txt 2>&1; echo "tsc exit $?"; grep -c "error TS" /tmp/a.txt)',1,'Exit code 1\ntsc exit 0\n0'), msg('Typecheck is clean.')])).toEqual({typecheck:'untrustworthy'});
  });
  it('v16 and still contradicts', () => {
    expect(V([file, cmd('tsc --noEmit > /tmp/a.txt 2>&1 && grep -c "error TS" /tmp/a.txt',1,'Exit code 1\n0'), msg('Typecheck is clean.')])).toEqual('CONTRADICTED');
  });
  it('span1', () => {
    expect(extractClaimSpans('Fixed the bug. All 284 tests pass.')).toEqual([{claim:'tests',start:23,end:33},{claim:'done',start:0,end:5}]);
  });
  it('span2', () => {
    expect(extractClaimSpans("Tests don't pass yet.")).toEqual([]);
  });
  it('span3', () => {
    expect(extractClaimSpans('CI is GREEN now.').map(x=>'CI is GREEN now.'.slice(x.start,x.end))).toEqual(['CI is GREEN']);
  });
  it('span4 matches claims', () => {
    expect(extractClaimSpans('Typecheck is clean and the build succeeded.').map(x=>x.claim)).toEqual(extractClaims('Typecheck is clean and the build succeeded.'));
  });
});
