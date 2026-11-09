import type { WakePreset } from '../../types'
import { type Canvas } from '../pixels'
import { type Emitter, type Light, type Vec, coneEnd, emit, shine, thrustPuff } from './particles'
import { craftLamp, craftNose, craftPush, dragonCrests } from './craft'
import { agyCore, agyOrbit, agyPulse } from './agy'
import { balloonNose, balloonPose } from './balloon'
import { creatureNose, creatureStroke } from './creatures'
import { TURN_LEAD_MS } from '../crew-row'
import { clockRate } from './gait'
import type { Tier } from './design'
import { type Look, P } from './kit'

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
export type Cell = { streams?: readonly Stream[]; lights?: readonly LightAt[]; talking?: readonly Stream[] }

const TAU = Math.PI * 2
const UP = -Math.PI / 2, DOWN = Math.PI / 2
const clamp = (v: number, lo = 0, hi = 1) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo)

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

/** Prop-wash at the ground: one soft fan of local material, rather than a column of light or a cloud of confetti. */
const WASH = (colors: readonly number[]): Stream => ({ at: 'ground', beats: [0, 4], emitter: { count: 3, life: 0.55, spawn: { w: 2 }, speed: [1, 3], angle: [UP - 0.8, UP + 0.8], gravity: 7, wind: 0.5, colors, alpha: 0.18, envelope: 'fade' } })
const BOOST: Stream = { at: 'tail', beats: [0, 4], emitter: { count: 2, life: 0.3, speed: [2, 4], angle: [-0.12, 0.12], colors: [P.white, P.sky], alpha: 0.18, envelope: 'fade' } }

/** Side-on wingtip and cockpit lamps: measured on the generator, never attached to the rectangle's banner or empty corner. */
const PLANE_LIGHTS: readonly LightAt[] = [
  { at: 'centre', light: { shape: 'halo', color: P.red, alpha: 0.25, reach: 0 } }, // actual wingtip comes from the generated pose
  { at: 'nose', light: { shape: 'halo', color: P.white, alpha: 0.2, reach: 0, modulate: 'strobe' } },
]

/** The eye and pulse are in the art; additional lights belong only to actual lamps. */
const CODEX: Partial<Record<WakePreset | 'any', Cell>> = {
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
      { at: 'left', light: { shape: 'halo', color: P.teal, alpha: 0.5, reach: 1, modulate: 'pulse', from: 0.05 } }, // the head's eyes
      { at: 'below', tiers: [3, 4], light: { shape: 'pool', color: P.teal, alpha: 0.22, reach: 6, modulate: 'pulse', from: 0.05 } }, // the pods' light, on whatever is below
    ],
  },
  harbor: {
    streams: [{ at: 'tail', dy: 1, follow: true, beats: [0, 2, 4, 6], emitter: { count: 3, life: 0.7, speed: [1, 2], angle: [-0.08, 0.08], drag: 0.6, colors: [P.white, P.sky], alpha: 0.24, envelope: 'fade' } }],
    talking: SIGNAL('nose', 0, 0, { angle: [Math.PI - 0.3, Math.PI + 0.3], speed: [5, 9] }), // the wheelhouse's horn
  },
  beach: {
    // Cowling slipstream, before the tether: the banner is fabric, not an engine.
    streams: [BOOST], lights: PLANE_LIGHTS, talking: SIGNAL('nose'),
  },
  mountains: {
    streams: [{ ...BOOST, at: 'below', emitter: { ...BOOST.emitter, angle: [DOWN - 0.2, DOWN + 0.2] } }], // the swinging rider's lift pod
    talking: SIGNAL('nose', 0, 0, { speed: [6, 10] }),
  },
  countryside: {
    streams: [
      WASH([P.sand, P.white]),
    ],
    lights: PLANE_LIGHTS, talking: SIGNAL('nose'),
  },
  forest: {
    streams: [WASH([P.leaf, P.overlay1])], // the generated hub anchors leaves directly under the rotor
    talking: SIGNAL('nose', 0, 0, { angle: [Math.PI - 0.2, Math.PI + 0.2] }),
  },
  desert: {
    streams: [
      { ...WASH([P.sand, P.overlay1]), beats: [2, 6] },
    ],
    talking: SIGNAL('nose', 0, 0, { speed: [6, 9] }),
  },
  tundra: {
    streams: [{ ...WASH([P.white, P.snow]), beats: [2, 6] }], // the alternating low strokes of the two runners
    lights: PLANE_LIGHTS, talking: SIGNAL('nose', 0, 0, { speed: [10, 12] }),
  },
}

