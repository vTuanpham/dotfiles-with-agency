# opencode

[← Packages](../README.md#packages) · **Snapshot + live** · `./install.sh --apply snapshots links`

OpenCode's user config under `~/.config/opencode`.

The installer restores OpenCode 2.2.2 from its official V2 installer, matching
the inbox adapter's verified protocol.

- `AGENTS.md`: **live**, appendable OpenCode preferences.
- `cli.json`: interface preferences (word-wrapped diffs, no sidebar). A snapshot.
- `opencode.jsonc`: loads shared instructions via the native
  [`instructions` field](https://opencode.ai/docs/rules/#custom-instructions).
  No model or provider is pinned here. A snapshot.
- `plugins/agent-process-guard.js`: **live**, a native OpenCode 2 before-tool
  plugin (OpenCode 2.2.2+) that calls the shared [process guard](../shell/README.md#agent-process-matching)
  for `shell` commands. Native-child shell calls export the root controller,
  child session ID and worker restrictions to their command and descendants,
  including compound commands and scripts that call `agent-resources`. An enclosing
  Bridge controller is preserved. Root sessions and ordinary history forks retain
  their environment. The plugin is discovered automatically under the global plugin
  directory.

Resource attribution reads the tool hook's session ID and follows verified
[`parentID` ancestry](https://github.com/anomalyco/opencode/blob/v2.2.2/packages/core/src/tool/plugin/subagent.ts),
with a three-second deadline and at most 32 sessions. Missing, malformed or cyclic
ancestry rejects that shell call instead of guessing a controller. Ordinary
[forks have separate history metadata](https://github.com/anomalyco/opencode/blob/v2.2.2/packages/core/src/session/projector.ts)
and no native parent. The [native shell creates a fresh process per call](https://github.com/anomalyco/opencode/blob/v2.2.2/packages/core/src/shell.ts),
so the export prefix changes neither the plugin process environment nor another
agent's shell. The command keeps its own working directory and exit status.
Commands that explicitly clear their environment must preserve attribution themselves.
These labels describe local command reservations, not model-loop RAM or an agent memory cap.

`bun test tests/test_process_guard_plugin.test.js` checks resource attribution,
worker boundaries and process guarding without starting model sessions.
OpenCode [reloads watched config changes automatically](https://dev.opencode.ai/v2/docs/plugins#reload).
A linked source outside watched directories may need a native reload or a new
service instance; an installed link alone does not verify the active revision.

Shared skills, including `python-project` and the adapted
[engineering skills](../agents/README.md#engineering-skills), are discovered from
`~/.agents/skills`. They use available native tools and load only for relevant
tasks; no separate copy of their workflows belongs in the global instructions.

`agent-bridge` runs OpenCode workers confined by `bwrap`. Its free-tier admission
is limited to reviewed zero-retention routes; Go and external provider routes keep
their own billing and privacy terms. Read `model-guide read subscriptions` when
those terms affect a choice.
