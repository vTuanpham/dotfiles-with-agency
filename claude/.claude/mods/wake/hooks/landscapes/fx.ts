import type { WakePreset } from '../../types'
import { type Canvas } from '../pixels'
import { type Emitter, type Light, type Vec, coneEnd, emit, shine } from './particles'
import { type Look, P } from './kit'

// What the air is doing, as data for the engine in particles.ts: the wind, and what each member of the crew stirs up and lights.
//
//   CREW[family].any       every member of the family, wherever it flies
//   CREW[family][place]    added for that family in that place (a helicopter's rotor wash, an owl's eyeshine, a kite's string)
//
// A stream or light may be limited to some classes (`tiers`) and to the dusk and dark (`from`); it hangs on an anchor of the sprite
// (`at`, nudged by `dx`/`dy`) and, with `follow`, leaves from where the sprite WAS when each particle was born, so a trail is its
// own path and bends with it. Strength follows the worker's pace and any event that makes it flare (the `lift`). To add an effect,
// add a row. To give a place or a family its own, add a key. Write a new loop only for a motion or a light the engine lacks.

type Kind = 'codex' | 'agy' | 'claude' | 'opencode'
type Anchor = 'centre' | 'above' | 'below' | 'left' | 'right' | 'nose' | 'tail' | 'eyeL' | 'eyeR' | 'ground'

export type Stream = { at: Anchor; dx?: number; dy?: number; emitter: Emitter; follow?: boolean; tiers?: readonly number[]; from?: number }
export type LightAt = { at: Anchor; dx?: number; dy?: number; light: Light; tiers?: readonly number[]; /** a pool of light where a cone lands */ lands?: Light; /** a column or cone that runs down to the ground */ toGround?: boolean; /** shown whatever the hour (true), or in proportion to daylight ('day'): a shadow, not a lamp */ always?: boolean | 'day' }
export type Cell = { streams?: readonly Stream[]; lights?: readonly LightAt[] }

const TAU = Math.PI * 2
const UP = -Math.PI / 2, DOWN = Math.PI / 2
const clamp = (v: number, lo = 0, hi = 1) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo)

// ── the crew ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a low machine's downdraught does to the ground under it: a column of streaks from the craft, then dust and litter kicked
 * up and swept outward along the ground both ways, with a few larger pieces thrown high that fall back. `colors` is the place's
 * ground (dust, leaves, hay, sand, snow).
 */
const BLOWN = (colors: readonly number[], reach: number, alpha = 0.55): readonly Stream[] => [
  { at: 'below', emitter: { count: 14, life: 0.5, spawn: { w: 2 }, speed: [10, 16], angle: [DOWN - 0.12, DOWN + 0.12], colors: [P.white, P.sky], alpha: alpha * 0.55, envelope: 'fade', streak: 3 } }, // the downdraught itself
  { at: 'ground', emitter: { count: 24, life: 1.1, spawn: { w: 3 }, speed: [4, reach], angle: [-0.35, 0.12], gravity: 3, drag: 1.1, swirl: 0.6, colors, alpha, envelope: 'fade' } }, // swept out to the right
  { at: 'ground', emitter: { count: 24, life: 1.1, spawn: { w: 3 }, speed: [4, reach], angle: [Math.PI - 0.12, Math.PI + 0.35], gravity: 3, drag: 1.1, swirl: 0.6, colors, alpha, envelope: 'fade' } }, // and to the left
  { at: 'ground', emitter: { count: 9, life: 1.3, spawn: { w: 2 }, speed: [3, 8], angle: [UP - 1.1, UP + 1.1], gravity: 15, drag: 0.4, swirl: 0.5, colors: [...colors, P.white], alpha: alpha + 0.2, envelope: 'fade', size: 2 } }, // litter flung up that falls back
]