/** Small cries, chirps and hoots: paired sound arcs from the generated beak after the bird faces Mochi. */
const CALL = (speed: number, delay = 0): readonly Stream[] => [{
  at: 'nose', dx: -1, emitter: { count: 2, life: 0.55, burst: true, delay, speed: [speed, speed + 4], angle: [Math.PI - 0.12, Math.PI + 0.12], colors: [P.white, P.snow], alpha: 0.55, envelope: 'fade', arc: true },
}]
const FEATHER: Stream = { at: 'below', follow: true, emitter: { count: 2, life: 0.65, speed: [0.4, 1.2], angle: [DOWN - 0.35, DOWN + 0.35], gravity: 2, swirl: 0.4, wind: 0.6, colors: [P.white, P.snow], alpha: 0.26, envelope: 'fade' } }
const BIRD_WASH = (color: number): readonly Stream[] => [{ at: 'ground', emitter: { count: 1, life: 0.4, speed: [1, 2], angle: [UP - 0.5, UP + 0.5], gravity: 5, wind: 0.6, colors: [color, P.white], alpha: 0.14, envelope: 'fade' } }]
const CLAUDE: Partial<Record<WakePreset | 'any', Cell>> = {
  any: { lights: SHADOW, streams: [FEATHER] },
  city: { talking: CALL(11), streams: BIRD_WASH(P.overlay1) },
  harbor: { talking: CALL(8), streams: BIRD_WASH(P.sky) },
  beach: { talking: CALL(9, 0.06), streams: BIRD_WASH(P.sand) },
  mountains: { talking: CALL(6, 0.08), streams: BIRD_WASH(P.snow) },
  countryside: { talking: CALL(12), streams: BIRD_WASH(P.yellow) },
  forest: { talking: CALL(4, 0.12), streams: BIRD_WASH(P.leaf), lights: [{ at: 'nose', dx: 2, dy: -1, light: { shape: 'halo', color: P.yellow, alpha: 0.18, reach: 0 } }] },
  desert: { talking: CALL(5, 0.1), streams: BIRD_WASH(P.sand) },
  tundra: { talking: CALL(7, 0.06), streams: BIRD_WASH(P.snow) },
}

/** A pale echo sheds at the moving filament's low stroke. The solid light stays in agy.ts. */
const LIGHT_ECHO = (angle: number, colors: readonly number[], gravity = 0, voice: Partial<Emitter> = {}): Cell => ({
  streams: [{ at: 'tail', follow: true, emitter: { count: 2, life: 0.45, speed: [1, 2], angle: [angle - 0.2, angle + 0.2], gravity, wind: 0.25, colors, alpha: 0.2, envelope: 'fade' } }],
  talking: [{ at: 'nose', emitter: { count: 3, life: 0.55, burst: true, spawn: { ring: 1 }, speed: [4, 5], angle: [0, TAU], colors: [P.white, P.lavender], alpha: 0.38, envelope: 'fade', ...voice } }],
})
const AGY: Partial<Record<WakePreset | 'any', Cell>> = {
  any: {
    streams: [0, 1].map(() => ({ at: 'centre', emitter: { count: 1, life: 1.2, speed: [0, 0], angle: [0, 0], colors: [P.white], alpha: 0.27, envelope: 'pulse' } })),
    lights: [
      { at: 'nose', light: { shape: 'halo', color: P.mauve, alpha: 0.2, reach: 2 } },
      { at: 'ground', light: { shape: 'pool', color: P.lavender, alpha: 0.12, reach: 3, modulate: 'pulse' } },
    ],
  },
  city: LIGHT_ECHO(DOWN, [P.white, P.lavender]),
  harbor: { ...LIGHT_ECHO(0, [P.white, P.sky], 0, { angle: [0, Math.PI], speed: [3, 4] }), lights: [{ at: 'ground', light: { shape: 'pool', color: P.lavender, alpha: 0.2, reach: 4, modulate: 'pulse' } }] },
  beach: LIGHT_ECHO(DOWN, [P.white, P.sand], 0, { spawn: { ring: 2 } }),
  mountains: LIGHT_ECHO(DOWN, [P.white, P.snow], 0, { angle: [DOWN - 0.7, DOWN + 0.7] }),
  countryside: LIGHT_ECHO(DOWN, [P.white, P.yellow], 1, { count: 2, delay: 0.1, speed: [3, 3] }),
  forest: LIGHT_ECHO(DOWN, [P.white, P.overlay1], 2, { angle: [DOWN - 0.9, DOWN + 0.9], gravity: 2 }),
  desert: LIGHT_ECHO(UP, [P.white, P.sand], -2, { spawn: { ring: 2 }, speed: [2, 3], swirl: 0.3 }),
  tundra: LIGHT_ECHO(UP, [P.white, P.snow], 0, { angle: [UP - 0.9, UP + 0.9] }),
}

