# Claude hooks (live)

## RTK and auto review

`rtk.py` delegates to `rtk hook claude` only in known permission modes without
the auto classifier. Auto mode, plan mode (which can use that classifier), and
missing or unknown modes leave the command untouched. Use explicit `rtk` commands
in those modes, following the shared shell filtering guidance.

This avoids [invalidating review of the original input](https://code.claude.com/docs/en/hooks#pretooluse-updatedinput-in-auto-mode),
including denials of sibling tool calls. The wrapper never grants permission,
denies a command, or retries it. `install.sh --apply links hooks` installs the live
wrapper and replaces only the former managed `rtk hook claude` Bash entry in Claude
settings, preserving local settings and Codex's native RTK hook.

## Native resource reservations

`resource-context.py` uses [SubagentStart](https://code.claude.com/docs/en/hooks#subagentstart)
to give each child its root owner and agent ID as context. The child must export these values
in each Bash call that invokes `agent-resources`; this also covers nested scripts. The hook
does not change commands or enforce attribution, and omitted exports leave requests unattributed.
Install its link and hook with `./install.sh --apply links hooks`.

## Process matching

The shared [process-match guard](../../../shell/README.md#agent-process-matching)
rejects self-matching `pgrep`/`pkill` patterns before Bash executes. It is owned by
the shell package and also used by Codex; it is separate from the root Stop hook.

## Root stop safety net

`bridge-stop.py` is linked to `~/.claude/hooks/bridge-stop.py` by
`install.sh --apply links`. SessionStart and Stop entries are merged from the
settings snapshot by `install.sh --apply hooks`; installation is explicit.

SessionStart exports the native session ID through Claude's `CLAUDE_ENV_FILE`.
Bridge records it with the owner's next root command. Stop reads
`agent-bridge status --json --no-quotas`, selecting those owners. With running
workers or unread completions and no kernel-locked root watch, it asks once to
arm a watch or acknowledge results. Private session-scoped pending-set hashes
prevent loops and survive restarts. The hook never starts workers or sends messages.

Subagent events, worker environments, stop-hook continuation, pending native
AskUserQuestion calls and question-like closing text allow stopping. All errors,
incomplete status, missing inputs and timeouts also allow stopping. Existing
sessions can resume after installation so SessionStart supplies their ID.

Disable for a session: `AGENT_BRIDGE_STOP_GUARD=0 claude`.

Contracts: [Stop](https://code.claude.com/docs/en/hooks#stop) and
[SessionStart environment](https://code.claude.com/docs/en/hooks#persist-environment-variables).
Codex/agy roots explicitly arm `agent-bridge watch OWNER --until-event` or poll
`agent-bridge status --json` about every ten seconds.
