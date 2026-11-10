import { P } from './landscapes/kit'
import { hash } from './pixels'
import type { Dot, Style } from './exit-styles'
import type { PassageStyle } from './landscapes/design'

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }

/** These are exits; arrivals play the same passage in reverse. */
const surface: Style = k => {
  const depth = k.y1 + 1, q = ease(k.p / 0.8), fade = 1 - k.p
  k.sprite({ dy: q * (k.y1 - k.y0 + 3), clipBelow: depth, dissolve: clamp((k.p - 0.72) / 0.28) })
  if (k.p > 0) for (let i = 1; i <= 4; i++) {
    const r = 1 + Math.round(k.p * (i + 2)), a = fade * (0.7 - i * 0.12)
    k.lit(k.cx - r, depth, P.sky, a); k.lit(k.cx + r, depth, P.white, a)
    if (k.p < 0.55) k.lit(k.cx + (i % 2 ? r : -r), depth - 1 - i * k.p * 2, P.white, fade * 0.55)
  }
}

const ignite: Style = k => {
  const bright = (d: Dot) => Math.max(d.color >> 16 & 255, d.color >> 8 & 255, d.color & 255) >= 175
  const order = (d: Dot) => (hash(d.x * 97 + d.y * 31 + k.seed) % 1000) / 1000
  const lines = clamp(k.p / 0.45), stars = clamp((k.p - 0.4) / 0.6)
  k.sprite({
    filter: d => bright(d) ? order(d) >= stars : order(d) >= lines,
    offset: d => bright(d) && stars > 0 ? [stars * (0.5 + order(d) * 2), stars * stars * (4 + order(d) * 6)] : [0, 0],
  })
  if (stars > 0 && stars < 1) for (let i = 0; i < 5; i++) {
    const x = k.cx + (i - 2) * 2 + stars * (1 + i % 2), y = k.cy + stars * stars * (4 + i)
    k.lit(x - 1, y - 1, P.lavender, 0.45 * (1 - stars))
    k.lit(x, y, P.white, 0.65 * (1 - stars))
  }
}

const unfold: Style = k => {
  const fold = ease(k.p / 0.55), drift = clamp((k.p - 0.45) / 0.55)
  k.sprite({ sx: 1 - 0.8 * fold, sy: 1 - 0.7 * fold, dx: Math.sin(drift * 12) * drift * 3, dy: drift * drift * 12, dissolve: clamp((k.p - 0.72) / 0.28) })
}

const swoop: Style = k => {
  const q = ease(k.p)
  k.sprite({ dx: (k.seed % 2 ? 1 : -1) * q * 12, dy: -q * q * (k.y1 + 4), dissolve: clamp((k.p - 0.85) / 0.15) })
}

const boot: Style = k => {
  const columns = clamp(k.p / 0.8), drop = ease((k.p - 0.55) / 0.45)
  k.sprite({ filter: d => columns < 1 && (d.x - k.x0) / Math.max(1, k.x1 - k.x0) <= 1 - columns, dy: drop * drop * 10, tint: P.ink, tintBy: clamp(k.p / 0.25) * 0.35 })
  if (k.p > 0 && k.p < 0.8) for (let i = 0; i < 4; i++) {
    const edge = k.x1 - columns * (k.x1 - k.x0), y = k.cy + (i - 1.5) * 1.4
    k.lit(edge + (i % 2 ? 1 : -1), y, i % 2 ? P.yellow : P.sky, (1 - k.p) * 0.7)
  }
}

export const PASSAGE_STYLES: Record<PassageStyle, Style> = { surface, ignite, unfold, swoop, boot }