/** Whatever flies throws a soft shadow on the ground beneath it by day, wider the bigger it is. */
const SHADOW: readonly LightAt[] = [1, 2, 3, 4].map(tier => ({
  at: 'ground', tiers: [tier], always: 'day',
  light: { shape: 'pool', color: P.ink, alpha: 0.3, reach: [1, 2, 4, 7][tier - 1]!, from: 0 },
}))

/** A Codex machine's lights, on every one: red to port, green to starboard and a strobe on top. */
const NAVIGATION: readonly LightAt[] = [
  { at: 'left', light: { shape: 'halo', color: P.red, alpha: 0.7, reach: 1 } },
  { at: 'right', light: { shape: 'halo', color: P.green, alpha: 0.7, reach: 1 } },
  { at: 'above', dy: -1, light: { shape: 'halo', color: P.white, alpha: 0.9, reach: 1, modulate: 'strobe' } },
]

/** What a Codex machine leaves in its wake, in the air of the place that built it. */
const EXHAUST = (colors: readonly number[], alpha: number, extra: Partial<Emitter> = {}): Stream => ({
  at: 'tail', follow: true,
  emitter: { count: 10, life: 1.1, spawn: { h: 0.6 }, speed: [0.3, 1.2], angle: [0, TAU], wind: 0.7, colors, alpha, envelope: 'fade', ...extra },
})

const CODEX: Partial<Record<WakePreset | 'any', Cell>> = {
  any: { lights: [...NAVIGATION, ...SHADOW] },
  city: {
    streams: [
      { at: 'below', follow: true, tiers: [1, 2], emitter: { count: 8, life: 0.6, speed: [0.5, 1.5], angle: [DOWN - 0.5, DOWN + 0.5], colors: [P.teal, P.sky], alpha: 0.5, envelope: 'fade' } }, // a drone's thrust
      ...BLOWN([P.overlay2, P.overlay1, P.sand], 10).map(stream => ({ ...stream, tiers: [3] })), // the helicopter's rotor blows the street up: dust and litter swept out along it
      { at: 'tail', follow: true, tiers: [4], emitter: { count: 16, life: 2.2, speed: [0, 0.4], angle: [0, TAU], wind: 0.6, colors: [P.white, P.sky], alpha: 0.2, envelope: 'fade' } }, // a blimp's long, pale contrail
    ],
    lights: [
      { at: 'nose', dx: 1, dy: 1, tiers: [3], light: { shape: 'cone', color: P.yellow, alpha: 0.55, reach: 12, angle: 2.2, spread: 0.4, modulate: 'sweep', swing: 0.75 }, lands: { shape: 'pool', color: P.yellow, alpha: 0.55, reach: 3 } }, // the helicopter's searchlight, swinging over the roofs and the street
      { at: 'below', tiers: [4], light: { shape: 'pool', color: P.yellow, alpha: 0.3, reach: 6 } }, // light from the blimp's banner and gondola, pooled below
      { at: 'centre', tiers: [4], light: { shape: 'halo', color: P.yellow, alpha: 0.18, reach: 2, modulate: 'pulse' } },
    ],
  },
  harbor: { streams: [{ at: 'below', follow: true, emitter: { count: 8, life: 0.9, speed: [0.5, 2], angle: [DOWN - 0.9, DOWN + 0.9], gravity: 3, colors: [P.white, P.sky], alpha: 0.5, envelope: 'fade' } }] },
  beach: { streams: [{ at: 'below', follow: true, emitter: { count: 8, life: 0.9, speed: [0.5, 2], angle: [DOWN - 0.9, DOWN + 0.9], gravity: 3, colors: [P.white, P.sky], alpha: 0.5, envelope: 'fade' } }] },
  mountains: {
    streams: [EXHAUST([P.white, P.sky], 0.3, { count: 8, life: 1.4 }), ...BLOWN([P.snow, P.white], 6, 0.45).slice(1, 3)], // a paraglider's thin contrail, and the powder its passing lifts off the slope
    lights: [{ at: 'nose', dy: 1, light: { shape: 'cone', color: P.yellow, alpha: 0.3, reach: 7, angle: 2.5, spread: 0.3 } }],
  },
  countryside: {
    streams: [
      EXHAUST([P.overlay2, P.overlay0], 0.42, { count: 14, life: 1.5, spawn: { h: 0.4 }, speed: [0.4, 1.4], angle: [UP - 0.5, UP + 0.5], swirl: 0.5 }), // a crop duster's smoke
      ...BLOWN([P.yellow, P.sand, P.green], 9, 0.55), // the prop-wash flattens the crop and throws up chaff and dust
    ],
    lights: [{ at: 'nose', dy: 1, light: { shape: 'cone', color: P.yellow, alpha: 0.32, reach: 8, angle: 2.6, spread: 0.3 } }],
  },
  forest: { streams: [
    { at: 'below', follow: true, emitter: { count: 8, life: 1.6, spawn: { w: 2 }, speed: [0.2, 0.9], angle: [UP - 1, UP + 1], swirl: 1.1, colors: [P.yellow, P.peach], alpha: 0.7, envelope: 'twinkle' } }, // embers off the lantern
    ...BLOWN([P.green, P.teal, P.leaf], 8, 0.6), // the autogyro's rotor whirls the forest floor's leaves up
  ] },
  desert: { streams: [
    EXHAUST([P.sand, P.peach], 0.45, { count: 12, life: 1, speed: [1, 3], angle: [UP - 0.7, UP + 0.7], gravity: 4 }), // sand kicked up behind
    ...BLOWN([P.sand, P.peach], 12, 0.6), // and thrown off the dune under it
  ] },
  tundra: {
    streams: [EXHAUST([P.white, P.snow], 0.5, { count: 12, life: 1, speed: [1, 3], angle: [UP - 0.8, UP + 0.8], gravity: 3 }), ...BLOWN([P.white, P.snow], 11, 0.6)], // snow thrown off the skis, and the drift the prop-wash stirs
    lights: [{ at: 'nose', dy: 1, light: { shape: 'cone', color: P.yellow, alpha: 0.32, reach: 8, angle: 2.6, spread: 0.3 } }],
  },
}

