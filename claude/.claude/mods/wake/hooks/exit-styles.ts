// The styles for exits.ts: one way of leaving per craft and per place. Pure pixels; `exits.ts` runs them.
//
// A style gets `p`, how far through the *exit* it is (0..1), and must leave nothing visible at p = 1 (that is the end of an
// exit and the start of an arrival, which plays the same style backwards). Trails go through `behind` and `flip`, so they stay
// behind the craft whichever way it moves. Every family has a style for every landscape:
//   Codex     the machine its place builds (a dragon, a boat, a paraglider, a biplane, an autogyro, a skiff, a ski plane)
//   Claude    the place's creature in flight (soar, skim, loop, spiral, swoop, flit, thermal, ghost)
//   agy       how its sparks end (ring, ripple, glints, snow, fireflies, blink, dust devil, aurora ribbon)
//   OpenCode  where its lantern goes (pops to confetti, bubbles, petals, spores or flurry; drifts, mists or shimmers away)
// To add or change one, write a function here and name it in the family's table.
import { P } from './landscapes/kit'
import { lanternInk } from './landscapes/lantern'
import { type Canvas, hash, mix } from './pixels'
import { designFor } from './landscapes/design'
import type { WakePreset } from '../types'
import { PASSAGE_STYLES } from './passage-styles'

export type Dot = { x: number; y: number; color: number }
export type Look = { dx?: number; dy?: number; sx?: number; sy?: number; dissolve?: number; tint?: number; tintBy?: number; filter?: (dot: Dot) => boolean; offset?: (dot: Dot) => readonly [number, number]; clipBelow?: number }
export type Ctx = {
  c: Canvas
  p: number
  seed: number
  arriving: boolean
  cx: number
  cy: number
  x0: number
  x1: number
  y0: number
  y1: number
  /** Draw the sprite again: moved, stretched about its centre, with a share of its pixels dissolved, tinted toward a colour. */
  sprite(look: Look): void
  /** Light one pixel toward a colour by `alpha` (0..1); outside the scene is ignored. */
  lit(x: number, y: number, color: number, alpha: number): void
  /** The point in the style's own time `i` steps behind the craft, however it is moving (earlier on a leave, later on an arrival). */
  behind(i: number, step: number): number
  /** 1 when the craft moves the way the style was written, -1 when it is coming back: a wake or a plume sits on the other side. */
  flip: 1 | -1
}
export type Style = (k: Ctx) => void

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const ease = (t: number) => clamp(t) * clamp(t) * (3 - 2 * clamp(t))
const dirOf = (k: Ctx) => (k.seed % 2 ? 1 : -1)
const spot = (k: Ctx, i: number, salt: number, range: number) => (hash(i * salt + k.seed) % (range * 2 + 1)) - range // a stable offset

// ── Codex: the machine each place builds ─────────────────────────────────────────────────────────────────────────────────────

/** City: the dragon rises, charges (a halo, a shake, going white), then hyperdrives off in a streak of light (arriving, it warps in and settles). */
const hyperdrive: Style = k => {
  const { p, cx, cy, c } = k
  const rise = ease(p / 0.5) * Math.max(0, Math.min(7, k.y0 - 1))
  if (p < 0.55) {
    const charge = clamp((p - 0.3) / 0.25)
    k.sprite({ dy: -rise, dx: Math.round(Math.sin(p * 70) * charge), tint: P.white, tintBy: charge * 0.6 })
    for (let a = 0; a < 10 && charge > 0.1; a++) { // a halo draws in as it charges
      const angle = (a / 10) * Math.PI * 2, r = 6 - charge * 3
      k.lit(cx + Math.cos(angle) * r * 1.4, cy - rise + Math.sin(angle) * r * 0.8, P.sky, charge * 0.7)
    }
    return
  }
  const q = (p - 0.55) / 0.45, dx = q * q * (c.W - cx + 30), y = cy - rise
  // stretched along its flight and thinned across it, so the dragon turns into a bolt of light
  k.sprite({ dy: -rise, dx, sx: 1 + q * q * 14, sy: Math.max(0.25, 1 - q * 0.8), tint: P.white, tintBy: 0.5 + 0.5 * q })
  if (q < 0.15) for (let a = 0; a < 12; a++) k.lit(cx + Math.cos(a) * (1 + q * 40) * 1.4, y + Math.sin(a) * (1 + q * 40) * 0.8, P.white, 0.8 * (1 - q / 0.15)) // the flash
  for (let x = Math.max(0, cx - 4); x < Math.min(c.W, cx + dx); x++) k.lit(x, y, P.white, 0.55 * (1 - q) * clamp(1 - (cx + dx - x) / 44)) // the streak it leaves
}

