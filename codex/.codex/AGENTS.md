Read `~/.config/agents/AGENTS.md` before starting work and apply its shared
instructions alongside this file's Codex preferences.

## Command waits

For ordinary checks that may take seconds, prefer `exec_command` with a 30-second
yield. When only waiting for an existing command, use a 30–60-second poll within
the harness's limits. Yield sooner for interactive or background work; use
completion events for long waits. These windows do not limit command runtime.

## Background task notifications

Use the `codex-wake` skill when background command completion, a timer or an
external event should resume this conversation and no native completion trigger
already does. Read the skill before launching: it covers delivery preflight,
originating-session targeting and a background process that survives ending the
turn. Bridge watch already delivers its own events; do not wrap it again.
Notifications never answer a pending question or grant approval.
