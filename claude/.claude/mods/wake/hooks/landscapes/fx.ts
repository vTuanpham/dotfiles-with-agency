import type { WakePreset } from '../../types'
import { type Canvas, mix } from '../pixels'
import { type Emitter, type Light, type Vec, coneEnd, emit, shine, thrustPuff } from './particles'
import { craftLamp, craftNose, craftPush, dragonCrests } from './craft'
import { AGY_TEMPO, agyCore, agyOrbit, agyPulse } from './agy'
import { lanternNose, lanternPose } from './lantern'
import { creatureNose, creatureStroke } from './creatures'
import { TURN_LEAD_MS } from '../crew-row'
import { clockRate } from './gait'
import { designFor, type Tier } from './design'
import { type Look, type SurfaceLight, P } from './kit'

// What the air is doing, as data for the engine in particles.ts: the wind, and what each member of the crew stirs up and lights.
//
//   CREW[family].any       every member of the family, wherever it flies
//   CREW[family][place]    added for that family in that place (an autogyro's rotor wash, an owl's eyeshine, a kite's string)
//
// A stream or light may be limited to some classes (`tiers`) and to the dusk and dark (`from`); it hangs on an anchor of the sprite
// (`at`, nudged by `dx`/`dy`) and, with `follow`, leaves from where the sprite WAS when each particle was born, so a trail is its
// own path and bends with it. Strength follows the worker's pace and any event that makes it flare (the `lift`). To add an effect,
// add a row. To give a place or a family its own, add a key. Write a new loop only for a motion or a light the engine lacks.

type Kind = 'codex' | 'agy' | 'claude' | 'opencode'
type Anchor = 'centre' | 'above' | 'below' | 'left' | 'right' | 'nose' | 'tail' | 'ground'

export type Stream = { at: Anchor; dx?: number; dy?: number; emitter: Emitter; follow?: boolean; tiers?: readonly number[]; from?: number; /** Eight-beat mechanical stroke(s) that drive the effect. */ beats?: readonly number[] }
export type LightAt = { at: Anchor; dx?: number; dy?: number; light: Light; tiers?: readonly number[]; /** a pool of light where a cone lands */ lands?: Light; /** a column or cone that runs down to the ground */ toGround?: boolean; /** shown whatever the hour (true), or in proportion to daylight ('day'): a shadow, not a lamp */ always?: boolean | 'day' }
/** `talking` streams are bursts shown while the worker is sending a message to the root; written facing left, the way a sprite is drawn. */
export type Cell = { streams?: readonly Stream[]; lights?: readonly LightAt[]; talking?: readonly Stream[]; /** Added to this family or place only after dusk. */ night?: Cell }
export type MessageStyle = 'packet' | 'song' | 'starfall' | 'ember'
type FamilyCells = Partial<Record<WakePreset | 'any' | 'night', Cell>> & { message: MessageStyle }

const TAU = Math.PI * 2
const UP = -Math.PI / 2, DOWN = Math.PI / 2
const clamp = (v: number, lo = 0, hi = 1) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo)
export const NIGHT_GAIN = 0.4 // full night adds 40% brightness and reach
const NIGHT_FROM = 0.12
const nightLight = (color: number): Cell => ({ lights: [{ at: 'centre', light: { shape: 'halo', color, alpha: 0.25, reach: 2, from: NIGHT_FROM } }] })

// ── the crew ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────


/** Whatever flies throws a soft shadow on the ground beneath it by day, wider the bigger it is. */
const SHADOW: readonly LightAt[] = [1, 2, 3, 4].map(tier => ({
  at: 'ground', tiers: [tier], always: 'day',
  light: { shape: 'pool', color: P.ink, alpha: 0.24, reach: [1, 2, 4, 7][tier - 1]!, from: 0 },
}))


/** A brief signal from the machine's eye/cowling, directed at Mochi after it turns. */
const SIGNAL = (at: Anchor, dx = 0, dy = 0, extra: Partial<Emitter> = {}): readonly Stream[] => [{
  at, dx, dy, emitter: { count: 2, life: 0.6, burst: true, delay: 0.25, speed: [8, 12], angle: [Math.PI - 0.08, Math.PI + 0.08], colors: [P.white, P.sky], alpha: 0.45, envelope: 'fade', ...extra },
}]

/** What an automaton sheds in its wake, twinkling out behind it. */
const WORKS = (colors: readonly number[], extra: Partial<Emitter> = {}): Stream => ({ at: 'tail', follow: true, emitter: { count: 7, life: 1.1, speed: [0.3, 1], angle: [0, TAU], wind: 0.5, colors, alpha: 0.55, envelope: 'twinkle', ...extra } })
/** The glass eye, lit from within once it is dusk. */
const EYE = (color: number): LightAt => ({ at: 'nose', light: { shape: 'halo', color, alpha: 0.45, reach: 1, modulate: 'pulse', from: 0.05 } })

