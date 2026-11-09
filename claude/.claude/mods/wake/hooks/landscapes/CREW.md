# The crew: how it is built, and where to add things

## The standard

1. One design per family and place, grown through four classes by parameters, never four unrelated pictures.
2. Small and slim: every sprite rectangle fits `CRAFT_MAX` (19×7); each class grows in area. OpenCode's narrow balloons alone
   may use 13×9 (`BALLOON_MAX`): classes are 7×8, 9×9, 11×9 and 13×9, growing sideways.
3. Detailed: at least three tones, structure (plates, seams, ribs, spars or rigging) and a highlight. One connected silhouette,
   with a few intentional joints instead of scattered texture. No outline or backing.
4. Smooth: eight or more beats for Codex. The structure itself moves: bending plates, billowing surfaces, pitching fuselage,
   heaving hull, tilting rotor or flexing runners. A rigid body with a blinking accent does not qualify.
5. Travel and face the direction of travel. Flag a front with `facing`; symmetric designs never turn.
6. One tasteful real effect that belongs to the body: thrust, wash, wake, spray or flap shimmer. Effects stay subordinate,
   outside the body's cells, with fewer, paler particles that cannot be mistaken for its plates.
7. Light only what motivates it: an eye, navigation lamp or lantern.
8. Turn to suit the body: `coil` for serpentine bodies, `bank` for planes/birds, `none` for symmetric designs.
9. A message to/from root turns the sender toward Mochi (right); `talking` delivers it in that design's voice. **Behaviour order:
   a sender turns first, then sends**: the packet, the send reaction and the roar all wait `TURN_LEAD_MS` (crew-row.ts), the
   time a turn takes, so nothing leaves until the craft faces her. A receiver turns while the packet is in flight.
10. Sol/Astra have escorts where company makes sense; companions follow the leader's path and turns.
11. Touch the scene: disturb its water, crop, leaves, sand or snow; cast a shadow by day; fit the actual room.
12. **An interrupt is a strike.** When a worker's turn is cut off by the root (a native subagent's `turn.complete` with
    `isAborted`; a Bridge job's `turn_completed` with status `interrupted`) its exit is not the place's farewell but
    `exit-styles.ts` `struck`: a bolt drops on it, it flashes white, shudders, turns red and falls dissolving, shedding its
    family's debris (machine smoke and sparks, feathers, embers, confetti and hissing air). It applies to every family and
    landscape and to native subagents and Bridge workers alike (`WakeChip.interrupted`, `WakeAgent.interrupted` -> `struck`).
    When you add a family, give it debris in `struck`. Preview with `STRUCK=1 bun dev/passages.ts <place> [class]`.
13. Every behaviour above is part of the standard for each design: when adding a design, check its facing and turn, its
    send order, its interrupt and its passage, not only its sprite.

Family identities: **Codex** builds slim plated machines with an eye, seams, gear teeth and a travelling pulse;
**Claude** is a living winged creature native to the place; **agy** is celestial light with an intelligible physical rhythm;
**OpenCode** is an airborne festival with fabric, rigging and warm light.

## Codex concepts

- City: clockwork dragon; long plated wave, horned glowing eye at the front, flicking tail blade, short booster jet, and a crisp
  blue shock arc (`thrustPuff`) that drops from each low bend of the wave as the body pushes the air down and rises.
- Harbor: paddle launch; eyed wheelhouse on a long low hull, a round paddle wheel dipping below its stern; bow-led heave travels aft while three spokes turn, with three pale wake flecks at the paddle's contact point.
- Beach: banner tug; glass-eyed cowling and one filled ribbon; the fuselage pitches with thrust while a sine wave streams along the entire banner, with two pale slipstream flecks below the aft cowling.
- Mountains: ridge glider; broad canopy arch over an eyed rider on a harness; a ripple travels edge to edge while the pod swings and lifts on its lines, with two faint downward lift flecks from the pod.
- Countryside: articulated crop biplane; eyed nose, two staggered wings and open spars; the whole fuselage pitches and bends while both wings flex in opposing arcs, with three pale chaff flecks below the propeller.
- Forest: autogyro; a two-row rotor lens over a glass-eyed pod and forked boom; the disc tilts and changes span while the pod bobs and the boom trails its pitch, with three muted leaf flecks directly under the rotor.
- Desert: lateen hover yacht; filled sail triangle on a two-row knife hull with a prow eye; a ripple billows the sail's leading edge while the hull heaves from bow to stern, with three muted sand flecks below its lift nozzle.
- Tundra: sprung ski plane; eyed nose and high wing on open struts above two curled runners; the body pitches, the wing bends and the runners kick and flex in opposite phases, with three pale snow flecks under the lowest runner.

