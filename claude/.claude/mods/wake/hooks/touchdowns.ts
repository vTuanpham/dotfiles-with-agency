// What a crew member throws off as it touches down at its post and as it sets out again: a shockwave in its family's own
// stuff, played over its passage (exits.ts) like the dragon's booster over its flight. Pure pixels through the passage's `lit`.
//   codex     a targeting reticle: arc segments spin out from the craft as it locks on; leaving, its drive spools up in streaks
//   claude    a downdraught: the last wingbeat curls air out in two spiral arms and drops a feather; leaving, a gust kicks below
//   agy       a nova: rays turn as they lengthen and leave a ring of stars that wink out; leaving, the light falls inward
//   opencode  a bloom: a wavering ring of heat flings embers out and up; leaving, sparks fountain from the flame
// `q` runs 0..1 through the flourish; the craft stands at (cx, cy) all the while.
import { P } from './landscapes/kit'
import { hash } from './pixels'
import type { Ctx } from './exit-styles'

type Kind = 'codex' | 'agy' | 'claude' | 'opencode'
type Flourish = (k: Ctx, q: number) => void

/** How long the touchdown plays once the arrival has brought the craft home, and the opening of an exit the take-off fills. */
export const LANDED_MS = 900
export const LAUNCH_MS = 700

const TAU = Math.PI * 2
const ease = (t: number) => 1 - (1 - t) ** 3 // a shockwave leaves fast and slows as it spreads
/** A point `r` out at `angle`, on the slightly wide ellipse a round thing makes in half-block cells. */
const out = (k: Ctx, angle: number, r: number, dy = 0) => [k.cx + Math.cos(angle) * r * 1.4, k.cy + dy + Math.sin(angle) * r * 0.8] as const
const spin = (k: Ctx) => (k.seed % 2 ? 1 : -1) * (k.heading ?? 1)
/** The radius that clears the sprite itself, so a wave is seen leaving it rather than drawn into its own pixels. */
const clear = (k: Ctx) => Math.max((k.x1 - k.x0) / 2.8, (k.y1 - k.y0) / 1.6) + 1
/** Holds strong for most of the wave and goes at the end. */
const hold = (q: number) => Math.sqrt(1 - q)

const LAND: Record<Kind, Flourish> = {
  codex: (k, q) => {
    const r = clear(k) + ease(q) * 9, turn = spin(k) * q * 3 + k.seed, fade = hold(q)
    for (let s = 0; s < 3; s++) for (let n = 0; n <= 7; n++) { // three arc segments, bright at the leading end
      const [x, y] = out(k, turn + s * TAU / 3 + n * 0.09, r)
      k.lit(x, y, n >= 6 ? P.white : P.teal, fade * (0.45 + n * 0.07))
    }
    if (q < 0.35) for (const [x, y, sx, sy] of [[k.x0 - 1, k.y0 - 1, 1, 1], [k.x1 + 1, k.y0 - 1, -1, 1], [k.x0 - 1, k.y1 + 1, 1, -1], [k.x1 + 1, k.y1 + 1, -1, -1]] as const) {
      const a = 0.9 * (1 - q / 0.35) // the lock: corner brackets snap shut round it
      k.lit(x, y, P.white, a); k.lit(x + sx, y, P.sky, a * 0.7); k.lit(x, y + sy, P.sky, a * 0.7)
    }
  },
  claude: (k, q) => {
    const r0 = clear(k), r = ease(q) * 8, fade = hold(q), turn = spin(k) * q * 2.4
    for (const arm of [0, Math.PI]) for (let n = 0; n < 9; n++) { // two arms of air spiralling out from under the wings
      const [x, y] = out(k, turn + arm + n * 0.3, r0 * 0.8 + r * (0.3 + n * 0.09), 1)
      k.lit(x, y, n % 3 ? P.snow : P.pink, fade * (0.95 - n * 0.06))
    }
    for (let n = -6; n <= 6; n += 2) k.lit(k.cx + n * (0.6 + q * 1.4), k.y1 + 1 + q, P.white, fade * 0.3 * (1 - Math.abs(n) / 7)) // flattened air below
    const sway = Math.sin(q * 9 + k.seed) * 1.5 // and a feather sways down from the last beat
    k.lit(k.cx + 1 + sway, k.y1 + q * 4, P.white, 0.8 * fade)
    k.lit(k.cx + 1 + sway + (sway > 0 ? -1 : 1), k.y1 + q * 4, P.pink, 0.5 * fade)
  },
  agy: (k, q) => {
    const turn = spin(k) * q * 1.2 + k.seed * 0.3, fade = hold(q), r0 = clear(k)
    for (let ray = 0; ray < 8; ray++) { // long and short rays, turning as they reach out past its own stars
      const reach = r0 + ease(q) * (ray % 2 ? 4 : 8)
      for (let d = Math.max(r0 - 1, reach - 3); d <= reach; d += 1) k.lit(...out(k, turn + ray * TAU / 8, d), d >= reach - 1 ? P.white : P.lavender, fade * 0.9)
    }
    if (q > 0.3) for (let star = 0; star < 12; star++) { // the stars it leaves, winking out one by one
      if ((hash(star * 37 + k.seed) % 1000) / 1000 < (q - 0.3) / 0.7) continue
      const [x, y] = out(k, star * TAU / 12 - turn, r0 + 9)
      k.lit(x, y, star % 3 ? P.lavender : P.white, 1)
      if (star % 3 === 0) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) k.lit(x + dx, y + dy, P.lavender, 0.45) // the bright ones glint
    }
  },
  opencode: (k, q) => {
    const r = clear(k) + ease(q) * 8, fade = hold(q)
    for (let n = 0; n < 24; n++) { // the heat's ring wavers as it spreads
      const angle = n * TAU / 24, wobble = Math.sin(angle * 5 + q * 12) * 0.7
      k.lit(...out(k, angle, r + wobble), n % 2 ? P.peach : P.yellow, fade * 0.55)
    }
    for (let e = 0; e < 7; e++) { // embers flung out and floating up
      const angle = e * TAU / 7 + k.seed + q * spin(k), fly = ease(q) * (5 + (hash(e * 13 + k.seed) % 4))
      const [x, y] = out(k, angle, fly)
      k.lit(x, y - q * q * 5, e % 2 ? P.yellow : P.red, fade * 0.95)
    }
    if (q < 0.2) k.lit(k.cx, k.cy, P.white, 1 - q / 0.2)
  },
}

