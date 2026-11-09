# The crew: how it is built, and where to add things

The crew is a matrix, **four families (Codex, Claude, agy, OpenCode) by eight places** (city, harbor, beach, mountains,
countryside, forest, desert, tundra). Every cell of it has the same five parts. Each part has one owner and is data, so adding a
place, a family or an effect means adding a row, not writing a new loop. `tests/crew-matrix.test.ts` fails when a cell is missing.

| Part | Owner | What a row is |
| --- | --- | --- |
| Sprite | `craft.ts` (Codex), `creatures.ts` (Claude), `AIR` in `crew.ts` (agy, OpenCode), `BOATS` (Codex on water) | frames of letters; or, for creatures, a spec for the generator |
| Air effects | `fx.ts` `CREW[family][place]` | emitters and lights hung on anchors of the sprite |
| Passage (arrive, leave) | `exit-styles.ts` | one small function per family and place; every style ends clean at p = 1 |
| Send and receive | `reactions.ts` `BURSTS[family]` and `SCENE[place]` | emitter specs; a receive gathers in (`reverse`) then lands (`delay`) |
| Motion | `gait.ts` (path), `crew.ts` `lanes` and `placeFly` (room) | a gait per family; a lane of sky per flyer |

## The standard: attention to detail, and how it is made

Every effect is **data for the engine in `particles.ts`**, never a hand-written loop of pixels.

- **Emitter**: a swarm. Count, life, speed and angle ranges, gravity, drag, swirl, a share of the wind, a colour ramp over the
  particle's life, an alpha envelope (`fade`, `pulse`, `twinkle`), size, streak, `reverse`, `delay`.
- **Light**: a halo, cone, pool or column, which may strobe, pulse or sweep, and comes on with the dusk (`from`).
- Both are **stateless**: a particle is a pure function of the clock, its index and a seed. Nothing is stored between paints,
  any frame can be drawn alone, the same inputs draw the same picture. An emitter that `follow`s a moving origin is born where
  the origin *was*, so a trail is exactly the sprite's own path and leans with the wind.
- Things **touch their place**: a helicopter's rotor blows the street up (a downdraught, dust swept out along the ground, litter
  flung high), an autogyro whirls the forest floor's leaves, a duster throws chaff, a skiff sand, a ski plane snow; boats leave a
  wake, spray and funnel smoke; everything that flies throws a shadow by day; stars, balloons and burners light the ground at
  night; owls have eyeshine, the kite a lantern on its string. When you add a thing, ask what it would disturb and what it would light.
- **Dusk and night** change the crew, not only the sky: nav lights and strobes, a searchlight that lands in a pool, landing
  lights, a balloon lit from inside. Use `from` and the family's `lights`.
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

## Recipes

- **A new place**: add it to `WakePreset` and `LANDSCAPES`, then the tests tell you the rest: a craft (`craft.ts`) or boat, a creature
  (`creatures.ts` `ALL_CREATURES`), an exit style per family (`exit-styles.ts`), `CARRIED` and `SCENE` rows, and its rows in `CREW`.
- **A new effect for a cell**: add a stream or light to `CREW[family][place]`. Pick an anchor (`centre above below left right nose
  tail eyeL eyeR ground`), `follow` it if it should trail, limit it with `tiers` or `from`.
- **A new family**: a sprite table, a `CREW[family]` with an `any` row, `BURSTS[family]` (a send, and a receive that gathers then
  lands), and a style per place. TypeScript (`Record<Kind, …>`) and the matrix test list what is missing.
- **A new motion or light**: only then change `particles.ts`; add a case and a test in `tests/particles.test.ts`.
- **A new creature**: write a `Bird` spec (span, rise, droop, root thickness, tip, tail, head, beak, eyes) in `creatures.ts`; the
  generator draws all four classes and both frames. Insects and the kite are drawn from half rows mirrored about the centre (`sym`).
- **A new craft**: two or more frames per class, each class a rectangle inside `CRAFT_MAX`; classes grow in area.

## Look at it

`bun dev/cast.ts [place|all]` the whole cast, large · `bun dev/crew.ts <family>` every class over every place ·
`bun dev/passages.ts <place> [class]` arrivals and exits frame by frame · `bun dev/fx.ts <place> [pace] [wind] [hour]` the air effects ·
`bun dev/roam.ts [place]` how far each family travels and its largest step · `bun dev/perf.ts` milliseconds a frame (the budget is
50 ms; it runs 1–6 ms) · `bun dev/motion.ts` messages crossing. Check rendered output at day, dusk and night and at narrow widths.
`look.effects = false` draws bare sprites (tests use it).
