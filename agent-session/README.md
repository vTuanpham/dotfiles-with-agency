# agent-session

[← Packages](../README.md#packages) · **Library** (editable dependency, no CLI)

One answer to "which conversation is calling?", shared by Bridge, Baton, Resources and Lab.

```python
import agent_session

agent_session.native()  # ("claude", "<session id>"), ("codex", …), ("agy", …), ("opencode", …), or None
```

A process can inherit an enclosing session's variables: Claude Code started from a Codex
terminal still sees `CODEX_THREAD_ID`. The running harness's own marker therefore wins:

| Order | Harness | Variables |
| --- | --- | --- |
| 1 | Claude Code | `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID` (the session is `None` when Claude hides it) |
| 2 | Antigravity | `ANTIGRAVITY_CONVERSATION_ID` |
| 3 | Codex | `CODEX_THREAD_ID` |
| 4 | Declared (e.g. OpenCode) | `AGENT_BRIDGE_ROOT_HARNESS`, `AGENT_BRIDGE_ROOT_SESSION` |

A bare `CLAUDE_CODE_SESSION_ID` without `CLAUDECODE` is an inherited ID, not a Claude
session. Empty means unknown; whitespace, control characters or more than 200 characters
raise `ValueError` instead of falling through to another identity.
`environment(harness, session)` is the inverse, for tools that launch a child as a given
session; `VARIABLES` lists everything to drop first.

Tool-specific policy stays with each tool: Baton's `AGENT_BATON_SESSION`, Resources'
`AGENT_RESOURCES_OWNER`, a Bridge worker's own job, Lab's `/proc` lookup when Claude hides
its ID, and each tool's stored identity format.

Installed through its consumers (`install.sh` passes `--with-editable`). Checks:
`uv run --locked pytest` and `uv run --locked ruff check src tests`.