/** A boat under sail for the horizon, its wake behind the hull, dissolving into the haze. `chop` is how much the water throws it about. */
const sailing = (chop: number, wake: number): Style => k => {
  const { p, cx, y1 } = k
  const dir = dirOf(k)
  const dx = dir * p ** 1.7 * k.c.W * 0.6
  k.sprite({ dx, dy: Math.round(Math.sin(p * 20) * chop), dissolve: clamp((p - 0.5) / 0.5) })
  for (let i = 0; i < 12; i++) k.lit(cx + dx - k.flip * dir * (i * 2 + 2), y1, wake, 0.5 * (1 - i / 12) * (1 - p))
}

/** Mountains: the paraglider finds a thermal, spiralling up and away, a thin contrail behind it, until it is a speck. */
const paraglide: Style = k => {
  const at = (q: number) => ({ x: k.cx + q * 22 + Math.sin(q * Math.PI * 3) * 4, y: k.cy - q * 13 })
  const dissolve = clamp((k.p - 0.55) / 0.45), here = at(k.p)
  k.sprite({ dx: here.x - k.cx, dy: here.y - k.cy, dissolve })
  for (let i = 1; i <= 9; i++) {
    const q = k.behind(i, 0.03)
    if (q >= 0 && q <= 1) k.lit(at(q).x, at(q).y, P.white, 0.4 * (1 - i / 10) * (1 - dissolve))
  }
}

/** Countryside: the biplane opens the throttle, climbs and roars off, puffing smoke. */
const biplane: Style = k => {
  const at = (q: number) => ({ x: q * q * (k.c.W - k.cx + 24), y: -(q ** 1.5) * 9 + Math.sin(q * 30) * 0.4 })
  const here = at(k.p)
  k.sprite({ dx: here.x, dy: here.y })
  for (let i = 1; i <= 10; i++) {
    const q = k.behind(i, 0.035)
    if (q >= 0 && q <= 1) k.lit(k.cx + at(q).x - 2 * k.flip, k.cy + at(q).y + i * 0.25, P.overlay2, 0.55 * (1 - i / 11))
  }
}

/** Forest: the autogyro lifts straight up, swaying, and comes apart into leaves that drift down. (Arriving, leaves gather.) */
const gyro: Style = k => {
  const lift = k.p * Math.max(0, k.cy * 0.8)
  const dissolve = clamp((k.p - 0.4) / 0.6)
  k.sprite({ dy: -lift, dx: Math.sin(k.p * 9) * 1.5, dissolve })
  for (let i = 0; i < 7 && k.p > 0.3; i++) {
    const fall = (k.p - 0.3) * (6 + (i % 3) * 4)
    k.lit(k.cx + spot(k, i, 13, 4) + Math.sin(k.p * 6 + i) * 1.5, k.cy - lift * 0.6 + fall, i % 2 ? P.green : P.teal, 0.9 * (1 - k.p))
  }
}

/** Desert: the sand skiff catches a gust and speeds off, kicking up a plume of dust that thins into shimmer. */
const skiff: Style = k => {
  const dx = k.p * k.p * (k.c.W - k.cx + 14)
  k.sprite({ dx, dissolve: clamp((k.p - 0.7) / 0.3) })
  for (let i = 1; i <= 9; i++) k.lit(k.cx + dx - k.flip * i * 2, k.y1 - (i % 3), P.sand, 0.6 * (1 - i / 10) * (1 - k.p * 0.5))
}