/** The eye and pulse are in the art; additional lights belong only to actual lamps. */
const CODEX: FamilyCells = {
  message: 'packet',
  night: nightLight(P.sky),
  any: { lights: SHADOW },
  city: {
    // The dragon's roar, when it turns to Mochi with a message: a cone of sound rings from its jaws, and the message itself
    // shouted after it as bright packets (written facing left, so the nose is on the left and "forward" is towards 180 degrees).
    talking: [
      { at: 'nose', tiers: [1, 2], emitter: { count: 4, life: 0.5, burst: true, speed: [7, 10], angle: [Math.PI - 0.5, Math.PI + 0.5], drag: 1.1, colors: [P.white, P.sky], alpha: 0.6, envelope: 'fade' } },
      { at: 'nose', tiers: [3, 4], emitter: { count: 7, life: 0.5, burst: true, speed: [7, 10], angle: [Math.PI - 0.5, Math.PI + 0.5], drag: 1.1, colors: [P.white, P.sky], alpha: 0.6, envelope: 'fade' } },
      { at: 'nose', emitter: { count: 3, life: 0.35, burst: true, delay: 0.1, speed: [10, 14], angle: [Math.PI - 0.12, Math.PI + 0.12], colors: [P.yellow, P.white], alpha: 0.75, envelope: 'fade', streak: 1 } },
    ],
    // A dragon's effects are its own: data packets shed from its tail as it flies, the glow of its head, a booster at its tail, and
    // the light of its plates on whatever is below at night.
    streams: [
      { at: 'tail', follow: true, emitter: { count: 9, life: 1.3, spawn: { h: 0.6 }, speed: [0.3, 1], angle: [0, TAU], wind: 0.5, colors: [P.teal, P.sky, P.white], alpha: 0.55, envelope: 'twinkle' } }, // data packets shed in its wake
      { at: 'tail', dx: 1, emitter: { count: 7, life: 0.35, spawn: { h: 0.3 }, speed: [3, 6], angle: [-0.2, 0.2], colors: [P.white, P.sky, P.teal], alpha: 0.8, envelope: 'fade', streak: 2 } }, // the booster at its tail: a short bright jet streaming back
    ],
    lights: [
      { at: 'nose', light: { shape: 'halo', color: P.teal, alpha: 0.5, reach: 1, modulate: 'pulse', from: 0.05 } }, // the head's eyes
      { at: 'below', tiers: [3, 4], light: { shape: 'pool', color: P.teal, alpha: 0.22, reach: 6, modulate: 'pulse', from: 0.05 } }, // the pods' light, on whatever is below
    ],
  },
  // Each automaton sheds its own stuff from the part that drives it (a fluke, a wire, a propeller, a leg), as the dragon sheds
  // packets, and its glass eye glows after dusk. Its signal to Mochi leaves that eye.
  harbor: { // the tug: water churned up by its screw
    streams: [WORKS([P.white, P.sky], { gravity: 3, angle: [UP - 0.6, UP + 0.6], speed: [1, 3], envelope: 'fade' })], lights: [EYE(P.yellow)],
    talking: SIGNAL('nose', 0, 0, { angle: [Math.PI - 0.3, Math.PI + 0.3], speed: [5, 9] }),
  },
  beach: { // the saucer: light dripping from its thrusters, and the glow under its hull
    streams: [WORKS([P.yellow, P.teal], { gravity: 1.5, angle: [DOWN - 0.3, DOWN + 0.3] })],
    lights: [EYE(P.teal), { at: 'below', light: { shape: 'halo', color: P.yellow, alpha: 0.35, reach: 2, modulate: 'pulse', from: 0.05 } }],
    talking: SIGNAL('nose'),
  },
  mountains: { // the airship: its propeller's slipstream, and the lamp under its gondola
    streams: [WORKS([P.white, P.sky], { count: 5, life: 0.4, speed: [3, 6], angle: [-0.15, 0.15], envelope: 'fade', streak: 2 })],
    lights: [EYE(P.teal), { at: 'below', light: { shape: 'halo', color: P.yellow, alpha: 0.4, reach: 1, from: 0.05 } }],
    talking: SIGNAL('nose', 0, 0, { speed: [6, 10] }),
  },
  countryside: { streams: [WORKS([P.yellow, P.white], { gravity: 1.2, envelope: 'fade' })], lights: [EYE(P.teal), { at: 'left', light: { shape: 'halo', color: P.yellow, alpha: 0.4, reach: 1, from: 0.05 } }], talking: SIGNAL('nose') }, // the strider: chaff kicked up by its feet, and its headlamp
  forest: { // the probe: sparks off its working arms
    streams: [WORKS([P.white, P.teal], { count: 5, life: 0.8, speed: [0.3, 1], gravity: 2, envelope: 'fade' })], lights: [EYE(P.teal)],
    talking: SIGNAL('nose', 0, 0, { angle: [Math.PI - 0.2, Math.PI + 0.2] }),
  },
  desert: { // the speeder: a plume of dust behind its jet, and its headlamp
    streams: [WORKS([P.sand, P.peach], { count: 9, life: 1.2, gravity: 0.6, angle: [-0.4, 0.4], speed: [1, 3], envelope: 'fade' })],
    lights: [EYE(P.teal), { at: 'left', light: { shape: 'halo', color: P.yellow, alpha: 0.4, reach: 1, from: 0.05 } }],
    talking: SIGNAL('nose', 0, 0, { speed: [6, 9] }),
  },
  tundra: { // the snowcat: snow thrown off its tracks, and its headlamp
    streams: [WORKS([P.snow, P.sky, P.white], { gravity: 0.5, swirl: 0.8 })],
    lights: [EYE(P.teal), { at: 'left', light: { shape: 'halo', color: P.white, alpha: 0.4, reach: 1, modulate: 'pulse', from: 0.05 } }],
    talking: SIGNAL('nose', 0, 0, { speed: [10, 12] }),
  },
}

