// The shooting star that marks a finished job: a bright head on a diagonal path, a long tail that tapers and fades smoothly,
// and a few embers that hang in the air behind it. Pure pixels; the scene only says how far along it is.
import { P } from './landscapes/kit'
import { type Canvas, hash, mix } from './pixels'

const TAIL = 24 // cells from the head to where the tail has faded away
const SLOPE = 0.2 // how steeply it falls (rows per column): a gentle diagonal, never a flat dash
const SPAN = 64 // columns it crosses: enough to read as a streak, short enough to stay in the sky on a wide band
const EMBERS = 6

/** Light a point that falls between pixels: spread over its four neighbours by how near each is, so the line is smooth. */
function dab(c: Canvas, x: number, y: number, color: number, strength: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  for (const [dx, dy, weight] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
    if (weight > 0.02) c.glow(x0 + dx, y0 + dy, color, Math.min(1, strength * weight * 1.4))
  }
}

/** `t` is how far along the whole flight it is (0..1); `tint` colours the tail (cool white, or warm over the desert). */
export function drawMeteor(c: Canvas, t: number, tint: number, ground: number) {
  const run = Math.hypot(1, SLOPE)
  const span = Math.min(SPAN, c.W - 12)
  const startX = (c.W - span) * 0.3 // where it appears; the whole streak stays inside the band
  const along = (distance: number) => ({ x: startX + distance / run, y: 1 + (distance / run) * SLOPE })
  const flight = (span + TAIL) * run // the head crosses the span, then the tail finishes crossing
  const headAt = t * flight
  const head = along(headAt)
  const tail = mix(P.white, tint, 0.45)
  const dir = { x: 1 / run, y: SLOPE / run }
  // the tail: brightest at the head, tapering to nothing, a little thicker near the head; it grows out of its start point
  for (let s = 0; s <= TAIL; s += 0.5) {
    if (headAt - s < 0 || headAt - s > span * run) continue // before its start, or past its end
    const k = (1 - s / TAIL) ** 1.7
    const x = head.x - dir.x * s, y = head.y - dir.y * s
    if (y > ground - 2) continue // it never falls into the ground
    dab(c, x, y, s < 2 ? P.white : tail, k)
    if (s < 6) { dab(c, x, y - 1, tail, k * 0.35); dab(c, x, y + 1, tail, k * 0.35) }
  }
  // the head: a small bright core with a soft halo
  if (headAt <= span * run && head.y < ground - 2) {
    dab(c, head.x, head.y, P.white, 1)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) dab(c, head.x + dx, head.y + dy, tail, 0.5)
  }
  // embers: motes it leaves where it has been, hanging a moment, sinking and fading
  for (let k = 0; k < EMBERS; k++) {
    const born = t - 0.035 * (k + 1)
    if (born < 0 || born * flight > span * run) continue
    const age = t - born
    const spot = along(born * flight)
    const jitter = (hash(k * 31 + 5) % 5) - 2
    const y = spot.y + jitter * 0.8 + age * 14 // sinks as it fades
    if (y < ground - 2) dab(c, spot.x, y, k % 2 ? tail : P.white, 0.75 * (1 - Math.min(1, age / 0.28)))
  }
}