const CLAUDE: Partial<Record<WakePreset | 'any', Cell>> = {
  any: {
    lights: SHADOW,
    streams: [
      { at: 'left', emitter: { count: 6, life: 1.1, spawn: { w: 1 }, speed: [0.4, 1.8], angle: [DOWN - 0.6, DOWN + 0.6], gravity: 1.2, drag: 0.5, swirl: 0.8, wind: 0.8, colors: [P.pink, P.white], alpha: 0.55, envelope: 'fade' } }, // feathers shaken loose off each wing
      { at: 'right', emitter: { count: 6, life: 1.1, spawn: { w: 1 }, speed: [0.4, 1.8], angle: [DOWN - 0.6, DOWN + 0.6], gravity: 1.2, drag: 0.5, swirl: 0.8, wind: 0.8, colors: [P.pink, P.white], alpha: 0.55, envelope: 'fade' } },
      { at: 'centre', follow: true, emitter: { count: 9, life: 1, speed: [0, 0.5], angle: [0, TAU], wind: 0.8, colors: [P.pink, P.white], alpha: 0.4, envelope: 'twinkle' } }, // a faint wake of motes
    ],
  },
  city: { lights: [{ at: 'below', light: { shape: 'pool', color: P.yellow, alpha: 0.25, reach: 3 } }] }, // street lights catch its belly
  harbor: { lights: [{ at: 'below', light: { shape: 'pool', color: P.sky, alpha: 0.25, reach: 3 } }] },
  beach: {
    lights: [
      { at: 'below', toGround: true, light: { shape: 'column', color: P.text, alpha: 0.5, reach: 12, from: 0 } }, // the kite's string, down to the sand
      { at: 'below', dy: 4, light: { shape: 'halo', color: P.yellow, alpha: 0.8, reach: 1, modulate: 'pulse' } }, // a lantern hung on it at night
    ],
  },
  mountains: { lights: [{ at: 'above', light: { shape: 'pool', color: P.sapphire, alpha: 0.28, reach: 3 } }] }, // moonlight on the wings
  countryside: { streams: [{ at: 'centre', from: 0.2, emitter: { count: 7, life: 1.3, spawn: { w: 4, h: 2 }, speed: [0, 0.5], angle: [0, TAU], swirl: 1, colors: [P.yellow, P.pink], alpha: 0.85, envelope: 'twinkle', size: 2 } }] }, // luminous wing dust
  forest: { lights: [{ at: 'eyeL', tiers: [2, 3, 4], light: { shape: 'halo', color: P.yellow, alpha: 0.6, reach: 1 } }, { at: 'eyeR', tiers: [2, 3, 4], light: { shape: 'halo', color: P.yellow, alpha: 0.6, reach: 1 } }] }, // an owl's eyeshine
  desert: { streams: [{ at: 'centre', from: 0.2, emitter: { count: 6, life: 0.8, spawn: { w: 4, h: 1 }, speed: [0, 0.3], angle: [0, TAU], colors: [P.sky, P.mauve], alpha: 0.7, envelope: 'twinkle' } }] }, // glints off glassy wings
  tundra: {
    lights: [
      { at: 'above', light: { shape: 'pool', color: P.green, alpha: 0.26, reach: 3 } }, // the aurora on white feathers
      { at: 'eyeL', tiers: [2, 3, 4], light: { shape: 'halo', color: P.yellow, alpha: 0.6, reach: 1 } },
      { at: 'eyeR', tiers: [2, 3, 4], light: { shape: 'halo', color: P.yellow, alpha: 0.6, reach: 1 } },
    ],
  },
}

