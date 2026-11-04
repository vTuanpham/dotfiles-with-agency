# Protocol recordings

`codex-0.166.0-metadata.json` was captured on 2026-11-04 from an already-running
Codex CLI 0.166.0 daemon. The probe initialized a separate connection, then read
its own existing root with `thread/read` and `thread/turns/list` (`limit: 3`,
`itemsView: notLoaded`). It did not start, resume, steer or interrupt a turn.

This is an allowlisted projection of actual JSON-RPC responses: root/turn IDs and
the cursor were replaced; user-agent, paths, titles and unrelated metadata were
removed. Native status, ancestry, input capability and empty item views retain
their recorded types and values. No transcript or credential was recorded.
Replay uses the production connection handshake, RPC decoder and adapter.

History workloads, steering acknowledgements, turn-finished errors and lost
connections in `test_protocol_replay.py` are **authored fault schedules**, not
recordings of real model turns. They test receipt/restart semantics without
starting models. They do not establish a provider's current live capabilities.

To refresh, check the installed native version and the
[official contract](https://learn.chatgpt.com/docs/app-server), read only an
explicitly selected existing root, and apply the same allowlist before writing
a fixture. Review the result and run `python3 tests/check_public.py --changed`
from the repository root. Never copy a raw session or daemon log into this tree.
