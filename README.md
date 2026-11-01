<h1 align="center"><img src="docs/images/hero.gif" alt="Dotfiles with agency: a workspace where AI agents work together, hand off to you when it matters, and a small town grows above your prompt. Four animated pixel landscapes from Wake, and cards for Wake, Bridge, Baton and install.sh." width="100%"></h1>

<p align="center">
<a href="#why-use-it">Why use it</a> · <a href="#wake">Wake</a> · <a href="#agent-tools">Agent tools</a> · <a href="#built-in-guardrails">Guardrails</a> · <a href="#restore">Restore</a> · <a href="#packages">Packages</a> · <a href="#checks">Checks</a>
</p>

A working environment for people who run several coding agents at once. Codex, Claude Code, Antigravity
and OpenCode share one set of instructions, skills and tools, so they can delegate to each other, ask you
questions on your phone, and show what they are doing without you reading a transcript.
It runs on WSL2 Ubuntu; check paths, the distro and Windows fonts before restoring.

```sh
git clone https://github.com/vTuanpham/dotfiles-with-agency ~/dotfiles-with-agency && cd ~/dotfiles-with-agency
./install.sh            # preview only: nothing changes
./install.sh --apply    # then apply the steps it listed
```

## Why use it

Each tool is a separate, small CLI or mod. Take one, or all of them.

