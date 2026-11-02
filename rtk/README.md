# rtk

[← Packages](../README.md#packages) · **Snapshot** · `./install.sh --apply snapshots`

The user config for [RTK](https://github.com/rtk-ai/rtk), the proxy that filters shell
command output before it reaches an agent.

- `.config/rtk/config.toml`: tracking and history settings.
- `.config/rtk/filters.toml`: user-global output filters; a project's own `.rtk/filters.toml` takes
  precedence over these.

The Claude and Codex configs call `rtk hook claude` as a `PreToolUse` hook, and the shell startup test
needs `rtk` on PATH. There is no scripted install: install it by hand.

The `uvx-progress` filter removes UVX setup progress, preserving tool output,
package changes, errors and exit status. It does not filter Baton answers,
Bridge events or protocol JSON. After reviewing and copying the snapshot to the
live config, run `rtk trust --yes` locally. Trust hashes stay outside Git.
Use `rtk uvx ...` for standalone UV-managed tools; repository commands stay
`uv run` with the existing RTK filters.

## Exact output and shell quoting

`rtk bypass` (legacy alias `rtk proxy`) sends raw output and increases model input
tokens and cost. Use a command-specific filter, then `summary`/`err`/`test` for
other commands. Reserve bypass for byte-exact protocols or demonstrated filter
breakage. Full file/instruction reads use `rtk read --level none`; bound ordinary
reads and recover elided details before resorting to raw output.

### Pipelines, chains and substitutions

RTK's display output is for the agent, not input to another program. Keep native
commands inside data flows; filter only the final display boundary. Otherwise
shortened paths, omitted rows or added headings can change a later search, count
or parser. This applies to pipelines, command/process substitutions and redirected
file/protocol output, including when they appear inside a longer command chain.

```sh
# With the native hook: write the pipeline normally; RTK rewrites only its tail.
find ~/.claude/projects -type f -name '*.jsonl' | rg dotfiles

# Without a hook: filter the complete pipeline once, after its internal work.
rtk summary bash -o pipefail -c 'rg --files --hidden ~/.claude/projects | rg dotfiles'

# Keep substitutions and file contents exact; compress the displayed result later.
count=$(find . -type f | wc -l)
find . -type f > inventory.txt
```

Do not write `rtk find ... | rg ...` or `rtk rg ... | jq ...` when the next stage
needs the original records. A whole-chain wrapper must keep the original shell,
quoting, redirections, operator order and exit status; use `pipefail` when any
failed pipeline stage should fail the command. `&&`, `||` and `;` may join ordinary
display commands as well as pipelines; they do not make every command a data source.

RTK 1.1's native rewrite engine already leaves pipeline producers native, rewrites
only a supported final stage, preserves chain operators, and declines command
substitutions and file redirects. No additional rewrite hook is installed here.
The checks below exercise these boundaries through the real Claude hook, including
unsupported final stages and short-circuit exit status.

A recorded `rtk summary` invocation stripped the
quoting from `awk 'NR>=80'`, leaving a `>=80` redirect and a stray `=80` file.
Prefer a read tool for line ranges; recover omitted output with `rtk recall` or
a focused read. Shell quoting alone is not a reason to bypass filtering.

### Known `rtk summary` limits (RTK 1.1.0)

`summary` is a heuristic display filter, and these are upstream behaviours to design around, not to bypass RTK for:

- **It does not pass stdin to the command it wraps.** `printf x | rtk summary python3 -c 'import sys; print(len(sys.stdin.read()))'`
  prints 0, with exit status 0 (reproduced). Wrapping the whole pipeline (`rtk summary bash -o pipefail -c '… | …'`) prints 1.
  So the final-consumer rule above applies to the hook's rewrite of supported stages, not to a hand-written `summary` tail.
- **Its test-result block is a guess.** A report had a plain `wc -l` over files named `test_*.py` and a passing `npm test` come
  back with an invented "Test Results" count and negative-case test titles under "Failures" (not reproduced on small inputs here).
  Take counts from the native tool (`wc`, a read of the file) and test outcomes from the runner's own exit status and
  summary line (`rtk test`, or the project's runner), never from `summary`'s headings.

## Learning and filter patterns

`rtk --help` owns current dispatch. RTK 1.1's `rtk uv run ...` preserves the UV
environment while routing supported tools to their own filters. Existing
`filters.toml` regex rules handle repeated output noise; keep versions, failures,
diagnostics and exit status, with positive and negative fixtures.

`rtk learn` mines Claude Code's error/correction history; `rtk discover` finds
missed filtering opportunities in that history. They do not audit Codex sessions.
Start with a bounded project/date range and repeated, high-confidence findings.
Review candidates before applying a targeted fix. Do not run `--write-rules` in
public dotfiles: generated commands and paths are private state, not shared rules.

`rtk pipeline test` validates loaded engine pipelines; `rtk methods list` shows
their lossiness/recovery contracts. `pipeline explain` establishes which hooks
the installed harness supports. Codex cannot replace results in PostToolUse, so
installing an after-tool pipeline alone does not compress native tool output.
No LLM proxy, delegated compression task or additional engine hook is configured
here. CLI filters remain the shared route across harnesses.

## Checks

Run `python3 -B tests/test_rtk_filters.py` from the repo root to check the inline
fixtures and real dispatch/exit status in an isolated config. RTK's verifier
currently reads project filters, not global ones, so an empty global verify run
is not proof that a filter passed. The test copies this snapshot into its own
temporary project and keeps its trust state there.
