---
name: otto-evidence
description: How Otto judges "done", and how to run verification commands so the evidence counts. Use before reporting that tests, typecheck, build, lint, or CI pass.
---

# Evidence Otto accepts

Otto reads the raw command log of each turn (exit code and output), not your summary. A claim is VERIFIED only when the last matching check in the turn ran after your last file edit, exited 0, and nothing in the command hides its exit status.

## Do

- Run the check as its own command: `npm test`
- If you need a short tail, write to a file first:
  `npm test > /tmp/test.log 2>&1` then, as a separate command, `tail -20 /tmp/test.log`
- If you must pipe, start with `set -o pipefail; `
- After editing files, rerun the check before saying it passes.
- For CI, wait on `.status` until every check is COMPLETED, then require `conclusion == "SUCCESS"` for each.

## Do not

- `npm test | tail -3` (exit code is tail's)
- `npm test; echo done` or `npm test || true` (exit code is not the test's)
- `npm test | grep -q passed` ("2 failed | 284 passed" matches)
- `.conclusion // "-"` on GitHub checks (a running check has an empty conclusion)

## Commands

- `bb otto lint "<command>"`: check a command before you rely on it. Exit 2 means a high finding.
- `bb otto proof`: show the proof cards for this thread.
- `bb otto rules`: list every rule.
