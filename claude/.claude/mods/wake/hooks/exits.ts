// How a crew member arrives when its job starts and leaves when it is done: each craft its own way, in each landscape. Pure
// pixels. The styles are in exit-styles.ts; this runs them.
//
// A finished job stays in its slot for EXIT_MS and a new one is on its way in for ARRIVE_MS (the band includes it in the scene
// for those windows; see band.ts). `passages` lifts the sprite's pixels off the finished scene (by its hit owner), paints the
// background back over the hole and draws the sprite again, moved, stretched or dissolving, with whatever the style adds around
// it. An arrival is the same style played backwards, so each craft has one thing to design: the helicopter that lifts off in a
// ring of rotor wash and banks away lands the same way in reverse, the boat that sails off to the horizon sails in from it, the
// sparks that burst gather into a star. Fast movers leave afterimages, and every family has a signature burst at the resting end
// (see exit-styles.ts); effects are data for landscapes/particles.ts (landscapes/CREW.md).
import { type Ctx, type Dot, styleFor } from './exit-styles'
import { type Canvas, hash, mix } from './pixels'

export const EXIT_MS = 3200
export const ARRIVE_MS = 2400

/** `age` is ms into the passage: since the job finished (leaving) or since it started (arriving). */
export type Passage = { id: string; kind: 'codex' | 'agy' | 'claude' | 'opencode'; place: string; seed: number; age: number; arriving: boolean; tier?: number }

const clamp = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Play every passage (a job arriving or leaving) over the finished scene. `owners` are the scene's hit targets, so a job's id
 * finds its pixels through the canvas's hit owners. Hit owners are never changed: hover stays where the job stands.
 */
export function passages(c: Canvas, owners: { id: string }[], list: Passage[]): void {
  const playing = list.filter(job => job.age > 0 && job.age < (job.arriving ? ARRIVE_MS : EXIT_MS))
  if (!c.hitOwners || playing.length === 0) return
  const wanted = new Map(playing.map(job => [owners.findIndex(owner => owner.id === job.id) + 1, job]))
  wanted.delete(0)
  const dots = new Map<number, Dot[]>()
  for (let y = 0; y < c.H; y++) for (let x = 0; x < c.W; x++) {
    const owner = c.hitOwners[y * c.W + x]!
    if (wanted.has(owner)) (dots.get(owner) ?? dots.set(owner, []).get(owner)!).push({ x, y, color: c.px[y * c.W + x]! })
  }
  const lit = (x: number, y: number, color: number, alpha: number) => {
    const px = Math.round(x), py = Math.round(y)
    if (px < 0 || px >= c.W || py < 0 || py >= c.H || alpha <= 0) return
    c.px[py * c.W + px] = mix(c.px[py * c.W + px]!, color, clamp(alpha))
  }
  for (const [owner, job] of wanted) {
    const sprite = dots.get(owner)
    if (!sprite?.length) continue
    const rows = new Map<number, [number, number]>() // each row's left and right edge of the sprite
    for (const d of sprite) { const edge = rows.get(d.y); rows.set(d.y, edge ? [Math.min(edge[0], d.x), Math.max(edge[1], d.x)] : [d.x, d.x]) }
    const xs = sprite.map(d => d.x), ys = sprite.map(d => d.y)
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    // lift the sprite off: each row of the hole takes the colour of the scene just beside it (skies and water vary by row)
    for (const d of sprite) {
      const [left, right] = rows.get(d.y)!
      const from = left - 1 >= 0 ? left - 1 : right + 1 < c.W ? right + 1 : d.x
      c.px[d.y * c.W + d.x] = c.px[d.y * c.W + from]!
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const p = job.arriving ? 1 - job.age / ARRIVE_MS : job.age / EXIT_MS // an arrival is the exit played backwards
    const ctx: Ctx = {
      c, p, seed: job.seed, tier: job.tier ?? 2, arriving: job.arriving, cx, cy, x0, x1, y0, y1, lit,
      behind: (i, step) => (job.arriving ? p + i * step : p - i * step),
      flip: job.arriving ? -1 : 1,
      sprite: ({ dx = 0, dy = 0, sx = 1, sy = 1, dissolve = 0, tint, tintBy = 0, alpha = 1 }) => {
        for (const d of sprite) {
          if (dissolve > 0 && (hash(d.x * 31 + d.y * 17 + job.seed) % 1000) / 1000 < dissolve) continue
          const x = cx + dx + (d.x - cx) * sx, y = Math.round(cy + dy + (d.y - cy) * sy)
          const color = tint === undefined ? d.color : mix(d.color, tint, tintBy)
          for (let i = 0; i < Math.max(1, Math.ceil(sx)); i++) {
            const px = Math.floor(x) + i
            if (px >= 0 && px < c.W && y >= 0 && y < c.H) c.px[y * c.W + px] = alpha >= 1 ? color : mix(c.px[y * c.W + px]!, color, alpha)
          }
        }
      },
    }
    styleFor(job.kind, job.place)(ctx)
  }
}
