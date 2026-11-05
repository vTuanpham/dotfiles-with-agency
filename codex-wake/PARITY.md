# Claude Code → Codex wake parity

Contracts target installed Codex **0.166.0** and its official documentation.
Implementation, schema-derived tests and live acceptance are separate checks.
Native idle command delivery has been observed; final polls with exit 0 and 7
also verified the trusted collection hook and retirement without another send.
The remaining live checks are listed below.

## Parity matrix

| Claude Code source | Codex native equivalent | Gap | Proposed hook/mechanism | Status |
| --- | --- | --- | --- | --- |
| [Background Bash completion](https://code.claude.com/docs/en/tools-reference#background-commands): status and captured-output file | Unified-exec terminal and command item completion events | No documented automatic idle model turn; no yielded-exec PostToolUse payload | Host `Stop` captures outstanding native items. A transient delivery-only observer reads completion/output and sends one native task notification with status and a private log path. | Implemented in snapshot; live acceptance pending. Native captured output can be truncated. Commands finishing before Stop need no new idle wake and are not separately re-notified. |
| [Background subagent completion](https://code.claude.com/docs/en/sub-agents) returns its result | [Codex native subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), collaboration messages, SubagentStart/SubagentStop | Ticket evidence shows final/blocker reports can leave both worker and parent idle | Capture launch generation; async SubagentStop gives native delivery two seconds, then verifies ancestry, child turn, unchanged parent turn during that grace period and fresh idle before reporting once. Earlier user turns do not invalidate the result. | Implemented in snapshot; genuine parent/child payload and idle-resumption check pending. No forced wake of active/input-blocked/paused parents. |
| [Async hooks with `asyncRewake`](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background): exit 2 can wake idle Claude | Codex async command hooks and later informational context | Async stdout alone waits for a user turn; no public HookCompleted hook to attach another wake universally | A hook that owns an actionable event calls `Wake.send` itself from the host. Keep its cancellation/dedupe local. | Shared client available; arbitrary third-party hooks were not wrapped. Rewaking on every hook would create loops and duplicate notifications. |
| [Monitor](https://code.claude.com/docs/en/tools-reference#monitor-tool), [scheduled wakeups and cron](https://code.claude.com/docs/en/scheduled-tasks) | Background one-shot condition commands / `sleep`; desktop local scheduled tasks are a separate feature | No documented CLI Monitor or universal per-session cron-completion hook | A one-shot watcher/timer uses normal background exec and Stop observation. Continuous/recurring producers explicitly send selected events, or use a separately authorized native desktop schedule. | One-shot path implemented; continuous streaming and recurring cron remain recommendations. No polling daemon/catalog/scheduler was added. |
| [Team/session messages](https://code.claude.com/docs/en/agent-teams) arrive without manual polling | Native collaboration/task-message channel; Bridge watch for Bridge jobs | No public Codex Notification/TeammateIdle event to intercept all messages; a blocker posted during a still-active child turn has no SubagentStop | Native delivery first; SubagentStop for a reporting turn boundary; existing fresh-idle native recovery once per unresolved blocker; explicit host producer for unrelated external sessions | Boundary recovery implemented; mid-turn and unrelated-session message interception not implemented. No guessed parent or newest-session fallback. |

No path treats a notification, timeout or silence as human input or approval.
The four observations remain distinct: command/result ready, delivery accepted,
next parent turn started, logical task finished.

## Supported Codex hook inventory

The [official hook reference](https://learn.chatgpt.com/docs/hooks) describes these
12 events for the installed release. Match Bash for shell/unified-exec tools;
`exec_command` is not a separate hook event. The
[0.166.0 unified-exec output implementation](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/context.rs#L471)
omits PostToolUse whenever `process_id` is still set. A final `write_stdin` can
emit the original Bash command's PostToolUse with text output. There is no
documented background launch PID, stable output-file path or exit status to
extract from an initial yielded PostToolUse payload, because that payload is absent.

| Event | Relevant published input | Can it carry a wake? / snapshot choice |
| --- | --- | --- |
| SessionStart | `session_id`, source (`startup`, `resume`, `clear`, `compact`, `fork`) | Can set context; waking at startup would loop. No new wake handler. |
| SessionEnd | `session_id`, reason | Session ending is a cancellation boundary, not a request to restart it. New handler pauses the generation. |
| UserPromptSubmit | `session_id`, `turn_id`, prompt; child context may include `agent_id` | Ordinary prompts preserve ongoing observers. A parent prompt starts a fresh generation only after Interrupt/SessionEnd paused delivery; child prompts never resume a paused parent. |
| PreToolUse | canonical tool name, tool-use ID, tool input (`command` for Bash) | Runs before knowing whether exec will yield. Rewriting every command changes semantics and can bypass checks; not used for arming. |
| PermissionRequest | tool name/input, active turn | Can control an approval. No wake handler; never auto-answer or turn a wake into approval. |
| PostToolUse | tool name/use ID, input, result | Unified exec omits it while running. A final Bash result carries the original command ID; the synchronous handler retires that command's observer. Existing browser hooks remain. |
| PreCompact | trigger (`manual`/`auto`), turn | Context maintenance; no new wake handler. |
| PostCompact | trigger, turn | Context maintenance; no new wake handler. |
| SubagentStart | parent session context, `agent_id`, `agent_type`, turn | Records generation only; no wake. |
| SubagentStop | agent ID/type, transcript path, last assistant message, turn, `stop_hook_active` | New async handler lets native delivery go first, verifies actual parent metadata and unchanged parent turn, checks fresh idle, then reports once per native child turn. A report is not a promise that all child work is complete. |
| Stop | current session/turn, last assistant message, `stop_hook_active` | Synchronous host handler reads running-terminal metadata in at most four 32-entry pages and registers each native item once. It launches an observer without scanning turn history. |
| Interrupt | main session/turn | New handler cancels prior incidents. No restart or wake. |

All share session/cwd/model/transcript metadata. The transcript is explicitly an
unstable format, so the implementation reads targeted native command items and bounded terminal metadata,
not transcript files or process listings. Subagent ancestry is confirmed through
the actual child's `parentThreadId`, not inferred from an inherited environment
variable or the newest thread.

`Notification`, `TaskCompleted`, `TeammateIdle`, a background-shell-completed
event, and a hook-completed event are **not in this published Codex inventory**.
Internal source types or under-development feature flags do not establish a
supported installable event. No such event was invented in the snapshot.

## Lifecycle, safety and remaining limits

- Hook processes are host processes in 0.166.0: see the
  [host command runner](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/engine/command_runner.rs#L280).
  They observe/deliver; they never receive a user command to execute outside its sandbox.
- Hook timeout is seconds: most default to 600; Interrupt and SessionEnd default
  to 1 and support at most 3. The installed Stop/SubagentStop setup budget is 60.
  [Async hooks do not remove those limits](https://learn.chatgpt.com/docs/hooks#run-hooks-in-the-background).
  A transient user service carries long observation beyond hook lifetime.
- Interrupt and SessionEnd invalidate old generations. Ordinary prompts preserve
  command observers and worker incidents across turns. A pending approval/input
  keeps the target active, which is ineligible for forced delivery. Already
  unloaded/failed targets are never resumed by the observer. Cancellation and
  sends use fresh checks, but the native task API has no atomic “send only if
  still idle and unpaused” operation; a final cross-process race cannot be eliminated here.
- Persistent per-incident claims prevent repeat sends, including after uncertain
  receipts. Native delivery and actual model work remain independently observable.
- Bridge workers, existing Bridge watch and explicit run producers are excluded. A completion
  producer hidden inside an arbitrary shell script cannot be recognized from
  command text; avoid combining it with automatic observation.
- Observer reads keep one connection open, request only watched native IDs, cache
  completed output, and back off quiet polls from 2 to 30 seconds. The versioned
  [`thread/items/read` contract](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1875)
  requires a turn and explicit item IDs. One output-bearing item per request
  stays within the client's response cap even when control characters expand in JSON.
  Stop's metadata page budget is separate from the number of historical turn items.
- The [event API](https://learn.chatgpt.com/docs/app-server#events) streams after
  starting/resuming a thread. The [0.166.0 request inventory](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server-protocol/src/protocol/common.rs)
  exposes no passive subscription operation. Read-only targeted polling avoids
  resuming an unloaded thread or changing its configuration merely to observe it.

See [installation and the five live acceptance checks](README.md#checks-and-remaining-live-verification).
The recommended native long-term fix is a harness-owned completion/task event
that starts an idle turn with captured output and exposes cancellation/origin
metadata. That would remove this host observer, as Claude's native task channel
removes the need for a per-command wrapper.

## Ticket suggestions reconsidered

| Earlier suggestion | Decision and reason |
| --- | --- |
| Wrap each command with run at launch | Replaced as the default: ordinary sandboxed exec plus a host Stop hook avoids both forgotten arming and the control-socket boundary. `run -- COMMAND` remains a small explicit fallback where delivery already works; its message is now optional and output is teed to a log. |
| Add `wait --pid` to attach later | Dropped with its implementation/tests/docs. Automatic Stop capture uses native command identity, so no agent must retain an OS PID, resolve namespaces, observe PID reuse or guess an exit code. |
| Improve PermissionError diagnostic | Kept the explanation, replaced the unsafe next action. It now routes to host hooks or authorized delivery-only send/check, and expressly rejects escalating run. |
| Distinguish observer completion from job success | Kept. Native command status is read from the item; missing exit code says unknown. Worker report, accepted delivery and logical task completion remain separate. |
| Wake a verified idle parent once after lost native messages | Automated for SubagentStop, with start-generation, actual ancestry, fresh-idle and incident checks. Kept bounded manual native recovery for reports without an ending child turn. |

The feedback informed reproduction and acceptance cases; it did not determine
the design or authorize unrelated changes.
