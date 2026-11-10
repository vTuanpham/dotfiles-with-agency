import { P } from './landscapes/kit'
import { hash } from './pixels'
import type { Dot, Style } from './exit-styles'
import type { PassageStyle } from './landscapes/design'

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }

/** These are exits; arrivals play the same passage in reverse. */
const surface: Style = k => {
  const dir = (k.heading ?? 1) * (k.arriving ? -1 : 1), q = ease(k.p), dx = dir * q * k.c.W * .65
  k.sprite({ dx, dy: Math.sin(k.p * 12) * .5, dissolve: clamp((k.p - .7) / .3) })
  if (k.p > 0) for (let i = 1; i <= 6; i++) k.lit(k.cx + dx - dir * k.flip * i * 2, k.y1 + 1, i % 2 ? P.sky : P.white, (1 - k.p) * .35 * (1 - i / 7))
}

const walk: Style = k => {
  const dir = (k.heading ?? -1) * (k.arriving ? -1 : 1), q = ease(k.p)
  const distance = dir > 0 ? k.c.W - k.x0 + 2 : k.x1 + 2
  k.sprite({ dx: dir * q * distance })
  // Footfalls stay on the ground, behind the departing body.
  if (k.p > .08 && k.p < .9) for (let i = 1; i <= 3; i++) k.lit(k.cx + dir * q * distance - dir * k.flip * i * 2, k.y1, P.overlay2, .3 * (1 - k.p) / i)
}

const ignite: Style = k => {
  const bright = (d: Dot) => Math.max(d.color >> 16 & 255, d.color >> 8 & 255, d.color & 255) >= 175
  const order = (d: Dot) => (hash(d.x * 97 + d.y * 31 + k.seed) % 1000) / 1000
  const lines = clamp(k.p / 0.45), stars = clamp((k.p - 0.4) / 0.6)
  k.sprite({
    filter: d => bright(d) ? order(d) >= stars : order(d) >= lines,
    offset: d => bright(d) && stars > 0 ? [stars * stars * (d.x - k.cx) * 3, -stars * stars * (6 + order(d) * 12)] : [0, 0],
    tint: P.ink, tintBy: k.p * 0.12,
  })
  if (stars > 0 && stars < 1) for (let i = 0; i < 5; i++) {
    const x = k.cx + (i - 2) * (1 + stars * stars * 8), y = k.cy - stars * stars * (6 + i)
    k.lit(x, y + 1, P.lavender, 0.45 * (1 - stars))
    k.lit(x, y, P.white, 0.65 * (1 - stars))
  }
}

const unfold: Style = k => {
  const fold = ease(k.p / 0.55), drift = clamp((k.p - 0.45) / 0.55)
  const dir = (k.heading ?? 1) * (k.arriving ? -1 : 1)
  k.sprite({ sx: 1 - 0.6 * fold, sy: 1 - 0.65 * fold, dx: dir * drift * drift * (k.c.W + 12), dy: -Math.sin(drift * Math.PI) * 4, dissolve: clamp((k.p - 0.9) / 0.1) })
  if (k.p > .15 && k.p < .55) k.lit(k.cx, k.cy, P.snow, Math.sin((k.p - .15) / .4 * Math.PI) * .6)
}

const swoop: Style = k => {
  const q = ease(k.p)
  k.sprite({ dx: (k.seed % 2 ? 1 : -1) * q * 12, dy: -q * q * (k.y1 + 4), dissolve: clamp((k.p - 0.85) / 0.15) })
}

const boot: Style = k => {
  const charge = ease(k.p / .25), rise = clamp((k.p - .25) / .75), dy = -rise * rise * (k.y1 + 8)
  k.sprite({ dy, sy: 1 - rise * .6, tint: P.sky, tintBy: charge * .2, dissolve: clamp((rise - .85) / .15) })
  if (k.p > 0 && k.p < 1) {
    const glow = Math.sin(k.p * Math.PI), radius = (k.x1 - k.x0) / 2 + 2
    const floor = k.surfaceAt?.(Math.round(k.cx), k.y1 + 1)
    if (floor !== undefined) for (let i = -radius; i <= radius; i += 2) {
      const y = k.surfaceAt?.(Math.round(k.cx + i), k.y1 + 1)
      if (y !== undefined) k.lit(k.cx + i, y, P.teal, glow * .4 * (1 - Math.abs(i) / (radius + 1)))
    }
    for (let y = k.y1 + dy; floor !== undefined && y < floor && rise > 0; y++) {
      k.lit(k.cx - radius * (1 - rise), y, P.sky, glow * .2)
      k.lit(k.cx + radius * (1 - rise), y, P.sky, glow * .2)
    }
  }
}

export const PASSAGE_STYLES: Record<PassageStyle, Style> = { surface, ignite, unfold, swoop, boot, walk }