const OPENCODE: Partial<Record<WakePreset | 'any', Cell>> = {
  any: {
    streams: [
      { at: 'above', follow: true, emitter: { count: 2, life: 0.45, speed: [1, 2], angle: [UP - 0.3, UP + 0.3], swirl: 0.4, wind: 0.25, colors: [P.white, P.sky], alpha: 0.2, envelope: 'fade' } }, // pale heat at the mouth's open side, on the pressure stroke
      { at: 'below', follow: true, emitter: { count: 2, life: 0.65, speed: [0.5, 1.5], angle: [DOWN - 0.5, DOWN + 0.5], gravity: 2, wind: 0.5, colors: [P.yellow, P.white], alpha: 0.25, envelope: 'fade' } }, // two small drifting embers per flare
    ],
    talking: [
      { at: 'nose', emitter: { count: 2, life: 0.3, burst: true, speed: [3, 5], angle: [UP - 0.15, UP + 0.15], colors: [P.white, P.yellow], alpha: 0.9, envelope: 'fade' } },
      { at: 'nose', emitter: { count: 5, life: 0.6, burst: true, spawn: { ring: 1 }, speed: [3, 5], angle: [0, TAU], drag: 1, colors: [P.white, P.sky], alpha: 0.45, envelope: 'fade' } }, // the burner's short hiss ring
    ],
    lights: [
      { at: 'nose', light: { shape: 'halo', color: P.yellow, alpha: 0.2, reach: 2 } },
      { at: 'ground', light: { shape: 'pool', color: P.yellow, alpha: 0.16, reach: 3 } },
      ...SHADOW,
    ],
  },
}

export const CREW: Record<Kind, Partial<Record<WakePreset | 'any', Cell>>> = { codex: CODEX, claude: CLAUDE, agy: AGY, opencode: OPENCODE }

