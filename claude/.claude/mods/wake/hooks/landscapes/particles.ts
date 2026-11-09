import { type Canvas, hash, mix } from '../pixels'

// The crew's ambient air: wind, rotor wash, feathers, sparks, flames and mechanical thrust. Emitters and lights are data;
// thrustPuff is the small crescent primitive. Passages and send/receive reactions keep their own handcrafted pixels.
//
//   Emitter  a swarm of particles: how many, how long they live, how fast and which way they leave, what pulls them
//            (gravity, drag, swirl, the wind) and what they look like along their life (a colour ramp and an alpha envelope).
//   Light    a steady source of soft light: a halo, a cone, a pool or a column, modulated (a strobe, a pulse, a sweep).
//
// Both are stateless. A particle is a pure function of the clock, its index and a seed (its birth is staggered, its
// parameters come from a hash, its place follows from its age), so nothing is stored between paints, any frame can be drawn on
// its own, and the same inputs always draw the same picture. An emitter may follow a moving origin: a particle is born where
// the origin WAS when it was born (`at(secondsAgo)`), which makes a trail the exact path of whatever left it. Played in
// `reverse`, an emitter gathers in what it would have thrown out: that is how the same description serves both for a message
// leaving a worker and for one landing on it, and for a craft leaving and for one arriving.
//
// Effects are listed as tables of specs next to what they belong to (fx.ts, reactions.ts, exit-styles.ts); to make a new one,
// write a spec there. Add to this file only a new kind of motion or light. All output is soft light (`Canvas.glow`).

export type Vec = readonly [number, number]

/**
 * A downward shock arc: the air a bend pushes down. A bowl (lowest in the middle, its ends rising) that drops three rows and
 * widens from three cells to seven in four crisp steps, a near-white aqua heart with teal then cyan shoulders, each step dimmer.
 * Hard-edged steps, not a blur, so it reads as a shock even at one pixel per cell. No retained particle state.
 */
export function thrustPuff(c: Pick<Canvas, 'glow'>, x: number, y: number, age: number, wind: number): void {
  const life = 0.42, step = Math.floor((age / life) * 4)
  if (age < 0 || step >= 4) return
  const cx = x + Math.round(wind * 0.12 * age), cy = y + 1 + Math.round(step * 1.25), reach = 1 + step, alpha = 0.95 - 0.2 * step
  for (let side = -reach; side <= reach; side++) {
    const edge = Math.abs(side), colour = edge === 0 ? 0xe4eeff : edge === 1 ? 0x89b4fa : 0x74a0f0 // blue, so it reads apart from the teal body
    c.glow(cx + side, cy - Math.floor(edge / 2), colour, alpha * (edge > 1 ? 0.75 : 1))
  }
}

export type Emitter = {
  /** A stream: this many alive at once, born steadily for as long as it runs. A burst: this many, all born at the start. */
  count: number
  /** Seconds one particle lives. */
  life: number
  burst?: boolean
  /** A burst's start, in seconds after the clock's zero: an impact that follows a gathering. */
  delay?: number
  /** Where they are born around the origin: a box (half width, half height), or an ellipse (radius, wider than tall). */
  spawn?: { w?: number; h?: number; ring?: number }
  /** Cells a second at birth, and the direction in radians (0 right, -π/2 up, π/2 down); each is drawn from its range. */
  speed: readonly [number, number]
  angle: readonly [number, number]
  /** Cells a second squared, downward. */
  gravity?: number
  /** Share of its speed lost each second (an exponential, so it coasts to a stop). */
  drag?: number
  /** Sideways wobble: amplitude in cells. */
  swirl?: number
  /** How much of the world's wind carries it, 0..1. */
  wind?: number
  /** Its colour across its life, first to last. */
  colors: readonly number[]
  /** How bright at most; the envelope shapes it over the life. */
  alpha: number
  /** fade: bright at birth, dying away. pulse: rises then falls. twinkle: dying away, flickering. */
  envelope?: 'fade' | 'pulse' | 'twinkle'
  /** 1 a cell; 2 a cell with a faint plus around it. */
  size?: 1 | 2
  /** Cells of streak behind the head, along the way it came. */
  streak?: number
  /** Played backwards: it starts spread out and gathers into the origin. */
  reverse?: boolean
}

