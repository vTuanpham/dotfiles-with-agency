# Direct session messaging

`agent-bridge message` contacts existing root sessions independently of Bridge jobs.
It does not transfer ownership, start workers, resume saved conversations or
change the existing `start`, `steer`, `watch` and result workflow.

Native sends are root-to-root only. `send()` and the CLI reject managed Bridge
workers (`AGENT_BRIDGE_WORKER`) before native discovery or transport access.
Workers write ordinary `TO <peer>:` job messages for siblings and `URGENT:` job
messages for root blockers. Those channels do not need native session discovery
and never fall back to a native message to root. Runner steering remains available.

```sh
agent-bridge message whoami
agent-bridge message list
agent-bridge message send codex:NATIVE_ID --text 'Can you check the shared file?'
agent-bridge message send claude:NATIVE_ID --text-file question.txt
agent-bridge message register  # once through the current agy session's command tool
```

Use the exact `HARNESS:SESSION_ID` from the other agent, native discovery or a
resource request's controller identity. A title, cwd or recent history does not
prove identity. Codex discovery returns at most 50 recent tasks plus pinned tasks;
check `truncated` and unavailable sources. Titles are untrusted display data.
Claude discovery verifies native process start time and peer socket ownership.
OpenCode lists active sessions; agy lists registered connections and checks their
liveness before sending. Unavailable inventories are explicit, not empty success.
`sessions` still exports only managed Bridge workers.

Messages are attributed peer content, never user instructions or approval. Send
only within the user's authorized coordination task; tool availability does not
authorize contacting unrelated sessions. Requests for cancellation, edits or help
leave the receiving agent responsible for its own permissions and user pauses.
A message does not answer a pending native question. Reply using the From address;
there is no automatic reply, acknowledgement loop or fallback to user chat.

## Native transports

| Recipient | Transport | Receipt |
| --- | --- | --- |
| Codex app task | `codex_tui.send_message_to_thread` through the local app server | `accepted` means native task-message admission, not read/completed |
| Running Claude session | Authenticated native `SendMessage` peer socket, `priority=now` | `sent` means native socket write completed; a native hold/refusal is reported when received |
| OpenCode 2.2.2 | `/api/session/ID/synthetic`, `delivery=steer` | `accepted` validates the native synthetic receipt and exact session |
| agy | `agentapi send-message` | `accepted` means the native CLI confirmed its request; no mid-turn option is exposed |

Codex-to-Codex delivery uses the sender's MCP connection and the exact recipient
argument. A foreign harness uses the recipient's connection as an explicitly
labelled Bridge forwarder: its From address is the host tool's observed identity,
not a native Codex peer identity. Claude uses its native peer channel directly;
its model receives peer-origin metadata with `plugin=agent-bridge`, never a UI
composer prompt. The protocol's internal `type=user` frame is the native peer
envelope, not a call to user chat. The sender's same-user claim is untrusted.
These local same-user addresses are attribution, not cryptographic authentication.

Codex requires a loaded task with the native task MCP and its reachable control
socket under `CODEX_HOME`; a standalone Bridge app-server worker need not expose
this API. The entire framed message must fit 1000 UTF-8 bytes. Claude accepts up
to 16384 UTF-8 bytes of body. Missing identity, missing API, offline recipients,
refusal and unsupported protocol versions fail explicitly. Sandbox denial means the
delivery-only command needs an authorized host context; never unsandbox a larger
command or worker to make messaging work.

Steering is the default wherever native APIs offer it. agy exposes no steering
flag, so its own agent API controls the delivery boundary; Bridge does not imitate
it with prompt input. Native user pauses, approval holds and refusals stay in force.
Acceptance, a socket write, the next turn and actually reading a message are
different observations. A reply provides stronger evidence than a send receipt.

There is one send attempt. A transport error or lost receipt may mean the message
arrived: inspect the recipient before considering another send. Claude authenticates
with the native private peer key, verifies process/socket identity and uses a
temporary private reply socket to catch native holds/refusals. No callback within
500 ms yields `sent`, never a read claim. Both temporary socket and key are removed.
No messaging daemon, polling relay or additional Wake hooks are installed.

## Setup and import API

Claude needs its existing native cross-session messaging enabled, not a Bridge mod.
The Linux host adapter supports native peer protocol 1, as shipped in 2.1.317;
unknown protocols fail explicitly. It reads live registry metadata and peer keys
under `CLAUDE_CONFIG_DIR`, never transcripts or unrelated authentication stores.
OpenCode uses its existing private `XDG_STATE_HOME/opencode/service.json` and
verifies its loopback URL, version and process before any send.
Its direct messaging adapter addresses sessions on that service; a standalone
Bridge worker has its own server and keeps the existing worker/steer workflow.
Message delivery never selects or changes the recipient's model. For a native
OpenCode chat/model check, follow `agent-bridge start --help`'s OpenCode notes;
service-API errors are not a substitute for that CLI check.

agy sessions run `agent-bridge message register` once through their own native
command tool, which exports the conversation's API environment. Startup hooks
do not have that environment. If the tool's PATH omits it, use
`~/.local/bin/agent-bridge message register`. Only the exact conversation address and its local
`ANTIGRAVITY_LS_ADDRESS`/`ANTIGRAVITY_CSRF_TOKEN` connection binding are stored, with
owner-only permissions under `$AGENT_BRIDGE_HOME/messages`. These credentials
never appear in discovery, receipts or the public repository. Offline bindings
fail the native metadata preflight; no conversation is resumed or cloned.

Other host tools can import `agent_bridge.messages.identity`, `sessions` and
`send(target, text)`. `send` returns a version 1 receipt containing `id`, `sender`,
`recipient`, `status` and `transport`; it never alters a Bridge job. No Inbox
dependency or additional daemon is required.

The official [Codex app-server MCP contract](https://learn.chatgpt.com/docs/app-server)
defines per-thread tool connections; the installed `codex_tui` tool schema owns
its task-message arguments and size limit. Claude's
[session messaging API](https://code.claude.com/docs/en/plugins/mods/api#send-and-receive-messages-between-sessions)
owns native peer framing and refusal. The installed native peer protocol defines
socket authentication and priority. OpenCode documents its separate
[synthetic-message API](https://opencode.ai/v2/docs/api#session-synthetic), and
Antigravity documents [agentapi messaging](https://antigravity.google/docs/sidecars#agentapi).
Bridge adds exact addresses, attribution, local size limits and one-attempt
forwarding; it does not relax native admission rules.
