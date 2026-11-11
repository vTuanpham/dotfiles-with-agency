// How a crew member arrives when its job starts and leaves when it is done: each craft its own way, in each landscape. Pure
// pixels. The styles are in exit-styles.ts; this runs them.
//
// A finished job stays in its slot for EXIT_MS and a new one is on its way in for ARRIVE_MS (the band includes it in the scene
// for those windows; see band.ts). `passages` lifts the sprite's pixels off the finished scene (by its hit owner), paints the
// background back over the hole and draws the sprite again, moved, stretched or dissolving, with whatever the style adds around
// it. An arrival is the same style played backwards, so each craft has one thing to design: the city's clockwork critters that
// hyperdrive away in a streak of light warp in and settle, the boat that sails off to the horizon sails in from it, the sparks
// that burst gather into a star.
import { type Ctx, type Dot, styleFor } from './exit-styles'
import { type Canvas, hash, mix } from './pixels'
import type { CrewBox, SurfaceLight } from './landscapes/kit'
import type { WakePreset } from '../types'
import { type Body, DOWNWASH, canvasSurface, downwash } from './downwash'
import type { Look as SpriteLook } from './exit-styles'

export const EXIT_MS = 3200
/** The flight in; the arrival window runs on a little once the craft is home, while the dust its wash raised settles. */
const FLY_IN_MS = 2400, SETTLE_MS = 600
export const ARRIVE_MS = FLY_IN_MS + SETTLE_MS

/** `age` is ms into the passage: since the job finished (leaving) or since it started (arriving). */
export type Passage = { id: string; kind: 'codex' | 'agy' | 'claude' | 'opencode'; place: string; seed: number; age: number; arriving: boolean; /** its last turn was interrupted: it leaves by being struck down, not by its place's farewell */ struck?: boolean }

const clamp = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Play every passage (a job arriving or leaving) over the finished scene. `owners` are the scene's hit targets, so a job's id
 * finds its pixels through the canvas's hit owners. Hit owners are never changed: hover stays where the job stands.
 */
