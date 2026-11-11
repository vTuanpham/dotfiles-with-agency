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

The status line's first row shows effort as Wake's dots (`●●●○○`, one per level, lit up to the current one). Its second row
shows context use, then **how long this session's prompt cache stays warm** (`cache 47m`, coloured as it runs down;
`cache cold` once it has lapsed), then the rate limits, cost and lines changed. A turn refreshes the cache, so the countdown restarts at each
response. `statusline.py` uses Claude Code's native `prompt_cache` observation for
warmth, lifetime and expiry. It leaves the segment out until caching is observed.
See the [native statusline fields](https://code.claude.com/docs/en/statusline#prompt-cache-fields).
Subagent rows retain their token count while the model's context size is being resolved.

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
Agent Inbox does not intercept these questions. See its [Claude limitations](../agent-inbox/README.md#connect-a-harness).
[Documented limits](https://code.claude.com/docs/en/remote-control#limitations),
[shared question policy](../agent-baton/README.md#native-questions-and-hooks).

## Wake mod (live)

Your workers have somewhere to be. A mechanical dragon folds into a warp above the city;
an owl settles onto a branch; a constellation gathers light to send a message.
Wake turns live agent activity into a pixel landscape above the Claude Code prompt.

<img src="../docs/images/wake-tour.gif" alt="Class-4 crew close-ups: a dragon warps through the night city, an owl rests and takes flight by day, a scorpion constellation exchanges messages, and mountain lanterns arrive and depart as a formation." width="100%">

*Four families in motion, rendered by Wake. The reel follows each action at its native pace.*

[The cast](#the-crew-at-work) · [Messages](#messages) · [Arrivals and exits](#arrivals-and-exits) ·
[Weather and landscapes](#landscapes-and-session-state) · [Read the rows](#crew-and-quota-rows) · [Setup](#use-and-check)

The mod lives at `.claude/mods/wake` and reloads as its files change. It displays native Claude
subagents and workers from every [Bridge harness](../agent-bridge/README.md). The display itself
runs in Claude Code; Bridge and [Baton](../agent-baton/README.md) also work in other harnesses.

### The crew at work

**32 designs, four sizes each.** Machines bend at their joints, creatures beat their wings,
cloth catches the wind and light travels through constellations. The gallery features class 4,
with the larger bodies and companions, as daylight gives way to night.

<img src="../docs/images/wake-cast.gif" alt="All 32 class-4 designs transition from day to night: clockwork machines, living creatures, constellations and lit paper crafts, with companions on designs that support them." width="100%">

*Day → dusk → night. Shaded bodies recede; eyes, engines, star nodes and lanterns stay lit.*

| Family | The idea | By place |
| --- | --- | --- |
| Codex | Mint clockwork with a glass eye and gear | Dragon, tug, saucer, airship, crop drone, probe, sun skiff and snowcat |
| Claude | Living creatures in the family's pink | Bat, crab, flamingo, eagle, butterfly, owl, fox and puffin |
| agy | Constellations with a moving pulse of light | Crown, sail, starfish, condor, plough, tree, scorpion and aurora arch |
| OpenCode | Paper and cloth with a warm window | Crane, paper boat, kite, sky lantern, carp streamer, lantern string, flying carpet and paper star |

Model classes grow the same design: 1 Haiku/Luna, 2 Sonnet/Terra, 3 Opus/Sol, 4 Fable/Astra;
unrecognized models use class 2. Companions belong to particular designs at classes 3 and 4.

Each design declares how it faces, moves and turns (`hooks/landscapes/design.ts`): the dragon coils, headed designs bank or
show a hand-drawn mid-turn pose, and face-on designs do not turn. The tug and paper boat ride harbor water; the crab,
snowcat and fox use the ground, the flamingo flies the shoreline, and the sun skiff and crop drone cruise low. The dragon, bat, owl, puffin and lantern string
settle on perches once they have had nothing to do for 12 s on end (`REST_AFTER_MS` in `hooks/band.ts`): stale, paused, or
done and waiting for the root. A worker queued for heavy work, waiting on a peer or blocked on a question is still on the job
and hovers calmly instead; any activity lifts a resting one off again. Landing and taking off take 1.6 s along an
arc, with the wash of their wings or booster, and while one plays the worker goes nowhere else. Other workers fly. Mochi and
her laptop are hard boundaries.
Flying crews can visit neighboring airspace and cross paths. A visit returns to its
home route within roughly 4–10 seconds of movement; message turns can pause that route.

### Messages

**Slow down. Aim. Send.** A machine vents a packet, a creature sings, a constellation releases
light and paper craft sheds an ember. The receiver catches it with a flash or a gadget; the
sender gathers speed again. Bridge workers and native Claude subagents share this behavior.

<img src="../docs/images/wake-sequence.gif" alt="A worker in each of the four families, flying over the city, has a message for the root: it brakes to a hover, turns to face Mochi, sends it as a call and a packet that crosses to her, then turns back and sets off again." width="860">

*Class-4 crews: brake, aim, release, catch and resume.*

Each projectile travels independently after release. Its faint trace records only the cells it has crossed and fades in place
as the crew moves on. Notes and embers leave their own curved path; a harbor tug's rocket climbs off the deck, throws a ring of
vapour as it pitches over, and trails swelling smoke. Each design throws its own thing (`hooks/landscapes/projectiles.ts`): the
dragon a bolt, the puffin a fish, the kite its ribbon.

Between workers, the receiver catches in its own family's way, whoever sent it. A message to another family turns into the
receiver's own projectile at the top of its arc, with a ring of both colours, and leaves the receiver's colour behind it.
Messages between workers of the same family fly with a second strand braided round them.

<img src="../docs/images/wake-conversations.gif" alt="Four pairs of workers and Mochi messaging in a loop, each family throwing and catching in its own way." width="100%">

<a id="characters-arrivals-and-exits"></a>

<img src="../docs/images/wake-characters.gif" alt="Mochi's satellite dish, Tabby's radar whiskers, Tuxedo's ear trumpet and Bun's antennae catch incoming messages." width="100%">

Choose a character with `/wake mochi <name>`. Each has its own signal-catching gadget.

### Interrupts

A worker whose turn is cut off by the root (a native subagent's aborted turn, or a Bridge job's interrupted turn) does not
take a bow: a bolt strikes it, it flashes white, shudders and falls dissolving, shedding what it is made of.

<img src="../docs/images/wake-strike.gif" alt="Four workers struck down: a Codex dragon sheds smoke and sparks, a Claude eagle loses feathers, an agy scorpion scatters light and an OpenCode paper star tears into scraps and sparks." width="560">

*Struck down, in each family's own debris. Actual renderer output.*

### Arrivals and exits

A worker is a visitor with a life of its own. It **arrives** when its job starts, or when a reply wakes it, and it **leaves the
moment it is done**: a Bridge job parked waiting for the root leaves then, not only when it is finally retired; a native
subagent leaves when it goes idle. Each craft does both in its own way, and each landscape changes how:

<img src="../docs/images/wake-passages.gif" alt="Eight landscapes and four worker families at class 4, each arriving, working and leaving in its own way." width="100%">

*Class-4 crews in every place: arriving (2.4 s, then 0.8 s while the dust settles), working, then leaving (3.2 s).*

The moment a crew touches down, and the moment it first moves to leave, it throws a shock (`hooks/shock.ts`). That moment is
read from each passage style itself, so the shock fires when the body really arrives or sets out, whatever the design. The
shock is anchored where it happened and runs out on its own: a blink of a flash, then a ring with a bright leading edge that
races out flat across the ground, or round in the open air, with an echo a beat behind. Each family adds a little of its
own: sparks and dragged dust for machines, a few feathers or petals for creatures, stars that wink out for constellations,
rising embers for lanterns. Boats send two soft ripples across the water; walkers land in a puff of dust.

What comes down out of the air and climbs back into it pushes air onto what lies below (`hooks/downwash.ts`): the bats, the
flamingo, the eagle and the butterflies on their wings, the saucer, the crop drone and the probe on their jets. The wash is
driven by the flight itself, every frame: it builds as the body nears the ground, peaks as it settles, and on the way out
blasts hardest at lift-off and fades as it climbs. Each downstroke sends a widening front of air down from under the wings;
a jet holds a shimmering column and pools its light on the ground. Below, the scenery is really pressed (treetops, roofs,
sand and water dip and part under the body), a pressure ripple runs out along the surface, and the place's own material,
dust, sand, spray, snow or petals, is blown out both ways. Walkers, boats, level flyers, constellations and lanterns raise
none.

The dragon charges and warps; probes and saucers lift through a beam. Boats travel over water, ground creatures walk out,
birds follow their scene's flight path, and constellations assemble from streaking stars. Paper folds and opens; floating
lanterns rise and disperse. Companions pass through the same effect around their own bodies.
Arrivals reverse the departure sequence. A subagent is kept in the scene only while it leaves, and nothing else (the crew rows, the counts,
`/wake`) counts it; a worker already running when Wake starts does not replay its arrival. Each style is one small function in
`hooks/passage-styles.ts` or `hooks/exit-styles.ts`; `hooks/exits.ts` runs them.

### Landscapes and session state

Daylight gives way to lit windows, engine glow and star nodes. Wind carries smoke and loose paper;
rain crosses the forest and snow settles over the tundra. `/wake tour` visits all eight places;
`/wake scene <name>` pins one.

<img src="../docs/images/wake-landscapes.gif" alt="Eight time-lapses: city, harbor, beach, mountains, countryside, rainy forest, desert and snowy tundra move through day and night with working crews and session effects." width="100%">

*Time and weather are accelerated here; crew movement uses the renderer's animation clock.*

| Session event | In the scene |
| --- | --- |
| Turns and tool calls | Structures grow; colored windows record the tools used |
| Workers start, wait or finish | Crews arrive, slow down, perch or depart |
| Tests pass | Fireworks, reflected in harbor and beach water |
| A command fails | A storm, sandstorm or blizzard, depending on the place |
| A Bridge job finishes | A shooting star, or an aurora in the tundra |
| The plan completes | Paper lanterns rise |
| Tests recover after a failure | A rainbow appears |
| Plan progress and session mood | Lamps light; Mochi works, waits, celebrates or sleeps |

When milestones coincide, failure takes priority, then a finished plan, recovery and passing tests.

### Crew and quota rows

<img src="../docs/images/wake-dock.gif" alt="A labeled harbor scene over worker rows, a message graph and colored quota meters." width="100%">

<details>
<summary>Reading the rows, hover cards and account windows</summary>

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

A filling circle beside the harness mark shows the class (see [the crew at work](#the-crew-at-work) for the designs), and
Claude's workers (its subagents and Claude Bridge jobs) are in the family's pink; the code is in `hooks/landscapes/`
(`craft.ts`, `creatures.ts`, `agy.ts`, `lantern.ts`) and [`CREW.md`](.claude/mods/wake/hooks/landscapes/CREW.md) is the standard
every new design is held to.

**Crew life is data for one particle engine** (`hooks/landscapes/particles.ts`; the guide and recipes are in
[`hooks/landscapes/CREW.md`](.claude/mods/wake/hooks/landscapes/CREW.md)). Every effect is an emitter or a light
described in a table, stateless, so any frame draws alone and a trail is exactly the sprite's own path:

- **They touch their place.** Water workers leave wakes and reflections, ground workers stir their footing, feathers shake
  loose off wings and paper scraps trail the crane.
- **Dusk and night change the crew.** Bodies darken with the sky; eyes, glass, lamps and flames stay bright and bloom.
  Night-only effects add light to each family, while agy's faint links tint the sky beneath them.
- **Wind is real.** Gusts cross the whole sky faster the harder it blows, each place blows its own things about (dust, spray,
  sand, snow, petals, leaves), and trails and smoke lean downwind.
- **Motion follows what the worker really does.** A worker's pace is high just after an event and eases off over two
  minutes; waiting, paused and stalled workers are calm and a running one is never idle. A busy worker roams wider, its
  gait quickens and its wings beat faster; a change of pace never jumps the sprite, and a worker that talks to the root
  hovers for it. An event hops the sprite and flares its effects.
- **Lanes, not slots.** The whole width of the sky is shared out among the flyers by size, so one worker roams the sky end to
  end and four a quarter each.
- **Hand-made moments.** Arrivals, exits and message reactions are handcrafted pixels, not particles: the sender pulses as
  its projectile launches and the receiver as it lands, each family catching in its own way, and Mochi or another character catches it with a gadget that pops out of their head.

A worker's arrival and exit run from the moment Wake sees it start or stop (Bridge's own times are already seconds old), and
Wake looks at Bridge every five seconds while a worker runs and straight after an `agent-bridge start`, `resume`, `steer`,
`watch` or `result`.
A filling circle beside the harness mark (◔ ◑ ◕ ◉) shows the class, and effort is a row of
dots on the model's own scale (`●●●○`, one per level it offers, lit up to the current one) for Bridge
jobs and Claude subagents alike. Each row opens with the harness logo and, while the worker
runs, the harness's own spinner (Codex orbits, agy twinkles, OpenCode's lantern flickers); the
working headline's spinner follows the command: a shell spins, tests fill a gauge, edits grow a caret,
reads fill a page, searches circle, agents turn a gem, the web turns a globe; thinking keeps the
landscape's own.
The root has one place in every worker row: a `◉` node on the first row, a
spine down to the last worker tied to it, `─┤`/`─┘` branches, and `↑`/`↓` for the last message
to or from the root (`·` when the worker simply works for it); a packet runs the spine as a
message arrives and a tie fades over 15 minutes. The graph's column hugs the longest row's words
and metrics with a fixed gap that peer lanes stand in first, so it does not move as messages come and go,
whether worker to worker, worker to root or root to worker; the row's leader stays empty except for a
few beads while a message arrives. Every metric opens a card under the pointer: effort says which levels the
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
from raw logs or replaced with an older message. Messages leave faint, fading paths
where they travelled, between workers or to and from Mochi. Once delivered, the path
stays put as the crew moves on; messages unseen by this view have no invented trail.
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
move, nor does a wait. A worker's state mark lights when it acts, then settles. In the scene the
sender's projectile travels between the workers' current body points (see [Messages](#messages)).
Flights pass above atmospheric effects; the receiver catches it in its own family's way.
Message links fade gradually and are gone after 15 minutes. The gutter
shrinks with the terminal; where a group cannot fit, the existing ↗/↙ peer marks remain.
Root messages use the root graph at the right edge (above). Arcs connect workers
to Mochi. Hover details show the scrubbed preview and distinguish
Bridge observing worker output from sending a root prompt or steer; neither
proves the recipient read it. The root endpoint is the owner namespace across
session handoffs. The native Claude `statusline.py` still renders
Claude's own session/context/cost input; it has no separate Bridge parser.

Wake shows quota rows for native sessions and Bridge jobs. It reads the local account
snapshot, then requests a bounded refresh and reads it again, and it does this when something
happened rather than on a fast timer: the engine pushes this session's own five-hour and weekly
windows as they move a whole point, and those update the active Claude row at once; a finished
turn, an `agent-bridge` start/resume/steer/compact, and `cswap`, `codex-auth` or `agy-auth`
(which re-read their own backend, since a switched login is not in the cache) each ask for a look,
bursts folded to one every ten seconds. While a Bridge worker runs, a reading older than two
minutes is due instead of ten; a five-minute timer remains only as a safety net. Provider
cooldowns in `agent-accounts` still bound how often anything is asked.
The rows show remaining allowance by reported window, including OpenCode's current
workspace budgets. `h` is five-hour, `w` weekly and `m` monthly when the source
reports those durations; pool and model bindings stay as reported by the provider.
Hover for the window name, remaining allowance, reset time and last update. Refresh
failures appear there; the JSON account snapshot retains source metadata. The
active-account mark describes the current CLI profile, not every running conversation.

`*` marks the active account; `?` means its quota is unknown, and `~` marks a
stale reading or one without a known sample time. Idle accounts of one CLI with the same
numbers fold into a range (`02–06~ m0%`) however long ago each was read, because a window
stays at its numbers until it resets; one stale reading marks the range.

Retired Bridge jobs leave the crew row. The tidy scan counts retired jobs past their purge date,
excludes dirty worktrees, and asks the root to run `agent-bridge purge`. `agent-bridge restore`
reactivates a retained job with its original session.

</details>

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

- `/wake` summarises; `/wake legend` explains the crew; `/wake tour` plays every landscape for 12 s, a whole day in each; `/wake crew` shows each demo family flying, turning, sending, receiving, resting, arriving and leaving in the current landscape by day and night; `/wake scene <city|harbor|beach|mountains|countryside|forest|desert|tundra|auto>`
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
- The crew, for design review: `bun dev/cast.ts [place|all]` draws the whole cast large; `bun dev/passages.ts <place> [class]`
  shows every family arriving and leaving frame by frame; `bun dev/fx.ts <place> [pace] [wind] [hour]` shows the air effects;
  `bun dev/review-server.ts` opens a local review at `http://localhost:18761` with
  scrubbable scenes, design assessments and feedback boxes. Drafts and submitted
  batches stay in the ignored `feedback.local/wake-review/` folder. Run this
  long-lived server through `agent-resources`; stop it when the review is finished.
  `bun dev/review-sheet.ts <place> <mode> [out.png] [width] [hour] [class] [family]` samples
  the same timeline into a comparison sheet; select one family for a closer view.
  `bun dev/reactions.ts [out.png] [day|night]` shows each crew and root character charging,
  releasing and receiving. The review's overcast action compares idle and working skies.
  Test the feedback server
  separately with `bun test dev/review-server.spec.ts`.
  `bun dev/roam.ts [place]` prints how far each family travels and its largest step per paint; `bun dev/perf.ts` prints
  milliseconds a painted frame (the scene repaints twenty times a second, a 50 ms budget; it runs 1 to 6 ms: compare before and
  after a change).
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
