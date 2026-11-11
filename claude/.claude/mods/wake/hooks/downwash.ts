// The air a winged creature or a powered craft drives down onto whatever is below it as it comes in and as it lifts off: the
// wash. It is not a set piece played at a moment; exits.ts feeds it the body where the passage has just drawn it and how hard
// it is working (its thrust), every frame, so it builds as the body comes down towards the ground, peaks as it settles, dies
// away as the dust does, and on the way out blasts hardest as it lifts and fades as it climbs away.
//   wings  every downstroke sends a front of air down from under the wings; the scenery below dips and parts on each beat
//   jets   a steady blast from under the hull: a shimmering column, its light pooled on the ground, the scenery held pressed
// The scenery under the body is really moved (treetops, grass, water and roofs are pushed down and out from under it), the
// place's own material (dust, spray, sand, snow, petals, leaves) is blown out along the ground both ways in puffs, and a bright
// pressure ripple runs across the surface. Walkers, boats, constellations and lanterns raise none: only the designs listed.
import type { WakePreset } from '../types'
import { CARRIED } from './landscapes/fx'
import { P } from './landscapes/kit'
import { type Canvas, hash, mix } from './pixels'

type Kind = 'codex' | 'agy' | 'claude' | 'opencode'
export type Wash = { by: 'wings' | 'jets'; power: number }
const wings = (power: number): Wash => ({ by: 'wings', power }), jets = (power: number): Wash => ({ by: 'jets', power })

/**
 * Who raises a wash, and how strong it is for its size: only what comes down onto its place and climbs away from it. The
 * dragon warps in level, the forest owl and the puffins glide in along the canopy and the snow, so they raise none.
 */
export const DOWNWASH: Record<Kind, Partial<Record<WakePreset, Wash>>> = {
  codex: { beach: jets(1), countryside: jets(0.8), forest: jets(0.9) }, // the saucer, the crop drone, the probe: they boot and lift straight up
  claude: { city: wings(0.7), beach: wings(0.8), mountains: wings(1.1), countryside: wings(0.5) }, // bats, the flamingo, the eagle, butterflies
  agy: {},
  opencode: {},
}

/**
 * Coming down onto a perch to rest and springing off it again is vertical for everyone who rests, so it raises a wash: the
 * flyers above, and the dragon (on its booster), the owl and the puffins, which pass in and out level but land like the rest.
 */
export const PERCH_WASH: Record<Kind, Partial<Record<WakePreset, Wash>>> = {
  ...DOWNWASH,
  codex: { ...DOWNWASH.codex, city: jets(1.1) },
  claude: { ...DOWNWASH.claude, forest: wings(0.8), tundra: wings(0.6) },
}

/** A canvas as a wash's surface: light mixes over what is there. */
export const canvasSurface = (c: Canvas, surfaceAt?: Surface['surfaceAt']): Surface => ({
  W: c.W, H: c.H, px: c.px, surfaceAt,
  lit: (x, y, color, alpha) => {
    const px = Math.round(x), py = Math.round(y)
    if (px < 0 || px >= c.W || py < 0 || py >= c.H || alpha <= 0) return
    c.px[py * c.W + px] = mix(c.px[py * c.W + px]!, color, Math.min(1, alpha))
  },
})