export function passages(c: Canvas, owners: { id: string }[], list: Passage[], background?: Uint32Array, boxes?: Record<string, CrewBox>, points?: Record<string, { x: number; y: number }>, lights?: SurfaceLight[], surfaceAt?: (x: number, below: number) => number | undefined): void {
  const playing = list.filter(job => job.age >= 0 && job.age < (job.arriving ? ARRIVE_MS : EXIT_MS))
  if (!c.hitOwners || playing.length === 0) return
  const wanted = new Map(playing.map(job => [owners.findIndex(owner => owner.id === job.id) + 1, job]))
  wanted.delete(0)
  const dots = new Map<number, Dot[]>()
  for (let y = 0; y < c.H; y++) for (let x = 0; x < c.W; x++) {
    const owner = c.hitOwners[y * c.W + x]!
    if (wanted.has(owner)) (dots.get(owner) ?? dots.set(owner, []).get(owner)!).push({ x, y, color: c.px[y * c.W + x]! })
  }
  const surface = canvasSurface(c, surfaceAt), lit = surface.lit
  for (const [owner, job] of wanted) {
    const painted = dots.get(owner)
    if (!painted?.length) continue
    const box = boxes?.[job.id]
    // Shadows and flight trails belong to the scenery; moving them would carry pieces of its background along.
    const rows = new Map<number, [number, number]>() // each row's left and right edge of the sprite
    for (const d of painted) { const edge = rows.get(d.y); rows.set(d.y, edge ? [Math.min(edge[0], d.x), Math.max(edge[1], d.x)] : [d.x, d.x]) }
    const home = job.arriving && job.age >= FLY_IN_MS // home: the sprite stays as the scene drew it while its wash dies away
    if (!home) for (const d of painted) {
      const [left, right] = rows.get(d.y)!
      const from = left - 1 >= 0 ? left - 1 : right + 1 < c.W ? right + 1 : d.x
      const index = d.y * c.W + d.x
      c.px[index] = background?.[index] ?? c.px[d.y * c.W + from]!
    }
    const parts = box ? [box, ...box.companions ?? []] : [undefined]
    const center = box ? (box.x0 + box.x1) / 2 : undefined
    const heading = center !== undefined && points?.[job.id] && points[job.id]!.x !== center ? points[job.id]!.x < center ? -1 as const : 1 as const : undefined
    for (const part of parts) {
      const sprite = part ? painted.filter(d => d.x >= part.x0 && d.x <= part.x1 && d.y >= part.y0 && d.y <= part.y1) : painted
      if (!sprite.length) continue
      const xs = sprite.map(d => d.x), ys = sprite.map(d => d.y)
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      const p = job.arriving ? Math.max(0, 1 - job.age / FLY_IN_MS) : job.age / EXIT_MS // an arrival is the exit played backwards
      const ctx: Ctx = {
        c, p, seed: job.seed, arriving: job.arriving, cx, cy, x0, x1, y0, y1, lit, surfaceAt,
        heading,
        behind: (i, step) => (job.arriving ? p + i * step : p - i * step),
        flip: job.arriving ? -1 : 1,
        sprite: ({ dx = 0, dy = 0, sx = 1, sy = 1, dissolve = 0, tint, tintBy = 0, filter, offset, clipBelow }) => {
          for (const light of lights ?? []) if (part === box && light.id === job.id) {
            light.x += dx
            light.y = cy + dy + (light.y - cy) * sy
            light.alpha *= 1 - dissolve
          }
          for (const d of sprite) {
            if (filter && !filter(d)) continue
            if (dissolve > 0 && (hash(d.x * 31 + d.y * 17 + job.seed) % 1000) / 1000 < dissolve) continue
            const [ox, oy] = offset?.(d) ?? [0, 0]
            const x = cx + dx + ox + (d.x - cx) * sx, y = Math.round(cy + dy + oy + (d.y - cy) * sy)
            if (clipBelow !== undefined && y > clipBelow) continue
            const color = tint === undefined ? d.color : mix(d.color, tint, tintBy)
            for (let i = 0; i < Math.max(1, Math.ceil(sx)); i++) {
              const px = Math.floor(x) + i
              if (px >= 0 && px < c.W && y >= 0 && y < c.H) c.px[y * c.W + px] = color
            }
          }
        },
      }
      const wash = job.struck && !job.arriving ? undefined : DOWNWASH[job.kind][job.place as WakePreset]
      const scale = part === parts[0] ? 1 : 0.6 // a companion is smaller and pushes less air
      if (home) { // settled: the wash dies away over the dust's last second
        if (wash) downwash(surface, wash, job.place as WakePreset, { x0, x1, y0, y1 }, 0.6 * scale * (1 - (job.age - FLY_IN_MS) / SETTLE_MS), job.age, job.seed)
        continue
      }
      const style = styleFor(job.kind, job.place, job.struck && !job.arriving, job.arriving)
      let drawn: SpriteLook | undefined
      const draw = ctx.sprite
      style({ ...ctx, sprite: look => { drawn ??= look; draw(look) } })
      if (!wash || !drawn) continue
      // Where the body is, and how hard it is working: it holds itself up (0.55) and works harder the faster it climbs or
      // brakes, measured from the same style a moment earlier in its passage. It fades as the body dissolves.
      const at = (look: SpriteLook): Body => ({
        x0: cx + (look.dx ?? 0) + (x0 - cx) * (look.sx ?? 1), x1: cx + (look.dx ?? 0) + (x1 - cx) * (look.sx ?? 1),
        y0: cy + (look.dy ?? 0) + (y0 - cy) * (look.sy ?? 1), y1: cy + (look.dy ?? 0) + (y1 - cy) * (look.sy ?? 1),
      })
      const step = 0.02
      let before: SpriteLook | undefined
      style({ ...ctx, p: Math.min(1, ctx.p + step), lit: () => {}, sprite: look => { before ??= look } })
      const body = at(drawn), climb = before ? Math.abs(at(before).y1 - body.y1) / (step * (job.arriving ? FLY_IN_MS : EXIT_MS) / 1000) : 0
      const thrust = (0.55 + 0.45 * clamp(climb / 8)) * scale * (1 - (drawn.dissolve ?? 0))
      downwash(surface, wash, job.place as WakePreset, body, thrust, job.age, job.seed)
    }
  }
}