/** Tundra: the ski plane runs along the snow, lifts off and turns to aurora glitter. */
const skiplane: Style = k => {
  const run = clamp(k.p / 0.45), climb = clamp((k.p - 0.45) / 0.55)
  const dx = run * run * k.c.W * 0.25 + climb * k.c.W * 0.25, dy = -climb * climb * 10
  const dissolve = clamp((climb - 0.6) / 0.4)
  k.sprite({ dx, dy, dissolve })
  if (run < 1) for (let i = 1; i <= 6; i++) k.lit(k.cx + dx - k.flip * i * 2, k.y1 - (i % 2), P.white, 0.6 * (1 - i / 7)) // spray off the skis
  for (let i = 0; i < 8 && dissolve > 0; i++) k.lit(k.cx + dx + spot(k, i, 1, 5), k.cy + dy + spot(k, i, 7, 3), i % 2 ? P.green : P.teal, 0.9 * (1 - dissolve)) // glitter
}

const CODEX: Record<string, Style> = {
  city: hyperdrive, harbor: sailing(0.5, P.white), beach: biplane, mountains: paraglide, // (the beach's banner plane roars off like the biplane)
  countryside: biplane, forest: gyro, desert: skiff, tundra: skiplane,
}

// ── Claude: the creature's flight, by place ──────────────────────────────────────────────────────────────────────────────────────

type Flight = { path: (p: number, k: Ctx) => { dx: number; dy: number }; dissolveFrom: number; shed: 'feather' | 'leaf' | 'shimmer' | 'snow' | 'spray'; ghost?: boolean }

const FLIGHT: Record<string, Flight> = {
  city: { path: (p, k) => ({ dx: dirOf(k) * p * k.c.W * 0.35, dy: -p * 11 + Math.sin(p * 16) * 1.2 }), dissolveFrom: 0.6, shed: 'feather' }, // soars up and away
  harbor: { path: (p, k) => ({ dx: dirOf(k) * p * k.c.W * 0.45, dy: Math.sin(p * 10) - p * 2 }), dissolveFrom: 0.55, shed: 'spray' }, // skims the water out to sea
  beach: { path: (p, k) => ({ dx: dirOf(k) * p * 16 + Math.sin(p * 4 * Math.PI) * 4, dy: -p * 7 - (1 - Math.cos(p * 4 * Math.PI)) * 2.5 }), dissolveFrom: 0.65, shed: 'spray' }, // a looping gull
  mountains: { path: (p, k) => ({ dx: dirOf(k) * p * 10 + Math.sin(p * 9) * 6, dy: -p * 13 + Math.cos(p * 9) * 2 }), dissolveFrom: 0.6, shed: 'feather' }, // an eagle spiralling up a thermal
  countryside: { path: (p, k) => ({ dx: dirOf(k) * p * k.c.W * 0.4, dy: p < 0.3 ? Math.sin((p / 0.3) * Math.PI) * 3 : -((p - 0.3) ** 1.4) * 18 }), dissolveFrom: 0.62, shed: 'feather' }, // a swoop, then up
  forest: { path: (p, k) => ({ dx: dirOf(k) * p * k.c.W * 0.2, dy: -Math.abs(Math.sin(p * 14)) * 3 - p * 6 }), dissolveFrom: 0.5, shed: 'leaf' }, // flits up into the canopy
  desert: { path: (p, k) => ({ dx: dirOf(k) * p * 6 + Math.sin(p * 14) * 3, dy: -p * 14 }), dissolveFrom: 0.6, shed: 'shimmer' }, // a hawk circling up in the heat
  tundra: { path: (p, k) => ({ dx: dirOf(k) * p * k.c.W * 0.25, dy: -p * 3 }), dissolveFrom: 0.3, shed: 'snow', ghost: true }, // an owl, silent, fading as it goes
}

/** What the bird leaves behind it: a feather, a leaf, heat shimmer, a puff of snow, or spray. */
function shed(k: Ctx, kind: Flight['shed'], x: number, y: number) {
  const { p } = k
  if (kind === 'spray') { for (let i = 0; i < 5 && p < 0.35; i++) k.lit(x + spot(k, i, 3, 3), k.y1 - (i % 2), P.white, 0.7 * (1 - p / 0.35)); return }
  if (p < 0.15 || k.arriving) return
  const age = p - 0.15
  if (kind === 'feather') k.lit(x + Math.sin(p * 14) * 2, y - 2 + age * 16, P.pink, 0.85 * (1 - p))
  if (kind === 'leaf') for (let i = 0; i < 3; i++) k.lit(x + spot(k, i, 5, 3) + Math.sin(p * 9 + i) * 2, y + age * (8 + i * 3), i % 2 ? P.green : P.teal, 0.85 * (1 - p))
  if (kind === 'shimmer') for (let i = 0; i < 4; i++) k.lit(x + spot(k, i, 9, 2) + Math.sin(age * 20 + i) * 1.2, y + 2 - age * 10 - i * 2, P.peach, 0.6 * (1 - p))
  if (kind === 'snow') for (let i = 0; i < 4; i++) k.lit(x + spot(k, i, 11, 4), y + age * (4 + i * 2), P.white, 0.7 * (1 - p))
}

