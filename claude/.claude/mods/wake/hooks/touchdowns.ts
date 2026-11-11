// What a crew member throws off as it touches down at its post and as it sets out again: a shockwave in its family's own
// stuff, played over its passage (exits.ts) like the dragon's booster over its flight. Pure pixels through the passage's `lit`.
// Every wave is sized by the body that made it, so a class-4 dragon or eagle rocks the whole sky and a sparrow ripples:
//   an impact flash, a hard ring with a white leading edge running out to a couple of body-widths, and a ripple of dust
//   running both ways along whatever is below. Over it each family adds its own:
//   codex     a targeting reticle: arc segments spin out as it locks on; leaving, its drive spools up in long streaks
//   claude    a downdraught: the last wingbeat curls air out in two spiral arms and drops feathers; leaving, a gust kicks below
//   agy       a nova: rays turn as they lengthen and leave a ring of stars that wink out; leaving, the light falls inward
//   opencode  a bloom: a wavering ring of heat flings embers out and up; leaving, sparks fountain from the flame
// `q` runs 0..1 through the flourish; the craft stands at (cx, cy) all the while.
import { P } from './landscapes/kit'
import { hash } from './pixels'
import type { Ctx } from './exit-styles'

type Kind = 'codex' | 'agy' | 'claude' | 'opencode'
type Flourish = (k: Ctx, q: number) => void

/** How long the touchdown plays once the arrival has brought the craft home, and the opening of an exit the take-off fills. */
export const LANDED_MS = 1100
export const LAUNCH_MS = 800

const TAU = Math.PI * 2
const ease = (t: number) => 1 - (1 - t) ** 3 // a shockwave leaves fast and slows as it spreads
/** A point `r` out at `angle`, on the slightly wide ellipse a round thing makes in half-block cells. */
const out = (k: Ctx, angle: number, r: number, dy = 0) => [k.cx + Math.cos(angle) * r * 1.4, k.cy + dy + Math.sin(angle) * r * 0.8] as const
const spin = (k: Ctx) => (k.seed % 2 ? 1 : -1) * (k.heading ?? 1)
/** The radius that clears the sprite itself, so a wave is seen leaving it rather than drawn into its own pixels. */
const clear = (k: Ctx) => Math.max((k.x1 - k.x0) / 2.8, (k.y1 - k.y0) / 1.6) + 1
/** How far a wave runs: two body-widths past the body, and never less than a good stretch of sky. */
const reach = (k: Ctx) => Math.max(10, clear(k) * 2.2)
/** Holds strong for most of the wave and goes at the end. */
const hold = (q: number) => Math.sqrt(1 - q)

/** A solid ring: every cell of its rim lit, a white leading edge and a coloured band behind it. */
function ring(k: Ctx, r: number, color: number, a: number, width = 2) {
  if (r <= 0 || a <= 0) return
  const n = Math.ceil(TAU * r * 1.3)
  for (let i = 0; i < n; i++) {
    const angle = i * TAU / n
    k.lit(...out(k, angle, r), P.white, a)
    for (let w = 1; w < width; w++) k.lit(...out(k, angle, r - w * 0.7), color, a * (0.85 - w * 0.2))
  }
}

