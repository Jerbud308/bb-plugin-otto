Otto checks what your agents say against what they actually ran. After every
finished turn it reads the raw command log, compares exit codes and output with
the agent's claim ("tests pass", "build is clean"), and stamps the turn
Verified, Unverified, or Contradicted. It catches the quiet traps, such as a
test run piped through `tail`, where the exit code belongs to `tail`.

Every thread gets a verdict badge and a Proof panel, and an Otto page lists
every card with the raw evidence beside the claim. Operator mode adds an
Advisor that second-guesses thin evidence in a hidden thread, a Bake-off
that sends one prompt to several agents and compares their receipts, a
Pipeline builder that chains agents into one worktree with proof gates between
them, and a Budget meter with an optional Guard that holds or refuses messages
over a limit. Learn (Pro and Operator) shows which traps repeat and offers a
CLAUDE.md line for each. Otto never edits your files or merges anything.