| You get | What it does that is hard to get elsewhere |
| --- | --- |
| **[Wake](claude/README.md#wake-mod-live)**, a Claude Code mod | A pixel landscape above the prompt that is the session's live state: eight places, weather and time, a building that rises with each turn, and a crew of real workers. Each Codex worker is the craft its place would build (a steamship at sea, a paraglider in the mountains, a ski-plane in the tundra), and a message between workers is a comet with a long fading tail, drawn behind the scene. It also shows per-harness quota with tinted backgrounds, effort inferred from what each model supports, hover cards, and a spinner that changes with the command being run. |
| **[Agent Bridge](agent-bridge/README.md)** | A Codex root can hand a job to Claude, Antigravity or OpenCode (and the reverse). Jobs persist, can be watched and steered live, message each other (`TO <peer>:`), survive a root change (`handoff`), and archive when finished. |
| **[Agent Baton](agent-baton/README.md)** | The agent asks; you answer from a Windows toast or your phone. For passwords, 2FA and API keys the value goes straight into the field or env file and **never reaches the agent or its transcript**. |
| **[Agent Inbox](agent-inbox/README.md)** | Your existing Codex, Claude Code and OpenCode conversations on your phone: chat, images, tool steps, pending questions and native `/` commands, over Tailscale. |
| **[Model Guide](agent-models/README.md)** | Picks nothing for you, and says why. It reads the live native model lists, then compares eleven public leaderboards (Arena, LiveBench, Vals, SWE-bench, OSWorld, BFCL, LiveCodeBench, KernelBench, Bug Hunt and more) **per effort level and per harness**, in plain code. A 36-hour conditional poll notices board changes; updates stay a pending proposal until reviewed. |
| **[codex-wake](codex-wake/README.md)** | Codex background tasks and subagents wake the idle conversation through native lifecycle hooks: end your turn, and the result arrives. |
| **[Portlink](portlink/README.md)** | `portlink open 3000` gives a private, expiring HTTPS link and QR to a local app, build folder or file, for your phone. |
| **[agent-resources](agent-resources/README.md)** | Kernel-lock admission for heavy commands, so five agents do not run five test suites at once. Released automatically when the process exits. |
| **[agent-accounts](agent-accounts/README.md)** | Cached, address-free quota and freshness across Codex, Claude Code and Antigravity accounts, with remaining allowance rounded down. |
| **[agent-lab](agent-lab/README.md)** | Persistent experiment folders outside your repos, with creator and run provenance and guarded cleanup after retirement. |
| **[agent-session](agent-session/README.md)** | One answer to "which conversation is calling?", correct even when Claude Code is started inside a Codex terminal. |
| **[Feedback loop](agents/feedback/README.md)** | Agents file a ticket when a tool gives them trouble, with harness version and session ID attached. Tickets are worked to a root cause and closed, never deleted. |

## Wake

**[Wake](claude/README.md#wake-mod-live)** puts the session, its workers and account quota above the
Claude Code prompt. The landscape is not decoration: every sprite is a fact about the session.

<img src="docs/images/wake-dock.gif" alt="Wake's beach scene animating above the session's activity, crew and account quota rows, a prompt and the Claude Code status line. Call-outs name what each sprite is: street lamps are plan steps, a boat is a Codex worker, a bird is a Claude subagent, a constellation is an agy worker, a comet is a message in flight, the rising building is the current turn and Mochi shows the session's mood. Notes under the crew rows name their parts: the round harness logo with its own spinner, effort dots from the model's own levels, a peer lane that lights when one worker messages another, and the root graph where a message to the root travels up and the quota line below is tinted per harness." width="100%">

- **Crew that works.** Each worker patrols its own patch of sky or sea in the sprite of its harness and
  model class, and a Codex worker is whatever its place would build. Activity flashes when something real
  happens. A message between two workers is a comet in the sender's colour with a long fading tail, drawn
  behind the scene so it never covers anything, and the same message lights the peer lane and the root
  graph in the rows below. Nothing moves once the job is idle.
- **Honest rows.** Quota is coloured per harness, effort is shown as dots inferred from each model's
  supported levels, and every item has a hover card.
- **Eight places** that follow time, weather and session state: success, failure, waiting and sleeping all
  change the scene.

[Scene, crew and quota legend](claude/README.md#crew-and-quota-rows).

<img src="docs/images/wake-landscapes.gif" alt="Eight animated Wake landscapes: city at work, harbor awaiting input, beach with workers, mountains with fireworks after passed tests, idle countryside, rainy forest after a failure, desert with a shooting star after a completed job, and sleeping winter tundra." width="100%">

[Landscapes, time, weather and session state](claude/README.md#landscapes-and-session-state).

## Agent tools

![Inbox carries chat and controls; Baton carries questions and secrets; native delegation and Bridge connect workers. Shared model, account, resource and lab tools support the session.](docs/images/agent-tools.gif)

### Model selection that shows its work

![Model Guide combines current native controls, domain evidence and account observations before delegation.](docs/images/model-selection.gif)

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

Behind the scenes: [resource admission](agent-resources/README.md),
[account observations](agent-accounts/README.md), [persistent labs](agent-lab/README.md),
[session identity](agent-session/README.md) and [Codex notifications](codex-wake/README.md).

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

## Restore

```sh
./install.sh                 # preview missing tools, links and config differences
./install.sh --apply         # apply the listed steps
./install.sh --apply links   # or choose specific steps
```

Existing files that differ are preserved; hook/plugin merges retain live settings and leave a backup.
Python tools are editable `uv` tools, and `~/.local/bin/node` follows the newest nvm Node.

Still manual:

- Node via nvm, `rtk`, `agy`, harness logins and `sudo tailscale up`.
- The private secrets file, described below.
- [Chrome extension registration](chrome/README.md) and [Windows terminal setup](windows/README.md).
- The external plugins and preview tools listed in [shell](shell/README.md),
  [Neovim](nvim/README.md) and [Ranger](ranger/README.md), before using those configs.

Credentials and machine-local state stay outside Git.
[Private credentials and permissions](shell/README.md#credentials).

## Configuration flow

![Configuration paths: live links share the working-tree file, snapshots copy only into missing destinations, and hook entries merge on request. Credentials and machine-local state stay outside Git.](docs/images/file-flow.gif)

Snapshots never flow back automatically; generated changes stay uncommitted.
[Handling and publication rules](AGENTS.md) · [Public-data checks](tests/README.md).

## Packages

One folder per package; paths mirror `$HOME`. Each README states its install flow.

**Built here**

| Package | Kind | Contents |
| --- | --- | --- |
| [claude](claude/README.md) | Snapshot + live | Wake mod, hooks, native account CLI (`cswap`), skills |
| [codex](codex/README.md), [codex-wake](codex-wake/README.md) | Snapshot + live, uv tool | Codex preferences, hooks, skills and native task notifications |
| [agent-bridge](agent-bridge/README.md) | uv tool | Cross-harness jobs: start, watch, steer, hand off, retire |
| [agent-baton](agent-baton/README.md) | uv tool | Human handoff: questions, secrets and approved commands |
| [agent-inbox](agent-inbox/README.md) | uv tool + user service | Phone chat for existing root conversations |
| [agent-models](agent-models/README.md) | uv tool + timer | Model references, benchmark evidence and task shortlists |
| [agent-resources](agent-resources/README.md) | uv tool | Cooperative host resource queue |
| [agent-accounts](agent-accounts/README.md) | uv tool | Independent cached account observations |
| [agent-lab](agent-lab/README.md) | uv tool + live skill and timer | Persistent experiment folders and provenance |
| [agent-session](agent-session/README.md) | Library | The calling conversation's identity, shared by the tools above |
| [portlink](portlink/README.md) | uv tool | Private preview URLs, QR codes and route expiry |
| [agents](agents/README.md) | Live | Shared instructions, engineering skills and the feedback workflow |
| [opencode](opencode/README.md), [gemini](gemini/README.md) | Snapshot + live | Harness preferences, shared instructions and native hooks |
| [systemd](systemd/README.md), [tests](tests/README.md) | Live + reference, n/a | User timers and service PATH; installer, shell and public-facing checks |

**Ordinary dotfiles**

| Package | Kind | Contents |
| --- | --- | --- |
| [shell](shell/README.md), [starship](starship/README.md) | Live | Bash/Zsh startup, aliases, prompt and private credential include |
| [git](git/README.md), [npm](npm/README.md), [rtk](rtk/README.md), [desktop](desktop/README.md) | Snapshot | Git, npm prefix, tool and MIME preferences |
| [nvim](nvim/README.md), [ranger](ranger/README.md) | Snapshot | LazyVim config; inline previews |
| [ghostty](ghostty/README.md), [windows](windows/README.md) | Manual | Terminal integration; Windows Terminal and GhostInTheWSL configs |
| [chrome](chrome/README.md), [github](github/README.md) | Live + manual | Chrome extensions; GitHub CLI tools |

## What starts on its own

[Timers, catalog refresh, lab cleanup and startup tasks](systemd/README.md#startup-and-timers)
· [Codex reset tracker](https://github.com/vTuanpham/codex-reset-tracker).

## Checks

From the repository root:

```sh
python3 -B tests/check_public.py
python3 -B tests/test_public.py
python3 -B tests/test_install.py
python3 -B tests/test_shell_startup.py
```

[Test scope](tests/README.md); package READMEs list their own checks.
[Ponytail](https://github.com/DietrichGebert/ponytail) is enabled in the Claude/Codex snapshots;
its setup and hook trust live in those harness READMEs.

## License

Original files: [MIT](LICENSE). Third-party parts keep their own licenses:
Ghostty's Zsh integration (`ghostty/`, GPL-3.0), ranger-devicons (`ranger/`, with the
Nerd Fonts notice), and the LazyVim starter (`nvim/.config/nvim/LICENSE`, Apache-2.0).
[Harness marks](agent-inbox/src/agent_inbox/assets/NOTICE.md) keep their owners' terms.