/** What every touchdown shares: the flash of the impact, the ring and the dust it kicks along whatever is below. */
function impact(k: Ctx, q: number, color: number, landing: boolean) {
  const big = reach(k), r = clear(k) + ease(q) * big, a = hold(q)
  if (q < 0.18) { // the flash: a bright disc where it lands, gone in a blink
    const f = 1 - q / 0.18, d = clear(k) * (0.8 + q * 2)
    for (let y = -d; y <= d; y++) for (let x = -d * 1.4; x <= d * 1.4; x++) {
      const e = Math.hypot(x / 1.4, y) / d
      if (e <= 1) k.lit(k.cx + x, k.cy + y * 0.8, P.white, f * 0.75 * (1 - e * e))
    }
  }
  ring(k, r, color, a * 0.95, 3)
  if (q > 0.12) ring(k, clear(k) + ease(q - 0.12) * big * 0.7, color, a * 0.45, 1) // an echo a beat behind
  // the dust it kicks up, running both ways along the ground below and rising a little as it goes
  const floor = k.surfaceAt?.(Math.round(k.cx), k.y1 + 1)
  if (floor === undefined || floor - k.y1 > 14) return
  const run = ease(q) * big * 1.8, lift = landing ? 1 : 0.6
  for (const side of [-1, 1]) for (let n = 0; n < 6; n++) {
    const x = k.cx + side * (run - n * 1.2), ground = k.surfaceAt?.(Math.round(x), k.y1 + 1) ?? floor
    k.lit(x, ground - 1 - (n === 0 ? lift : 0) - (n % 2) * q * 2, n ? P.overlay2 : P.white, a * (0.9 - n * 0.13))
  }
}

const LAND: Record<Kind, Flourish> = {
  codex: (k, q) => {
    impact(k, q, P.teal, true)
    const r = clear(k) + ease(q) * reach(k) * 0.8, turn = spin(k) * q * 3 + k.seed, fade = hold(q)
    for (let s = 0; s < 3; s++) for (let n = 0; n <= 12; n++) { // three arc segments, bright at the leading end
      const [x, y] = out(k, turn + s * TAU / 3 + n * 0.06, r)
      k.lit(x, y, n >= 10 ? P.white : P.sky, fade * (0.5 + n * 0.04))
    }
    if (q < 0.4) for (const [x, y, sx, sy] of [[k.x0 - 2, k.y0 - 1, 1, 1], [k.x1 + 2, k.y0 - 1, -1, 1], [k.x0 - 2, k.y1 + 1, 1, -1], [k.x1 + 2, k.y1 + 1, -1, -1]] as const) {
      const a = 1 - q / 0.4 // the lock: corner brackets snap shut round it
      for (let n = 0; n < 3; n++) { k.lit(x + sx * n, y, n ? P.sky : P.white, a); k.lit(x, y + sy * n * 0.7, P.sky, a * 0.8) }
    }
  },
  claude: (k, q) => {
    impact(k, q, P.pink, true)
    const r0 = clear(k), r = ease(q) * reach(k), fade = hold(q), turn = spin(k) * q * 2.4
    for (const arm of [0, Math.PI]) for (let n = 0; n < 14; n++) { // two arms of air spiralling out from under the wings
      const [x, y] = out(k, turn + arm + n * 0.22, r0 * 0.8 + r * (0.25 + n * 0.06), 1)
      k.lit(x, y, n % 3 ? P.snow : P.pink, fade * (1 - n * 0.04))
    }
    for (let f = 0; f < 3; f++) { // and feathers sway down from the last beat
      const sway = Math.sin(q * 9 + k.seed + f * 2) * 2, x = k.cx + (f - 1) * clear(k) * 0.9 + sway, y = k.y1 + q * (4 + f * 2)
      k.lit(x, y, P.white, 0.9 * hold(q)); k.lit(x + (sway > 0 ? -1 : 1), y, P.pink, 0.6 * hold(q))
    }
  },
  agy: (k, q) => {
    impact(k, q, P.lavender, true)
    const turn = spin(k) * q * 1.2 + k.seed * 0.3, fade = hold(q), r0 = clear(k), big = reach(k)
    for (let ray = 0; ray < 8; ray++) { // long and short rays, turning as they reach out past its own stars
      const end = r0 + ease(q) * big * (ray % 2 ? 0.45 : 0.9)
      for (let d = Math.max(r0 - 1, end - 5); d <= end; d += 0.7) k.lit(...out(k, turn + ray * TAU / 8, d), d >= end - 1 ? P.white : P.lavender, fade)
    }
    if (q > 0.3) for (let star = 0; star < 16; star++) { // the stars it leaves, winking out one by one
      if ((hash(star * 37 + k.seed) % 1000) / 1000 < (q - 0.3) / 0.7) continue
      const [x, y] = out(k, star * TAU / 16 - turn, r0 + big * 0.95)
      k.lit(x, y, P.white, 1)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) k.lit(x + dx, y + dy, P.lavender, 0.6) // each one glints
    }
  },
  opencode: (k, q) => {
    impact(k, q, P.peach, true)
    const r = clear(k) + ease(q) * reach(k) * 0.85, fade = hold(q)
    for (let n = 0; n < 48; n++) { // the heat's ring wavers as it spreads
      const angle = n * TAU / 48, wobble = Math.sin(angle * 5 + q * 12) * 1.2
      k.lit(...out(k, angle, r + wobble), n % 2 ? P.peach : P.yellow, fade * 0.8)
    }
    for (let e = 0; e < 12; e++) { // embers flung out and floating up
      const angle = e * TAU / 12 + k.seed + q * spin(k), fly = ease(q) * reach(k) * (0.5 + (hash(e * 13 + k.seed) % 5) / 10)
      const [x, y] = out(k, angle, clear(k) + fly)
      k.lit(x, y - q * q * 6, e % 2 ? P.yellow : P.red, fade); k.lit(x, y - q * q * 6 + 1, P.peach, fade * 0.5)
    }
  },
}

