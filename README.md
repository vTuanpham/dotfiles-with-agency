<h1 align="center"><img src="docs/images/hero.gif" alt="Dotfiles with agency: a workspace where AI agents work together, hand off to you when it matters, and a small town grows above your prompt. Four animated pixel landscapes from Wake, and cards for Wake, Bridge, Baton and install.sh." width="100%"></h1>

<p align="center">
<a href="#why-use-it">Why use it</a> · <a href="#wake">Wake</a> · <a href="#codex-tasks-that-wake-you">codex-wake</a> · <a href="#agent-tools">Agent tools</a> · <a href="#built-in-guardrails">Guardrails</a> · <a href="#setup">Setup</a> · <a href="#packages">Packages</a>
</p>

A working environment for people who run several coding agents at once. Codex, Claude Code, Antigravity
and OpenCode share one set of instructions, skills and tools, so they can delegate to each other, ask you
questions on your phone, wake you (and each other) when work finishes, and show what they are doing without
you reading a transcript. Each tool is a small CLI or mod: take one, or all of them.

```sh
git clone https://github.com/vTuanpham/dotfiles-with-agency ~/dotfiles-with-agency && cd ~/dotfiles-with-agency
./install.sh            # preview only: nothing changes
./install.sh --apply    # then apply the steps it listed
```

[Setup, restore details and checks](docs/setup.md) · WSL2 Ubuntu is the tested platform.

## Why use it