export type Body = { x0: number; x1: number; y0: number; y1: number }
export type Surface = {
  W: number
  H: number
  px: Uint32Array
  lit(x: number, y: number, color: number, alpha: number): void
  /** The first solid row at or below `below` in column `x`. */
  surfaceAt?: (x: number, below: number) => number | undefined
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const WATER: ReadonlySet<string> = new Set(['harbor', 'beach'])
/** A wingbeat's length: the gusts come at this rate, and each sends one front of air down. */
const BEAT_S = 0.3

/** Draw the wash under `body` at `thrust` (0..1, how hard it is holding itself up), `t` ms into the passage. */
export function downwash(k: Surface, wash: Wash, place: WakePreset, body: Body, thrust: number, t: number, seed: number): void {
  const span = Math.max(3, body.x1 - body.x0 + 1), cx = (body.x0 + body.x1) / 2, under = Math.ceil(body.y1) + 1
  const ground = k.surfaceAt?.(Math.round(cx), under)
  if (ground === undefined) return
  const air = ground - under, reach = 5 + span * 0.6 * wash.power
  const strength = clamp(thrust * clamp(1.15 - air / reach) * Math.min(1.2, wash.power + 0.3))
  if (strength < 0.04) return
  const s = t / 1000, beat = (s / BEAT_S + (seed % 7) / 7) % 1
  // a wing pushes on the downstroke (the first half of the beat) and rests on the upstroke; a jet holds steady with a flicker
  const push = wash.by === 'wings' ? Math.max(0, Math.sin(beat * Math.PI * 2)) : 0.85 + 0.15 * Math.sin(s * 40)
  const a = strength * (wash.by === 'wings' ? 0.35 + 0.65 * push : push)
  const sky = mix(P.white, P.sky, 0.35)

  // 1. the scenery below is pressed: a dent right under the body, the rest parted outwards, deepest at the centre
  const width = span * 0.5 + 3 + 6 * strength, depth = (wash.by === 'wings' ? 1 + push : 1.6) * strength
  const top = Math.max(under, ground - 2), bottom = Math.min(k.H - 1, ground + 2)
  const x0 = Math.max(0, Math.floor(cx - width)), x1 = Math.min(k.W - 1, Math.ceil(cx + width))
  const lift = Math.max(0, under, top - 2) // never reach up into the body itself
  const before = new Map<number, number>()
  for (let y = lift; y <= bottom; y++) for (let x = x0; x <= x1; x++) before.set(y * k.W + x, k.px[y * k.W + x]!)
  const was = (x: number, y: number) => before.get(Math.max(lift, y) * k.W + Math.max(x0, Math.min(x1, x)))!
  for (let y = top; y <= bottom; y++) for (let x = x0; x <= x1; x++) {
    const d = (x - cx) / width, near = 1 - Math.abs(d)
    if (near <= 0) continue
    const down = Math.round(depth * near * near), out = Math.round(depth * 0.8 * Math.sin(near * Math.PI) * Math.sign(d))
    if (down || out) k.px[y * k.W + x] = was(x - out, y - down)
  }

  // 2. the air itself, driven down from under the body
  if (wash.by === 'wings') for (let n = 0; n < 2; n++) { // the fronts of the last two downstrokes, widening as they fall
    const f = (beat + n) / 2, y = under + f * (air + 1), half = span * (0.35 + 0.45 * f)
    if (y > ground + 0.5) continue
    for (let dx = -Math.ceil(half); dx <= half; dx++) {
      const edge = Math.abs(dx) / half, bow = Math.round(edge * edge * 1.5) // the front leads at the middle, its ends trail
      k.lit(cx + dx, y - bow, sky, strength * 0.75 * (1 - f * 0.6) * (0.4 + 0.6 * (1 - edge)))
    }
  } else for (const [n, f] of [-0.3, -0.1, 0.1, 0.3].entries()) for (let y = under; y < ground; y++) { // the column, rushing down
    const x = cx + f * span * (1 + (y - under) / (air + 2) * 0.6), fall = (y - s * 34 + n * 1.7) % 3
    k.lit(x, y, y - under < 2 ? P.sky : sky, a * ((fall + 3) % 3 < 1.4 ? 0.8 : 0.3) * (1 - 0.5 * (y - under) / (air + 2)))
  }
  if (wash.by === 'jets') for (let dx = -Math.ceil(span * 0.6); dx <= span * 0.6; dx++) { // its light, pooled on the ground
    const g = k.surfaceAt?.(Math.round(cx + dx), under) ?? ground
    const fall = 1 - Math.abs(dx) / (span * 0.6 + 1)
    k.lit(cx + dx, g, P.teal, strength * 0.7 * fall)
    k.lit(cx + dx, g - 1, P.teal, strength * 0.3 * fall * fall)
  }

  // 3. a pressure ripple running out across the surface, both ways, brightest on the beat
  const radius = span * 0.5 + 5 + 12 * strength
  for (let dx = -Math.ceil(radius); dx <= radius; dx++) {
    const x = Math.round(cx + dx), g = k.surfaceAt?.(x, under)
    if (g === undefined || Math.abs(g - ground) > 3) continue
    const ring = Math.abs(dx) - (wash.by === 'wings' ? beat * radius : (s * 18) % 6 + span * 0.3)
    const crest = wash.by === 'wings' ? clamp(1 - Math.abs(ring) / 1.6) : 0.4 + 0.6 * clamp(1 - Math.abs(ring % 6) / 1.5)
    const fade = strength * (1 - Math.abs(dx) / (radius + 1))
    k.lit(x, g, WATER.has(place) ? P.white : sky, fade * 0.85 * crest)
    if (WATER.has(place)) k.lit(x, g + 1, P.sky, fade * 0.5 * crest)
  }

  // 4. the place's own stuff, kicked up in puffs, blown out along the ground and settling back
  const colors = CARRIED[place].colors, life = 0.8
  for (let i = 0; i < 12 + Math.round(span * 0.8); i++) {
    const r = (n: number) => (hash(i * 7919 + seed * 31 + n) % 1000) / 1000
    const age = (s + r(1) * life) % life, f = age / life
    const dir = i % 2 ? 1 : -1, from = cx + dir * r(2) * span * 0.3
    const speed = (8 + r(3) * 16) * (0.5 + strength), up = (WATER.has(place) ? 8 : 5) * (0.4 + r(4)) * (0.5 + strength)
    const x = from + dir * speed * age, y = ground - 1 - Math.max(0, up * f * 2.2 - up * f * f * 2.2)
    const alpha = a * (1 - f) * (0.7 + 0.3 * r(5)), color = colors[i % colors.length]!
    k.lit(x, y, color, alpha)
    if (r(6) < 0.5) k.lit(x - dir, y, color, alpha * 0.5) // a puff, not a speck: it trails a little of itself
  }
}