const LAUNCH: Record<Kind, Flourish> = {
  codex: (k, q) => {
    impact(k, q, P.teal, false)
    const back = -(k.heading ?? 1), fade = hold(q)
    for (let row = -2; row <= 2; row++) for (let n = 0; n < 3 + q * 26; n++) // the drive's streaks, lengthening behind it
      k.lit((back > 0 ? k.x1 : k.x0) + back * (n + 1 + Math.abs(row) * 2), k.cy + row * 0.8, n < 3 ? P.white : P.sky, fade * (0.9 - n * 0.03))
  },
  claude: (k, q) => {
    impact(k, q, P.pink, false)
    const fade = hold(q), r = clear(k) + ease(q) * reach(k)
    for (const side of [-1, 1]) for (let n = 0; n < 6; n++) { // a downstroke's pair of gusts, curling back up at the ends
      const x = k.cx + side * (r * 1.2 - n), y = k.y1 + 1 - Math.sin(q * Math.PI) * 3 - n * 0.3
      k.lit(x, y, n ? P.snow : P.white, fade * (1 - n * 0.12)); k.lit(x + side, y - 1, P.pink, fade * 0.6)
    }
  },
  agy: (k, q) => {
    const turn = spin(k) * -q * 1.5 + k.seed * 0.3, r = clear(k) + reach(k) * (1 - ease(q)) // the light pulled back into its stars
    ring(k, r, P.lavender, 0.4 + 0.6 * q, 2)
    for (let ray = 0; ray < 8; ray++) for (let d = r; d <= r + 4; d++) k.lit(...out(k, turn + ray * TAU / 8, d), d === r ? P.white : P.lavender, 0.3 + 0.7 * q)
    if (q > 0.7) for (let n = 0; n < 4; n++) for (let d = 0; d < (q - 0.7) * 30; d++) k.lit(...out(k, n * TAU / 4 + turn, d), P.white, 1 - d / 12) // and goes off as a cross
  },
  opencode: (k, q) => {
    impact(k, q, P.peach, false)
    for (let s = 0; s < 14; s++) { // a fountain of sparks off the flame
      const spread = ((hash(s * 29 + k.seed) % 9) - 4) * 0.8, h = q * (8 + s % 4 * 3)
      k.lit(k.cx + spread * q * 4, k.y0 - h + q * q * 6, s % 3 ? P.yellow : P.white, hold(q))
    }
  },
}

/** The touchdown (`landing`) or the take-off, `q` 0..1 through it. */
export const flourish = (kind: Kind, k: Ctx, q: number, landing: boolean): void => (landing ? LAND : LAUNCH)[kind](k, Math.max(0, Math.min(1, q)))
