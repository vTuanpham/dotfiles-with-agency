// The shock of a crew member touching down at its post and of it setting out again. It is fired once, at the moment of
// contact (the body reaching home, or first leaving it: exits.ts finds that moment in each passage style), and is anchored
// where that happened, so it runs out on its own at its own speed while the craft carries on. Sized by the body, quick and
// clean: a flash where it struck, a ring that races out flat across the plane it struck (the air, the ground, the water) with
// a bright leading edge and a thin band of the family's colour, and an echo a beat behind. Over that, sparingly, the family's own:
//   codex     sparks flicked off the ring's front, and on the ground a line of dust it drags along
//   claude    a few feathers or petals caught in the front, settling after it has passed
//   agy       the front glints into stars that wink out where it was
//   opencode  embers lifted off the front, rising as they cool
// Boats strike water: two soft ripples instead of a ring. Walkers land light: a puff of dust at the feet.
import type { WakePreset } from '../types'
import { CARRIED } from './landscapes/fx'
import { P } from './landscapes/kit'
import { hash } from './pixels'

type Kind = 'codex' | 'agy' | 'claude' | 'opencode'
export type Contact = { x0: number; x1: number; y0: number; y1: number }
export type ShockSurface = { lit(x: number, y: number, color: number, alpha: number): void; surfaceAt?: (x: number, below: number) => number | undefined }

/** How long a shock runs, from the moment of contact. */
export const SHOCK_MS = 760
const TAU = Math.PI * 2
const COLOR: Record<Kind, number> = { codex: P.teal, claude: P.pink, agy: P.lavender, opencode: P.peach }
const out = (t: number) => 1 - (1 - t) ** 3 // it leaves fast and slows as it spreads

/** Draw the shock `ms` after contact. `habit` is how the design meets its place (design.ts); `landing` it arrived, else it set out. */
export function shock(k: ShockSurface, kind: Kind, place: WakePreset, habit: 'air' | 'ground' | 'water', body: Contact, ms: number, landing: boolean, seed: number): void {
  if (ms < 0 || ms >= SHOCK_MS) return
  const t = ms / SHOCK_MS, span = body.x1 - body.x0 + 1, cx = (body.x0 + body.x1) / 2
  const floor = k.surfaceAt?.(Math.round(cx), Math.ceil(body.y1) + 1)
  const grounded = floor !== undefined && floor - body.y1 <= 2
  // where it struck: the feet on whatever it stands on, else the middle of the body in the air
  const cy = grounded ? floor! - 0.5 : (body.y0 + body.y1) / 2
  const fade = (1 - t) ** 1.6, color = COLOR[kind]

  if (habit === 'water') { // two soft ripples spreading on the water, the second a beat behind
    for (const [lag, a] of [[0, 0.8], [0.22, 0.5]] as const) {
      const q = (t - lag) / (1 - lag)
      if (q <= 0) continue
      const r = span * 0.5 + out(q) * span * 1.3
      for (let dx = -Math.ceil(r); dx <= r; dx++) {
        const edge = Math.abs(Math.abs(dx) - r)
        if (edge < 1.2) k.lit(cx + dx, cy, P.white, a * (1 - q) * (1 - edge / 1.2))
      }
    }
    return
  }
  if (habit === 'ground') { // landing light: a puff of dust at the feet, out both ways
    const colors = CARRIED[place].colors
    for (let n = 0; n < 8; n++) {
      const side = n % 2 ? 1 : -1, run = out(t) * (3 + span * 0.5) * (0.6 + (n >> 1) * 0.15)
      k.lit(cx + side * (span * 0.3 + run), cy - Math.sin(t * Math.PI) * (1 + (n >> 1) % 2), colors[n % colors.length]!, fade * 0.8)
    }
    return
  }

  const reach = Math.max(9, span * 1.5) * (landing ? 1 : 0.8)
  const r0 = span * 0.35
  // flat: a shock on the ground runs out across it; one in the air is a disc seen a little from the side
  const squash = grounded ? 0.32 : 0.62
  const at = (angle: number, r: number) => [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r * squash] as const

  if (ms < 90) { // the flash where it struck, gone in a blink
    const f = 1 - ms / 90
    for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) k.lit(cx + dx, cy + dy, P.white, f * (1 - (Math.abs(dx) + Math.abs(dy)) / 4))
  }
  const ring = (r: number, a: number) => {
    const n = Math.ceil(TAU * r * 0.9) + 8
    for (let i = 0; i < n; i++) {
      const angle = i * TAU / n
      if (grounded && Math.sin(angle) < -0.15) continue // the far half of a ground ring is behind the body's own feet
      k.lit(...at(angle, r), P.white, a)
      k.lit(...at(angle, r - 1.2), color, a * 0.55)
    }
  }
  const r = r0 + out(t) * reach
  ring(r, fade * 0.9)
  if (t > 0.14) ring(r0 + out((t - 0.14) / 0.86) * reach * 0.62, fade * 0.35) // the echo

  const rnd = (n: number) => (hash(n * 7919 + seed * 31) % 1000) / 1000
  if (kind === 'codex') {
    for (let s = 0; s < 6; s++) { // sparks flicked off the front, falling away
      const angle = rnd(s) * TAU, fly = r + 1 + t * 3
      const [x, y] = at(angle, fly)
      k.lit(x, y + t * t * 4, s % 2 ? P.white : P.sky, fade)
    }
    if (grounded) for (const side of [-1, 1]) for (let n = 0; n < 4; n++) // the dust the ring drags along the ground
      k.lit(cx + side * (r - n), floor! - 1 - (n === 0 ? 1 : 0), n ? P.overlay2 : P.white, fade * (0.8 - n * 0.15))
  } else if (kind === 'claude') {
    for (let f = 0; f < 4; f++) { // a few feathers or petals caught in the front, settling after it
      const angle = (f + 0.5) * TAU / 4 + rnd(f) * 0.6, drift = Math.min(r, r0 + reach * 0.7)
      const [x, y] = at(angle, drift)
      const sway = Math.sin(t * 8 + f * 2) * 1.2, settle = Math.max(0, t - 0.3) * 6
      k.lit(x + sway, y + settle, f % 2 ? P.white : P.pink, Math.min(1, fade * 1.6))
    }
  } else if (kind === 'agy') {
    for (let s = 0; s < 10; s++) { // the front glints into stars, each winking out where it was
      const angle = s * TAU / 10 + rnd(s), passed = r0 + reach * (0.35 + 0.55 * rnd(s + 20))
      if (r < passed || t > 0.35 + 0.65 * rnd(s + 40)) continue
      const [x, y] = at(angle, passed)
      k.lit(x, y, P.white, 1)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) k.lit(x + dx, y + dy, P.lavender, 0.45)
    }
  } else {
    for (let e = 0; e < 8; e++) { // embers lifted off the front, rising as they cool
      const angle = e * TAU / 8 + rnd(e), [x, y] = at(angle, r - 0.5)
      k.lit(x, y - t * t * (4 + rnd(e + 9) * 4), e % 3 ? P.yellow : P.red, fade)
    }
  }
}
