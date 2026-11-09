// The styles for exits.ts: one way of leaving per craft and per place. Pure pixels; `exits.ts` runs them.
//
// A style gets `p`, how far through the *exit* it is (0..1), and must leave nothing visible at p = 1 (that is the end of an
// exit and the start of an arrival, which plays the same style backwards). Trails go through `behind` and `flip`, so they stay
// behind the craft whichever way it moves. Every family has a style for every landscape:
//   Codex     the machine its place builds (a drone's dash, a helicopter's lift-off and bank, a blimp's drift, a boat, a paraglider,
//             a biplane, an autogyro, a skiff, a ski plane)
//   Claude    the place's creature in flight (soar, skim, loop, spiral, swoop, flit, thermal, ghost)
//   agy       how its sparks end (ring, ripple, glints, snow, fireflies, blink, dust devil, aurora ribbon)
//   OpenCode  where its balloon goes (pops to confetti, bubbles, petals, spores or flurry; drifts, mists or shimmers away)
// Two helpers apply to any style: `ghosted` leaves afterimages behind a fast mover, and every family's `signature` burst (a radar
// pulse, feathers, a starburst, confetti) pushes out at the start of an exit and gathers in at the end of an arrival.
// To add or change one, write a function here and name it in the family's table.
import { P } from './landscapes/kit'
import { type Canvas, hash, mix } from './pixels'