Compared side by side with the dragon, these keep its continuous plated line and readable eye while giving each place one clear
feature. Bigger classes mostly get longer; moving accents use the seven-row ceiling rather than stacking more texture.
`crew-sprites.test.ts` checks every beat for a single connected body, distinct silhouettes, a real front and substantial changes
in occupied cells (at least 8/14/20/26 through the four classes, ignoring every colour change). The non-city machines paint their air first and their solid pixels last; their eyes/plates are bright pixels without a
halo that would turn the silhouette into a teal cloud.

## Owners

The crew is a matrix, **four families (Codex, Claude, agy, OpenCode) by eight places** (city, harbor, beach, mountains,
countryside, forest, desert, tundra). Every cell has the parts below. Each part has one owner and is data, so adding a
place, a family or an effect means adding a row, not writing a new loop. `tests/crew-matrix.test.ts` fails when a cell is missing.

| Part | Owner | What a row is |
| --- | --- | --- |
| Sprite | `craft.ts` (all Codex machines, including boats), `creatures.ts` (Claude), `balloon.ts` (OpenCode), `AIR` in `crew.ts` (agy) | rectangular frames of letters; machines and balloons are generated from class parameters |
| Design | `design.ts` `DESIGNS[family][place]` | drawing's front, cruise, turn style and escort formation |
| Air effects | `fx.ts` `CREW[family][place]` | emitters and lights hung on anchors of the sprite |
| Passage (arrive, leave) | `exit-styles.ts` (look) and `exits.ts` (timing) | one small function per family and place, handcrafted pixels; every style ends clean at p = 1 |
| Send and receive | `reactions.ts` `EFFECTS` (by kind) | one `Effect` per family (Codex ripple, Claude stars, agy sparks, OpenCode burst) and a gadget per Mochi character |
| Motion | `gait.ts` (path), `crew.ts` `lanes` and `placeFly` (room), `orient` and `shape` (facing, turning) | a gait per family; a lane of sky per flyer |

Passages and reactions are deliberately **handcrafted pixels, not particle emitters**: the warp-speed pop in and out and the
shockwave on a send read far better than a swarm of dots did. Particles are for the air around the crew (trails, wind, light).

## Effects: how they are made

OpenCode's `balloon.ts` cuts a local fabric envelope for each place: city ticker, harbor sail/pennant, beach globe/streamers,
mountain quilted pear, country hay-stack/garland, forest leaf lantern, desert sun-disc/tassels and tundra ribbed lantern.
Eight cached poses share a pressure clock: the fabric expands, a ripple travels down its gores, the bunting hem waves and the
basket swings behind the pulse. `balloonPose` exposes the visible burner and external heat/ember anchors from that same pose.
`balloonNose` is the burner voice, since drifting balloons have no heading. Large classes have smaller sister balloons; the
seed's `balloonInk` remains their envelope colour. Effects paint before the solid cloth, with sparse pale heat and two embers;
a sending burner flares with a pale hiss ring after the shared turn lead. The nine-row exception belongs only to this family.

Every effect is **data for the engine in `particles.ts`**, never a hand-written loop of pixels.

- **Emitter**: a swarm. Count, life, speed and angle ranges, gravity, drag, swirl, a share of the wind, a colour ramp over the
  particle's life, an alpha envelope (`fade`, `pulse`, `twinkle`), size, streak, `reverse`, `delay`.