const AGY: Partial<Record<WakePreset | 'any', Cell>> = {
  any: {
    streams: [
      { at: 'centre', follow: true, emitter: { count: 16, life: 0.9, speed: [0, 0.6], angle: [0, TAU], wind: 0.5, colors: [P.white, P.mauve, P.mauve], alpha: 0.8, envelope: 'twinkle', size: 2 } }, // a trail of sparks that twinkle out
      { at: 'centre', emitter: { count: 6, life: 0.5, spawn: { w: 3, h: 2 }, speed: [0, 0], angle: [0, TAU], colors: [P.white], alpha: 0.9, envelope: 'twinkle', size: 2 } }, // glints about the star
    ],
    lights: [
      { at: 'centre', light: { shape: 'halo', color: P.mauve, alpha: 0.32, reach: 2, modulate: 'pulse' } },
      { at: 'centre', light: { shape: 'halo', color: P.white, alpha: 0.6, reach: 0 } },
      { at: 'ground', light: { shape: 'pool', color: P.mauve, alpha: 0.28, reach: 5, modulate: 'pulse' } }, // the star lights the ground beneath it
      ...SHADOW,
    ],
  },
  city: { streams: [{ at: 'centre', follow: true, emitter: { count: 8, life: 0.8, spawn: { h: 1 }, speed: [0, 0.8], angle: [0, TAU], colors: [P.pink, P.sky], alpha: 0.5, envelope: 'twinkle' } }] }, // neon
  forest: { streams: [{ at: 'centre', emitter: { count: 6, life: 2, spawn: { w: 6, h: 3 }, speed: [0.2, 0.7], angle: [0, TAU], swirl: 1.6, colors: [P.yellow], alpha: 0.7, envelope: 'twinkle' } }] }, // fireflies
  desert: { streams: [{ at: 'below', follow: true, emitter: { count: 8, life: 1.2, spawn: { w: 2 }, speed: [0.3, 1], angle: [UP - 0.6, UP + 0.6], gravity: -1, colors: [P.sand, P.peach], alpha: 0.45, envelope: 'fade' } }] }, // heat rising
  tundra: { streams: [{ at: 'above', emitter: { count: 10, life: 2.2, spawn: { w: 2 }, speed: [0.6, 1.4], angle: [UP - 0.4, UP + 0.4], swirl: 1.4, colors: [P.green, P.teal], alpha: 0.5, envelope: 'pulse' } }] }, // an aurora ribbon rising
  mountains: { streams: [{ at: 'centre', emitter: { count: 8, life: 1.4, spawn: { w: 4, h: 2 }, speed: [0, 0.5], angle: [0, TAU], gravity: 0.6, colors: [P.snow, P.white], alpha: 0.6, envelope: 'twinkle' } }] }, // ice glints
}

