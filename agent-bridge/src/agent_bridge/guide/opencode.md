# OpenCode backend

- **Models**: `model-guide models --backend opencode --json` reports the connected service's model IDs and published variants. It is inventory, not a standalone-session or entitlement check: test a non-free model with `opencode run --standalone -m MODEL` first (see Native chat verification), and expect a Cerebras/Google/Groq model whose key lives in an environment variable to fail in a worker with "Model unavailable" until that name is opted in with `AGENT_BRIDGE_PASS_ENV`. Use the lowest variant that suits a probe; a variant list is not a default. Preserve the full requested model ID; `model-guide read subscriptions` owns free variants versus Go allowances.
- **Effort**: effort selects OpenCode's model variant (`provider/model#<effort>`); an unknown variant fails the turn with "Variant unavailable".
- **Privacy**: the free tier is limited to the zero-retention allowlist described in `model-guide read subscriptions`; read it when the choice depends on plan or retention terms. The bridge refuses any other free model and any start without `--model`. Other providers (OpenCode Go, Cerebras, Groq) follow their own terms.
- **Sandbox**: every turn requires `bwrap`; without it the runner fails closed. The filesystem is read-only except cwd and writable roots in workspace-write mode; OpenCode data is private to the job and goes with the job dir. Both modes read anywhere (OpenCode's outside-cwd check is opened; bwrap confines writes). Read-only also denies `edit`, `bash`, `webfetch` and `websearch`. A denial aborts the turn, is logged as urgent, and the worker is told to continue without it.
- **Steers** use the worker's private OpenCode server and reach an active turn at its next safe step boundary. Bridge records delivery only after the message appears in native history. `--queue` keeps a message for the next turn. Interrupt signals the active turn's process group; stop ends the runner. An unconfirmed receipt is reconciled using the same message ID on resume.
- **Sessions**: each turn owns a private server and client inside the same sandbox and resource scope. Later turns reuse the stored session ID.
- **Compact**: `agent-bridge compact <job>` starts the native compaction API for an idle session and waits for its completion or failure event. It keeps queued steers for a later resume.

## Native chat verification

For a requested OpenCode chat/model test, launch the native CLI with the requested
variant, for example:

```sh
opencode run --standalone -m opencode/deepseek-v4.1-flash-free 'Reply only OK; do not use tools.'
```

Bridge's worker runner also uses an isolated native server. A background-service API
probe tests a different execution context; its quota/auth error does not prove
that the native CLI or free variant is unavailable. Check the matching CLI
before changing providers or models. Direct session messaging still uses the
native messaging APIs described in `agent-bridge guide messages`.
