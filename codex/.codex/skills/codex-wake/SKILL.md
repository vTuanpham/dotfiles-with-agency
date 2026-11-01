---
name: codex-wake
description: Codex host-hook task notifications, explicit event delivery, and recovery of a native worker blocked on an idle parent. Use for background wake delivery or diagnosis; Bridge watch owns its own notifications.
---

# Codex task notifications

With the trusted snapshot hooks installed, launch background commands normally,
continue independent work, then end the turn when only the event remains. The
host `Stop` hook captures outstanding native command items and arranges delivery;
`SubagentStop` can recover an idle verified parent once per child turn. No wrapper,
hand-written message, PID or terminal handle is needed for these notifications.
This is event delivery, separate from Claude's visual Wake mod.
Verify installation/trust and live acceptance before relying on this path;
repository snapshots alone do not arm a wake.

| What will finish | Producer |
| --- | --- |
| Native completion already proven to resume this idle session | That native trigger |
| A background command or one-shot condition/timer command | Normal Codex exec; installed host `Stop` hook observes its native item |
| A native worker ending its turn | Native delivery first; installed SubagentStart/SubagentStop hooks recover an idle verified parent |
| An event producer or an assigned logical result (analysis done, blocked) | `codex-wake send --message TEXT` once, at that boundary |
| Bridge jobs | Bridge watch; do not wrap it again |
| An unplanned worker blocked on an idle root | The recovery procedure below |

"Proven" means the idle session actually resumed, not that a message was queued.

```sh
codex-wake send --message "Analysis done: 2 failures need a decision. See notes.md."
```

Read the private output file named in the notification. Its native captured text
can already be truncated by Codex. A command finishing, the notification
being accepted, the next turn starting and the logical task being done are four
separate observations. A worker told to report at a logical boundary sends once
there; that is a planned handoff, not the recovery procedure below. At delegation,
record the verified parent thread, the command handle/log, the expected event and
who acts next.

The observer uses native item identity, not an OS PID; `wait --pid` was removed.
Interrupt/session-end hooks pause delivery. Ordinary prompts preserve existing
observers across turns; a parent prompt after a pause starts a new generation.
Respect the interrupt control and any user pause. Do not infer permission
from a timeout. Async hook stdout alone cannot start an idle turn: these host
hooks call the existing task-message channel. Bridge watch and explicit `run`
producers must keep sole ownership of their notification.

If the hooks are unavailable, `codex-wake run -- COMMAND` is a fallback only in
an already-authorized context where delivery works. `--message` is optional;
it tees output to a temporary log. **Never escalate `run` out of the sandbox**:
that would unsandbox its arbitrary wrapped command. The agent-facing default
is normal sandboxed exec plus the trusted host hook. Retain a terminal handle
only to interact with or cancel a running command.

Explicit CLI producers default to the originating `CODEX_THREAD_ID` and `CODEX_HOME`.
Use `--thread`/`--home` only for an explicitly intended different target. `run`
notifies on success or failure; an existing event producer can call `send`.
Explicit producers preflight delivery; `check` diagnoses availability without
sending. A `PermissionError` means the sandbox cannot reach the control socket:
use the host hook or an authorized delivery-only call, never escalate `run`.
On delivery failure, inspect the command's outcome before retrying: it may already
have executed. A notification does not resolve a blocking
question or grant approval.

## Native worker blocked on its root

Use native collaboration messages first and continue independent work. If blocked
after two unanswered messages spaced over at least three minutes:

1. Identify the root from native spawn/parent metadata or the root's explicit
   brief. An inherited `CODEX_THREAD_ID`, a title or the newest thread is not proof
   of parentage. Do not choose another session when identity cannot be verified.
2. Read that exact root through the native task MCP's `read_thread`, keeping
   history/output bounded. Immediately before sending, confirm its reported
   status is `idle`. Silence is not an idle check; `active`, `notLoaded`, errors
   and unknown states do not qualify. Respect a user pause and pending human input
   or approval.
3. Use the same MCP's `send_message_to_thread` once, with the verified root's
   `threadId` and a short `prompt` identifying the worker, blocker and requested
   decision. Omit model overrides. This is the native task channel used by
   `codex-wake`; no separate wake process is needed inside the harness.
4. Verify the returned target and return to native messages/waits. Send at most
   one recovery wake per unresolved blocker; an uncertain receipt is not a reason
   to duplicate it. This never answers a question or grants approval.

For installation, producers and compatibility details, see
`~/dotfiles-with-agency/codex-wake/README.md`.