export type Dot = { x: number; y: number; color: number }
export type Look = { dx?: number; dy?: number; sx?: number; sy?: number; dissolve?: number; tint?: number; tintBy?: number; /** 0..1: draw it translucent over what is there, as an afterimage */ alpha?: number }
export type Ctx = {
  c: Canvas
  p: number
  seed: number
  /** the model class, 1..4: a big machine leaves differently from a small one */
  tier: number
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

/**
 * Afterimages: the style played again a little earlier, faint and fainter, behind the craft, so anything that moves fast leaves a
 * trail of where it was. (Arriving, "earlier" is later in the style's own time: the ghosts still trail the way it came.)
 */
const ghosted = (style: Style, count = 3, step = 0.035, alpha = 0.3): Style => k => {
  for (let i = count; i >= 1; i--) {
    const q = k.behind(i, step)
    if (q < 0 || q > 1) continue
    const fade = alpha * (1 - (i - 1) / count)
    style({ ...k, p: q, sprite: look => k.sprite({ ...look, alpha: (look.alpha ?? 1) * fade }), lit: (x, y, color, a) => k.lit(x, y, color, a * fade) })
  }
  style(k)
}

/**
 * City drones (classes 1 and 2): hover with a shiver as the motors spool up, then dash off up and away, leaving a streak of
 * light and afterimages; arriving, they dive in and brake.
 */
const dash: Style = ghosted(k => {
  const { p, cx, cy } = k
  const dir = dirOf(k), go = clamp((p - 0.28) / 0.72)
  const shiver = p < 0.3 ? Math.round(Math.sin(p * 90) * (p / 0.3)) : 0
  const dx = dir * go * go * k.c.W * 0.45 + shiver, dy = -go * Math.min(10, k.y0 - 1) - Math.sin(go * 7) * 0.8
  k.sprite({ dx, dy, dissolve: clamp((go - 0.65) / 0.35), tint: P.white, tintBy: clamp(go * 0.8) * 0.5 })
  for (let i = 1; i <= 7; i++) k.lit(cx + dx - dir * k.flip * i * 1.6, cy + dy + i * 0.35, P.teal, 0.5 * (1 - i / 8) * (1 - k.p))
}, 3, 0.04, 0.3)

/**
 * City helicopter (class 3): spools up, lifts straight off in a ring of rotor wash that spreads over the street, banks away over
 * the roofs and shrinks into the sky, its searchlight still sweeping.
 */
const chopper: Style = ghosted(k => {
  const { p, cx, cy } = k
  const dir = dirOf(k), lift = ease(clamp(p / 0.45)) * Math.max(0, Math.min(5, k.y0 - 1)), bank = clamp((p - 0.4) / 0.6)
  const dx = dir * bank * bank * k.c.W * 0.4, dy = -lift - bank * bank * 7
  k.sprite({ dx, dy, sx: 1 - bank * 0.4, sy: 1 - bank * 0.4, dissolve: clamp((bank - 0.7) / 0.3) })
  if (p < 0.5) for (let a = 0; a < 14; a++) { // rotor wash: rings flattened to the ground plane, widening as it climbs
    const angle = (a / 14) * Math.PI * 2, r = 2 + p * 20
    k.lit(cx + Math.cos(angle) * r * 1.7, k.y1 + 2 + Math.sin(angle) * r * 0.25, P.white, 0.4 * (1 - p / 0.5))
  }
  for (let r = 1; r <= 9; r++) k.lit(cx + dx - dir * k.flip * r * 0.6, cy + dy + 2 + r * 0.9, P.yellow, 0.32 * (1 - r / 10) * (1 - bank)) // the searchlight
}, 2, 0.05, 0.22)

/** City blimp (class 4): the ticker blinks, the lines let go, and it rises and drifts off into the haze, going pale with distance. */
const airship: Style = k => {
  const { p } = k
  const dir = dirOf(k), rise = ease(p) * Math.max(0, Math.min(6, k.y0 - 1))
  k.sprite({ dx: dir * p * p * k.c.W * 0.35, dy: -rise, sx: 1 - p * 0.25, sy: 1 - p * 0.25, dissolve: clamp((p - 0.5) / 0.5), tint: P.white, tintBy: p * 0.55 })
  if (p < 0.7) for (let x = k.x0 + 1; x < k.x1; x += 2) k.lit(x + dir * p * p * k.c.W * 0.35, k.y0 + 3 - rise, (Math.floor(p * 30) + x) % 2 ? P.yellow : P.white, 0.5 * (1 - p / 0.7)) // the ticker
  for (let i = 1; i <= 6; i++) k.lit(k.cx + dir * p * p * k.c.W * 0.35 - dir * k.flip * i * 2.4, k.cy - rise, P.white, 0.22 * (1 - i / 7) * (1 - p)) // a contrail
}

const cityCraft: Style = k => (k.tier >= 4 ? airship : k.tier === 3 ? chopper : dash)(k)

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
  city: cityCraft, harbor: sailing(0.5, P.white), beach: sailing(1.4, P.sky), mountains: ghosted(paraglide, 2, 0.05, 0.2),
  countryside: ghosted(biplane, 3, 0.04, 0.28), forest: gyro, desert: ghosted(skiff, 3, 0.04, 0.28), tundra: ghosted(skiplane, 2, 0.05, 0.25),
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

const flight = (place: string): Style => ghosted(k => {
  const f = FLIGHT[place] ?? FLIGHT.city!
  const here = f.path(k.p, k)
  k.sprite({ dx: here.dx, dy: here.dy, dissolve: clamp((k.p - f.dissolveFrom) / (1 - f.dissolveFrom)), ...(f.ghost ? { tint: P.white, tintBy: clamp(k.p * 1.3) * 0.6 } : {}) })
  shed(k, f.shed, k.cx + here.dx, k.cy + here.dy)
}, 2, 0.05, 0.22)

// ── every family's signature: the burst at the moment of arriving or setting off ─────────────────────────────────────────────

/**
 * The energy of a passage's resting end, in the family's own way. Leaving, it pushes out from the craft as it sets off; arriving,
 * it pulls in and gathers as the craft lands. It runs over the last fifth of an arrival and the first fifth of an exit.
 *   Codex     a square radar pulse, teal      Claude    a puff of pink feathers
 *   agy       a four-pointed starburst       OpenCode  a pop of confetti
 */
const SIGNATURE_WINDOW = 0.22
const signature = (kind: 'codex' | 'agy' | 'claude' | 'opencode'): Style => k => {
  if (k.p >= SIGNATURE_WINDOW) return
  const t = k.p / SIGNATURE_WINDOW // 0 at rest .. 1 at the edge of the window
  const radius = 2 + t * 8
  const alpha = k.arriving ? 0.25 + 0.65 * t : 0.9 * (1 - t) // gathering gets brighter as it closes in; a burst fades as it spreads
  if (kind === 'codex') {
    for (let i = -radius; i <= radius; i++) for (const [x, y] of [[i, -radius * 0.55], [i, radius * 0.55], [-radius, i * 0.55], [radius, i * 0.55]] as const) k.lit(k.cx + x, k.cy + y, P.teal, alpha * 0.5)
  } else if (kind === 'claude') {
    for (let i = 0; i < 9; i++) k.lit(k.cx + Math.cos(i * 2.4 + k.seed) * radius * 1.3 + Math.sin(k.p * 40 + i) * 0.6, k.cy + Math.sin(i * 2.4 + k.seed) * radius * 0.7 + t * 2, i % 3 ? P.pink : P.white, alpha * 0.8)
  } else if (kind === 'agy') {
    for (let r = 1; r <= radius; r++) for (const [x, y] of [[r, 0], [-r, 0], [0, r * 0.6], [0, -r * 0.6]] as const) k.lit(k.cx + x, k.cy + y, r < radius * 0.5 ? P.white : P.mauve, alpha * (1 - r / (radius + 1)))
  } else {
    const palette = [P.red, P.yellow, P.green, P.blue, P.lavender, P.peach]
    for (let i = 0; i < 12; i++) k.lit(k.cx + Math.cos(i * 1.9 + k.seed) * radius * 1.2, k.cy + Math.sin(i * 1.9 + k.seed) * radius * 0.8 + t * t * 3, palette[i % palette.length]!, alpha)
  }
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

// ── OpenCode: where the balloon goes, by place ───────────────────────────────────────────────────────────────────────────────

/** How the balloon ends. `fade` styles keep the balloon and let it dissolve; the rest hide it at the top and release a burst. */
type Ending = { wind: number; fade?: (k: Ctx, r: number) => void; burst?: { colors: number[]; gravity: number; spread: number; sway?: number; ring?: number } }

const ENDING: Record<string, Ending> = {
  city: { wind: 0, burst: { colors: [P.pink, P.yellow, P.teal, P.mauve, P.green, P.peach, P.red, P.blue], gravity: 9, spread: 8, ring: P.white } }, // pops into confetti
  harbor: { wind: 14, fade: () => undefined }, // drifts out to sea on the wind, fading
  beach: { wind: 3, burst: { colors: [P.white, P.sky, P.sapphire, P.teal], gravity: 1.5, spread: 6, sway: 1.5, ring: P.sky } }, // bubbles that hang and wobble
  mountains: { wind: 2, fade: (k, r) => { for (let i = 0; i < 8; i++) k.lit(k.cx + Math.sin(2) * 1.5 + spot(k, i, 5, 5) * r, 2 + spot(k, i, 7, 2) * r, P.white, 0.7 * (1 - r)) } }, // lost in the clouds
  countryside: { wind: 0, burst: { colors: [P.pink, P.yellow, P.flamingo, P.rosewater], gravity: 7, spread: 6, sway: 2.5 } }, // petals flutter down
  forest: { wind: 0, burst: { colors: [P.green, P.teal, P.yellow, P.green], gravity: 6, spread: 7, sway: 2 } }, // leaves and spores
  desert: { wind: 0, fade: (k, r) => { for (let i = 0; i < 6; i++) k.lit(k.cx + Math.sin(2) * 1.5 + Math.sin(r * 18 + i) * 2, 3 - r * 6 - i, P.peach, 0.6 * (1 - r)) } }, // evaporates in the heat
  tundra: { wind: 0, burst: { colors: [P.white, P.snow, P.sky, P.white], gravity: 8, spread: 7, sway: 1.5 } }, // bursts into a flurry
}

const balloon = (place: string): Style => k => {
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

const styleOf = (kind: 'codex' | 'agy' | 'claude' | 'opencode', place: string): Style =>
  kind === 'codex' ? CODEX[place] ?? cityCraft : kind === 'claude' ? flight(place) : kind === 'agy' ? spark(place) : balloon(place)

/** The style a family plays in a place: its way of going, with its signature burst at the resting end. */
export const styleFor = (kind: 'codex' | 'agy' | 'claude' | 'opencode', place: string): Style => {
  const way = styleOf(kind, place), burst = signature(kind)
  return k => { way(k); burst(k) }
}