/** Small cries, chirps and hoots: paired sound arcs from the generated beak after the bird faces Mochi. */
const CALL = (speed: number, delay = 0): readonly Stream[] => [{
  at: 'nose', dx: -1, emitter: { count: 2, life: 0.55, burst: true, delay, speed: [speed, speed + 4], angle: [Math.PI - 0.12, Math.PI + 0.12], colors: [P.white, P.snow], alpha: 0.55, envelope: 'fade', arc: true },
}]
const FEATHER: Stream = { at: 'below', follow: true, emitter: { count: 2, life: 0.65, speed: [0.4, 1.2], angle: [DOWN - 0.35, DOWN + 0.35], gravity: 2, swirl: 0.4, wind: 0.6, colors: [P.white, P.snow], alpha: 0.26, envelope: 'fade' } }
const BIRD_WASH = (color: number): readonly Stream[] => [{ at: 'ground', emitter: { count: 1, life: 0.4, speed: [1, 2], angle: [UP - 0.5, UP + 0.5], gravity: 5, wind: 0.6, colors: [color, P.white], alpha: 0.14, envelope: 'fade' } }]
/** What a creature leaves in its wake, shed from its wing on each downstroke: as present as the dragon's packets, in its own stuff. */
const SHED = (colors: readonly number[], extra: Partial<Emitter> = {}): Stream => ({ at: 'below', follow: true, emitter: { count: 7, life: 1.1, speed: [0.3, 1], angle: [DOWN - 0.6, DOWN + 0.6], gravity: 1.2, swirl: 0.6, wind: 0.6, colors, alpha: 0.5, envelope: 'fade', ...extra } })
const CLAUDE: FamilyCells = {
  message: 'song',
  night: nightLight(P.pink),
  any: { lights: SHADOW, streams: [FEATHER] },
  city: { talking: CALL(11), streams: [SHED([P.white, P.overlay1]), ...BIRD_WASH(P.overlay1)] }, // the pigeon's grey down
  harbor: { talking: CALL(8), streams: [SHED([P.sky, P.white], { count: 4, life: 0.9, speed: [0.3, 1], angle: [UP - 0.4, UP + 0.4], gravity: -0.8, swirl: 0.6, envelope: 'twinkle' })] }, // bubbles blown by the crab
  beach: { talking: CALL(9, 0.06), streams: [SHED([P.sky, P.white], { count: 4, life: 0.6, speed: [0.5, 1.5], angle: [UP - 0.8, UP + 0.8], gravity: 5, swirl: 0 })] }, // splashes round the flamingo's legs
  mountains: { talking: CALL(6, 0.08), streams: [SHED([P.white, P.snow], { count: 5, life: 0.4, speed: [3, 6], angle: [-0.1, 0.1], gravity: 0, swirl: 0, alpha: 0.35, streak: 2 }), ...BIRD_WASH(P.snow)] }, // the air streaming off the eagle's wingtip
  countryside: { talking: CALL(12), streams: [SHED([P.yellow, P.white], { count: 9, speed: [0.1, 0.5], angle: [0, TAU], gravity: 0.3, envelope: 'twinkle' }), ...BIRD_WASH(P.yellow)] }, // pollen off the butterfly's wings
  forest: {
    talking: CALL(4, 0.12), streams: [SHED([P.leaf, P.yellow], { count: 5, gravity: 1, swirl: 1.2 }), ...BIRD_WASH(P.leaf)], // leaves stirred by the owl
    lights: [-1, 1].map(dx => ({ at: 'nose' as const, dx, dy: -1, light: { shape: 'halo' as const, color: P.yellow, alpha: 0.45, reach: 0, from: 0.05 } })), // its eyes shine in the dark
  },
  desert: { talking: CALL(5, 0.1), streams: [SHED([P.sand, P.peach], { count: 6, life: 0.6, speed: [0.5, 2], angle: [UP - 0.2, UP + 0.9], gravity: 4, swirl: 0 })] }, // sand kicked up by the fox's paws
  tundra: { talking: CALL(7, 0.06), streams: [SHED([P.snow, P.white], { count: 8, gravity: 0.8, swirl: 1 }), ...BIRD_WASH(P.snow)] }, // a flurry behind the puffin
}

