# Codex wait-time audit

Checked 2026-11-01 against installed `codex-cli 0.166.0`, its CLI help/features,
current official documentation, versioned upstream code where the docs omit a
number, and this working tree. These are defaults, not an assertion about private
live configuration. No live Codex settings were changed. Local source line
numbers describe this audit's tree; other packages are being edited concurrently.

A **yield** returns control while work continues; a **runtime timeout** stops work;
an **RPC deadline** limits waiting for a reply; a **reminder/stall threshold** only
reports a condition. Increasing a yield does not extend a command's lifetime.
Existing external defaults were not changed. New owned hook/observer settings
and the removed PID poll are listed below.

## Codex and app-server

| Wait / timeout | Current default | Source | Fits? Recommendation |
| --- | --- | --- | --- |
| Code-mode `functions.exec` initial yield | 30 s | [config/mod.rs:1220][config] | Yes for mixed work; explicitly yield sooner for background commands. It is not a job timeout. |
| Code-mode `functions.wait` yield | 10 s | [wait_spec.rs:18][waitspec] | Yes for collecting a yielded cell; do not use repeated cell polls as an idle wake producer. |
| Unified-exec `exec_command` initial yield | 10 s; clamp 250 ms–30 s (Windows minimum 10 s) | [shell_spec.rs:27][shellspec], [unified_exec/mod.rs:66][unified] | Yes; use a short explicit yield for known background work. |
| `write_stdin`, nonempty input | 250 ms; cap 30 s | [shell_spec.rs:125][shellspec], [handler defaults:117][handler] | Yes; preserves interactive responsiveness. |
| `write_stdin`, empty poll | Omitted value 250 ms is clamped to **5 s**; maximum **300 s** | [handler defaults:117][handler], [process_manager.rs:1047][manager] | Yes as a poll window; choose an explicit longer wait only when no independent work remains and the harness permits it. “5–300 s” is a range, not a 300 s default poll. |
| Background-terminal maximum poll window | `background_terminal_max_timeout = 300000` ms, minimum 5000 ms | [config/mod.rs:4139][config] | Keep. This caps empty `write_stdin` waits; it does **not** kill a terminal after five minutes. |
| Interactive unified-exec process lifetime | No elapsed-runtime timeout in the interactive path | [preparation.rs:245][preparation] | Fits background jobs; lifetime still depends on process/session cleanup. Do not claim arbitrary detached survival. |
| Completion-only `exec_command` variant | 10 s runtime limit; terminates on timeout/cancellation | [exec_command.rs:283][oneshotspec], [preparation.rs:245][preparation] | Too short for long builds; set a measured runtime limit or use the interactive/background variant. It is a different tool mode. |
| MCP startup / per-tool call | 10 s / 60 s | [Official configuration reference][configdocs] | Keep globally; override only servers/tools known to need longer. A long-running MCP tool needs its own bounded contract. |
| Model SSE stream idle timeout | 300 s; stream interruptions default to five retries | [Official configuration reference][configdocs] | Keep. Network-idle timeout is separate from tool execution and total turn duration. |
| App-server `command/exec` runtime | 10 s unless `timeoutMs` or `disableTimeout` is supplied | [command_exec_processor.rs:189][processor], [exec.rs:63][exec] | Set explicitly for long commands. Official [app-server docs][appserver] say “server default” without the number; 10 s comes from 0.166.0 source. |
| App-server `thread/shellCommand` runtime | 1 hour; `timeoutMs` overrides | [Official app-server docs][appserver] | Reasonable for a user shell action; set a task-specific runtime when needed. This is not `command/exec`. |
| Generic app-server RPC / whole turn | No universal numeric client deadline documented | [Official app-server protocol][appserver] | Do not invent one or copy a command timeout. Clients own their request deadline; long turns use events. |
| Unsubscribed thread unload delay | 60 s | [config/mod.rs:4143][config] | Keep; thread residency is separate from command runtime or a wake promise. |
| Idle, unopened session end | 30 min; also normal close/archive/delete | [Official SessionEnd hook docs][sessionend] | Keep; unfinished background hooks are cancelled at session end. |
| Command hooks, synchronous or async | 600 s; Interrupt and SessionEnd default 1 s, maximum 3 s | [Official hook docs][hookdocs] | Set narrow limits for guards; async hook output alone cannot start an idle turn, regardless of timeout. |
| Snapshot guard hooks | Process guard 5 s; Baton guards 10 s; browser pre/stop/interrupt/end 3 s; async browser post 330 s; RTK uses the 600 s hook default | `codex/.codex/hooks.json:24`, `:29`, `:34`, `:44`, `:54`, `:67`, `:81`, `:95`, `:109` | Explicit guards fit. Recommend an explicit short RTK timeout after measuring normal startup; leave the browser's owned reminder window alone. |