- **Light**: a halo, cone, pool or column, which may strobe, pulse or sweep, and comes on with the dusk (`from`).
- Both are **stateless**: a particle is a pure function of the clock, its index and a seed. Nothing is stored between paints,
  any frame can be drawn alone, the same inputs draw the same picture. An emitter that `follow`s a moving origin is born where
  the origin *was*, so a trail is exactly the sprite's own path and leans with the wind.
- Things **touch their place**: the city dragon has a booster jet at its tail and data packets trailing behind it, an autogyro
  whirls the forest floor's leaves, a duster throws chaff, a skiff sand, a ski plane snow; paddle launches leave a wake;
  everything that flies throws a shadow by day; stars, balloons and burners light the ground at night; owls have eyeshine,
  the kite a lantern on its string. When you add a thing, ask what it would disturb and what it would light.
- **Dusk and night** change the crew, not only the sky, **but only where the design motivates a light**: the dragon's head glows and
  a pulse of light runs down its plates, planes show navigation lights, a balloon is lit from inside, an owl's eyes shine. Never
  copy one design's light onto another (a searchlight belongs on a helicopter, not on a dragon). Use `from` and the family's `lights`.
- **Wind** is real (`look.wind`): gusts cross the whole sky, each place blows its own things about (`CARRIED`: dust, spray,
  sand, snow, petals, leaves), trails and smoke lean downwind.

## Activity drives motion

`gait.ts` turns what a worker really did into movement. `paceOf` (0..1) is high just after an event and eases off over two minutes;
waiting, paused and stalled workers are calm, a running one is never idle. `PhaseClock` integrates a per-worker clock at
`clockRate(pace)`, so a change of pace speeds the gait up or down and **never jumps the sprite**. Wings, rotors and effects run on
that clock, so a busy worker's wings beat faster and its trail is denser. Real events (a tool call, a message sent or received)
`lift` the sprite and flare its effects.

## Room: lanes, not slots

`lanes()` shares the **whole width of the sky** among the flyers in proportion to their size, by identity (never list order): one
worker roams the sky end to end, four a quarter each, so together they always cover the scene. A gait is a path in a unit square and
stretches to the room it has. Only Mochi, her laptop and the other crew are hard obstacles; scenery is a soft preference (a flyer
is nearer than the buildings and may pass in front of them), so placement settles in clear sky when there is any.

## Facing, turning and company

`design.ts` owns `DESIGNS[family][place]`: a complete typed matrix of `{ facing, cruise, escorts, turn }`.
`facing: 'left' | 'right' | null` is the drawing's front (`null` means symmetric). `cruise: true` uses the continuous looping gait;
false retains that family's gait. `turn: 'coil' | 'bank' | 'none'` selects a flexible spiral, a rigid body wheeling through edge-on,
or no deformation. The beach and tundra planes bank; they never inherit the dragon's coil just because they have fronts.
The other families retain their existing symmetric motion until their place-specific art declares its fronts.

`escorts` maps a leader's class to smaller companions: `{ tier, lag, dx?, dy }`. Each uses the same family's local sprite and follows
the leader's continuous path `lag` seconds behind, offset by `dx` columns and `dy` rows. Non-city Codex machines fly in a low,
spread formation rather than a vertical stack. Placement reserves the entire formation and keeps companions inside their lane;
narrow views can omit a wingman. Harbor launches reserve companions in clear water berths. Berth collision uses the occupied
cells of every pose in both headings, rather than empty corners around the wheelhouse. Near and far water berths keep foreground
and plan-lamp reservations hard for full and compact hulls, and for their overflow dragons. When the
harbor is crowded, distant launches pack on the water; only an unberthable overflow worker borrows a coastal city dragon.

`orient` reads the continuous path (raster steps must never become false turns) and aims a worker with a message at Mochi on the
right. `shape` projects the chosen turn; straight at both ends, the mirror changes at the narrow middle. `talking` streams deliver
the message from each craft's actual eye, cowling or horn. `craftNose` follows each generated face; wing lamps use the pose's
`lamp` point. The dragon finishes its 0.9-second aim before its smaller roar/packet burst begins. Reactions remain handcrafted in `reactions.ts`.