/** A pale echo sheds at the moving filament's low stroke. The solid light stays in agy.ts. */
const LIGHT_ECHO = (angle: number, colors: readonly number[], gravity = 0, voice: Partial<Emitter> = {}): Cell => ({
  streams: [{ at: 'tail', follow: true, emitter: { count: 2, life: 0.45, speed: [1, 2], angle: [angle - 0.2, angle + 0.2], gravity, wind: 0.25, colors, alpha: 0.2, envelope: 'fade' } }],
  talking: [{ at: 'nose', emitter: { count: 3, life: 0.55, burst: true, spawn: { ring: 1 }, speed: [4, 5], angle: [0, TAU], colors: [P.white, P.lavender], alpha: 0.38, envelope: 'fade', ...voice } }],
})
/** A constellation's own air: the echo and the voice above, and the dust of its place drifting off its last star. */
const STARS = (echo: Cell, colors: readonly number[], extra: Partial<Emitter> = {}): Cell => ({
  ...echo,
  streams: [...echo.streams!, { at: 'tail', follow: true, emitter: { count: 6, life: 1.4, speed: [0.2, 0.7], angle: [0, TAU], wind: 0.4, colors, alpha: 0.55, envelope: 'twinkle', ...extra } }],
})
const AGY: FamilyCells = {
  message: 'starfall',
  night: nightLight(P.lavender),
  any: {
    streams: [
      ...[0, 1].map((): Stream => ({ at: 'centre', emitter: { count: 1, life: 1.2, speed: [0, 0], angle: [0, 0], colors: [P.white], alpha: 0.6, envelope: 'pulse', size: 2 } })), // two satellites circling the core
      { at: 'tail', follow: true, emitter: { count: 10, life: 1, speed: [0, 0.5], angle: [0, TAU], wind: 0.5, colors: [P.white, P.mauve, P.lavender], alpha: 0.65, envelope: 'twinkle' } }, // stardust shed in its wake
    ],
    lights: [
      { at: 'nose', light: { shape: 'halo', color: P.mauve, alpha: 0.4, reach: 2, modulate: 'pulse' } },
      { at: 'ground', light: { shape: 'pool', color: P.lavender, alpha: 0.2, reach: 4, modulate: 'pulse', from: 0.05 } }, // the stars light the ground beneath them
    ],
  },
  city: STARS(LIGHT_ECHO(DOWN, [P.white, P.lavender]), [P.pink, P.sky]), // neon
  harbor: { ...STARS(LIGHT_ECHO(0, [P.white, P.sky], 0, { angle: [0, Math.PI], speed: [3, 4] }), [P.sky, P.white], { gravity: 2 }), lights: [{ at: 'ground', light: { shape: 'pool', color: P.lavender, alpha: 0.2, reach: 4, modulate: 'pulse', from: 0.05 } }] }, // spray
  beach: STARS(LIGHT_ECHO(DOWN, [P.white, P.sand], 0, { spawn: { ring: 2 } }), [P.sand, P.white], { gravity: 1 }), // sand glitter
  mountains: STARS(LIGHT_ECHO(DOWN, [P.white, P.snow], 0, { angle: [DOWN - 0.7, DOWN + 0.7] }), [P.snow, P.white], { gravity: 0.6 }), // ice glints
  countryside: STARS(LIGHT_ECHO(DOWN, [P.white, P.yellow], 1, { count: 2, delay: 0.1, speed: [3, 3] }), [P.yellow, P.white]), // pollen
  forest: STARS(LIGHT_ECHO(DOWN, [P.white, P.overlay1], 2, { angle: [DOWN - 0.9, DOWN + 0.9], gravity: 2 }), [P.yellow, P.green], { life: 2, swirl: 1.6 }), // fireflies
  desert: STARS(LIGHT_ECHO(UP, [P.white, P.sand], -2, { spawn: { ring: 2 }, speed: [2, 3], swirl: 0.3 }), [P.sand, P.peach], { angle: [UP - 0.6, UP + 0.6], gravity: -1, envelope: 'fade' }), // heat rising
  tundra: STARS(LIGHT_ECHO(UP, [P.white, P.snow], 0, { angle: [UP - 0.9, UP + 0.9] }), [P.green, P.teal], { count: 9, life: 2.2, speed: [0.6, 1.4], angle: [UP - 0.4, UP + 0.4], swirl: 1.4, envelope: 'pulse' }), // an aurora ribbon rising
}

/** A paper craft's own trail in its place, twinkling out behind it. */
const PAPER = (colors: readonly number[], extra: Partial<Emitter> = {}): Stream => ({ at: 'above', follow: true, emitter: { count: 6, life: 1.2, speed: [0.2, 0.8], angle: [0, TAU], gravity: 1, swirl: 0.5, wind: 0.5, colors, alpha: 0.5, envelope: 'twinkle', ...extra } })
const OPENCODE: FamilyCells = {
  message: 'ember',
  night: nightLight(P.yellow),
  any: {
    streams: [
      { at: 'above', follow: true, emitter: { count: 7, life: 1.2, speed: [0.5, 1.5], angle: [UP - 0.4, UP + 0.4], swirl: 0.6, wind: 0.4, colors: [P.yellow, P.peach, P.red], alpha: 0.6, envelope: 'twinkle' } }, // embers rising off the flame and trailing behind
    ],
    talking: [
      { at: 'nose', emitter: { count: 2, life: 0.3, burst: true, speed: [3, 5], angle: [UP - 0.15, UP + 0.15], colors: [P.white, P.yellow], alpha: 0.9, envelope: 'fade' } },
      { at: 'nose', emitter: { count: 5, life: 0.6, burst: true, spawn: { ring: 1 }, speed: [3, 5], angle: [0, TAU], drag: 1, colors: [P.white, P.yellow], alpha: 0.35, envelope: 'fade' } }, // a pale warm halo from the lead lantern
    ],
    lights: [
      { at: 'nose', light: { shape: 'halo', color: P.yellow, alpha: 0.4, reach: 2, modulate: 'pulse', from: 0.05 } }, // each window glows
      { at: 'ground', light: { shape: 'pool', color: P.yellow, alpha: 0.22, reach: 4, from: 0.05 } },
      ...SHADOW,
    ],
  },
  // What each craft adds of its own, from the same flame.
  city: { streams: [PAPER([P.white, P.sky])] }, // scraps of folded paper off the crane
  harbor: { streams: [PAPER([P.sky, P.white], { gravity: 3, angle: [-0.3, 0.3], speed: [0.5, 1.5], envelope: 'fade' })] }, // ripples trailing the paper boat
  beach: { streams: [PAPER([P.peach, P.yellow], { swirl: 1.2 })] }, // ribbon ends off the kite's tail
  mountains: { streams: [PAPER([P.overlay1, P.surface2], { count: 5, life: 1.6, angle: [UP - 0.3, UP + 0.3], gravity: -0.6, alpha: 0.35, envelope: 'fade' })] }, // the lantern's thin smoke
  countryside: { streams: [PAPER([P.peach, P.white], { count: 5, speed: [1, 2.5], angle: [-0.3, 0.3], gravity: 0.4, swirl: 0.8 })] }, // threads of cloth streaming off the carp's tail
  forest: { streams: [PAPER([P.yellow, P.green], { life: 2, swirl: 1.6, gravity: 0 })] }, // fireflies drawn to the lanterns
  desert: { streams: [PAPER([P.yellow, P.peach, P.mauve], { count: 9, gravity: 0.5 })] }, // the carpet's trail of magic dust
  tundra: { streams: [PAPER([P.snow, P.white, P.sky], { gravity: 0.6, swirl: 1 })] }, // frost glittering off the star
}