const flight = (place: string): Style => k => {
  const f = FLIGHT[place] ?? FLIGHT.city!
  const here = f.path(k.p, k)
  k.sprite({ dx: here.dx, dy: here.dy, dissolve: clamp((k.p - f.dissolveFrom) / (1 - f.dissolveFrom)), ...(f.ghost ? { tint: P.white, tintBy: clamp(k.p * 1.3) * 0.6 } : {}) })
  shed(k, f.shed, k.cx + here.dx, k.cy + here.dy)
}

// ── agy: how the sparks end, by place ────────────────────────────────────────────────────────────────────────────────────────

/** `q` is 0..1 through the burst that follows the gathering into one star. */
type Burst = (k: Ctx, q: number) => void

const sprinkle = (k: Ctx, q: number, count: number, at: (i: number) => [number, number, number, number]) => {
  for (let i = 0; i < count; i++) { const [x, y, color, alpha] = at(i); k.lit(x, y, color, alpha * (1 - q)) }
}

const BURST: Record<string, Burst> = {
  city: (k, q) => sprinkle(k, q, 12, i => [k.cx + Math.cos((i / 12) * Math.PI * 2 + (k.seed % 7) * 0.3) * q * 13 * 1.4, k.cy + Math.sin((i / 12) * Math.PI * 2 + (k.seed % 7) * 0.3) * q * 13 * 0.9, i % 2 ? P.white : P.mauve, 1]), // a ring of sparks
  harbor: (k, q) => { // ripples spreading over the water
    for (let ring = 0; ring < 3; ring++) {
      const r = q * 15 - ring * 4
      if (r > 0) for (let a = 0; a < 24; a++) k.lit(k.cx + Math.cos((a / 24) * Math.PI * 2) * r * 1.7, k.y1 + 1 + Math.sin((a / 24) * Math.PI * 2) * r * 0.3, ring ? P.sky : P.white, 0.8 * (1 - q))
    }
  },
  beach: (k, q) => { // sun glints, each twinkling in its own time
    for (let i = 0; i < 8; i++) {
      const a = Math.sin(q * Math.PI * (1 + (i % 3))) ** 2 * (1 - q), x = k.cx + spot(k, i, 17, 12), y = k.cy + spot(k, i, 5, 5)
      k.lit(x, y, P.white, a)
      if (a > 0.4) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) k.lit(x + dx, y + dy, P.yellow, a * 0.5)
    }
  },
  mountains: (k, q) => sprinkle(k, q, 12, i => [k.cx + spot(k, i, 13, 6) * q * 1.3 + Math.sin(q * 6 + i), k.cy + q * 14 * (0.5 + (i % 3) / 3), P.white, 0.9]), // drifts down as snow
  countryside: (k, q) => sprinkle(k, q, 10, i => [k.cx + spot(k, i, 7, 12) * q + Math.sin(q * 7 + i) * 2, k.cy + spot(k, i, 11, 4) * q + Math.cos(q * 5 + i) * 1.5, i % 2 ? P.yellow : P.green, 0.5 + 0.5 * Math.sin(q * 20 + i * 3)]), // fireflies wandering off
  forest: (k, q) => { // fireflies that blink and go out one by one
    for (let i = 0; i < 9; i++) {
      const out = 0.4 + i * 0.06
      if (q < out) k.lit(k.cx + spot(k, i, 3, 8), k.cy + spot(k, i, 5, 4) - q * 3, i % 2 ? P.teal : P.yellow, Math.sin(q * 26 + i * 2) > 0 ? 0.9 : 0.2)
    }
  },
  desert: (k, q) => sprinkle(k, q, 14, i => [k.cx + Math.cos(i * 0.6 + q * 9) * q * 12 * 1.3, k.cy - q * 8 + Math.sin(i * 0.6 + q * 9) * q * 12 * 0.5, i % 2 ? P.sand : P.peach, 0.9]), // a dust devil
  tundra: (k, q) => { // the sparks stretch into a wavering aurora ribbon
    for (let j = 0; j < 16; j++) k.lit(k.cx + Math.sin(j * 0.5 + q * 8) * 2.5, k.cy - j - q * 10, mix(P.green, P.teal, j / 16), (1 - j / 16) * (1 - q))
  },
}