const OPENCODE: Partial<Record<WakePreset | 'any', Cell>> = {
  any: {
    streams: [
      { at: 'below', dy: -2, emitter: { count: 9, life: 0.4, spawn: { w: 0.6 }, speed: [1.5, 3], angle: [UP - 0.25, UP + 0.25], colors: [P.yellow, P.peach, P.red], alpha: 0.85, envelope: 'fade' } }, // the burner's flame, up into the envelope
      { at: 'above', emitter: { count: 6, life: 1.3, spawn: { w: 3 }, speed: [0.8, 1.8], angle: [UP - 0.3, UP + 0.3], wind: 0.5, colors: [P.white], alpha: 0.16, envelope: 'pulse' } }, // heat shimmering off the top
      { at: 'below', follow: true, emitter: { count: 6, life: 1.3, spawn: { w: 1 }, speed: [0, 0.8], angle: [DOWN - 0.5, DOWN + 0.5], gravity: 2, wind: 0.8, colors: [P.peach, P.red], alpha: 0.55, envelope: 'fade' } }, // embers drifting down behind it
    ],
    lights: [
      { at: 'centre', dy: 1, light: { shape: 'halo', color: P.peach, alpha: 0.3, reach: 3, modulate: 'pulse' } }, // the envelope lit from inside, like a lantern
      { at: 'ground', light: { shape: 'pool', color: P.peach, alpha: 0.26, reach: 5, modulate: 'pulse' } }, // and the burner's glow on the ground below
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
}

const anchorOf = (a: Aura, at: Anchor, dx = 0, dy = 0): Vec => {
  const w = a.w / 2, h = a.h / 2
  const [ox, oy]: Vec = at === 'above' ? [0, -h - 0.5] : at === 'below' ? [0, h + 0.5] : at === 'left' ? [-w + 0.5, 0] : at === 'right' ? [w - 0.5, 0]
    : at === 'nose' ? [-w, 0] : at === 'tail' ? [w, 0] : at === 'eyeL' ? [-1, -h + 1] : at === 'eyeR' ? [1, -h + 1]
      : at === 'ground' ? [0, a.ground - a.cy - 1] : [0, 0]
  return [ox + dx, oy + dy]
}


/** The cells that apply to one sprite: the family's, then the place's. */
const cellsFor = (kind: Kind, place: WakePreset) => [CREW[kind].any, CREW[kind][place]].filter((cell): cell is Cell => !!cell)

/** Draw everything one crew member stirs up and lights. */
export function crewFx(c: Canvas, look: Look, a: Aura): void {
  if (look.effects === false) return
  const place = look.place ?? 'city', wind = clamp(look.wind, 0, 60)
  const dark = clamp(look.night + (look.blend?.dusk ?? 0) * 0.6 + (look.blend?.dawn ?? 0) * 0.4) // dusk and dawn count as half dark
  const strength = 0.35 + 0.65 * a.pace + 0.5 * a.lift
  const t = a.phase / 10
  for (const cell of cellsFor(a.kind, place)) {
    for (const [i, s] of (cell.streams ?? []).entries()) {
      if ((s.tiers && !s.tiers.includes(a.tier)) || (s.from !== undefined && dark < s.from)) continue
      const [ox, oy] = anchorOf(a, s.at, s.dx, s.dy)
      const origin = (ago: number): Vec => { const [px, py] = s.follow ? a.path(ago) : [a.cx, a.cy]; return [px + ox, py + oy] }
      emit(c, s.emitter, { at: origin, t, seed: a.seed * 31 + i, strength, wind })
    }
    for (const l of cell.lights ?? []) {
      if (l.tiers && !l.tiers.includes(a.tier)) continue
      const [ox, oy] = anchorOf(a, l.at, l.dx, l.dy), x = a.cx + ox, y = a.cy + oy
      const light = l.toGround ? { ...l.light, reach: Math.max(1, (look.crewGround ?? c.H) - Math.round(y)) } : l.light
      const level = l.always === 'day' ? 1 - look.night : l.always || l.toGround ? 1 : dark
      shine(c, light, x, y, t, level, a.seed)
      if (l.lands) { const [ex, ey] = coneEnd(light, x, y, t, a.seed); shine(c, l.lands, ex, Math.min((look.crewGround ?? c.H) - 1, ey), t, dark, a.seed) }
    }
  }
}

// ── boats ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a Codex boat stirs on the water, by what it is: foam trailing from the stern, spray at the bow, ripples round the hull, and a funnel's smoke. */
const BOAT: readonly (Stream & { tiers?: readonly number[] })[] = [
  { at: 'tail', dy: 0, emitter: { count: 14, life: 1.8, spawn: { h: 0.4 }, speed: [0.8, 2.5], angle: [-0.12, 0.12], drag: 0.8, colors: [P.white, P.sky], alpha: 0.5, envelope: 'fade', streak: 2 } }, // the wake, spreading astern
  { at: 'nose', emitter: { count: 8, life: 0.7, spawn: { h: 0.4 }, speed: [1.5, 4], angle: [UP - 0.9, UP + 0.2], gravity: 11, colors: [P.white, P.sky], alpha: 0.7, envelope: 'fade' } }, // spray thrown off the bow
  { at: 'centre', dy: 2, emitter: { count: 6, life: 2, spawn: { ring: 3 }, speed: [0.2, 0.7], angle: [0, TAU], colors: [P.sky, P.white], alpha: 0.35, envelope: 'pulse' } }, // ripples widening round the hull
  { at: 'above', dy: -1, tiers: [2, 3, 4], emitter: { count: 10, life: 1.8, spawn: { w: 0.6 }, speed: [0.8, 1.8], angle: [UP - 0.25, UP + 0.25], wind: 0.9, swirl: 0.6, colors: [P.overlay2, P.overlay0], alpha: 0.5, envelope: 'pulse' } }, // smoke from the funnel, streaming downwind
]

/** The effects of one boat: its box on the water, and how busy its worker is. */
export function boatFx(c: Canvas, look: Look, b: { x: number; y: number; w: number; h: number; tier: number; seed: number; pace: number }): void {
  if (look.effects === false) return
  const t = look.frame / 10, wind = clamp(look.wind, 0, 60)
  const aura: Aura = { x0: b.x, y0: b.y, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2, kind: 'codex', tier: b.tier, seed: b.seed, pace: b.pace, phase: look.frame, path: () => [b.x + b.w / 2, b.y + b.h / 2], lift: 0, ground: b.y + b.h }
  BOAT.forEach((s, i) => {
    if (s.tiers && !s.tiers.includes(b.tier)) return
    const [ox, oy] = anchorOf(aura, s.at, s.dx, s.dy)
    emit(c, s.emitter, { at: () => [aura.cx + ox, aura.cy + oy], t, seed: b.seed * 17 + i, strength: 0.4 + 0.6 * b.pace, wind })
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