const LAUNCH: Record<Kind, Flourish> = {
  codex: (k, q) => {
    const back = -(k.heading ?? 1), fade = hold(q)
    for (let row = -1; row <= 1; row++) for (let n = 0; n < 2 + q * 10; n++) // the drive's streaks, lengthening behind it
      k.lit((back > 0 ? k.x1 : k.x0) + back * (n + 1 + (row ? 2 : 0)), k.cy + row, n < 2 ? P.white : P.sky, fade * (0.7 - n * 0.05))
    if (q < 0.3) for (let n = 0; n < 12; n++) k.lit(...out(k, n * TAU / 12, 2 + q * 8), P.teal, 0.6 * (1 - q / 0.3))
  },
  claude: (k, q) => {
    const fade = hold(q), r = clear(k) + ease(q) * 8
    for (let n = -8; n <= 8; n++) if ((n + Math.round(q * 6)) % 2 === 0) k.lit(k.cx + n * r / 8 * 1.4, k.y1 + 1 + Math.abs(n) * q * 0.15, P.snow, fade * 0.8 * (1 - Math.abs(n) / 10)) // the push-off: air kicked flat beneath
    for (const side of [-1, 1]) { // a downstroke's pair of gusts, curling back up at the ends
      const x = k.cx + side * (clear(k) + q * 5), y = k.y1 + 1 - Math.sin(q * Math.PI) * 2
      k.lit(x, y, P.white, fade * 0.9); k.lit(x + side, y - 1, P.pink, fade * 0.6)
    }
  },
  agy: (k, q) => {
    const turn = spin(k) * -q * 1.5 + k.seed * 0.3, reach = clear(k) + 9 * (1 - ease(q)) // the light pulled back into its stars
    for (let ray = 0; ray < 8; ray++) for (let d = reach; d <= reach + 2; d++) k.lit(...out(k, turn + ray * TAU / 8, d), d === reach ? P.white : P.lavender, 0.3 + 0.6 * q)
    if (q > 0.7) for (let n = 0; n < 4; n++) k.lit(...out(k, n * TAU / 4 + turn, (q - 0.7) * 6), P.white, 1) // and goes off as a cross
  },
  opencode: (k, q) => {
    for (let s = 0; s < 8; s++) { // a fountain of sparks off the flame
      const spread = ((hash(s * 29 + k.seed) % 9) - 4) * 0.5, h = q * (5 + s % 3 * 2)
      k.lit(k.cx + spread * q * 3, k.y0 - h + q * q * 4, s % 3 ? P.yellow : P.white, (1 - q) * 0.9)
    }
    for (let n = -4; n <= 4; n++) k.lit(k.cx + n * (1 + q), k.y1 + 1, P.peach, (1 - q) * 0.35 * (1 - Math.abs(n) / 5))
  },
}

/** The touchdown (`landing`) or the take-off, `q` 0..1 through it. */
export const flourish = (kind: Kind, k: Ctx, q: number, landing: boolean): void => (landing ? LAND : LAUNCH)[kind](k, Math.max(0, Math.min(1, q)))
