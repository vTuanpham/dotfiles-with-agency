# The crew: how it is built, and where to add things

## The standard

1. Each family has a different, recognisable design in each place: 32 designs, not one design in eight coats.
2. Read the silhouette first. Leave air around it; avoid slabs and clouds of dots. A large body needs markings or plates. Use at least three tones and a bright accent.
3. Each design moves its own part. Only the city dragon undulates and coils; nothing else borrows its travelling wave.
4. Hand-drawn pairs of poses per class are the norm. Generate a shape only when it ripples or is a figure of points: the dragon, constellations, carp tail and carpet ends.
5. Material and colour hold a family together: Codex is mint clockwork with a glass eye `Wg` and gear `k`; Claude is alive, with rose plumage and a bright eye or bill; agy is a constellation with bright stars, dim links, a core and a travelling pulse; OpenCode is paper and cloth in the worker's colour with a warm window.
6. Each family gets its own trail, glow, voice, local accent, struck exit and escorts at classes 3 and 4. Add counterparts to all families when adding one of these.
7. A front-facing design banks through turns; a face-on design has `facing: null`, `turn: 'none'` and drifts. The dragon alone coils.
8. A sender turns before the packet, voice and reaction leave, after `TURN_LEAD_MS`. An interrupt is a strike; a worker leaves when done. Effects never repaint body cells. Keep per-frame cost flat.

## Codex concepts

- City: dragon; its plated wave pushes air in blue arcs and sheds packets.
- Harbor: whale; its fluke throws spray.
- Beach: jellyfish; its wires drip light and its bell glows.
- Mountains: airship; its propeller leaves slipstream and its gondola has a lamp.
- Countryside: bee; its wings shed pollen.
- Forest: spider; its legs leave silk glints.
- Desert: scarab; its legs kick dust as it rolls a glowing sun.
- Tundra: narwhal; its fluke sheds ice crystals and its tusk glints.

## Claude concepts

- City: pigeon; fast wings shed grey down.
- Harbor: pelican; heavy wings move as water drips from its pouch.
- Beach: flamingo; wings beat above trailing legs and shed rose feathers.
- Mountains: eagle; broad wings flex and shed streaming air.
- Countryside: butterfly; paired wings open and close, shedding pollen.
- Forest: owl; silent wings stir leaves and its eyes shine.
- Desert: dragonfly; four glass wings whir and shed glints.
- Tundra: puffin; rapid wings shed a flurry.

## agy concepts

- City: crown; jewels rise and settle, shedding neon.
- Harbor: sail; mast and hull rock, shedding spray.
- Beach: starfish; its arms turn and scatter sand glitter.
- Mountains: condor; its wings open and fold, shedding ice glints.
- Countryside: plough; its handle swings and sheds pollen.
- Forest: tree; boughs sway amid fireflies.
- Desert: scorpion; claws snap and tail curls as heat rises.
- Tundra: aurora arch; curtains sway and shed a ribbon of light.

## OpenCode concepts

- City: origami crane; its wing beats and sheds paper.
- Harbor: carp streamer; its tail ripples and sheds spray.
- Beach: kite; its tail of bows snakes and sheds ribbon.
- Mountains: sky lantern; its flame gutters and smoke rises.
- Countryside: balloon; its burner flares and throws a jet.
- Forest: lantern string; lanterns bob among fireflies.
- Desert: flying carpet; its ends ripple and shed magic dust.
- Tundra: paper star; its points turn and shed frost glitter.

## Owners and effects

`craft.ts`, `creatures.ts`, `agy.ts` and `lantern.ts` own the four families' frames and physical anchors. `design.ts` owns facing, cruise, turns and escort formation. `fx.ts` owns each family's streams, lights and voice; `particles.ts` draws stateless emitters and lights. `exit-styles.ts` owns passages and strikes, `exits.ts` their timing, and `reactions.ts` the send and receive reactions. `gait.ts` owns motion clocks; `crew.ts` places, orients and shapes the crew.

Streams follow their source's earlier path; wind carries them and local material supplies their colour. Paint effects before solid sprites. Lights use `from` for dusk, except a motivated always-lit source such as the scarab's sun. `lanternPose` supplies window, heat and force; `lanternNose` is the lead flame, and `lanternFlare` brightens windows after the turn. `craftNose`, `craftPush`, `creatureNose`, `creatureStroke`, `agyCore` and `agyPulse` follow their current poses.

`PhaseClock` advances at a worker's pace without jumps. `lanes` divides available sky by identity and size; Mochi and her laptop are hard obstacles, scenery is a soft preference. Escorts follow the leader with the lag and offsets in `DESIGNS`. A strike uses the family's debris; a normal exit uses the place's passage, and an arrival plays it backwards.

## Recipes

For a new place, add the preset and landscape, a design and sprite for each family, its `CREW` and `CARRIED` effects and each passage. For a new family, add its sprite and design rows, effects, reactions and passages. For a new effect, use an existing anchor, `follow` for a trail and `from` for a dusk light. Preserve pose-derived anchors and verify the four classes, escorts, message timing and exits. `tests/crew-matrix.test.ts` checks the matrix; the family tests cover frames and effects.

## Look at it

Use `bun dev/cast.ts`, `bun dev/crew.ts <family>`, `bun dev/passages.ts <place> [class]` (with `STRUCK=1` for interrupts), `bun dev/fx.ts <place>`, and `bun dev/motion.ts` to inspect the cast, passages and messages. Check day, dusk, night and narrow widths. `look.effects = false` shows bare sprites. Run `bun dev/perf.ts` to check frame cost; the frame budget is 50 ms. Keep review artifacts local.