export type Source = {
  /** Where the origin was `secondsAgo` seconds ago (the origin of a still emitter ignores the argument). */
  at: (secondsAgo: number) => Vec
  /** The clock in seconds: since a burst began, or for a stream any steadily rising time. */
  t: number
  seed: number
  /** 0..1.5: how strongly this effect shows now (the worker's pace, a reaction's strength). */
  strength: number
  /** The world's wind, km/h. */
  wind: number
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const lerp = (range: readonly [number, number], r: number) => range[0] + (range[1] - range[0]) * r
const byte = (n: number, shift: number) => ((n >> shift) & 255) / 255
const WIND_CELLS = 0.12 // cells a second a particle moves, per km/h of wind that carries it fully

function ramp(colors: readonly number[], f: number): number {
  if (colors.length === 1) return colors[0]!
  const at = clamp(f) * (colors.length - 1), i = Math.min(colors.length - 2, Math.floor(at))
  return mix(colors[i]!, colors[i + 1]!, at - i)
}

function envelope(shape: Emitter['envelope'], f: number, r: number, age: number): number {
  switch (shape ?? 'fade') {
    case 'pulse': return Math.sin(Math.PI * f) ** 1.3
    case 'twinkle': return (1 - f) * (0.45 + 0.55 * Math.sin(age * 22 + r * 6.3) ** 2)
    default: return (1 - f) ** 1.2
  }
}

/** Where one particle is at `age` seconds: its birth origin, its launch, what pulls on it. */
function place(e: Emitter, born: Vec, r: number, spawn: Vec, age: number, wind: number): Vec {
  const speed = lerp(e.speed, byte(r, 0)), angle = lerp(e.angle, byte(r, 8))
  const drag = e.drag ?? 0, reach = drag > 0 ? (1 - Math.exp(-drag * age)) / drag : age
  const swirl = (e.swirl ?? 0) * Math.sin(age * 6 + byte(r, 16) * 6.28)
  return [
    born[0] + spawn[0] + Math.cos(angle) * speed * reach + swirl + (e.wind ?? 0) * wind * WIND_CELLS * age,
    born[1] + spawn[1] + Math.sin(angle) * speed * reach + 0.5 * (e.gravity ?? 0) * age * age,
  ]
}

/** Draw an emitter's particles for this clock. */
export function emit(c: Pick<Canvas, 'glow'>, e: Emitter, s: Source): void {
  const total = e.count, life = Math.max(0.05, e.life)
  for (let k = 0; k < total; k++) {
    const cycle = e.burst ? 0 : Math.floor((s.t + (k / total) * life) / life)
    const r = hash(s.seed * 7919 + k * 131 + cycle * 977)
    const age = e.burst ? s.t - (e.delay ?? 0) : s.t + (k / total) * life - cycle * life
    if (age < 0 || age >= life) continue
    const shown = e.reverse ? life - age : age // gathering in is the same particle run from its end to its start
    const f = shown / life
    const born = e.burst ? s.at(0) : s.at(age) // a stream's particle starts where the origin was when it was born
    const around = e.spawn?.ring
      ? (() => { const a = byte(r, 24) * 6.2832; return [Math.cos(a) * e.spawn.ring! * 1.4, Math.sin(a) * e.spawn.ring! * 0.7] as const })()
      : ([(byte(r, 24) * 2 - 1) * (e.spawn?.w ?? 0), (byte(r, 4) * 2 - 1) * (e.spawn?.h ?? 0)] as const)
    const [x, y] = place(e, born, r, around, shown, s.wind)
    const alpha = clamp(envelope(e.envelope, f, byte(r, 12), shown) * e.alpha * s.strength)
    if (alpha <= 0.01) continue
    const color = ramp(e.colors, f)
    c.glow(Math.round(x), Math.round(y), color, alpha)
    if (e.size === 2) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) c.glow(Math.round(x) + dx, Math.round(y) + dy, color, alpha * 0.4)
    for (let j = 1; j <= (e.streak ?? 0); j++) { // a streak: the same particle a moment earlier, fainter
      const [px, py] = place(e, born, r, around, e.reverse ? shown + j * 0.03 : Math.max(0, shown - j * 0.03), s.wind)
      c.glow(Math.round(px), Math.round(py), color, alpha * (1 - j / (e.streak! + 1)) * 0.7)
    }
  }
}

