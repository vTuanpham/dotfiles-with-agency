# claude

[← Packages](../README.md#packages) · **Snapshot + live** · [Accounts](#accounts) · [Hooks](#hooks) · [Remote questions](#remote-questions-and-notifications) · [Wake mod](#wake-mod-live)

Claude Code configuration under `~/.claude`. Each part has its own kind:

| Part | Kind | Restore |
| --- | --- | --- |
| `settings.json`, status lines (`statusline-starship.sh` runs `statusline.py`; `subagent_statusline.py` draws the subagent rows) | Snapshot: holds this machine's paths | `install.sh --apply snapshots` copies what is missing on a new machine |
| `CLAUDE.md` (`~/.claude/CLAUDE.md` links here; it imports the shared `~/.config/agents/AGENTS.md`), Bridge/Baton and the [pstack skills](../agents/README.md#engineering-skills) | Live link | `install.sh --apply links` |
| Hook and plugin entries | Merged into the live `settings.json` | `install.sh --apply hooks` |
| [Root stop safety net](.claude/hooks/README.md) | Script is a live link; entries merge into settings | `install.sh --apply links`, then `install.sh --apply hooks` |
| [Wake mod](#wake-mod-live) | Live link; reloads as its files change | `install.sh --apply links` |

## Accounts

[claude-swap](https://github.com/realiti4/claude-swap) (`cswap`) owns native Claude
account selection, like `codex-auth` does for Codex. The installer adds the reviewed
CLI release through uv; account stores and settings remain private on each host.

```text
cswap ── explicit allowance refresh ── agent-accounts cache ─┬─ Wake
                                                           └─ Bridge
```

```sh
cswap add                              # save the current login without logging out
cswap list --json                      # inspect managed accounts and usage
cswap switch 2                         # select an authorized account
agent-accounts refresh --backend claude # update the shared allowance view
```

Adding another account: use Claude's normal login flow, then `cswap add` again.
Do not log out first: logout can revoke the saved account's refresh token.
Account numbers are local to cswap; shared observations omit addresses and aliases.
Wake uses each numbered account's cached allowance. If its windows have expired,
run `agent-accounts refresh --backend claude` to fetch that account's usage through
cswap; the next local Wake poll picks it up. A session reading is not substituted
for a numbered account without verified identity.

Switch between sessions; verify Claude's `/status` and reconnect Remote Control
if it drops. Automatic rotation is not enabled. Before considering parallel
account launches, check the upstream [session-token report](https://github.com/realiti4/claude-swap/issues/515):
in 0.29.0, a preset `CLAUDE_CONFIG_DIR` bypasses the same-account protection.
Do not use `cswap run` from a redirected profile or run one account through both
the default login and a session profile. `--require-session` refuses the ordinary
same-account fast path but does not repair that preset-directory case.

On Linux/WSL, account data lives in `${XDG_DATA_HOME:-$HOME/.local/share}/claude-swap`.
Its `.enc` files are Base64 with private file permissions, not encrypted vaults;
exports are plaintext credentials. Keep this directory and exports outside Git.
Upgrade deliberately with `uv tool install claude-swap==VERSION` after checking
the release; nothing installs an autoswitch service or modifies the Claude launcher.

## Cache and thread reuse

Within included subscription usage, Claude Code's main conversation defaults to
a one-hour prompt cache; subagents and most other requests default to five
minutes. Usage credits, API keys and cloud-provider requests default to five
minutes for both. Explicit settings can change these defaults; see the
[official prompt-cache guide](https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets).
Reuse context when relevant, and start fresh when unrelated history outweighs
the benefit; a warm cache does not make an oversized conversation free.

## Hooks

The settings snapshot selects `/bin/bash` for Claude's Bash tool through
[`CLAUDE_CODE_SHELL`](https://code.claude.com/docs/en/env-vars). Interactive Zsh
keeps its native parsing; agent compatibility does not change `.zshenv` options.

`settings.json` defines Bash checks and a browser guard, shared with Codex (`codex/.codex/hooks.json`):

| Matcher | Command | What it does |
| --- | --- | --- |
| `Bash` | `rtk.py` | Uses RTK's native rewrite outside auto/plan modes; [classifier-reviewed commands stay intact](.claude/hooks/README.md#rtk-and-auto-review) |
| `Bash` | `agent-process-guard.py` | Parses shell commands and rejects full-command process matches that include the invoking ancestry; [behavior](../shell/README.md#agent-process-matching) |
| `Bash` | `agent-baton guard` | Denies the agent `agent-baton back` and `cancel`, and, while a `pass` request is out, any shell route to the browser or screen |
| MCP tools whose names contain browser, chrome, computer, playwright, puppeteer, cua or devtools | `agent-baton guard` | Blocks those tools while a `pass` request is out, and never lets them open a password manager |

`install.sh --apply links hooks` links the scripts and adds any entries your live `~/.claude/settings.json` lacks, keeps everything
else in it (replacing the former managed RTK Bash entry), and leaves a private recovery copy under
`${XDG_STATE_HOME:-$HOME/.local/state}/backups/dotfiles-with-agency/<timestamp>/`. The guard fails closed only while a `pass` request
is out. Claude also loads the `ponytail` plugin (`enabledPlugins` and `extraKnownMarketplaces` in
`settings.json`; see "Plugin: ponytail" in the top-level README), which ships hooks of its own.

## Remote questions and notifications

The [root Stop hook](.claude/hooks/README.md) reminds the root once to arm a
Bridge watch or acknowledge unread work before ending a turn. It allows user
questions and fails open on errors. Disable with `AGENT_BRIDGE_STOP_GUARD=0 claude`.

The settings snapshot enables `remoteControlAtStartup`, `inputNeededNotifEnabled`
and `agentPushNotifEnabled`. Remote Control provides the native phone/browser
answer path; the Claude mobile app must use the same account and allow notifications.
Push delivery also depends on an active Remote Control connection and presence:
Claude suppresses pushes while the connected terminal is focused or being used.
[Remote Control and mobile alerts](https://code.claude.com/docs/en/remote-control#mobile-push-notifications).

`AskUserQuestion` and permission prompts stay pending until answered. The
`dialogExpiry` setting applies to other forwarded dialogs, so changing it does
not implement a question timeout. No automatic-dismissal hook is installed.
Agent Inbox's `AskUserQuestion` PreToolUse callback can collect new answers from
paired devices before the terminal prompt opens. It returns the documented native
answer or a user-requested denial; timeout/failure leaves the native prompt intact.
See [Inbox's callback lifecycle](../agent-inbox/README.md#connect-a-harness).
[Documented limits](https://code.claude.com/docs/en/remote-control#limitations),
[shared question policy](../agent-baton/README.md#native-questions-and-hooks).

## Wake mod (live)

`.claude/mods/wake` is a Claude Code mod: the animated diorama above the prompt
(the session as a town in the real weather where you are), the crew row
(subagents, Bridge jobs), recaps, the plan in the spinner and the Bridge job tidy scan.
Retired Bridge jobs leave the crew row. The tidy scan counts only retired jobs past their
purge date, excludes dirty worktrees, and asks the root to run `agent-bridge purge`;
it never recommends deleting jobs still within retention. `agent-bridge restore` reactivates
a retained job with its original session.
Unlike the snapshot files, the mod is used in place and reloads as its files change.
It is Claude-only; [Agent Bridge](../agent-bridge/README.md) and
[Agent Baton](../agent-baton/README.md) work in every harness.

### Landscapes and session state

<img src="../docs/images/wake-landscapes.gif" alt="Eight animated Wake landscapes: city at work, harbor awaiting input, beach with workers, mountains with fireworks after passed tests, countryside with a rainbow after tests pass again, rainy forest after a failure, desert with a shooting star after a completed job, and sleeping winter tundra." width="100%">

*Actual renderer output, animating. Each scene is an example state, time and weather. `/wake tour` visits them all; `/wake scene <name>` pins one.*

| What changes | What Wake draws |
| --- | --- |
| Turns and tool calls | Structures and coloured windows; the current turn is under construction |
| Bridge workers and Claude subagents | Crew sprites by harness and model class, plus compact crew rows |
| Job stops making progress | Amber stale marker |
| Tests pass / command fails / Bridge job finishes | Fireworks / storm / shooting star, in the local style (harbor and beach fireworks mirror in the water; the desert storm is sand and the tundra's a blizzard; a tundra job lights the aurora); the shooting star is a streak with a tapering tail and a few embers hanging behind it |
| Every plan step done / tests pass right after a failed turn | Paper lanterns drift up from the ground / a rainbow draws itself over the scene (the biggest milestone of a turn gets the scene: failure, then a finished plan, then the rainbow, then fireworks) |
| Plan steps / session mood | Lit lamps / Mochi working, waiting, happy, sad or asleep |
| A message reaches a worker, or leaves one | The sender pulses as the comet launches and the receiver lights up as it lands, each harness in its own way: Codex a widening ripple, Claude twinkling stars, agy rising sparks, OpenCode a burst of confetti |
| A message reaches Mochi (or she sends one) | A gadget pops out of her head, one per character: a satellite dish with signal arcs (Mochi), whiskers turned radar with rings sliding in (Tabby), an ear trumpet with notes drifting into it (Tuxedo), rabbit-ear antennae with TV static between them (Bun) |
| Place, time and weather | Landscape, sun, moon phase and local weather |

### Characters, arrivals and exits

<img src="../docs/images/wake-characters.gif" alt="Four characters stand where Mochi does, each catching a message from a worker in its own way: Mochi raises a satellite dish between her ears, Tabby's whiskers turn to radar, Tuxedo unfolds an ear trumpet and Bun's ears stretch into antennae with TV static between them." width="860">

*Mochi, Tabby, Tuxedo and Bun (`/wake mochi <name>`), each catching a message with its own gadget. Actual renderer output.*

A worker is a visitor with a life of its own. When a Bridge job starts it **arrives**, and when it finishes it
stays a few seconds and **leaves**; each craft does both in its own way, and each landscape changes how:

<img src="../docs/images/wake-passages.gif" alt="A grid of eight landscapes by four worker families. Each cell loops a worker arriving, working and leaving: the city saucer warps in and hyperdrives away, harbor boats sail off to the horizon, mountain paragliders spiral up a thermal, countryside biplanes roar off, forest autogyros come apart into leaves, desert skiffs kick up dust and tundra ski planes lift off into aurora glitter. Claude's creature, agy's sparks and OpenCode's balloon end differently in each place too." width="860">

*Every family in every place: arriving (2.4 s), working, then leaving (3.2 s). Actual renderer output.*

| Family | How it leaves, by place (an arrival is the same thing played backwards) |
| --- | --- |
| Codex | City: the saucer rises, charges and hyperdrives off in a streak of light. Harbor and beach: the boat sails for the horizon, its wake behind it (rougher on the beach). Mountains: the paraglider spirals up a thermal. Countryside: the biplane climbs and roars off, smoking. Forest: the autogyro lifts and comes apart into leaves. Desert: the skiff speeds off in a plume of dust. Tundra: the ski plane runs, lifts off and turns to aurora glitter |
| Claude | A different flight in each place: soars (city), skims the water (harbor), loops (beach), spirals up (mountains), swoops then climbs (countryside), flits into the canopy (forest), circles in the heat (desert), fades silent like an owl (tundra) |
| agy | The sparks gather into one star, then end as a ring (city), ripples on the water (harbor), sun glints (beach), snow (mountains), wandering fireflies (countryside), fireflies going out one by one (forest), a dust devil (desert) or an aurora ribbon (tundra) |
| OpenCode | The balloon rises, then pops into confetti (city), bubbles (beach), petals (countryside), leaves and spores (forest) or a flurry (tundra); in the harbor it drifts out to sea, in the mountains it is lost in cloud, in the desert it evaporates |

Claude's workers, subagents included, are a creature that belongs to the place (`hooks/landscapes/creatures.ts`),
the same four sizes everywhere:

| Place | Creature | Place | Creature |
| --- | --- | --- | --- |
| City | pigeon | Forest | owl |
| Harbor | gull | Desert | dragonfly |
| Beach | kite on its string | Tundra | snowy owl |
| Mountains | eagle | Countryside | butterfly |

A subagent arrives when Claude spawns it and leaves when it finishes, like a Bridge job; it is kept in the
scene only while it leaves, and nothing else (the crew rows, the counts, `/wake`) counts it. A worker already
running when Wake starts does not replay its arrival. Each style is one small function in
`hooks/exit-styles.ts`; `hooks/exits.ts` runs them (lifting a sprite's pixels off the finished scene, repainting
the background and drawing it again moved, stretched or dissolving), so a new style or place is a single entry.

### Crew and quota rows

Bridge crew has one line per job: title, harness and model class, state, effort,
time since the last event, memory against its cap, and peer links from the last
15 minutes. Dead quota accounts fold into one range. Color distinguishes
families and states; short marks replace repeated model and status words. All
rows use the same columns, so each worker keeps its own harness and class. Narrow
layouts shrink titles and omit the same lower-priority columns for every row;
`/wake legend` explains the marks. A stalled or blocked job carries its reason
when there is room. Finished jobs remain until Bridge's `result` or `ack`.
A finished peer also stays visible while a recent exchange connects it to another
shown worker, so both endpoints remain in the inline graph for those 15 minutes.

The compact list follows Claude Code's subagent presentation: one recognizable
marker and name, a brief state and small counters, with color providing emphasis
and longer explanations kept out of the list. The row uses vendor logos where the
terminal supports inline images, with text alternatives otherwise. Model-maker
logos appear in hover details only when the model ID identifies the maker.
The [Claude Code documentation](https://code.claude.com/docs/en/sub-agents)
describes its subagent workflow and status access.

Classes are 1 Haiku/Luna, 2 Sonnet/Terra, 3 Opus/Sol and 4 Fable/Astra;
unrecognized models fall back to class 2. Each harness has four scene sprites that grow with
the class and keep their colour and character everywhere (agy light, OpenCode a festival
balloon); Claude's workers (its subagents and Claude Bridge jobs) are the winged creature of each
place, in the family's pink (a table below lists them), while Codex, the mechanical crew, builds what each place would
build: a steamship on the harbor and the beach (further out on the horizon when the skyline
hides the shore), drones and blimps over the city, a paraglider in the mountains, a
crop-duster over the countryside, an autogyro with a lantern in the forest, a sail-skiff in
the desert and a ski-plane in the tundra (see `hooks/landscapes/craft.ts`). Every family also
wears its place's weather as soft light (a searchlight over the city, a pennant in the
harbor, a ribbon on the beach, a contrail in the mountains, petals in the countryside,
fireflies in the forest, dust in the desert, aurora glitter in the tundra). Flyers patrol the
clear sky beside their home, slowly and continuously, so nothing teleports; they pass in front
of the backdrop but never over turn buildings. A worker hops when something real happens to it:
Bridge reports it acted, its message sets off (the sender), or one lands on it (the recipient).
A filling circle beside the harness mark (◔ ◑ ◕ ◉) shows the class, and effort is a
five-bar signal icon (an image where the terminal shows images, ▁▃▄·· as text) for Bridge
jobs and Claude subagents alike. Each row opens with the harness logo and, while the worker
runs, the harness's own spinner (Codex orbits, agy twinkles, OpenCode's balloon bobs); the
working headline's spinner follows the command: a shell spins, tests fill a gauge, edits grow a caret,
reads fill a page, searches circle, agents turn a gem, the web turns a globe; thinking keeps the
landscape's own.
The root has one place in every worker row: a `◉` node on the first row, a
spine down to the last worker tied to it, `─┤`/`─┘` branches, and `↑`/`↓` for the last message
to or from the root (`·` when the worker simply works for it); a packet runs the spine as a
message arrives and a tie fades over 15 minutes. The graph's column hugs the longest row (its
words, metrics and peer lanes) with a small gap, and steps a few cells further out only while a
message is crossing, so the packets have room; the row's leader stays empty except for a few beads
while a message arrives. Every metric opens a card under the pointer: effort says which levels the
model offers, Bridge time reflects its last activity, native Claude time is elapsed since first observed,
and Bridge memory shows scope use/cap. `?` on a worker means its current state is unknown;
when a source is unavailable, hover for its last observed state until a later scan succeeds.
Native `r...` / `⌁...` marks show declared local-command reservations, never agent RAM or a cap; hover
one for its command, queue state and reason. `r?` means the resource scan was unavailable. A stall reason
is shown in full. A SubagentStart hook gives each native child its owner and agent ID and asks it
to export them in Bash calls that invoke `agent-resources`, including through scripts. This is
best effort: unattributed commands have no worker mark. Cards open upward inside
their full row's bounds, including at narrow widths. Peer cards distinguish previews
withheld by Bridge from missing message metadata; withheld text is never reconstructed
from raw logs or replaced with an older message. In the scene a trail of faint embers
joins each worker (native or Bridge) to Mochi: working for the root is a relationship, not a message.
Worker, quota and actionable rows get room before decorative sky or optional
recap details. The scene trims its upper sky from ten rows down to six when
needed, preserving its ground, character, animation and matching hover targets.
Only a band too small for that compact scene drops it. If the terminal still
cannot fit every worker, crew paging keeps them reachable; recap details may
fold into an overflow count. A count never takes the place of a quota row that
would otherwise fit.
Bridge event cursors survive mod reloads with the session's notification state,
so an unanswered event does not create another dismiss row after each edit.
When a job finishes, its "needs you" row shows the first line of prose of its report: a markdown
table, heading marks, bullets and code fences are skipped, and a report that is only a table says so.
A stall mark comes from Bridge's shared
[stall classifier](../agent-bridge/src/agent_bridge/guide/status.md#bounded-waits-and-one-stall-classifier-v12);
known waits have their own reasons. Finished jobs stay as `done` until Bridge's
`result` or explicit `ack` acknowledges their completion.

Bridge jobs and tidy eligibility come from
[`agent-bridge status --json`](../agent-bridge/src/agent_bridge/guide/status.md).
Quota observations come independently from
[`agent-accounts snapshot`](../agent-accounts/README.md).
Wake maps the shared state and stall reason; heavy waits, root pauses and retry
backoff stay normal known states. Colored gutter lanes join connected peers;
← points to the recipient, ─, ━ and ═ represent 1, 2–4 and 5+ messages,
and ┄/┆ show a declared peer or dependency wait. Motion means a message just arrived: when Wake
first sees new messages on a link, one packet per message (up to five, a beat apart) crosses the
lane once from sender to recipient, then the lane rests. History Wake never saw arrive does not
move, nor does a wait. A worker's state mark lights when it acts, then settles. In the scene a
message is a comet in the sender's harness colour whose short tail fades quickly behind it, running an
arc between the two workers' fixed places (never their moving sprites). The trail is drawn
behind the sky's buildings, crew, weather and Mochi, so it takes nothing from them, and a soft
splash marks where it lands. Message links fade gradually and are gone after 15 minutes. The gutter
shrinks with the terminal; where a group cannot fit, the existing ↗/↙ peer marks remain.
Root messages use the root graph at the right edge (above). Arcs connect workers
to Mochi. Hover details show the scrubbed preview and distinguish
Bridge observing worker output from sending a root prompt or steer; neither
proves the recipient read it. The root endpoint is the owner namespace across
session handoffs. The native Claude `statusline.py` still renders
Claude's own session/context/cost input; it has no separate Bridge parser.

Wake shows quota rows for native sessions and Bridge jobs. It first reads the local
account snapshot, then requests a bounded refresh when needed and reads it again.
The rows show remaining allowance by reported window, including OpenCode's current
workspace budgets. `h` is five-hour, `w` weekly and `m` monthly when the source
reports those durations; pool and model bindings stay as reported by the provider.
Hover for the source, observation and reset times, and refresh diagnostics. The
active-account mark describes the current CLI profile, not every running conversation.

`*` marks the active account; `?` means its quota is unknown, and `~` marks a
stale reading or one without a known sample time.

### Use and check

Use the live mod in place:

```sh
ln -s ~/dotfiles-with-agency/claude/.claude/mods ~/.claude/mods
```

`settings.json` loads it in every session through
`"env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/wake" }`, and an
interactive session reloads it when its files change, so edits here apply live.

`agent-bridge message` uses Claude's existing native peer messaging socket,
independently of Wake. Setup, delivery receipts and limits belong to
`agent-bridge guide messages`; no extra mod or UI input is involved.

- `/wake` summarises; `/wake legend` explains the crew; `/wake tour` plays every landscape for 12 s, a whole day in each; `/wake scene <city|harbor|beach|mountains|countryside|forest|desert|tundra|auto>`
  pins a landscape to the current place; `/wake place <city|auto>` overrides the
  IP-based location (GeoJS, then ipwho.is; weather from Open-Meteo; all keyless).
- `/wake mochi <mochi|tabby|tuxedo|bun>` chooses who stands in Mochi's place: Mochi (lavender, belled collar),
  Tabby (orange, striped), Tuxedo (black and white, yellow eyes) or Bun (a white rabbit). `/wake mochi` alone
  shows the current one. Each is two hand-drawn frames in `hooks/mochi.ts`, and each has its own gadget for
  catching a message (`hooks/reactions.ts`); adding a character means drawing two frames and giving it a gadget.
- Pins, the place, the chosen character and cached weather live in the mod's store
  (`~/.claude/plugins/store/wake_*.json`), not here.
- Checks, from the mod folder: `claude plugin validate .`, `claude plugin test .`,
  and `npx -y -p typescript tsc -p .` (the engine writes `.claude-plugin/types/`
  on load; it is ignored).
  If every test file reports "did not load" with child exit code 0, check sandbox
  restrictions on the child harness; rerun the same command outside the sandbox
  when authorized. Type checking does not replace the runtime suite.
- For a focused runtime check: `python3 test.py tests/logos.test.ts` (multiple files
  are accepted; no files runs the full suite). It stages a private disposable
  copy containing only those test files, keeps shared helpers, and uses the same
  native `claude plugin test` kit and exit status. The live mod is untouched.
  On hook failures, read the runner's **the engine reported:** block for the
  inner missing implementation; stub every mods API call the hook uses.
  [The test-kit guide](https://code.claude.com/docs/en/plugins/mods/test) documents
  these stubs. Keep wall-clock limits so hung I/O still fails; use focused runs
  and host admission for full suites rather than raising limits with host load.
- `bun dev/showcase.ts`, `bun dev/dock.ts` and `bun dev/crew-life.ts` render the animation frames behind the README GIFs
  ([docs/tools](../docs/tools/README.md) turns them into images).
- `bun dev/crew.ts <codex|agy|claude|opencode>` renders the four sprite classes over every landscape;
  `bun dev/crew-review.ts` renders synthetic before/after rows at three widths.
- Motion and traffic over time, for nested crews: `bun dev/motion.ts [out.png] [width]` renders the
  scene through solo, chain, burst and crowded cases at several moments (patrol, hops, packets);
  `bun dev/rows.ts [width]` prints the inline rows' marks, lanes and root spine per moment as text,
  to confirm motion starts only on real arrivals and stops after.
- Live look without a screenshot: run `claude` in a detached `tmux` pane (no prompt needed), then
  `tmux capture-pane -t PANE -e -p > pane.ans` and `uv run --with pillow python dev/ansi-png.py pane.ans out.png [from] [to]`
  renders the band with its true colours and half-block pixels.
- Look at a landscape before changing it: `bun dev/preview.ts <landscape>` writes
  a sheet of every day phase, weather, effect and event to `dev/<landscape>.png`.
- Paint scene cards in the same Raster as the animation. The Client captures pointers
  only: independently redrawing an overlapping Client can briefly clear the fullscreen
  scene. Check continuous mouse movement in the configured terminal mode; hook traces
  and the test kit do not verify terminal compositing.