export const CREW: Record<Kind, FamilyCells> = { codex: CODEX, claude: CLAUDE, agy: AGY, opencode: OPENCODE }

/** The sprite's own box and where its centre was `ago` seconds ago, as `fly` knows them. */
export type Aura = {
  id?: string
  x0: number; y0: number; w: number; h: number; cx: number; cy: number
  kind: Kind; tier: number; seed: number
  /** 0..1: how busy the worker is */
  pace: number
  /** The gait's clock in frames (ten a second at pace 1.0). */
  phase: number
  /** The sprite's centre `ago` seconds ago: the origin a trail follows. */
  path: (ago: number) => Vec
  /** 0..1: hopping now because of a real event. */
  lift: number
  /** The row of the ground the sprite is flying over: what its downdraught reaches. */
  ground: number
  /** The sprite is mirrored (it is flying to the right): its nose, tail and sides, and anything thrown behind it, turn with it. */
  flip?: boolean
  /** A message to or from the root is in flight (ms since it arrived in view; sending, or being sent to). */
  talk?: { ms: number; sending: boolean; over?: number }
  /** ms since it began rolling round to face the other way, while it is turning. */
  turn?: number
  /** Local nose relative to the sprite centre, before mirroring. Codex derives it from the visible generated frame. */
  nose?: Vec
  /** Lamp cells already projected into the visible scene. */
  lamps?: readonly Vec[]
}

/** The sparks thrown off as a craft rolls round: a ring that spins out from it and fades. */
const ROLL: Emitter = { count: 12, life: 0.5, burst: true, spawn: { ring: 2 }, speed: [3, 6], angle: [0, TAU], drag: 1.5, colors: [P.white, P.sky, P.teal], alpha: 0.8, envelope: 'fade', streak: 2 }

const anchorOf = (a: Aura, at: Anchor, dx = 0, dy = 0): Vec => {
  const w = a.w / 2, h = a.h / 2
  const [ox, oy]: Vec = at === 'above' ? [0, -h - 0.5] : at === 'below' ? [0, h + 0.5] : at === 'left' ? [-w + 0.5, 0] : at === 'right' ? [w - 0.5, 0]
    : at === 'nose' ? a.nose ?? [-w, 0] : at === 'tail' ? [w, 0]
      : at === 'ground' ? [0, a.ground - a.cy - 1] : [0, 0]
  return a.flip ? [-(ox + dx), oy + dy] : [ox + dx, oy + dy]
}

/** An emitter as seen in a mirror: a direction that went right goes left, so what trails a craft trails it whichever way it flies. */
const mirrored = (e: Emitter): Emitter => ({ ...e, angle: [Math.PI - e.angle[1], Math.PI - e.angle[0]] })


/** The cells that apply to one sprite: the family's, then the place's. */
const cellsFor = (kind: Kind, place: WakePreset, dark: number) => {
  const family = CREW[kind].any, local = CREW[kind][place]
  return [family, local, ...(dark >= NIGHT_FROM ? [CREW[kind].night, family?.night, local?.night] : [])].filter((cell): cell is Cell => !!cell)
}

