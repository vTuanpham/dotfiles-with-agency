# Native stream fixtures

`codex-interrupt.ndjson` is an authored fault schedule using the
[official JSON-RPC contract](https://learn.chatgpt.com/docs/app-server).
It puts output and a server request before an interrupt acknowledgement, with
the terminal turn event afterwards. The replay uses real pipe bytes through
Bridge's production RPC reader, preserving pending callbacks and the distinction
between request acceptance and turn completion. It launches no Codex process.

`opencode.ndjson` is an existing stream fixture; its original capture
provenance is unknown. Tests exercise both event projection and fragmented bytes
through the production runner. Neither fixture proves current live behavior.
For a versioned, read-only native metadata recording, see
[Inbox's fixture provenance](../../../agent-inbox/tests/fixtures/README.md).