Upstream references are pinned to `rust-v0.166.0`; published documentation is
rolling. A CLI tool description can also be supplied by its harness/catalog;
the installed tool schema takes precedence over a default from another release.
Native completion here emits a command event, not a documented new model turn:
see the [approach evaluation](README.md#why-this-mechanism).

## codex-wake and local clients

| Wait / timeout | Current default | Source | Fits? Recommendation |
| --- | --- | --- | --- |
| Wake socket connect, WebSocket handshake and each RPC | 15 s each (`TIMEOUT`); RPC deadline resets per call | `codex-wake/src/codex_wake/client.py:12`, `:27`, `:35`, `:59` | Keep. A send failure may mean accepted-but-unacknowledged; never automatically resend. This is not a 15 s bound on the whole preflight or job. |
| `codex-wake run` job runtime | No wrapper-imposed runtime limit; attached child and streaming log | `codex-wake/src/codex_wake/cli.py:80` | Keep only as a fallback where delivery works; never unsandbox run to fix delivery. Native terminal/session lifetime still applies. |
| Old `wait --pid` observation | Removed (previous working tree: 1 s `/proc` poll, no expiry) | [Design decision](PARITY.md#ticket-suggestions-reconsidered) | Replaced by automatic host observation of native item IDs; no agent-facing PID attachment remains. |
| Host command observer poll | Quiet backoff 2, 4, 8, 16, then 30 s; reset on progress; RPC work adds to the interval | `codex-wake/src/codex_wake/hooks.py:16`, `:17`, `:136` | One persistent connection; reads only watched item IDs and caches completed output. Ordinary prompts preserve the observer. No whole-turn scans or model polling. |
| SubagentStop native-first grace | 2 s in an async hook, then fresh parent/incident checks | `codex-wake/src/codex_wake/hooks.py:243` | Lets native completion go first without blocking the child. A parent turn changing during this grace suppresses recovery; earlier parent prompts do not. Live scheduling still needs verification. |
| New hook setup budgets | Stop 60 s; async SubagentStop 60 s; generation/start/cancel hooks 3 s | `codex/.codex/hooks.json:5`, `:10`, `:15`, `:74`, `:88`, `:102` | Bounded local setup, not job runtime. Long observation is handed to a user service; no hook timeout was disabled. |
| Observer service startup / runtime | Launcher waits at most 10 s; service RuntimeMaxSec explicitly infinity | `codex-wake/src/codex_wake/hooks.py:180`, `:182` | Fits hook handoff. The delivery-only service stops on completion/cancellation/unloaded target, without extending the command's lifetime. |
| Native idle-root manual recovery | Two unanswered native messages over at least 3 min; fresh verified idle check; one recovery wake per blocker | `codex/.codex/skills/codex-wake/SKILL.md:68` | Keep for reports that do not end a child turn. Silence/expiry never grants approval; do not wake an unknown, paused or input-blocked root. |
| Agent Inbox Codex connection / close | 5 s / 2 s | `agent-inbox/src/agent_inbox/codex.py:32` | Keep for a local socket; report failure without switching sessions. |
| Agent Inbox Codex RPC | 10 s per call | `agent-inbox/src/agent_inbox/codex_rpc.py:22` | Keep for local control/history requests; use a method-specific longer deadline only with observed evidence. No blind retry of sends. |
| Agent Inbox loaded-session discovery | 8 s loop budget, checked between RPCs (an in-flight RPC can overrun it) | `agent-inbox/src/agent_inbox/codex.py:110` | Reasonable UI budget; recommend passing remaining time to RPCs if a strict total deadline is required. |

## Bridge Codex-facing waits and resource admission (recommendations only)

| Wait / timeout | Current default | Source | Fits? Recommendation |
| --- | --- | --- | --- |
| Start/resume/steer `--watch` without a value | 1800 s; standalone `watch --timeout` defaults to no deadline | `agent-bridge/src/agent_bridge/cli.py:62`, `:379`, `:426` | Keep as background watcher windows. A native Codex watch can outlive its deadline for scheduled unread reminders; do not describe it as a job runtime limit. |
| Watch scanning / idle exit | 2 s scan; five idle observations before exit | `agent-bridge/src/agent_bridge/watch.py:334`, `:343`, `:356` | Keep; bounded process polling rather than model polling. Preserve the existing native delivery; never wrap it in a second wake. |
| `AGENT_BRIDGE_ROOT_WAIT` | 20 min, then conservative auto-steer; maximum two automatic answers | `agent-bridge/src/agent_bridge/cli.py:124`, `:146` | Duration fits a root response window. Recommend explicit blocked/report behavior for required decisions; an elapsed timer must not manufacture authorization. |
| Codex question inbox | 120 s, then fills missing answers with “proceed using your best judgment” | `agent-bridge/src/agent_bridge/codex.py:30`, `:306`, `:346` | Too short for required human decisions. Recommend optional questions use an explicit pre-authorized fallback; required input remains pending with a reminder. A bigger number alone does not fix the policy. |
| Group completion settle window | 60 s | `agent-bridge/src/agent_bridge/status_model.py:206` | Keep for batched completion policies; not a delay on every default `wake=each` event. |
| Unread-result reminder | 900 s; repeat disabled by default; enabled repeats double up to a one-year cap | `agent-bridge/src/agent_bridge/status_model.py:207`, `:209`; `groups.py:18`, `:401` | Keep 15 min and default single reminder; repeats should be explicitly selected. |
| Silence stall / busy-process allowance | 15 min; busy multiplier 3 → 45 min | `agent-bridge/src/agent_bridge/assessment.py:5`, `:13`, `:23` | Keep as informational thresholds. Busy CPU alone does not prove progress. |
| In-flight long-command notice | 10 min | `agent-bridge/src/agent_bridge/assessment.py:6`, `:39` | Keep as a one-time notice, not a kill or stall verdict. |
| Declared wait / grace / maximum declaration | Default 20 min; grace ×1.25 → 25 min; maximum 2 h | `agent-bridge/src/agent_bridge/assessment.py:7`–`:9`; `:31` | Keep explicit estimates and the grace factor; check the awaited condition when overdue instead of assuming failure. |
| Pace slowdown | Five recent versus ten baseline samples; recent step ≥ max(60 s, 5× baseline) | `agent-bridge/src/agent_bridge/assessment.py:14`–`:15`, `:50` | Keep informational; no automatic task restart based on pace alone. |
| Bridge Codex JSON-RPC call | 300 s nominal reply deadline | `agent-bridge/src/agent_bridge/codex.py:120` | Broad for short control RPCs. Recommend method-specific deadlines and an absolute deadline check: continuous unrelated events or partial-line input can currently extend the nominal bound. |
| Bridge Codex event/inbox/root-loop tick | 0.2 s | `agent-bridge/src/agent_bridge/core.py:15`; `codex.py:250`; `agent-bridge/src/agent_bridge/cli.py:163` | Keep for steering/stop responsiveness; not a model turn or timeout. |
| Bridge Codex teardown / account discovery | 10 s after TERM, then 10 s after KILL / 20 s discovery | `agent-bridge/src/agent_bridge/codex.py:143`, `:150`, `:159` | Keep bounded cleanup; account lookup may be slow but does not justify extending every control call. |
| Resource queue escalation report | 30 min **unpaused** waiting; dead holder reported immediately | `agent-resources/src/agent_resources/heavy.py:411` | Keep. Root pauses neither fail work nor consume that threshold. |
| Resource queue polling / status output | 1 s poll; normally 30 s reports, changed state no more often than 5 s | `agent-resources/src/agent_resources/heavy.py:417`, `:421` | Keep; processes can wait quietly without spending model turns or sending routine coordinator messages. |

No Bridge, Agent Inbox, resource-admission or shared instruction files were
changed. The question-expiry and root-wait recommendations concern behavior,
not just timer length. The owned 15 s wake client remains unchanged; the old
1 s PID poll was deleted rather than tuned. New observer waits are owned here.

[configdocs]: https://learn.chatgpt.com/docs/config-file/config-reference
[appserver]: https://learn.chatgpt.com/docs/app-server
[hookdocs]: https://learn.chatgpt.com/docs/hooks#run-hooks-in-the-background
[sessionend]: https://learn.chatgpt.com/docs/hooks#sessionend
[config]: https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/config/mod.rs
[waitspec]: https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/code_mode/wait_spec.rs#L18
[shellspec]: https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/handlers/shell_spec.rs#L27
[unified]: https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/unified_exec/mod.rs#L66
[handler]: https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/handlers/unified_exec.rs#L113
[manager]: https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/unified_exec/process_manager.rs#L1047
[preparation]: https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/handlers/unified_exec/preparation.rs#L245
[oneshotspec]: https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs#L283
[processor]: https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server/src/request_processors/command_exec_processor.rs#L189
[exec]: https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/exec.rs#L63
