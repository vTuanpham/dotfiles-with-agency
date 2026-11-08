# agy backend (Antigravity CLI)

- Read `model-guide models --backend agy` for native IDs; use task evidence and actual account constraints for selection. Native inventory is distinct from Bridge's existing GPT-OSS policy exclusion.
- Quota observations retain native bucket IDs, window periods, reset times and reported model membership. A provider group name, equal percentages or matching resets do not establish shared membership or model access.
- Accounts are isolated under `~/.agy-accounts/<a>/`; the user signs in new accounts from a terminal.
- Bridge reads the selected thinking level from the native ACP session configuration.
- **Compact**: `agent-bridge compact <job>` resumes an idle session, discovers ACP's compact command and confirms a new native checkpoint before reporting success.
- Both modes read anywhere. workspace-write may write the cwd plus writable roots and run commands confined by agy's sandbox, with no network. read-only denies writes and commands.
  - Network or more commands are opt-in through agy's allow rules; deny beats allow.
  - A denial is logged as urgent, and the worker is told once to continue without it.
- Bridge uses AGY's [ACP steering](https://antigravity.google/docs/ide/extensions/acp/) to send a prompt during an active turn. `--queue` holds it for the next turn. The native echo confirms delivery; if the connection fails before confirmation, inspect the session before retrying. Interrupt ends the active turn. Conversation state is isolated per job and removed with the job.
- Quota out: the worker stays on its selected account. An account change requires an explicit resume with `--account`.
- Waiting costs quota: agy backgrounds long commands and repeated polling can spend model requests. The runner checks the native transcript when available and raises an urgent `quota_burn` after sustained requests without streamed activity. Briefs should keep agy workers off long benchmarks; the runner tells them to hand such a command to the coordinator and end the turn.