/** Draw everything one crew member stirs up and lights. */
export function crewFx(c: Canvas, look: Look, a: Aura): void {
  if (look.effects === false) return
  const place = look.place ?? 'city', wind = clamp(look.wind, 0, 60)
  if (a.kind === 'codex' && !a.nose) {
    const beat = ((Math.floor(a.phase / 1.5) + a.seed) % 8 + 8) % 8
    const [x, y] = craftNose(place, a.tier as Tier, beat)
    a = { ...a, nose: [x - (a.w >> 1), y - (a.h >> 1)] }
  }
  if (a.kind === 'agy' && !a.nose) {
    const [x, y] = agyCore(place, a.tier as Tier, Math.floor(a.phase / AGY_TEMPO) + a.seed)
    a = { ...a, nose: [x - (a.w >> 1), y - (a.h >> 1)] }
  }
  if (a.kind === 'claude' && !a.nose) {
    const [x, y] = creatureNose(place, a.tier as Tier, Math.floor(a.phase / 1.5) + a.seed)
    a = { ...a, nose: [x - (a.w >> 1), y - (a.h >> 1)] }
  }
  if (a.kind === 'opencode' && !a.nose) {
    const [x, y] = lanternNose(place, a.tier as Tier, Math.floor(a.phase / 1.5) + a.seed)
    a = { ...a, nose: [x - (a.w >> 1), y - (a.h >> 1)] }
  }
  const dark = clamp(look.night + (look.blend?.dusk ?? 0) * 0.6 + (look.blend?.dawn ?? 0) * 0.4) // dusk and dawn count as half dark
  const gain = 1 + NIGHT_GAIN * dark
  const boostEmitter = (e: Emitter): Emitter => dark ? { ...e, alpha: e.alpha * gain, speed: [e.speed[0] * gain, e.speed[1] * gain] } : e
  const boostLight = (l: Light): Light => dark ? { ...l, alpha: l.alpha * gain, reach: Math.round(l.reach * gain) } : l
  const strength = 0.35 + 0.65 * a.pace + 0.5 * a.lift
  const t = a.phase / (a.kind === 'agy' ? 30 : 10)
  if (a.kind === 'codex' && place === 'city' && a.turn === undefined) {
    for (const crest of dragonCrests(a.tier as Tier)) {
      const delta = ((a.phase / 1.5 + a.seed - crest.beat) % 8 + 8) % 8, age = delta * 0.15
      if (age >= 0.42) continue
      const ago = age / clockRate(a.pace), [px, py] = a.path(ago), earlier = a.path(ago + 0.6)[0]
      const right = a.talk ? a.flip : px > earlier + 0.5 ? true : px < earlier - 0.5 ? false : a.flip
      const dx = crest.x - (a.w >> 1), x = px + (right ? -dx : dx), y = py + crest.y - (a.h >> 1)
      thrustPuff(c, x, y, age, wind)
    }
  }
  if (a.turn !== undefined && a.kind !== 'agy') emit(c, ROLL, { at: () => [a.cx, a.cy], t: a.turn / 1000, seed: a.seed * 13, strength: 1, wind })
  for (const cell of cellsFor(a.kind, place, dark)) {
    for (const [i, s] of (cell.streams ?? []).entries()) {
      if ((s.tiers && !s.tiers.includes(a.tier)) || (s.from !== undefined && dark < s.from)) continue
      const [ox, oy] = anchorOf(a, s.at, s.dx, s.dy)
      const machine = a.kind === 'codex' && place !== 'city' ? place : undefined
      const creature = a.kind === 'claude'
      if (creature && s.at === 'ground' && a.cy + a.h / 2 < a.ground - 4) continue
      const pose = (ago: number) => creature
        ? creatureStroke(place, a.tier as Tier, Math.floor((a.phase - ago * 10) / 1.5) + a.seed)
        : craftPush(machine!, a.tier as Tier, Math.floor((a.phase - ago * 10) / 1.5) + a.seed)
      const origin = (ago: number): Vec => {
        if (a.kind === 'agy') {
          const beat = a.phase / AGY_TEMPO + a.seed
          const point = s.at === 'centre' ? agyOrbit(place, a.tier as Tier, beat, i * Math.PI) : (() => {
            const pulse = agyPulse(place, a.tier as Tier, Math.floor(beat - ago * 30 / AGY_TEMPO))
            return [pulse.x, pulse.y + (place === 'desert' || place === 'tundra' ? -1 : 1)] as const
          })()
          const dx = point[0] - (a.w >> 1), [px, py] = s.follow ? a.path(ago / clockRate(a.pace)) : [a.cx, a.cy]
          return [px + (a.flip ? -dx : dx), py + point[1] - (a.h >> 1)]
        }
        if (a.kind === 'opencode') {
          const back = s.follow ? ago : 0
          const pose = lanternPose(place, a.tier as Tier, Math.floor((a.phase - back * 10) / 1.5) + a.seed)
          const [x, y] = pose.heat
          const [px, py] = s.follow ? a.path(back / clockRate(a.pace)) : [a.cx, a.cy]
          return [px + (a.flip ? (a.w >> 1) - x : x - (a.w >> 1)), py + y - (a.h >> 1)]
        }
        if (machine || creature) {
          const push = pose(s.follow ? ago : 0), dx = push.x - (a.w >> 1)
          const [px, py] = s.follow ? a.path(ago / clockRate(a.pace)) : [a.cx, a.cy]
          return [px + (a.flip ? -dx : dx), s.at === 'ground' ? a.ground - 1 : py + push.y - (a.h >> 1) + 1]
        }
        const [px, py] = s.follow ? a.path(ago) : [a.cx, a.cy]
        return [px + ox, py + oy]
      }
      const beat = (a.phase / (a.kind === 'agy' ? AGY_TEMPO : 1.5) + a.seed) % 8
      const stroke = a.kind === 'agy' && s.at === 'tail' ? agyPulse(place, a.tier as Tier, Math.floor(beat)).force : machine ? pose(0).force : s.beats ? 0.2 + 0.8 * Math.max(...s.beats.map(b => Math.max(0, Math.cos((beat - b) * Math.PI / 4)) ** 6)) : 1
      const emitter = boostEmitter(s.emitter)
      emit(c, a.flip ? mirrored(emitter) : emitter, { at: origin, t, seed: a.seed * 31 + i, strength: strength * stroke, ...(creature ? { strengthAtBirth: (ago: number) => pose(ago).force } : a.kind === 'opencode' ? { strengthAtBirth: (ago: number) => lanternPose(place, a.tier as Tier, Math.floor((a.phase - ago * 10) / 1.5) + a.seed).force } : {}), wind })
    }
    if (a.talk?.sending && a.talk.over === undefined) for (const [i, s] of (cell.talking ?? []).entries()) { // shouting a message at the root: a burst on the message's own clock
      if (s.tiers && !s.tiers.includes(a.tier)) continue
      const [ox, oy] = anchorOf(a, s.at, s.dx, s.dy)
      // Every sender finishes turning to face the root before it speaks, on the same clock as the packet leaving (scene.ts).
      const spoken = a.talk.ms / 1000 - TURN_LEAD_MS / 1000
      const emitter = boostEmitter(s.emitter)
      emit(c, a.flip ? mirrored(emitter) : emitter, { at: () => [a.cx + ox, a.cy + oy], t: spoken, seed: a.seed * 17 + i, strength: 1, wind })
    }
    for (const l of cell.lights ?? []) {
      if (l.tiers && !l.tiers.includes(a.tier)) continue
      if (l.light.shape === 'pool') {
        if (designFor(a.kind, place).depth === 'far') continue
        const level = l.always === 'day' ? 1 - look.night : dark
        if (level < (l.light.from ?? .12)) continue
        const pulse = l.light.modulate === 'pulse' ? .65 + .35 * Math.sin(t * 5 + a.seed) : 1
        const source: SurfaceLight = { id: a.id, x: a.cx, y: a.y0 + a.h, color: l.light.color, radius: l.light.reach, alpha: l.light.alpha * level * pulse }
        if (look.crewLights) look.crewLights.push(source)
        else surfaceLights(c, look, [source])
        continue
      }
      if (a.kind === 'opencode' && l.at === 'nose') {
        for (const [i, lamp] of lanternPose(place, a.tier as Tier, Math.floor(a.phase / 1.5) + a.seed).lamps.entries()) {
          const [x, y] = a.lamps?.[i] ?? [a.cx + (a.flip ? (a.w >> 1) - lamp.flame[0] : lamp.flame[0] - (a.w >> 1)), a.cy + lamp.flame[1] - (a.h >> 1)]
          shine(c, boostLight(l.light), x + 0.5, y + 0.5,
            t, dark * (0.65 + 0.35 * lamp.force), a.seed)
        }
        continue
      }
      const lamp = a.kind === 'codex' && place !== 'city' && l.light.color === P.red
        ? craftLamp(place, a.tier as Tier, ((Math.floor(a.phase / 1.5) + a.seed) % 8 + 8) % 8) : undefined
      const [ox, oy] = lamp ? [a.flip ? (a.w >> 1) - lamp[0] : lamp[0] - (a.w >> 1), lamp[1] - (a.h >> 1)] : anchorOf(a, l.at, l.dx, l.dy)
      const x = a.cx + ox, y = a.cy + oy
      const light = boostLight(l.toGround ? { ...l.light, reach: Math.max(1, (look.crewGround ?? c.H) - Math.round(y)) } : l.light)
      const burner = a.kind === 'opencode' && !l.always ? 0.25 + 0.75 * lanternPose(place, a.tier as Tier, Math.floor(a.phase / 1.5) + a.seed).force : 1
      const level = (l.always === 'day' ? 1 - look.night : l.always || l.toGround ? 1 : dark) * burner
      shine(c, light, x, y, t, level, a.seed)
      if (l.lands) { const [ex, ey] = coneEnd(light, x, y, t, a.seed); shine(c, boostLight(l.lands), ex, Math.min((look.crewGround ?? c.H) - 1, ey), t, dark, a.seed) }
    }
  }
}

