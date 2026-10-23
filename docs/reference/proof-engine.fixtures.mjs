// Otto proof engine fixtures: THE CONTRACT for src/proof/*.
// Port every check below to tests/proof/*.test.ts (vitest), one it() per chk().
// Reference run: node docs/reference/proof-engine.fixtures.mjs   -> must print fail 0.
import * as E from './proof-engine.reference.mjs';
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
let pass=0, fail=0; const chk=(name,got,exp)=>{ if(eq(got,exp)) pass++; else { fail++; console.log('FAIL',name,'got',JSON.stringify(got),'exp',JSON.stringify(exp)); } };
// unwrap
chk('unwrap dq', E.unwrapCommand(`/bin/zsh -lc "rg -n \\"foo\\" src | head -5"`), `rg -n "foo" src | head -5`);
chk('unwrap sq', E.unwrapCommand(`/bin/zsh -lc 'cat a'\\''b'`), `cat a'b`);
chk('unwrap bash', E.unwrapCommand(`bash -lc 'npm test'`), `npm test`);
chk('unwrap none', E.unwrapCommand(`npm test`), `npm test`);
// split
const S=(c)=>E.splitTopLevel(c).map(s=>[s.joiner,s.text]);
chk('split1', S(`cd app && npm test | tail -3; echo "exit=$?"`), [[null,'cd app'],['&&','npm test | tail -3'],[';','echo "exit=$?"']]);
chk('split2', S(`echo "a;b" && echo 'c&&d'`), [[null,'echo "a;b"'],['&&',"echo 'c&&d'"]]);
chk('split3', S(`npm test || true`), [[null,'npm test'],['||','true']]);
chk('split4', S(`python3 - <<'PY'\nprint(1); print(2)\nPY\necho done`), [[null,`python3 - <<'PY'\nprint(1); print(2)\nPY`],['\n','echo done']]);
chk('split5', S(`x=$(npm test; echo hi) && echo ok`), [[null,'x=$(npm test; echo hi)'],['&&','echo ok']]);
chk('split6', S(`npm test 2>&1 | tail -5`), [[null,'npm test 2>&1 | tail -5']]);
chk('pipe1', E.splitPipeline(`npm test 2>&1 | tail -5`), ['npm test 2>&1','tail -5']);
chk('pipe2', E.splitPipeline(`echo "a|b" | wc -l`), ['echo "a|b"','wc -l']);
chk('pipe3', E.splitPipeline(`npm test |& tee log`), ['npm test','tee log']);
// classify
chk('cls1', E.classifyCommand('npx vitest run'), ['test']);
chk('cls2', E.classifyCommand('npm run typecheck && npm run build'), ['typecheck','build']);
chk('cls3', E.classifyCommand('pnpm test:unit'), ['test']);
chk('cls4', E.classifyCommand('gh pr checks 42'), ['ci']);
chk('cls5', E.classifyCommand('ls -la && cat README.md'), []);
chk('cls6', E.classifyCommand('npx tsc --noEmit'), ['typecheck']);
chk('cls7', E.classifyCommand('cat attestation.txt'), []);
chk('cls8', E.classifyCommand('bb plugin build'), ['build']);
// claims
chk('cl1', E.extractClaims('Fixed the bug. All 284 tests pass.'), ['tests','done']);
chk('cl2', E.extractClaims("Tests don't pass yet, still investigating."), []);
chk('cl3', E.extractClaims('Once the tests pass I will merge.'), []);
chk('cl4', E.extractClaims('Typecheck is clean and the build succeeded.'), ['typecheck','build']);
chk('cl5', E.extractClaims('CI is green on the PR.'), ['ci']);
chk('cl6', E.extractClaims('Here is a summary of the file.'), []);
chk('cl7', E.extractClaims('Done ✅'), ['done']);
chk('cl8', E.extractClaims('I could not verify that tests pass because the DB is down.'), []);
chk('cl9', E.extractClaims('Tests: 12 passed. Lint is clean.'), ['tests','lint']);
chk('cl10', E.extractClaims('Implemented the endpoint.'), ['done']);
// counts
chk('cnt vitest', E.parseCounts(' Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 284 passed (286)'), {failed:2,passed:284,failLines:0,tsErrors:0});
chk('cnt jest', E.parseCounts('Tests:       1 failed, 41 passed, 42 total'), {failed:1,passed:41,failLines:0,tsErrors:0});
chk('cnt pytest', E.parseCounts('==== 3 failed, 120 passed in 4.2s ===='), {failed:3,passed:120,failLines:0,tsErrors:0});
chk('cnt tsc', E.parseCounts("src/a.ts(3,1): error TS2322: Type 'x'.\nsrc/b.ts(9,2): error TS2345: bad\nFound 2 errors in 2 files."), {failed:null,passed:null,failLines:0,tsErrors:2});
chk('cnt fail lines', E.parseCounts(' FAIL  src/a.test.ts > adds\n ✓ src/b.test.ts'), {failed:null,passed:null,failLines:1,tsErrors:0});
chk('cnt clean', E.parseCounts('      Tests  286 passed (286)'), {failed:null,passed:286,failLines:0,tsErrors:0});
// rules
const R=(command,exitCode,aggregatedOutput='',status=exitCode===0?'completed':'failed',extra={})=>E.commandRules({command,exitCode,aggregatedOutput,status,...extra});
chk('r clean', R('npm test',0,'Tests  286 passed (286)'), []);
chk('r001', R('npm test 2>&1 | tail -3',0,'Tests  2 failed | 284 passed (286)'), ['OTTO001','OTTO005']);
chk('r001 pipefail', R('set -o pipefail; npm test 2>&1 | tail -3',0,'Tests  286 passed (286)'), []);
chk('r002', R('npm test 2>&1 | tail -3; echo "exit=$?"',0,'Tests  286 passed\nexit=0'), ['OTTO001','OTTO002','OTTO003:medium']);
chk('r003 semi', R('npm test; echo done',0,'Tests  286 passed\ndone'), ['OTTO003:medium']);
chk('r003 or', R('npm test || true',0,''), ['OTTO003:high']);
chk('r003 printed', R('npm test; echo "exit=$?"',0,'Tests 1 failed | 3 passed\nexit=1'), ['OTTO005','OTTO007']);
chk('r003 and ok', R('npm test && echo ok',0,'Tests  3 passed\nok'), []);
chk('r004', R('npm test 2>&1 | grep -q passed && echo OK',0,'OK'), ['OTTO001','OTTO004']);
chk('r004 neg', R('npm test 2>&1 | grep -E "failed|passed"',0,'Tests 3 passed'), ['OTTO001']);
chk('r004 nonver', R('grep -c passed results.log',0,'1'), []);
chk('r006', R('npx vitest run',1,'Tests  1 failed | 3 passed'), ['OTTO006']);
// ruleset 2: the exit code of a trailing `;` command is not the check's
chk('r006 trailing', R('(tsc --noEmit > /tmp/a.txt 2>&1; echo "tsc exit $?"; grep -c "error TS" /tmp/a.txt)',1,'Exit code 1\ntsc exit 0\n0'), ['OTTO006:medium','OTTO007:medium']);
chk('r006 trailing and', R('tsc --noEmit > /tmp/a.txt 2>&1 && grep -c "error TS" /tmp/a.txt',1,'Exit code 1\n0'), ['OTTO006','OTTO007']);
chk('r006 trailing printed fail', R('(tsc --noEmit > /tmp/a.txt 2>&1; echo "tsc exit $?"; grep -c "error TS" /tmp/a.txt)',1,'Exit code 1\ntsc exit 2\n0'), ['OTTO006:medium','OTTO007']);
chk('r006 trailing echo', R('npm test; echo done',1,'Exit code 1\nTests 1 failed'), ['OTTO003:medium','OTTO006','OTTO007']);
chk('r006 trailing check', R('npm run build; npm test',1,'Exit code 1\nTests 1 failed'), ['OTTO006','OTTO007']);
chk('r008', R(`gh pr view 7 --json statusCheckRollup --jq '.statusCheckRollup[] | .conclusion // "-"'`,0,'SUCCESS\n\n'), ['OTTO008','OTTO009']);
chk('r008 out', R('gh pr checks 7',0,'build\tpending\t0\thttps://x\nlint\tpass\t1m\thttps://y'), ['OTTO008']);
chk('r009 ok', R(`gh pr view 7 --json statusCheckRollup --jq '.statusCheckRollup[] | [.__typename, .conclusion, .state]'`,0,'["CheckRun","SUCCESS",null]'), []);
chk('r010', R('npm test',0,'Tests 3 passed','completed',{truncation:{aggregatedOutput:{originalLength:9,retainedHeadLength:1,retainedTailLength:1,truncatedAt:2}}}), ['OTTO010']);
chk('r011', E.commandRules({command:'npm test',status:'completed',aggregatedOutput:'ok'}), ['OTTO011']);
chk('r012', R('grep -rn foo --include=*.ts src',1,''), ['OTTO012']);
chk('r012 quoted', R(`grep -rn foo --include='*.ts' src`,1,''), []);
chk('r013', R('npm test',undefined,'','interrupted'), ['OTTO013']);
chk('r codex wrap', R(`/bin/zsh -lc "npm test 2>&1 | tail -3"`,0,'Tests 3 passed'), ['OTTO001']);
chk('r heredoc ok', R(`python3 - <<'PY'\nimport sys; print('passed')\nPY`,0,'passed'), []);
chk('fp filename', E.classifyCommand('cat /tmp/mixer-foundation-tsc.log; tail -25 /tmp/tests.log'), []);
chk('fp heredoc', E.classifyCommand("cat > a.ts <<'EOF'\nnpm test | grep passed\nEOF"), []);
chk('bin path', E.classifyCommand('node_modules/.bin/tsc -p web/tsconfig.json --noEmit > /tmp/x.log 2>&1'), ['typecheck']);
chk('env prefix', E.classifyCommand('CI=1 npx vitest run'), ['test']);
chk('subshell', E.segmentsOf('(npm run build > /tmp/b.txt 2>&1; echo $?) && echo ok').map(s=>[s.joiner,s.text]), [[null,'npm run build > /tmp/b.txt 2>&1'],[';','echo $?'],['&&','echo ok']]);
chk('r heredoc grep', R("cat > notes.md <<'EOF'\ngrep passed\nEOF",0,''), []);
chk('real1', R('tsc -p web --noEmit > /tmp/w.log 2>&1\ncode=$?\necho "$code" > /tmp/w.exit\ncat /tmp/w.log',0,"a.tsx(1,1): error TS2339: x"), ['OTTO003:medium','OTTO005:medium']);
chk('real3', R('npm run build > b.txt 2>&1; echo "build exit $?"; npm test > t.txt 2>&1; echo "test exit $?"; grep -c "ok" t.txt; grep FAIL t.txt',0,'build exit 0\ntest exit 1\n3\nFAIL x'), ['OTTO005:medium','OTTO007']);
chk('r007 status200', R('npm test',0,'expected status 200\nTests 3 passed'), []);
chk('r007 exiteq', R('npm test; echo "exit=$?"',0,'exit=1'), ['OTTO007']);
chk('r005 mixed', R('cat old.log && npm run build',0,'error TS2339: x\nbuilt'), ['OTTO005:medium']);
chk('cl11', E.extractClaims('Tests and typecheck pass.'), ['tests','typecheck']);
chk('cl12', E.extractClaims('Typecheck and tests pass.'), ['tests','typecheck']);
// verdict
const cmd=(command,exitCode,aggregatedOutput='',status=exitCode===0?'completed':'failed')=>{ const item={command,exitCode,aggregatedOutput,status}; return {kind:'cmd',item,kinds:E.classifyCommand(E.unwrapCommand(command)),findings:E.commandRules(item)}; };
const file={kind:'file'}; const msg=(text)=>({kind:'msg',text});
const V=(items)=>E.decideVerdict({items}).verdict;
const VS=(items)=>E.decideVerdict({items}).status;
chk('v1 verified', V([file, cmd('npm test',0,'Tests  12 passed (12)'), msg('All tests pass.')]), 'VERIFIED');
chk('v2 stale', V([cmd('npm test',0,'Tests  12 passed (12)'), file, msg('Tests pass.')]), 'UNVERIFIED');
chk('v2 stale status', VS([cmd('npm test',0,'Tests  12 passed (12)'), file, msg('Tests pass.')]), {tests:'stale'});
chk('v3 unsupported', VS([file, msg('Tests pass.')]), {tests:'unsupported'});
chk('v4 masked', VS([file, cmd('npm test | tail -3',0,'Tests  12 passed (12)'), msg('Tests pass.')]), {tests:'untrustworthy'});
chk('v5 contradicted', V([file, cmd('npm test',1,'Tests  1 failed | 11 passed'), msg('Tests pass.')]), 'CONTRADICTED');
chk('v6 last run wins', V([file, cmd('npm test',1,'Tests 1 failed | 11 passed'), file, cmd('npm test',0,'Tests 12 passed'), msg('Fixed it, tests pass.')]), 'VERIFIED');
chk('v7 no edit generic', V([msg('Done.')]), 'NO_CLAIM');
chk('v8 edit generic no check', V([file, msg('Done.')]), 'UNVERIFIED');
chk('v9 edit generic with check', V([file, cmd('npx tsc --noEmit',0,''), msg('Implemented it.')]), 'VERIFIED');
chk('v10 no claim', V([cmd('ls',0,'a'), msg("Here's the summary.")]), 'NO_CLAIM');
chk('v11 partial', VS([file, cmd('npm test',0,'Tests 3 passed'), msg('Tests pass and lint is clean.')]), {tests:'supported',lint:'unsupported'});
chk('v12 build errors', V([file, cmd('npm run build',0,'Found 3 errors in 2 files.'), msg('The build succeeded.')]), 'CONTRADICTED');
chk('v13 precedence', V([file, cmd('npm test',1,'Tests 1 failed'), msg('Tests pass and the build succeeded.')]), 'CONTRADICTED');
chk('v14 last message only', V([msg('All tests pass.'), cmd('ls',0,''), msg('Here is what I looked at.')]), 'NO_CLAIM');
chk('v15 trailing grep', V([file, cmd('(tsc --noEmit > /tmp/a.txt 2>&1; echo "tsc exit $?"; grep -c "error TS" /tmp/a.txt)',1,'Exit code 1\ntsc exit 0\n0'), msg('Typecheck is clean.')]), 'UNVERIFIED');
chk('v15 trailing grep status', VS([file, cmd('(tsc --noEmit > /tmp/a.txt 2>&1; echo "tsc exit $?"; grep -c "error TS" /tmp/a.txt)',1,'Exit code 1\ntsc exit 0\n0'), msg('Typecheck is clean.')]), {typecheck:'untrustworthy'});
chk('v16 and still contradicts', V([file, cmd('tsc --noEmit > /tmp/a.txt 2>&1 && grep -c "error TS" /tmp/a.txt',1,'Exit code 1\n0'), msg('Typecheck is clean.')]), 'CONTRADICTED');
// claim spans (highlighter)
chk('span1', E.extractClaimSpans('Fixed the bug. All 284 tests pass.'), [{claim:'tests',start:23,end:33},{claim:'done',start:0,end:5}]);
chk('span2', E.extractClaimSpans("Tests don't pass yet."), []);
chk('span3', E.extractClaimSpans('CI is GREEN now.').map(x=>'CI is GREEN now.'.slice(x.start,x.end)), ['CI is GREEN']);
chk('span4 matches claims', E.extractClaimSpans('Typecheck is clean and the build succeeded.').map(x=>x.claim), E.extractClaims('Typecheck is clean and the build succeeded.'));
console.log('pass',pass,'fail',fail,'total',pass+fail);
