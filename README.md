# Otto

A bb plugin from RAC Projects AI: the workspace that won't let your agents lie to you.

After every finished agent turn, Otto reads the raw command log (exit codes and output) and the agent's final message. If the agent says "tests pass", Otto checks whether a test command actually ran, whether its exit code was really the test's, and whether files changed after it. The result is a **proof card** with one verdict:

| Verdict | Meaning |
|---|---|
| Verified | The claim is backed by a check that ran and passed. |
| Unverified | No check ran, or the check hides its real exit code (for example `npm test \| tail -3`). |
| Contradicted | The raw evidence shows failure. |
| No claim | The agent did not claim a result. |

Otto never edits your files and makes no network call of its own. Everything it stores stays in the plugin's own database on your bb server.

## Requirements

Otto is a plugin for [bb](https://github.com/get-bb/bb) ([getbb.app](https://getbb.app)), version 0.46 or newer. It does not install bb for you.

1. Get bb from the [desktop app download](https://github.com/get-bb/bb/releases/tag/desktop-latest), or run `npx bb-app@latest` and open `http://localhost:38886`.
2. In bb, open **Settings, General, Command line** and choose **Install**, so the `bb` command works in your terminal.
3. Check it with `bb --version`.

## Install

```sh
git clone https://github.com/Jerbud308/bb-plugin-otto.git
bb plugin install path:$PWD/bb-plugin-otto
```

If the install reports a missing dependency, run `npm install` inside the folder and try again.

For a local checkout, `bb plugin build` compiles it and `bb plugin reload otto` loads a change.

## What you see

- A verdict stamp and a small ribbon in each thread header. Click it to open the **Proof** panel for that thread.
- An **Otto** page in the sidebar with the **Feed** (every proof card, filterable by verdict) and the **Rules** table (every trap Otto knows, with a fix hint).
- **Learn** (Pro and Operator): which traps keep coming back, per rule and per agent, with a one-line CLAUDE.md suggestion to copy for each habit that repeated three times. Otto never writes the file.
- In Operator mode, the **Bake-off**, **Pipelines** and **Budget** tabs.

## Modes

One setting, **Mode**, under Settings, Installed plugins, Otto. The default is Starter.

| | Starter | Pro | Operator |
|---|---|---|---|
| Proof cards, header badge, Proof panel, Feed, Rules, CLI | yes | yes | yes |
| Coaches agents: instructions, the `otto_lint_command` tool and the `otto-evidence` skill are added to agent threads | no | yes | yes |
| **Advisor**: an "Ask advisor" button on a card starts a hidden read-only agent thread that judges whether the evidence is enough | no | no | yes |
| **Bake-off**: one prompt to 2 to 4 agents, each in its own worktree; compare verdicts and diff sizes, pick a winner, keep a scoreboard | no | no | yes |
| **Pipelines**: chain 1 to 8 agent stages that share one worktree; each stage gets the earlier replies, and a gate can stop the run when a stage is contradicted or unproven. Build it by dragging stage boxes into order | no | no | yes |
| **Budget** and **Guard**: tokens per project, each agent's own plan-window percentages, and an optional limit that warns, holds or refuses a new message | no | no | yes |
| **Learn**: trends and suggested CLAUDE.md lines | no | yes | yes |

Advisor, Bake-off and Pipelines start agent threads, so they use tokens on your account. Otto asks before it starts any of them. Otto never merges anything: a Bake-off winner is merged with bb's own controls.

**Guard** is off by default. Its modes are `warn` (note it), `wait` (hold the message until the plan window resets) and `reject` (refuse it with a reason); it can be limited to chosen projects. It uses bb's experimental message hook, so a future bb release may change it. Otto shows tokens and each agent's own plan percent, never dollar figures.

Other settings: how many hours back to scan on startup, your own extra rules (a JSON list; they add a note to a card and never change a verdict), the Guard limits, and the Advisor's provider, model and timeout.

## Command line

```sh
bb otto proof [thread-id]     # newest proof cards for a thread (defaults to the current one)
bb otto scan [thread-id]      # rebuild a thread's cards; --all rescans recent threads
bb otto rules                 # the rules table
bb otto lint "<command>"      # check a command before running it; exits 2 on a high finding
bb otto learn [--days 7|30|90] # Pro and Operator: repeated traps and CLAUDE.md lines
bb otto advisor <card-id>     # Operator only: start an Advisor review
```

`proof`, `rules`, `lint` and `learn` take `--json`.

## Develop

```sh
npm install
npm test            # vitest
npm run typecheck   # tsc --noEmit
bb plugin build
```

The pure proof engine lives in `src/proof/` and is checked against 99 fixtures in `docs/reference/`.

## License

MIT, copyright RAC Projects AI. See [LICENSE](LICENSE). The files under `components/`, `hooks/` and `lib/` come from bb's own plugin scaffold.