/** Project lights onto visible surfaces; their pixels never become part of a moving crew sprite. */
export function surfaceLights(c: Canvas, look: Pick<Look, 'frame' | 'crewSurfaceAt' | 'crewGround' | 'crewBoxes' | 'crewSurface'>, lights: readonly SurfaceLight[]): void {
  const bodies = Object.values(look.crewBoxes ?? {})
  for (const light of lights) {
    if (light.x < 0 || light.x >= c.W || light.y < 0 || light.y >= c.H) continue
    for (let dx = -light.radius; dx <= light.radius; dx++) {
      const x = Math.round(light.x + dx)
      if (x < 0 || x >= c.W) continue
      const y = look.crewSurfaceAt?.(x, light.y) ?? (look.crewSurfaceAt ? undefined : look.crewGround)
      if (y === undefined || y >= c.H) continue
      const distance = Math.max(0, y - light.y), attenuation = 1 / (1 + distance * distance / 24)
      const water = look.crewSurface?.water
      const rippled = water && y >= water.y && water.spans.some(s => x >= s.x0 && x <= s.x1)
      const alpha = light.alpha * attenuation * (1 - Math.abs(dx) / (light.radius + 1))
      for (let row = 0; row < (rippled ? 3 : 1); row++) {
        const py = y + row, i = py * c.W + x
        if (py >= c.H || bodies.some(b => x >= b.x0 && x <= b.x1 && py >= b.y0 && py <= b.y1)) continue
        const ripple = rippled ? .5 + .5 * Math.sin(x * .8 + row * 2 - look.frame * .13) : 1
        c.px[i] = mix(c.px[i]!, light.color, alpha * ripple / (row + 1))
      }
    }
  }
}