const spark = (place: string): Style => k => {
  const { p } = k
  if (p < 0.35) {
    const squeeze = 1 - ease(p / 0.35) * 0.85
    k.sprite({ sx: squeeze, sy: squeeze, tint: P.white, tintBy: 0.5 })
    return
  }
  const q = (p - 0.35) / 0.65
  ;(BURST[place] ?? BURST.city!)(k, q)
  if (q < 0.25) for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const) k.lit(k.cx + dx, k.cy + dy, P.white, 1 - q * 4)
}

// ── OpenCode: where the lantern goes, by place ───────────────────────────────────────────────────────────────────────────────

/** How the lantern ends. `fade` styles keep the lantern and let it dissolve; the rest hide it at the top and release a burst. */
type Ending = { wind: number; fade?: (k: Ctx, r: number) => void; burst?: { colors: number[]; gravity: number; spread: number; sway?: number; ring?: number } }

const ENDING: Record<string, Ending> = {
  city: { wind: 0, burst: { colors: [P.green, P.yellow, P.red, P.blue, P.lavender, P.white], gravity: 9, spread: 8, ring: P.white } }, // pops into confetti
  harbor: { wind: 14, fade: () => undefined }, // drifts out to sea on the wind, fading
  beach: { wind: 3, burst: { colors: [P.white, P.sky, P.sapphire, P.blue], gravity: 1.5, spread: 6, sway: 1.5, ring: P.sky } }, // bubbles that hang and wobble
  mountains: { wind: 2, fade: (k, r) => { for (let i = 0; i < 8; i++) k.lit(k.cx + Math.sin(2) * 1.5 + spot(k, i, 5, 5) * r, 2 + spot(k, i, 7, 2) * r, P.white, 0.7 * (1 - r)) } }, // lost in the clouds
  countryside: { wind: 0, burst: { colors: [P.green, P.yellow, P.white, P.lavender], gravity: 7, spread: 6, sway: 2.5 } }, // petals flutter down
  forest: { wind: 0, burst: { colors: [P.green, P.white, P.yellow, P.green], gravity: 6, spread: 7, sway: 2 } }, // leaves and spores
  desert: { wind: 0, fade: (k, r) => { for (let i = 0; i < 6; i++) k.lit(k.cx + Math.sin(2) * 1.5 + Math.sin(r * 18 + i) * 2, 3 - r * 6 - i, P.peach, 0.6 * (1 - r)) } }, // evaporates in the heat
  tundra: { wind: 0, burst: { colors: [P.white, P.snow, P.sky, P.white], gravity: 8, spread: 7, sway: 1.5 } }, // bursts into a flurry
}

const lantern = (place: string): Style => k => {
  const { p, cx, cy } = k
  const end = ENDING[place] ?? ENDING.city!
  const top = 2, rise = Math.max(0, cy - top), dir = dirOf(k)
  if (p < 0.7) {
    const q = p / 0.7
    k.sprite({ dy: -ease(q) * rise, dx: Math.sin(q * 8) * 1.5 + dir * end.wind * q * q })
    return
  }
  const r = (p - 0.7) / 0.3, hx = cx + Math.sin(8) * 1.5 + dir * end.wind
  if (end.fade) {
    k.sprite({ dy: -rise - r * 2, dx: Math.sin(8) * 1.5 + dir * end.wind * (1 + r * 0.7), dissolve: r })
    end.fade(k, r)
    return
  }
  const { colors, gravity, spread, sway = 0, ring } = end.burst!
  if (ring !== undefined) for (let a = 0; a < 14; a++) k.lit(hx + Math.cos(a) * (1 + r * 7) * 1.3, top + Math.sin(a) * (1 + r * 7) * 0.8, ring, 0.8 * (1 - r)) // the pop
  colors.forEach((color, i) => k.lit(hx + Math.cos(i * 1.7) * r * spread + Math.sin(r * 9 + i) * sway, top + Math.sin(i * 1.7) * r * (spread / 2) + r * r * gravity, color, 1 - r))
}