export type Light = {
  shape: 'halo' | 'cone' | 'pool' | 'column'
  color: number
  alpha: number
  /** Cells: a halo's and a pool's radius, a cone's or column's length. */
  reach: number
  /** A cone's direction in radians (0 right, π/2 down) and its full opening. */
  angle?: number
  spread?: number
  /** How it changes with time: a strobe flashes one beat in six, a pulse breathes, a sweep swings a cone through `swing` radians. */
  modulate?: 'steady' | 'strobe' | 'pulse' | 'sweep'
  swing?: number
  /** Only as dark as this or darker (0 day .. 1 deep night); lights come on with the dusk. */
  from?: number
}

/** Draw one light at (x, y). `dark` is how dark it is, 0..1; `t` is seconds. */
export function shine(c: Canvas, l: Light, x: number, y: number, t: number, dark: number, seed: number): void {
  if (dark < (l.from ?? 0.12)) return
  const level = (l.alpha * dark) * (l.modulate === 'pulse' ? 0.65 + 0.35 * Math.sin(t * 5 + seed) : l.modulate === 'strobe' ? (Math.floor(t * 1.6 + seed) % 6 === 0 ? 1.2 : 0.15) : 1)
  if (level <= 0.01) return
  const px = Math.round(x), py = Math.round(y)
  switch (l.shape) {
    case 'halo':
      c.glow(px, py, l.color, level)
      for (let r = 1; r <= l.reach; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) c.glow(px + dx, py + dy, l.color, level * 0.35 / r)
      break
    case 'cone': {
      const angle = (l.angle ?? Math.PI / 2) + (l.modulate === 'sweep' ? Math.sin(t * 0.8 + seed) * (l.swing ?? 0.6) : 0), spread = l.spread ?? 0.5
      for (let r = 1; r <= l.reach; r++) for (const side of [-1, -0.5, 0, 0.5, 1]) {
        const a = angle + side * spread / 2
        c.glow(px + Math.round(Math.cos(a) * r), py + Math.round(Math.sin(a) * r * 0.9), l.color, level * (1 - r / (l.reach + 2)) * (side === 0 ? 1 : 0.55))
      }
      break
    }
    case 'pool':
      for (let dx = -l.reach; dx <= l.reach; dx++) {
        c.glow(px + dx, py, l.color, level * (1 - Math.abs(dx) / (l.reach + 1)))
        c.glow(px + dx, py - 1, l.color, level * 0.5 * (1 - Math.abs(dx) / (l.reach + 1)))
      }
      break
    case 'column':
      for (let r = 0; r < l.reach; r++) c.glow(px, py + r, l.color, level * (1 - r / l.reach))
      break
  }
}

/** Where the cone of a light sweeping through `swing` radians ends at `reach` cells: for a pool of light to land there. */
export function coneEnd(l: Light, x: number, y: number, t: number, seed: number): Vec {
  const angle = (l.angle ?? Math.PI / 2) + (l.modulate === 'sweep' ? Math.sin(t * 0.8 + seed) * (l.swing ?? 0.6) : 0)
  return [x + Math.cos(angle) * l.reach, y + Math.sin(angle) * l.reach * 0.9]
}