// ── boats ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A footstep reuses the place's ground stream, or its wind-borne material if it has none. */
export function groundStep(c: Canvas, look: Look, kind: Kind, x: number, y: number, seed: number, phase: number): void {
  if (look.effects === false) return
  const place = look.place ?? 'city'
  const source = cellsFor(kind, place, look.night).flatMap(cell => cell.streams ?? []).find(stream => stream.at === 'ground' && (stream.from === undefined || look.night >= stream.from))?.emitter ?? CARRIED[place]
  emit(c, { ...source, count: 3, life: 0.5, burst: true, delay: 0, spawn: { w: 1 }, speed: [0.5, 2], angle: [UP - 0.8, UP + 0.8], gravity: 5, streak: 0, arc: false }, { at: () => [x, y], t: (phase % 6) / 10, seed, strength: 0.7, wind: clamp(look.wind, 0, 60) })
}

// ── the wind ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the wind carries in each place, over the gusts: an emitter that it fully carries. */
export const CARRIED: Record<WakePreset, Emitter> = {
  city: { count: 6, life: 3, speed: [0.5, 1.5], angle: [UP - 0.5, UP + 0.5], gravity: 0.4, swirl: 0.8, wind: 1, colors: [P.overlay2], alpha: 0.5, envelope: 'pulse' }, // dust and scraps of paper
  harbor: { count: 6, life: 2.5, speed: [0.5, 1.5], angle: [UP - 0.8, UP + 0.2], gravity: 1, wind: 1, colors: [P.white, P.sky], alpha: 0.5, envelope: 'pulse' }, // spray off the water
  beach: { count: 8, life: 2.5, speed: [0.5, 1.5], angle: [UP - 0.4, UP + 0.4], gravity: 1.5, wind: 1, colors: [P.sand, P.peach], alpha: 0.5, envelope: 'pulse' }, // blown sand
  mountains: { count: 8, life: 3, speed: [0.5, 1.5], angle: [UP - 0.5, UP + 0.5], gravity: 0.4, swirl: 0.6, wind: 1, colors: [P.snow, P.white], alpha: 0.55, envelope: 'pulse' }, // snow off the ridges
  countryside: { count: 9, life: 3.5, speed: [0.3, 1.2], angle: [UP - 0.8, UP + 0.8], gravity: 0.5, swirl: 1.4, wind: 1, colors: [P.pink, P.yellow], alpha: 0.6, envelope: 'pulse', size: 1 }, // petals and seeds
  forest: { count: 9, life: 3.5, speed: [0.3, 1.2], angle: [UP - 0.8, UP + 0.8], gravity: 0.9, swirl: 1.6, wind: 1, colors: [P.green, P.teal, P.yellow], alpha: 0.6, envelope: 'pulse' }, // leaves
  desert: { count: 14, life: 2.5, speed: [0.5, 2], angle: [UP - 0.3, UP + 0.1], gravity: 0.8, wind: 1, colors: [P.sand, P.peach], alpha: 0.55, envelope: 'pulse' }, // sand
  tundra: { count: 14, life: 3, speed: [0.5, 2], angle: [UP - 0.4, UP + 0.4], gravity: 0.6, swirl: 0.7, wind: 1, colors: [P.white, P.snow], alpha: 0.6, envelope: 'pulse' }, // driven snow
}

/**
 * Gusts over the whole sky (thin soft streaks that run with the wind, more of them and faster as it strengthens) and what the
 * place has to blow about. It is drawn over the scenery and under the crew.
 */
export function windLayer(c: Canvas, look: Look): void {
  if (look.effects === false) return
  const wind = clamp(look.wind, 0, 60), top = (look.crewGround ?? c.H) - 1
  const t = look.frame / 10, speed = 3 + wind / 4 // cells a second
  const sky = (e: Emitter): Emitter => ({ ...e, spawn: { w: c.W / 2, h: top / 2 } })
  const origin: Vec = [c.W / 2, top / 2]
  const gusts: Emitter = sky({
    count: Math.round(clamp(2 + wind / 4, 2, 15)), life: 3.4, speed: [speed * 0.7, speed * 1.1], angle: [-0.03, 0.03], colors: [P.white, P.sky],
    alpha: 0.2 + 0.1 * wind / 60, envelope: 'pulse', streak: 4, // a streak is the particle a moment earlier, so a gust is a short bright line
  })
  const source = { at: () => origin, t, strength: 1 - look.night * 0.4, wind }
  emit(c, gusts, { ...source, seed: look.seed })
  emit(c, sky(CARRIED[look.place ?? 'city']), { ...source, seed: look.seed + 1, strength: 0.6 + wind / 80 })
}