| You get | What it does that is hard to get elsewhere |
| --- | --- |
| **[codex-wake](codex-wake/README.md)** | Codex finishes a background task or a subagent and **wakes the idle conversation by itself**: end your turn and the result arrives. `codex-wake monitor` watches a condition for a while and wakes it on each hit, with a cooldown so it never spams and a hard time limit so it never lingers. |
| **[Wake](claude/README.md#wake-mod-live)**, a Claude Code mod | A pixel town above the prompt that is the session's live state: eight places, weather and time, a building that rises with each turn, and a crew of real workers that arrive, message each other, react and leave, each in its own way. Plus per-harness quota, effort inferred from what each model supports, and hover cards on everything. |
| **[Agent Bridge](agent-bridge/README.md)** | A Codex root can hand a job to Claude, Antigravity or OpenCode (and the reverse). Jobs persist, can be watched and steered live, message each other (`TO <peer>:`), survive a root change (`handoff`), and archive when finished. It notices when a runtime silently swaps a worker's model. |
| **[Agent Baton](agent-baton/README.md)** | The agent asks; you answer from a Windows toast or your phone. For passwords, 2FA and API keys the value goes straight into the field or env file and **never reaches the agent or its transcript**. |
| **[Agent Inbox](agent-inbox/README.md)** | Your existing Codex, Claude Code and OpenCode conversations on your phone: chat, images, tool steps, pending questions and native `/` commands, over Tailscale. |
| **[Model Guide](agent-models/README.md)** | Picks nothing for you, and says why. It reads the live native model lists, then compares eleven public leaderboards (Arena, LiveBench, Vals, SWE-bench, OSWorld, BFCL, LiveCodeBench, KernelBench, Bug Hunt and more) **per effort level and per harness**, in plain code. |
| **[Portlink](portlink/README.md)** | `portlink open 3000` gives a private, expiring HTTPS link and QR to a local app, build folder or file, for your phone. |
| **[agent-resources](agent-resources/README.md)** | Kernel-lock admission for heavy commands, so five agents do not run five test suites at once. Released automatically when the process exits. |
| **[agent-accounts](agent-accounts/README.md)** | Cached, address-free quota and freshness across Codex, Claude Code and Antigravity accounts, with remaining allowance rounded down. |
| **[agent-lab](agent-lab/README.md)** | Persistent experiment folders outside your repos, with creator and run provenance and guarded cleanup after retirement. |
| **[agent-session](agent-session/README.md)** | One answer to "which conversation is calling?", correct even when Claude Code is started inside a Codex terminal. |
| **[Feedback loop](agents/feedback/README.md)** | Agents file a ticket when a tool gives them trouble, with harness version and session ID attached. Tickets are worked to a root cause and closed, never deleted. |

## Wake

**[Wake](claude/README.md#wake-mod-live)** puts the session, its workers and account quota above the
Claude Code prompt. The landscape is not decoration: every sprite is a fact about the session.

<img src="docs/images/wake-dock.gif" alt="Wake's harbor scene animating above the session's activity, crew and account quota rows, a prompt and the Claude Code status line. Call-outs name what each sprite is: street lamps are plan steps, a boat is a Codex worker, a kite (here; each place has its own creature) is a Claude subagent, a constellation is an agy worker, a comet is a message in flight, the rising building is the current turn and Mochi shows the session's mood. Notes under the crew rows name their parts: the round harness logo with its own spinner, effort dots from the model's own levels, a peer lane that lights when one worker messages another, and the root graph where a message to the root travels up and the quota line below is tinted per harness." width="100%">

- **Crew that works.** Each worker patrols its own patch of sky or sea in the sprite of its harness and
  model class, and a Codex worker is whatever its place would build: a saucer in the city, a steamship at
  sea, a paraglider in the mountains, a ski plane in the tundra, while Claude's subagents are the winged
  creature of the place: a pigeon in the city, a kite on the beach, a butterfly in the fields, an owl in the
  forest. A message between two workers is a comet
  with a short, quickly fading tail, drawn behind the scene, and the same message lights the peer lane and
  the root graph in the rows below. Nothing moves once the job is idle.
- **Crew that reacts.** When a message lands the receiver lights up and the sender pulses, each harness in its
  own way, and a gadget pops out of the root's head to catch a message: a dish, radar whiskers, an ear
  trumpet or rabbit-ear antennae, depending on which of four characters you chose (`/wake mochi`).
- **Crew with a life.** A worker arrives when its job starts and leaves when it is done, in its own way for
  every harness and every place: a saucer that warps in and hyperdrives away, a boat that sails for the
  horizon, a balloon that pops into petals or bubbles.
- **Honest rows.** Quota is coloured per harness, effort is shown as dots inferred from each model's
  supported levels, and every item (effort, time, memory, stall reason) has a hover card.
- **Eight places** that follow time, weather and session state: success, failure, waiting and sleeping all
  change the scene, with fireworks, storms, shooting stars, lanterns and rainbows for the milestones.

<img src="docs/images/wake-characters.gif" alt="Four characters stand where Mochi does, each catching a message from a worker in its own way: Mochi raises a satellite dish between her ears, Tabby's whiskers turn to radar, Tuxedo unfolds an ear trumpet and Bun's ears stretch into antennae with TV static between them." width="100%">

<img src="docs/images/wake-passages.gif" alt="A grid of eight landscapes by four worker families. Each cell loops a worker arriving, working and leaving: the city saucer warps in and hyperdrives away, harbor boats sail off to the horizon, mountain paragliders spiral up a thermal, countryside biplanes roar off, forest autogyros come apart into leaves, desert skiffs kick up dust and tundra ski planes lift off into aurora glitter. Claude's creature, agy's sparks and OpenCode's balloon end differently in each place too." width="100%">

[Characters, arrivals and exits](claude/README.md#characters-arrivals-and-exits) ·
[Scene, crew and quota legend](claude/README.md#crew-and-quota-rows).

<img src="docs/images/wake-landscapes.gif" alt="Eight animated Wake landscapes: city at work, harbor awaiting input, beach with workers, mountains with fireworks after passed tests, countryside with a rainbow after tests pass again, rainy forest after a failure, desert with a shooting star after a completed job, and sleeping winter tundra." width="100%">

[Landscapes, time, weather and session state](claude/README.md#landscapes-and-session-state).

## Codex tasks that wake you

<img src="docs/images/codex-notifications.gif" alt="A background command or native subagent runs in Codex's sandbox. When the turn ends a host-side hook hands it to an observer, which waits for the conversation to be idle and wakes it once with the result. codex-wake monitor feeds the same observer a bounded stream of hit lines, limited by a time window, a cooldown and an event cap." width="100%">

Codex does not wake a conversation when a background command or a subagent finishes. **[codex-wake](codex-wake/README.md)**
does: host lifecycle hooks, outside the command sandbox, watch what you left running and deliver one native
message to the same conversation when it ends, with the exit status and a private log path. Nothing is
escalated out of the sandbox, a notice never answers a question or grants an approval, and an uncertain
delivery is never retried.

```sh
# launch anything in a background terminal, end your turn, and the result arrives
# or watch a condition for a while: a file, a service, a count
codex-wake monitor --every 10s --ttl 30m --cooldown 5m --max-events 5 -- test -f build/ready
```

The monitor is the spam-proof version of a poll loop: it runs a probe on an interval, and the host hook wakes
the session on a hit at most once per cooldown (hits in between are counted and joined to the next notice),
at most `--max-events` times, never past the time limit (24 h at most), and with a closing notice when it ends.
`--distinct` announces only a changed answer. [How it works, limits and live checks](codex-wake/README.md#monitoring-a-condition-for-a-while).

## Agent tools

<img src="docs/images/agent-tools.gif" alt="Inbox carries chat and controls; Baton carries questions and secrets; native delegation and Bridge connect workers. Shared model, account, resource and lab tools support the session." width="100%">

### Delegate across harnesses

<img src="docs/images/agent-bridge-flow.gif" alt="The root briefs workers across four harnesses, then reads their persistent job state to handle blockers and verify results." width="100%">

Hand a job to the model that is best for it, watch it, steer it, and let workers message each other.
[Agent Bridge](agent-bridge/README.md) · [Model selection](agent-models/README.md).

### Model selection that shows its work

<img src="docs/images/model-selection.gif" alt="Model Guide combines current native controls, domain evidence and account observations before delegation." width="100%">

```sh
model-guide suggest --backend claude --task "fix a flaky failing test"
model-guide benchmarks --domain performance --query sol --brief
```

`suggest` returns a shortlist with a quality pick and a value pick per model ("low effort gets 54% of
the score at 14% of the cost"), labels evidence from another harness, and never averages conflicting
boards. Debugging (Bug Hunt) and GPU kernel (KernelBench) domains are included.
[Native controls, domain evidence and account context](agent-models/README.md).

### Questions on your PC or phone

<img src="docs/images/baton.gif" alt="Agent Baton in four steps: a Windows notification arrives, the one-use form opens, the human types an email and password, and the form replies that the agent can type them for ten minutes." width="100%">

Phone pushes and session-isolated replies. [Setup](agent-baton/README.md#phone-alerts-and-remote-handoff)
· [Questions and private handoffs](agent-baton/README.md#unanswered-questions).

### Your sessions on your phone

<img src="agent-inbox/docs/hero.svg" alt="Agent Inbox drawn on a phone in three scenes: chat with folded tool steps and an inline image, a slash menu of native commands, and a question form with attached images." width="100%">

[Agent Inbox: pairing, live chat and native controls](agent-inbox/README.md#connect-a-harness).

### Local previews, anywhere

<img src="portlink/docs/preview.svg" alt="Portlink opens a private preview from a local app, folder or file on a phone over Tailscale, with a QR and automatic expiry." width="100%">

[Portlink](portlink/README.md): private, expiring links to an app, build folder or file.

### Heavy commands, one at a time

<img src="docs/images/agent-resources.gif" alt="Heavy commands declare their needs to a shared queue, wait for headroom and run in the foreground; process exit releases the reservation." width="100%">

Five agents, one test suite at a time. [agent-resources](agent-resources/README.md).

Behind the scenes: [account observations](agent-accounts/README.md), [persistent labs](agent-lab/README.md)
and [session identity](agent-session/README.md).

## Built-in guardrails

- **Safe to publish.** `tests/check_public.py` runs as a pre-commit and commit-message hook. It scans for
  credentials, personal identifiers and private project names, and reports where and why, never the
  matching text. Private terms live outside the repository.
- **Safe to install.** `./install.sh` is a dry run by default and never overwrites a file that differs.
  Hook and plugin entries merge into your live files and leave a private backup.
- **Safe to run in parallel.** Resource admission, session-scoped Baton requests and per-owner Bridge locks
  keep several agents from stepping on each other or answering each other's questions.
- **Self-improving.** Agents are told to leave [feedback](agents/feedback/README.md) when a tool misleads
  them, with reporter metadata for tracing. Suggestions are treated as hypotheses; the fix goes to the
  root cause.

## Setup

[Restore, the manual steps, how files flow, what starts on its own and the checks](docs/setup.md).
Credentials and machine-local state stay outside Git; [handling and publication rules](AGENTS.md).

## Packages

One folder per package, each with its own README. [Every package, and the ordinary dotfiles](docs/packages.md):
[claude](claude/README.md) · [codex](codex/README.md) · [codex-wake](codex-wake/README.md) ·
[agent-bridge](agent-bridge/README.md) · [agent-baton](agent-baton/README.md) · [agent-inbox](agent-inbox/README.md) ·
[agent-models](agent-models/README.md) · [portlink](portlink/README.md) · [shell](shell/README.md) ·
[nvim](nvim/README.md) and more.

## License

Original files: [MIT](LICENSE). Third-party parts keep their own licenses; see [Setup](docs/setup.md#license).