/** The sprite's own box and where its centre was `ago` seconds ago, as `fly` knows them. */
export type Aura = {
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
const cellsFor = (kind: Kind, place: WakePreset) => [CREW[kind].any, CREW[kind][place]].filter((cell): cell is Cell => !!cell)

/** Draw everything one crew member stirs up and lights. */
export function crewFx(c: Canvas, look: Look, a: Aura): void {
  if (look.effects === false) return
  const place = look.place ?? 'city', wind = clamp(look.wind, 0, 60)
  if (a.kind === 'codex') {
    const beat = ((Math.floor(a.phase / 1.5) + a.seed) % 8 + 8) % 8
    const [x, y] = craftNose(place, a.tier as Tier, beat)
    a = { ...a, nose: [x - (a.w >> 1), y - (a.h >> 1)] }
  }
  if (a.kind === 'agy' && !a.nose) {
    const [x, y] = agyCore(place, a.tier as Tier, Math.floor(a.phase / 1.5) + a.seed)
    a = { ...a, nose: [x - (a.w >> 1), y - (a.h >> 1)] }
  }
  if (a.kind === 'claude') {
    const [x, y] = creatureNose(place, a.tier as Tier, Math.floor(a.phase / 1.5) + a.seed)
    a = { ...a, nose: [x - (a.w >> 1), y - (a.h >> 1)] }
  }
  if (a.kind === 'opencode') {
    const [x, y] = balloonNose(place, a.tier as Tier, Math.floor(a.phase / 1.5) + a.seed)
    a = { ...a, nose: [x - (a.w >> 1), y - (a.h >> 1)] }
  }
  const dark = clamp(look.night + (look.blend?.dusk ?? 0) * 0.6 + (look.blend?.dawn ?? 0) * 0.4) // dusk and dawn count as half dark
  const strength = 0.35 + 0.65 * a.pace + 0.5 * a.lift
  const t = a.phase / 10
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
  for (const cell of cellsFor(a.kind, place)) {
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
          const beat = a.phase / 1.5 + a.seed
          const point = s.at === 'centre' ? agyOrbit(place, a.tier as Tier, beat, i * Math.PI) : (() => {
            const pulse = agyPulse(place, a.tier as Tier, Math.floor(beat - ago * 10 / 1.5))
            return [pulse.x, pulse.y + (place === 'desert' || place === 'tundra' ? -1 : 1)] as const
          })()
          const dx = point[0] - (a.w >> 1), [px, py] = s.follow ? a.path(ago / clockRate(a.pace)) : [a.cx, a.cy]
          return [px + (a.flip ? -dx : dx), py + point[1] - (a.h >> 1)]
        }
        if (a.kind === 'opencode') {
          const back = s.follow ? ago : 0
          const pose = balloonPose(place, a.tier as Tier, Math.floor((a.phase - back * 10) / 1.5) + a.seed)
          const [x, y] = s.at === 'above' ? pose.heat : pose.ember
          const [px, py] = s.follow ? a.path(back / clockRate(a.pace)) : [a.cx, a.cy]
          return [px + x - (a.w >> 1), py + y - (a.h >> 1)]
        }
        if (machine || creature) {
          const push = pose(s.follow ? ago : 0), dx = push.x - (a.w >> 1)
          const [px, py] = s.follow ? a.path(ago / clockRate(a.pace)) : [a.cx, a.cy]
          return [px + (a.flip ? -dx : dx), s.at === 'ground' ? a.ground - 1 : py + push.y - (a.h >> 1) + 1]
        }
        const [px, py] = s.follow ? a.path(ago) : [a.cx, a.cy]
        return [px + ox, py + oy]
      }
      const beat = (a.phase / 1.5 + a.seed) % 8
      const stroke = a.kind === 'agy' && s.at === 'tail' ? agyPulse(place, a.tier as Tier, Math.floor(beat)).force : a.kind === 'opencode' ? balloonPose(place, a.tier as Tier, Math.floor(beat)).force : machine ? pose(0).force : s.beats ? 0.2 + 0.8 * Math.max(...s.beats.map(b => Math.max(0, Math.cos((beat - b) * Math.PI / 4)) ** 6)) : 1
      emit(c, a.flip ? mirrored(s.emitter) : s.emitter, { at: origin, t, seed: a.seed * 31 + i, strength: strength * stroke, ...(creature ? { strengthAtBirth: (ago: number) => pose(ago).force } : {}), wind })
    }
    if (a.talk?.sending && a.talk.over === undefined) for (const [i, s] of (cell.talking ?? []).entries()) { // shouting a message at the root: a burst on the message's own clock
      if (s.tiers && !s.tiers.includes(a.tier)) continue
      const [ox, oy] = anchorOf(a, s.at, s.dx, s.dy)
      // Every sender finishes turning to face the root before it speaks, on the same clock as the packet leaving (scene.ts).
      const spoken = a.talk.ms / 1000 - TURN_LEAD_MS / 1000
      emit(c, a.flip ? mirrored(s.emitter) : s.emitter, { at: () => [a.cx + ox, a.cy + oy], t: spoken, seed: a.seed * 17 + i, strength: 1, wind })
    }
    for (const l of cell.lights ?? []) {
      if (l.tiers && !l.tiers.includes(a.tier)) continue
      const lamp = a.kind === 'codex' && place !== 'city' && l.light.color === P.red
        ? craftLamp(place, a.tier as Tier, ((Math.floor(a.phase / 1.5) + a.seed) % 8 + 8) % 8) : undefined
      const [ox, oy] = lamp ? [a.flip ? (a.w >> 1) - lamp[0] : lamp[0] - (a.w >> 1), lamp[1] - (a.h >> 1)] : anchorOf(a, l.at, l.dx, l.dy)
      const x = a.cx + ox, y = a.cy + oy
      const light = l.toGround ? { ...l.light, reach: Math.max(1, (look.crewGround ?? c.H) - Math.round(y)) } : l.light
      const burner = a.kind === 'opencode' && !l.always ? 0.25 + 0.75 * balloonPose(place, a.tier as Tier, Math.floor(a.phase / 1.5) + a.seed).force : 1
      const level = (l.always === 'day' ? 1 - look.night : l.always || l.toGround ? 1 : dark) * burner
      shine(c, light, x, y, t, level, a.seed)
      if (l.lands) { const [ex, ey] = coneEnd(light, x, y, t, a.seed); shine(c, l.lands, ex, Math.min((look.crewGround ?? c.H) - 1, ey), t, dark, a.seed) }
    }
  }
}

// ── boats ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A boat uses the harbor cell too: one water wake and its wheelhouse's send signal, anchored on the actual hull. */
export function boatFx(c: Canvas, look: Look, b: { x: number; y: number; w: number; h: number; tier: number; seed: number; pace: number; phase: number; flip: boolean; talk?: Aura['talk'] }): void {
  const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1)
  crewFx(c, { ...look, place: 'harbor' }, {
    x0: b.x, y0: b.y, w: b.w, h: b.h, cx, cy, kind: 'codex', tier: b.tier, seed: b.seed, pace: b.pace, phase: b.phase,
    path: () => [cx, cy], lift: 0, ground: b.y + b.h, flip: b.flip, talk: b.talk,
  })
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