The city dragon is still the reference: a 3×3 horned head, seamed three-column plates, gear teeth, a travelling pulse and a flicking
tail blade, in eight beats. `dragonAt` is the single wave formula for both art and `dragonCrests`: one low-stroke thrust anchor per
plate group (one for a whelp's downward tail flick). `fx.ts` replays each short downward crescent at its birth position on the
leader's path; `particles.ts` owns the soft crescent primitive. The puffs have a bright teal centre, blue shoulders and fine sparks,
fall a few rows and fade; no light cone. Each non-city generator returns its rows plus `{ push: { x, y, force }, lamp? }` from
the same phase calculation. The eight poses and their push points are cached once, not rebuilt while painting. `craftPush`
anchors wash directly below that physical point and thrust one cell outside it; strength uses its pose's force. A following
wake samples the historical pose and path. `Stream.beats` remains available for other effects. The dragon keeps its separate tail jet and packets.

## Recipes

- **A new place**: add it to `WakePreset`, `LANDSCAPES` and every family's row in `DESIGNS`, then the tests tell you the rest: a craft (`craft.ts`), a creature
  (`creatures.ts` `ALL_CREATURES`), an exit style per family (`exit-styles.ts`), a `CARRIED` row, and its rows in `CREW`.
- **A new effect for a cell**: add a stream or light to `CREW[family][place]`. Pick an anchor (`centre above below left right nose
  tail ground`), `follow` it if it should trail, limit it with `tiers` or `from`.
- **A new family**: a sprite table, a `CREW[family]` with an `any` row, an `Effect` in `reactions.ts` `EFFECTS` (what it does on
  a send and on a receive), and a style per place. TypeScript (`Record<Kind, …>`) and the matrix test list what is missing.
- **A new motion or light**: only then change `particles.ts`; add a case and a test in `tests/particles.test.ts`.
- **A new creature**: grow one design through four classes in `creatures.ts`; two or more frames, all rectangular and inside
  `CRAFT_MAX`. Declare its front, turn and any companions in `DESIGNS.claude[place]`.
- **A new craft**: two or more frames per class, each class a rectangle inside `CRAFT_MAX`; classes grow in area. If it points one
  way, set the design record's `facing`; choose `cruise`, a body-appropriate `turn`, and `escorts` if the big classes have company.
  Keep an ASCII sheet of every beat, then inspect real scene frames by day and night and iterate on the silhouette and anchors.
  Generate the whole structure from phase. Return its actual push point and force alongside the rows; never guess an effect's
  offset from the bounding rectangle. Preserve the eye/glass pair through every pose. Compare single-colour silhouettes with
  the other seven places before accepting a concept; replace weak concepts instead of adding texture.

## Look at it

`bun dev/cast.ts [place|all]` the whole cast, large · `bun dev/crew.ts <family>` every class over every place ·
`bun dev/passages.ts <place> [class]` arrivals and exits frame by frame · `bun dev/fx.ts <place> [pace] [wind] [hour]` the air effects ·
`bun dev/roam.ts [place]` how far each family travels and its largest step · `bun dev/perf.ts` milliseconds a frame (the budget is
50 ms; it runs 1–6 ms) · `bun dev/motion.ts` messages crossing. Check rendered output at day, dusk and night and at narrow widths.
`look.effects = false` (`SceneInput.effects`) draws bare sprites, without the air round them (tests use it).

`bun dev/codex.ts <review-name>` prints each place's class 4 and class 1 beside the city dragon and writes the full eight-beat
ASCII sheet. For every place by day/night, `-native.png` shows all classes/beats at 1×, `-beats.png` at 2×, and the main `.png`
shows two key beats at 6× (`-beats.json` holds every rendered frame). Keep review artifacts local; do not regenerate GIFs for
design edits.

`bun dev/silhouettes.ts` writes `dev/codex-character-silhouettes.png`: all eight class-4 silhouettes side by side at every beat,
in one colour with no effects. `bun dev/dragon.ts <review-name>` renders a real send timeline and half-beat samples of the
dragon's downstroke puffs at native scale and 6×, by day and night.