// ── An interrupt: the root cuts a worker off, and it is struck down ───────────────────────────────────────────────

/**
 * A worker whose turn was interrupted does not take its bow. A jagged bolt drops out of the sky onto it and flashes it white,
 * then it is knocked out of the air: it shudders, goes red, and falls and drifts away dissolving, shedding what it is made of
 * (a machine smoke and sparks, a creature feathers, agy's star a scatter of embers, a lantern paper scraps and sparks).
 * The same fall for every landscape, since what interrupted it is not from the place; only the debris is the family's.
 */
const struck = (kind: 'codex' | 'agy' | 'claude' | 'opencode'): Style => k => {
  const { p } = k, hit = 0.12, q = clamp((p - hit) / (1 - hit))
  if (p < hit + 0.05) for (let i = 0, bottom = clamp(p / hit) * 12; i < bottom; i++) k.lit(k.cx + (i % 3 === 1 ? 1 : i % 3 === 2 ? -1 : 0), k.cy - 12 + i, i % 2 ? P.white : P.yellow, 1) // the bolt
  const flash = p < hit ? 0 : Math.exp(-(p - hit) * 14), fall = q * q * 14, drift = dirOf(k) * q * 8
  k.sprite({ dx: drift + (p > hit && p < 0.35 ? Math.sin(p * 90) : 0), dy: fall, dissolve: clamp((q - 0.45) / 0.55), tint: flash > 0.25 ? P.white : P.red, tintBy: p < hit ? 0 : flash > 0.25 ? flash : 0.45 * (1 - q) })
  if (p < hit) return
  const x = k.cx + drift, y = k.cy + fall, left = 1 - q
  if (kind === 'codex') for (let i = 0; i < 6; i++) { // smoke rising off it, and sparks falling
    k.lit(x + spot(k, i, 3, 2), y - i * 1.6 - q * 4, P.surface2, 0.7 * left)
    if (i < 5) k.lit(x + spot(k, i, 7, 3), y + q * 10 + i, i % 2 ? P.peach : P.red, 0.9 * left)
  }
  if (kind === 'claude') for (let i = 0; i < 4; i++) {
    const fx = x + spot(k, i, 5, 4) * (0.5 + q * 1.5) + Math.sin(q * 11 + i), fy = y + q * 8 + (i % 3)
    k.lit(fx, fy, mix(P.pink, P.white, 0.7), 0.7 * left) // pale quill with a trailing rose barb
    k.lit(fx + (i % 2 ? 1 : -1), fy - 1, P.pink, 0.4 * left)
  }
  if (kind === 'agy') for (let i = 0; i < 10; i++) k.lit(x + Math.cos(i * 0.63 + k.seed) * q * 12, y + Math.sin(i * 0.63 + k.seed) * q * 6 + q * 4, i % 2 ? P.white : P.mauve, left) // embers
  if (kind === 'opencode') for (let i = 0; i < 4; i++) { // torn paper scraps flutter down while the exposed flames shed sparks
    const px = x + spot(k, i, 5, 5) * (0.6 + q) + Math.sin(q * 12 + i), py = y + q * 7 + (i % 3)
    const paper = lanternInk(k.seed)
    k.lit(px, py, mix(paper, P.white, 0.55), 0.8 * left)
    k.lit(px + (i % 2 ? 1 : -1), py + 1, paper, 0.4 * left)
    if (i < 2) k.lit(x + spot(k, i, 7, 3) + q * 2, y - q * 6 - i, P.yellow, 0.75 * left)
  }
}

export const styleFor = (kind: 'codex' | 'agy' | 'claude' | 'opencode', place: string, interrupted = false, arriving = false): Style => {
  if (interrupted) return struck(kind)
  const design = designFor(kind, place as WakePreset)
  const name = arriving ? design?.enter : design?.leave
  return name ? PASSAGE_STYLES[name] : kind === 'codex' ? CODEX[place] ?? hyperdrive : kind === 'claude' ? flight(place) : kind === 'agy' ? spark(place) : lantern(place)
}
