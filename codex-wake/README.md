# Codex task notifications

[← Packages](../README.md#packages) · **uv tool** (editable) · Codex-specific

Host lifecycle hooks observe Codex background work and deliver a native task
message to the same conversation. The job stays in Codex's command sandbox;
only observation and delivery run on the host. Claude's visual
[Wake mod](../claude/README.md#wake-mod-live) is a separate feature.

## Default workflow

Launch a command normally with Codex's background terminal, continue independent
work, then end the model turn. No wrapper, hand-written completion message, OS
PID or terminal handle is required for the notification. The `Stop` hook captures
newly observed running command items and starts a host observer. Once a
captured command ends and the target is idle, it sends one notification with the
native exit status and a private captured-output path.

`SubagentStart` records the native worker's launch generation.
Async `SubagentStop` gives native delivery a two-second head start, verifies the
actual parent through `thread/read`, checks it is still idle without having
continued during that grace period, and reports the captured result once per child turn. It leaves active and
input-blocked parents to their native message flow. Posting a blocker without
ending the child turn has no corresponding hook: use the
[bounded native recovery](../codex/.codex/skills/codex-wake/SKILL.md#native-worker-blocked-on-its-root).
A result being reported does not prove the whole task is done.

### Install (user step)

```sh
uv tool install --editable ~/dotfiles-with-agency/codex-wake
./install.sh --apply hooks
```

Review and trust the merged hooks in Codex's `/hooks` UI, then restart Codex.
The snapshot is [hooks.json](../codex/.codex/hooks.json); nothing in this change
installs hooks or edits live `~/.codex` settings. A running user systemd manager
is required. The observer is a transient `codex-wake-*.service`, launched with
`systemd-run --user --collect --service-type=exec`. Its command is the fixed Python
observer module and a private job file, **never the user's shell command**.

The hook itself has a 60-second setup budget. The observer service has
`RuntimeMaxSec=infinity`, so it can outlive the hook and watch jobs longer than
600 seconds. It ends when its captured items finish, the target unloads/fails,
or its generation is cancelled. See [systemd 249's service lifecycle](https://www.freedesktop.org/software/systemd/man/249/systemd-run.html).
The service does not keep the Codex app server or the original terminal alive.

### Cancellation and duplicates

`Interrupt` and `SessionEnd` pause the generation; the next parent
`UserPromptSubmit` starts a new one only after such a pause. Ordinary parent and
child prompts preserve ongoing observers. Each command is registered by native
item ID, so later Stop events do not re-arm it. Delivery waits for idle across
turns and never answers a question or grants approval. Use Codex's interrupt
control to pause automatic delivery; a new chat prompt alone does not cancel it.

Each command item/child turn has a persistent claim written **before** submission.
An uncertain receipt is never retried. This provides at most one send attempt
per incident, not exactly-once receipt across crashes. Bridge watch and explicit
`codex-wake run` commands keep their own producer; the automatic command observer
skips those launch forms. Avoid burying completion producers inside opaque shell
scripts: command-text inspection cannot discover arbitrary nested behavior.
Unparseable shell syntax is conservatively skipped without preventing other
commands from being observed; those jobs need an explicit host producer.

State, claims and logs live under absolute `$XDG_STATE_HOME/codex-wake/`, or
`~/.local/state/codex-wake/` when XDG_STATE_HOME is absent or relative,
in private session directories (0700); files are 0600. Delete old state only when
its observer services have stopped. The native output can already be truncated
by Codex's retained-output limit (1 MiB in 0.166.0); the log preserves that captured
text, not an invented full transcript. The hook does not alter command I/O or TTYs.

Stop reads only background-terminal metadata, with 32 entries per page and a
four-page budget; it never scans turn history. The observer keeps one connection
open and fetches only watched IDs through the 0.166.0 experimental
[`thread/items/read` contract](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1875).
Each read requests one item because its captured output can expand near the
client's 8 MiB response limit. Completed output is cached while waiting for idle.
Quiet polls back off from 2 to 4, 8, 16 and then 30 seconds, resetting on progress.
The [documented event stream](https://learn.chatgpt.com/docs/app-server#events)
requires starting/resuming a thread; 0.166.0 has no passive subscribe request.
This observer uses read-only calls instead of resuming or altering the target.

## Monitoring a condition for a while

For "tell me when X happens, for the next half hour", launch the monitor like any background command and end the turn:

```sh
codex-wake monitor --every 10s --ttl 30m --cooldown 5m --max-events 5 -- test -f build/ready
```

The probe is an argument list (no shell) run every `--every`: exit 0 means the condition holds, 1 that it does not, anything
else is a probe error. The monitor prints a `wake-event:` line for each announced hit and a `wake-end:` line when it stops.
It never talks to Codex, so it runs in the command sandbox like any other command. The `Stop` hook recognises it and the
host observer reads those lines from the running command, waking the idle session under limits the command cannot loosen:

| Limit | Default | Hard cap | Behaviour |
| --- | --- | --- | --- |
| `--ttl` | 30m | 24h | the monitor stops itself; the observer stops listening shortly after the same time |
| `--cooldown` | 5m | at least 30s | one notice per cooldown at most; hits in between are counted and joined to the next notice |
| `--max-events` | 5 | 20 | notices stop after this many; the closing notice still arrives |
| `--every` | 10s | at least 2s | probe interval; five probe errors in a row end it with `reason=probe-failed` |

`--distinct` announces a hit only when the probe's first output line differs from the last announced one (a changed answer,
not the same answer again). A notice states how many hits are new and how many there have been, and names the private log;
the probe's own output is never pasted into it. The closing notice is the ordinary one for a finished command.

Delivery waits for the session to be idle, like every other notice here. Live delivery needs the installed hooks and reads
the command's output while it runs. If a Codex build does not return that output until the command ends, the monitor
still stops at its limits and the one closing notice carries every hit in its log. Check with a short run (`--ttl 1m
--cooldown 30s` and a probe that is true) and see whether the first notice arrives before the command ends.

## Why this mechanism

Checked against installed **codex-cli 0.166.0**, its `--help`, app-server help and
feature list, current official docs, and versioned upstream source. A live TUI
payload could not be captured from this worker; tests use documented/source-derived
shapes. Installation remains a user step pending the live checks below.

| Candidate | Finding | Decision |
| --- | --- | --- |
| Native unified-exec completion | The [exit watcher](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/unified_exec/async_watcher.rs#L167) emits command events; it does not itself submit a new model turn. | Prefer a native trigger wherever idle resumption is proven, but do not assume this event is one. |
| Async hook stdout | [Codex delivers it on the next user turn when idle](https://learn.chatgpt.com/docs/hooks#how-background-hooks-run). | A host hook must call the task-message channel explicitly. |
| `PostToolUse` on yielded exec | The [0.166.0 implementation](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/context.rs#L481) returns **no hook payload while a process ID is present**. The final response is text, not a background PID/output-file record. [Docs](https://learn.chatgpt.com/docs/hooks#tool-coverage) mention later `write_stdin` delivery. | Reject the proposed post-tool process observer; it cannot arm at background launch. |
| Host `Stop` + `SubagentStop` | [Lifecycle hooks](https://learn.chatgpt.com/docs/hooks) run at the needed boundaries. [Item pagination](https://learn.chatgpt.com/docs/app-server#list-thread-items) provides native identity/status/output; task delivery already exists locally. | Implement these without rewriting or unsandboxing jobs. |
| Delivery-only execpolicy rule | [An explicit `allow` can bypass the sandbox](https://learn.chatgpt.com/docs/agent-configuration/rules#understand-rule-fields), not merely skip a prompt. Source [requires every parsed segment to be explicitly allowed](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/exec_policy.rs#L442). A rule for exact `codex-wake send/check` would help separate delivery calls, but cannot elevate a nested child inside an already-sandboxed `run`, or automatically arm completion. | Not installed or recommended over the host hook. Never allow `codex-wake run`, a shell, Python, or the whole executable prefix. |
| Writable socket path / broader network | [`sandbox_workspace_write` controls filesystem roots/network](https://learn.chatgpt.com/docs/config-file/config-reference), not a per-method exception for the privileged control API. Linux [masks the app-server socket directory and aliases](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/linux-sandbox/src/daemon_mounts.rs#L24); [legacy Landlock is rejected for restricted policies](https://learn.chatgpt.com/docs/permissions#how-enforcement-works). | Do not make `~/.codex` writable or relax socket isolation. |
| Explicit AF_UNIX proxy allowlist | [Permission profiles support named Unix sockets](https://learn.chatgpt.com/docs/permissions#unix-sockets), but this is endpoint access for sandbox programs, not a `send`-only RPC capability. It would expose a powerful control API more broadly than delivery requires. | Reject for this task; no network/permission-profile changes. |

Native terminal/process IDs are **app-server handles**, not host PIDs. The
[app-server reference](https://learn.chatgpt.com/docs/app-server#clean-background-terminals)
states this explicitly. Using command item IDs avoids PID namespaces, reuse,
invisible processes and unavailable exit codes. The old agent-facing
`wait --pid` command and its process poll were removed rather than retained as
a second attachment workflow. The PermissionError diagnostic now routes to the
host hook or authorized delivery-only calls and explicitly forbids escalating `run`.

The [parity matrix and hook inventory](PARITY.md) distinguish implemented paths
from remaining gaps. The [wait-time audit](WAIT_TIMES.md) records source-backed
defaults and recommendations; no unrelated package's timer was changed.

## Explicit producers and fallback

```sh
codex-wake check
codex-wake send --message "The preview is ready for review."
codex-wake run -- make build
```

`check` and `send` use the current `CODEX_THREAD_ID` and `CODEX_HOME` (otherwise
`~/.codex`). Use `--thread THREAD --home PATH` only for an explicitly intended
different target. Existing host event producers can call `send`; Bridge watch
already uses the shared client, so never wrap it again.

`run -- COMMAND` remains a fallback **only where delivery already works**. It
preflights, runs the exact argument list with inherited stdin, tees combined
stdout/stderr to stdout and a 0600 temporary log, then sends the executable name,
exit status and output path. `--message` is optional. Arguments are omitted from
the notification; output is never pasted into it. No shell is inserted. Piped
output can change buffering and terminal formatting; use normal Codex terminals
with the installed hook as the default.

`run` preserves command exit codes (signals return `128 + signal`), returns 127
for an unavailable program, and 125 for setup/capture/delivery failure. Inspect
the printed log path before retrying: the job may already have executed.
Messages, including automatic context, must fit 1,000 UTF-8 bytes and are checked
before execution. Temporary logs persist until deleted or system cleanup and
have no size cap. **Never request sandbox bypass for `run`.** Allowing its delivery
would also unsandbox its arbitrary wrapped job. A separate narrow `send/check`
rule cannot change the sandbox of subprocesses already started by `run`.

## Shared client and compatibility

```python
from codex_wake.client import Wake

target = Wake(thread_id, home=codex_home)
target.check()
target.send("Automatic event notification. Not user approval.")
```

Each check/send opens and closes its own connection, freezes the target at
construction, validates discovery/receipts, and bounds each RPC wait to 15 seconds.
The Unix control socket and `codex_tui.send_message_to_thread` are **local
integration details**, not a promised public OpenAI wake API. The
[official app-server protocol](https://learn.chatgpt.com/docs/app-server) documents
the surrounding initialization, discovery and read APIs. There is no route
fallback, automatic send retry, second app server or silently selected session.
Receipt acceptance proves submission, not completion of the next turn or task.

## Checks and remaining live verification

From this directory: `uv run --locked pytest` and
`uv run --locked ruff check src tests`.

This worker cannot access an interactive Codex TUI or its user systemd bus;
`codex-wake check` returned an unavailable-control-socket `OSError`. After the
user installs/trusts the snapshot, perform these checks in that TUI:

1. Have Codex launch `sh -c 'sleep 10; echo wake-parity-check; exit 7'` normally
   with `exec_command` and `yield_time_ms=1000`, then end its model turn. Confirm
   one automatic resume in the same thread, status 7 and the marker in the
   notified private log. Repeat with exit 0 and multiple background commands.
2. Let a native worker end with a final result or blocker while its parent is
   idle. Confirm one parent resume and the correct captured result; replaying
   the same child-turn event must not send again. Repeat with a busy parent and
   pending human input/approval: no forced wake or automatic answer.
3. Send a new parent prompt before completion. Confirm the command still wakes
   once after the parent returns idle. Separately interrupt before completion
   and confirm the cancelled incident cannot wake it. Check multiple observers
   across successive task-message wakes as well.
4. Run a job exceeding 600 seconds. Confirm its `codex-wake-*.service` survives
   hook exit and delivers once; inspect `journalctl --user -u UNIT` if it fails.
5. Capture hook stdin privately in an isolated test configuration: a yielded
   exec must produce no `PostToolUse` payload, whereas the final poll produces
   a Bash payload with `tool_input.command` and text `tool_response`. Verify the
   Stop/SubagentStop IDs, child ancestry and item output against that live payload.

These are integration acceptance checks, not claims already established by the
schema-derived unit fixtures. No live hooks, trust state, settings or rules were installed.
