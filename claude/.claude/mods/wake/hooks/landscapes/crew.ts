import { TURN_LEAD_MS } from '../crew-row'
import { type Canvas, hash, mix } from '../pixels'
import { craftFrames, craftNose } from './craft'
import { AGY_TEMPO, agyFrames, agyCore } from './agy'
import { lanternFlare, lanternFrames, lanternInk, lanternPaper, lanternNose, lanternPose } from './lantern'
import { designFor, type Design, type Tier, type Turn } from './design'
import { creatureFrames, creatureNose } from './creatures'
import * as craftSprite from './craft'
import * as creatureSprite from './creatures'
import * as agySprite from './agy'
import * as lanternSprite from './lantern'
import { crewFx, groundStep } from './fx'
import type { Vec } from './particles'
import { clockRate, gait, roamShare } from './gait'
import { type Job, jobAccent, type Look, P } from './kit'
import type { WakePreset } from '../../types'

// The crew's look: one family per harness, four classes that grow in size and detail.
//   codex     mechanical  what each place builds (craft.ts): in the city a clockwork dragon, whelp -> Astra
//   agy       celestial   spark -> comet -> constellation
//   claude    living      sparrow -> gull -> eagle (also the subagents' birds)
//   opencode  festival    sky lantern garlands: one paper lantern -> five linked lanterns on a waving ribbon
// Sprite keys: a body, W highlight, l light stripe, d shade or rope, s lamp, beak or flame, p bunting, k smoke, h hull or basket,
// m / M the maker's mark (a body / highlight pixel that takes the maker's colour when another family made the model).
// Where each one flies comes from who it is (its seed), never from its place in the list: see stations.

type Kind = NonNullable<Job['kind']>
type Frames = readonly (readonly string[])[]
// A sprite module may export `emissive: string` for additional glowing cell letters.
const SPRITES = { codex: craftSprite, claude: creatureSprite, agy: agySprite, opencode: lanternSprite } as Record<Kind, { emissive?: string; rest?: Partial<Record<WakePreset, Record<Tier, readonly string[]>>>; restContact?: Partial<Record<WakePreset, Record<Tier, Vec>>>; turnPose?: Partial<Record<WakePreset, Record<Tier, readonly string[]>>>; messageStars?: (place: WakePreset, tier: Tier) => Vec[] }>
const TEMPO: Record<Kind, number> = { codex: 4, claude: 3, agy: 4, opencode: 5 }

const drawWithHit = <T>(c: Canvas, job: Job, draw: () => T): T => job.hitOwner ? c.withHit(job.hitOwner, draw) : draw()
const schedule = (look: Look, job: Job, draw: () => void) => { if (look.crewDeferred) look.crewDeferred.push({ job, draw }); else draw() }
/** How far a flyer patrols each way from its home, when the sky there is clear: about half a sky slot. */
const PATROL = 9

const LANE: Record<Kind, readonly string[]> = {
  codex: ['.a.', 'aWa', '.a.'],
  agy: ['.W.', 'WaW', '.W.'],
  claude: ['a.a', '.a.', '.d.'],
  opencode: ['.l.', 'asd', '.p.'],
}
/** The family's palette; a stale job stays amber. */
function paint(job: Job, look: Look) {
  const family = job.isStale ? P.peach : job.kind === 'opencode' ? lanternInk(job.seed) : jobAccent(job, P.teal)
  const base = job.signal ? mix(family, P.white, 0.65) : family
  const mark = job.maker && job.maker !== job.kind && !job.isStale ? jobAccent({ ...job, kind: job.maker }, P.teal) : undefined
  const paper = job.kind === 'opencode'
  const a = paper ? lanternPaper(base, 0) : base
  const W = job.isStale ? P.yellow : mix(base, P.white, 0.7)
  const colors: Record<string, number> = {
    a,
    W,
    m: mark ?? a,
    M: mark === undefined ? W : mix(mark, P.white, 0.45),
    l: mix(a, P.white, paper ? 0.32 : 0.5), // paper's lit folds and stripes have to read against its shade
    d: mix(a, P.ink, 0.45),
    s: P.yellow,
    f: mix(P.yellow, P.white, 0.65), // a flaring paper-lantern window stays warm
    p: paper ? mix(a, P.ink, 0.2) : job.isStale ? P.woodDark : P.yellow,
    k: P.surface2,
    r: job.isStale ? P.peach : P.red, // a beacon, a tail fin
    g: job.isStale ? mix(P.peach, P.white, 0.4) : mix(P.sapphire, P.white, 0.35), // glass
    h: job.isStale ? mix(P.peach, P.woodDark, 0.5) : P.wood,
  }
  const shade = Math.max(0, Math.min(1, look.night)) * 0.45
  const body = shade ? Object.fromEntries(Object.entries(colors).map(([ch, color]) => [ch, mix(color, look.top, shade)])) : colors
  const kind = job.kind ?? 'codex'
  const lit = kind === 'codex' ? 'sfgMr' + (look.place === 'city' ? 'W' : '') : kind === 'opencode' ? 'sfM' : 'M'
  // Stars have no body to stand out with by day: a deep ring round each one sets it off from a bright sky, cloud or snow.
  return { colors, body, extra: lit + (SPRITES[kind].emissive ?? ''), ...(kind === 'agy' ? { ring: mix(base, P.ink, 0.7) } : {}) }
}

function draw(c: Canvas, look: Look, x0: number, y0: number, art: readonly string[], pal: ReturnType<typeof paint>, glow: boolean) {
  const emissive = (ch: string, x: number, y: number) => pal.extra.includes(ch) || ch === 'W' && pal.extra.includes('g') && (art[y]?.[x - 1] === 'g' || art[y]?.[x + 1] === 'g' || art[y - 1]?.[x] === 'g' || art[y + 1]?.[x] === 'g')
  if (look.night > 0) art.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!
      if (ch !== '.' && emissive(ch, x, y)) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) c.glow(x0 + x + dx, y0 + y + dy, pal.colors[ch]!, 0.3 * look.night)
    }
  })
  if (pal.ring !== undefined && look.night < 1) art.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if ('WM'.includes(row[x]!)) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) c.glow(x0 + x + dx, y0 + y + dy, pal.ring!, (dx && dy ? 0.22 : 0.42) * (1 - look.night))
  })
  if (glow) art.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if ('WMs'.includes(row[x]!)) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) c.glow(x0 + x + dx, y0 + y + dy, pal.body.a!, 0.25 * (0.4 + look.night))
  })
  art.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]!
      if (ch === '.') continue
      if (ch === 'e' || ch === 'E') { c.glow(x0 + i, y0 + r, ch === 'E' ? pal.colors.W! : pal.colors.a!, ch === 'E' ? 0.38 + 0.2 * look.night : 0.07); continue } // a line is a tint of the sky behind it, never a solid cell; the one carrying light warms
      c.set(x0 + i, y0 + r, (emissive(ch, i, r) ? pal.colors : pal.body)[ch]!)
    }
  })
}

/** A flyer's frames: a Codex machine is the craft its place builds (a glider over the mountains, a biplane over the fields),
 * a Claude worker is its place's living winged creature, agy's luminous bodies are generated per place, and OpenCode sews a local
 * festival lantern: every family has a generator for each place. */
const airFrames = (look: Look, kind: Kind, tier: 1 | 2 | 3 | 4): Frames => {
  const frames = kind === 'codex' ? craftFrames(look.place, tier) : kind === 'claude' ? creatureFrames(look.place, tier) : kind === 'agy' ? agyFrames(look.place, tier) : lanternFrames(look.place, tier)
  return look.crewRest ? [SPRITES[kind].rest?.[look.place ?? 'city']?.[tier] ?? frames[0]!] : frames
}

const nearestLamp = (frame: readonly string[], [nx, ny]: Vec): Vec => {
  let point: Vec = [nx, ny], distance = Infinity
  for (const [y, row] of frame.entries()) for (let x = 0; x < row.length; x++) if (row[x] === 's' || row[x] === 'f') {
    const d = (x - nx) ** 2 + (y - ny) ** 2
    if (d < distance) { point = [x, y]; distance = d }
  }
  return point
}
const lanternPoint: typeof lanternNose = (place, tier, beat) => nearestLamp(lanternFrames(place, tier)[((beat % 8) + 8) % 8]!, lanternNose(place, tier, beat))
const noses = { codex: craftNose, claude: creatureNose, agy: agyCore, opencode: lanternPoint }
const lamps: Partial<Record<Kind, typeof lanternPose>> = { opencode: lanternPose }

/** Project the sprite's own point through its turn, then attach it to the nearest surviving painted cell. */
export function messagePoint(frame: readonly string[], art: readonly string[], point: readonly [number, number], mirror: 1 | -1, roll: number | undefined, turn: Turn): Vec {
  let target: Vec = [mirror < 0 ? frame[0]!.length - 1 - point[0] : point[0], point[1]]
  if (roll !== undefined && roll > 0 && roll < 1 && turn !== 'none') {
    const marked = frame.map((row, y) => y === point[1] ? row.slice(0, point[0]) + '@' + row.slice(point[0] + 1) : row)
    const projected = shape(marked, mirror, roll, turn)
    for (const [y, row] of projected.entries()) { const x = row.indexOf('@'); if (x >= 0) { target = [x, y]; break } }
  }
  if (art[target[1]]?.[target[0]] && art[target[1]]![target[0]] !== '.') return target
  let best: Vec = target, distance = Infinity
  for (const [y, row] of art.entries()) for (let x = 0; x < row.length; x++) if (row[x] !== '.') {
    const d = (x - target[0]) ** 2 + (y - target[1]) ** 2
    if (d < distance) { best = [x, y]; distance = d }
  }
  return best
}

function rememberPoint(look: Look, job: Job, art: readonly string[], x: number, y: number, point: Vec = [art[0]!.length >> 1, art.length >> 1]) {
  if (!job.hit) return
  const [px, py] = messagePoint(art, art, point, 1, undefined, 'none')
  ;(look.crewMessagePoints ??= {})[job.hit.id] = { x: x + px, y: y + py }
  ;(look.crewBoxes ??= {})[job.hit.id] = { x0: x, y0: y, x1: x + art[0]!.length - 1, y1: y + art.length - 1 }
}

/** The gait a flyer moves by: its family's, except that craft which cruise (a dragon, a banner plane) fly the continuous loop. */
const gaitKind = (job: Job, look: Look) => designFor(job.kind ?? 'codex', look.place).cruise ? 'claude' : job.kind ?? 'codex'

/** Seconds to coil a flexible body or wheel a rigid one through edge-on. */
const TURN = TURN_LEAD_MS / 1000 // (a sender sends only after this: crew-row.ts)
/** A reversal this close is not worth a turn back after a message. */
export const TURN_SOON_SECONDS = 4
export const MIN_TURN_GAP_MS = 3000

/** Sample the actual route ahead until its next horizontal reversal. */
export function runAhead(path: (ago: number) => Vec, ago: number, roam: number): { seconds: number; distance: number; enough: boolean } {
  const start = path(ago)[0], step = 0.5
  let previous = start, direction = 0, low = start, high = start
  for (let seconds = step; seconds <= 60; seconds += step) {
    const x = path(ago - seconds)[0], delta = x - previous
    low = Math.min(low, x); high = Math.max(high, x)
    if (Math.abs(delta) > 0.002) {
      const next = Math.sign(delta)
      if (direction && next !== direction) {
        const distance = Math.abs(previous - start)
        return { seconds: seconds - step, distance, enough: seconds - step > TURN_SOON_SECONDS && distance > 2 * roam / 3 }
      }
      direction = next
    }
    previous = x
  }
  const distance = Math.max(Math.abs(high - start), Math.abs(low - start))
  return { seconds: Infinity, distance, enough: direction !== 0 && distance > 2 * roam / 3 }
}

/**
 * How a craft that faces one way is turned `ago` seconds back: which way it is mirrored (1 as drawn, -1 reversed) and, while it
 * turns, how far through its turn it is (`roll`, 0..1). The design's shape controls the projection; the craft reverses halfway,
 * when coiled or edge-on. It faces its course or the other message endpoint. `since` is how long ago the roll began, in ms.
 */
export function orient(path: (ago: number) => Vec, drawn: 'left' | 'right', ago: number, talk?: { ms: number; over?: number; targetX?: number; sourceX?: number }, roam = 9): { mirror: 1 | -1; roll?: number; since?: number } {
  const side = (heading: 'left' | 'right'): 1 | -1 => (heading === drawn ? 1 : -1)
  const heading = (back: number): 'left' | 'right' => {
    const x = path(back)[0]
    for (const span of [0.6, 1.2, 2.4]) {
      const earlier = path(back + span)[0]
      if (Math.abs(x - earlier) > 0.03) return x > earlier ? 'right' : 'left'
    }
    return drawn
  }
  const turn = (from: 1 | -1, to: 1 | -1, elapsed: number): { mirror: 1 | -1; roll?: number; since?: number } => elapsed >= TURN
    ? { mirror: to }
    : { mirror: elapsed / TURN < 0.5 ? from : to, roll: elapsed / TURN, since: elapsed * 1000 }
  if (talk?.over !== undefined) { // decide from the course and remaining run at the end of the message
    const atEnd = ago + talk.over / 1000, course = heading(atEnd)
    const from = side((talk.targetX ?? Infinity) >= (talk.sourceX ?? path(ago)[0]) ? 'right' : 'left'), to = side(course)
    if (from === to) return orient(path, drawn, ago, undefined, roam)
    const run = runAhead(path, atEnd, roam)
    if (run.distance === 0) return { mirror: from }
    const returning = run.enough
    let previous = course, reversals = 0
    for (let seconds = 0.5; seconds <= talk.over / 1000; seconds += 0.5) {
      const next = heading(atEnd - seconds)
      if (next !== previous) { reversals++; previous = next; if (reversals >= 2) break }
    }
    if (reversals) return !returning && reversals === 1 ? { mirror: side(heading(ago)) } : orient(path, drawn, ago, undefined, roam)
    if (!returning) return { mirror: from }
    const wait = Math.max(0, MIN_TURN_GAP_MS - (talk.ms - talk.over))
    return turn(from, to, Math.max(0, talk.over - wait) / 1000)
  }
  if (talk) {
    const seconds = talk.ms / 1000, from = side(heading(ago + seconds)), to = side((talk.targetX ?? Infinity) >= (talk.sourceX ?? path(ago)[0]) ? 'right' : 'left')
    return from === to ? { mirror: to } : turn(from, to, seconds) // already facing her: no turn
  }
  const now = heading(ago)
  for (let k = 1; k <= 16; k++) {
    const before = heading(ago + k * 0.05)
    if (before !== now) return turn(side(before), side(now), k * 0.05 - 0.025) // it changed course k steps back: the roll began then
  }
  return { mirror: side(now) }
}

/**
 * Rows of a craft drawn facing left, turned: mirrored when `mirror` is -1, and, while it turns (`roll`, 0..1), coiled up. The body
 * (head on the left, tail on the right, as drawn) curls into a spiral like a snail's shell, head outside and tail winding in,
 * holds the coil a moment and uncurls. Each cell goes to its place on the spiral by how far along the body it is, so the curl
 * runs down the length from the head to the tail, and eases in and out, so the sprite starts and ends straight. Mid-turn the
 * whole body is coiled, and that is when the craft reverses (see `orient`): the spiral is the same either way, so nothing jumps.
 */
export function shape(rows: readonly string[], mirror: 1 | -1, roll?: number, turn: Turn = 'coil', turnPose?: readonly string[]): string[] {
  const h = rows.length, w = rows[0]!.length
  const reversed = (grid: readonly string[]) => (mirror < 0 ? grid.map(r => [...r].reverse().join('')) : [...grid])
  if (roll === undefined || turn === 'none' || roll === 0 || roll === 1) return reversed(rows)
  if (turn === 'pose' && turnPose && roll >= 0.35 && roll <= 0.65) return [...turnPose]
  const out = Array.from({ length: h }, () => Array<string>(w).fill('.'))
  if (turn === 'bank' || turn === 'pose') {
    // A rigid body wheels through edge-on: foreshorten the length, flatten the wings and tilt, then open the other way.
    const cx = (w - 1) / 2, cy = (h - 1) / 2, wheel = Math.sin(Math.PI * roll)
    // A body with a drawn front view only draws in a little on the way to it: squashed to a sliver, it would pop to full span.
    const sx = 1 - (turn === 'pose' && turnPose ? 0.3 : 0.78) * wheel * wheel, sy = 1 - 0.45 * Math.sin(2 * Math.PI * roll) ** 2
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y]![x]!
      if (ch === '.') continue
      const px = Math.round(cx + (x - cx) * sx)
      const py = Math.max(0, Math.min(h - 1, Math.round(cy + (y - cy) * sy + (x - cx) / w * Math.sin(2 * Math.PI * roll))))
      if (out[py]![px] !== '@' || ch === '@') out[py]![px] = ch
    }
    return reversed(out.map(r => r.join('')))
  }
  const mid = (h - 1) / 2, cx = (w - 1) / 2, rmax = Math.max(1, cx - 0.5), ky = Math.min(1, (h - 1) / (2 * rmax)) // the spiral fits the sprite's box
  const smooth = (edge0: number, edge1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t) }
  for (let x = 0; x < w; x++) {
    let top = -1, bottom = -1
    for (let y = 0; y < h; y++) if (rows[y]![x] !== '.') { if (top < 0) top = y; bottom = y }
    if (top < 0) continue
    const axis = (top + bottom) / 2, s = x / Math.max(1, w - 1) // how far down the body this column is: 0 at the head
    const t = Math.max(0, Math.min(1, (roll - 0.25 * s) / 0.75)) // the head curls first and the tail follows
    const coiled = smooth(0, 0.3, t) * smooth(1, 0.7, t) // 0 straight, 1 fully coiled, held through the middle of the turn
    for (let y = top; y <= bottom; y++) {
      for (const along of [s, s + 0.5 / Math.max(1, w - 1)]) { // twice a cell: a spiral is longer than the straight body, and must not tear
        const angle = Math.PI + 2.6 * Math.PI * along, radius = rmax * (1 - 0.8 * along) + (y - axis) * 0.7
        const px = (1 - coiled) * x + coiled * (cx + radius * Math.cos(angle))
        const py = (1 - coiled) * y + coiled * (mid + ky * radius * Math.sin(angle))
        const [ix, iy] = [Math.round(px), Math.round(py)]
        if (ix >= 0 && ix < w && iy >= 0 && iy < h && (out[iy]![ix] !== '@' || rows[y]![x] === '@')) out[iy]![ix] = rows[y]![x]!
      }
    }
  }
  return reversed(out.map(r => r.join('')))
}

/** A flyer centred on (cx, cy): its family and class decide the sprite and which frame this beat shows. */
export function fly(c: Canvas, look: Look, cx: number, cy: number, job: Job, kind: Kind = job.kind ?? 'codex', compact = false, path: (ago: number) => Vec = () => [cx, cy], company?: Design['escorts'][Tier]) {
  const frames = airFrames(look, kind, compact ? 1 : job.tier ?? 1)
  // its wings, rotors and lights beat on its own clock, so a busy worker's run faster than a calm one's; a craft drawn in many
  // frames (the dragon's wave has eight) steps through them faster, so the motion flows instead of ticking
  const tempo = kind === 'agy' ? AGY_TEMPO : frames.length >= 8 ? 1.5 : kind === 'claude' ? 3 : kind === 'opencode' ? 5 : 4
  const design = designFor(kind, look.place)
  // Every family's design declares its front and its own turn; a symmetric body never mirrors.
  const drawn = !compact ? design.facing : null
  // Momentum: a headed body that brakes to send carries on a little along its old course and, in the air, rises through the
  // turn, then settles back onto its spot exactly as the shot leaves (so the launch point is where the message starts).
  if (drawn && job.talk && job.talk.over === undefined && job.talk.ms < TURN_LEAD_MS && !look.crewRest) {
    const s = job.talk.ms / 1000, carry = Math.sign(path(s)[0] - path(s + 0.5)[0]), swing = Math.sin(Math.PI * job.talk.ms / TURN_LEAD_MS)
    cx += Math.round(carry * 2 * swing)
    if ((design.habit ?? 'air') === 'air' && design.altitude !== 'low' && cy - (frames[0]!.length >> 1) >= 1) cy -= Math.round(swing)
  }
  const turning: { mirror: 1 | -1; roll?: number; since?: number } = drawn ? orient(path, drawn, 0, job.talk, job.lane?.roam) : { mirror: 1 }
  const facingRight = !drawn ? false : drawn === 'right' ? turning.mirror > 0 : turning.mirror < 0 // effects are written facing left
  const beat = (Math.floor((job.phase ?? look.frame) / tempo) + job.seed) % frames.length
  const blast = kind === 'opencode' && !compact && !look.crewRest && job.talk?.sending && job.talk.over === undefined && job.talk.ms >= TURN_LEAD_MS && job.talk.ms < TURN_LEAD_MS + 300
  const frame = blast ? lanternFlare(look.place ?? 'city', job.tier ?? 1, beat) : frames[beat]!
  const turnPose = SPRITES[kind].turnPose?.[look.place ?? 'city']?.[compact ? 1 : job.tier ?? 1]
  const art = drawn ? shape(frame, turning.mirror, turning.roll, design.turn, turnPose) : [...frame]
  if (kind === 'agy' && drawn && turning.roll !== undefined && !(design.turn === 'pose' && turnPose && turning.roll >= 0.35 && turning.roll <= 0.65)) {
    // Projection can merge cells; keep the core in its own projected cell rather than losing it behind a filament.
    shape(frame.map(row => row.replace(/[^M]/g, '.')), turning.mirror, turning.roll, design.turn).forEach((row, y) => {
      const x = row.indexOf('M')
      if (x >= 0) art[y] = art[y]!.slice(0, x) + 'M' + art[y]!.slice(x + 1)
    })
  }
  const pal = paint({ ...job, kind }, look)
  const x0 = cx - (art[0]!.length >> 1), y0 = cy - (art.length >> 1)
  const point = messagePoint(frame, art, noses[kind](look.place ?? 'city', compact ? 1 : job.tier ?? 1, beat), turning.mirror, turning.roll, design.turn)
  if (job.hit && !compact) (look.crewMessagePoints ??= {})[job.hit.id] = { x: x0 + point[0], y: y0 + point[1] }
  if (job.hit && !compact && look.crewStarTargets?.has(job.hit.id) && SPRITES[kind].messageStars) {
    (look.crewMessageStars ??= {})[job.hit.id] = SPRITES[kind].messageStars!(look.place ?? 'city', job.tier ?? 1).map(star => {
      const [x, y] = messagePoint(frame, art, star, turning.mirror, turning.roll, design.turn)
      return { x: x0 + x, y: y0 + y }
    })
  }
  // The worker's own sprite, for what happens ON it (the send pulse, the receive ring): not its escorts, nor the trail and air it
  // leaves, which are painted under the same hit owner and would stretch its box across half the screen.
  if (job.hit && !compact) (look.crewBoxes ??= {})[job.hit.id] = { x0, y0, x1: x0 + art[0]!.length - 1, y1: y0 + art.length - 1 }
  if (look.crewLocateOnly) {
    if (job.hit) (look.crewPaths ??= {})[job.hit.id] = path
    return
  }
  const quietMachine = kind === 'agy' || kind === 'claude' || kind === 'opencode' || kind === 'codex' && look.place !== undefined && look.place !== 'city'
  const nose: Vec = [(point[0] - (art[0]!.length >> 1)) * (facingRight ? -1 : 1), point[1] - (art.length >> 1)]
  const lightPoints = look.effects === false ? undefined : lamps[kind]?.(look.place ?? 'city', job.tier ?? 1, beat).lamps.map(lamp => {
    const [x, y] = messagePoint(frame, art, nearestLamp(frame, lamp.flame), turning.mirror, turning.roll, design.turn)
    return [x0 + x, y0 + y] as Vec
  })
  const air = () => {
    if (!compact) crewFx(c, look, { id: job.hit?.id, x0, y0, w: art[0]!.length, h: art.length, cx, cy, kind, tier: job.tier ?? 1, seed: job.seed, pace: job.pace ?? 0.6, phase: job.phase ?? look.frame, path, lift: job.lift ?? 0, ground: look.crewGround ?? c.H, flip: facingRight, talk: job.talk, turn: design.turn === 'coil' ? turning.since : undefined, nose, lamps: lightPoints })
    if (!drawn && job.talk && job.talk.over === undefined && look.effects !== false) {
      const direction = (job.talk.targetX ?? Infinity) >= x0 + point[0] ? 1 : -1
      for (let distance = 1; distance <= art[0]!.length + art.length; distance++) {
        let painted = false
        for (let dx = 1; dx <= distance && !painted; dx++) for (const dy of [distance - dx, -(distance - dx)]) {
          const x = point[0] + direction * dx, y = point[1] + dy
          if ((art[y]?.[x] ?? '.') !== '.') continue
          c.glow(x0 + x, y0 + y, pal.colors.M!, 0.7)
          painted = true
          break
        }
        if (painted) break
      }
    }
  }
  // Air stays behind solid machines and plumage: no particle can repaint a body cell.
  if (quietMachine) air()
  if (kind === 'agy' && look.effects !== false) {
    const stars = SPRITES.agy.messageStars!(look.place ?? 'city', compact ? 1 : job.tier ?? 1)
    for (const [i, [x, y]] of stars.entries()) {
      const pulse = .65 + .35 * Math.sin((job.phase ?? look.frame) * .035 + i * 1.7)
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const distance = dx * dx + dy * dy
        if (distance > 0 && distance <= 5) c.glow(x0 + x + dx, y0 + y + dy, P.lavender, (.22 + .24 * look.night) * pulse / (1 + distance))
      }
    }
  }
  if (kind === 'agy' && !compact) {
    const clock = (job.phase ?? look.frame) / tempo + job.seed, fraction = clock - Math.floor(clock)
    const blend = fraction * fraction * (3 - 2 * fraction), next = frames[(beat + 1) % frames.length]!
    for (let y = 0; y < art.length; y++) for (let x = 0; x < art[y]!.length; x++) {
      const from = art[y]![x]!, to = next[y]![x]!
      if (from === '.' && to === '.') continue
      const sky = c.get(x0 + x, y0 + y)
      const color = (ch: string) => ch === '.' ? sky : ch === 'e' ? mix(sky, pal.colors.a!, .07) : ch === 'E' ? mix(sky, pal.colors.W!, .38 + .2 * look.night) : (pal.extra.includes(ch) ? pal.colors : pal.body)[ch]!
      c.set(x0 + x, y0 + y, mix(color(from), color(to), blend))
    }
  } else draw(c, look, x0, y0, art, pal, false)
  if (!compact) { // Companions share a patrol, with their own bounded deviations and wing clocks.
    for (const [i, e] of (company ?? design.escorts[job.tier ?? 1] ?? []).entries()) {
      const ownPath = (ago: number): Vec => {
        const [x, y] = path(ago + e.lag)
        const t = ((job.phase ?? look.frame) - ago * 10) * .035 + job.seed + i * 2.4
        // A flock member (one with its own station, `dx`) roams round that station on two unrelated rhythms, closing up and
        // falling back on its own; a whelp in line astern only weaves.
        return e.dx === undefined ? [x + 2 * Math.sin(t), y + e.dy + Math.sin(t * .7 + i)]
          : [x + e.dx - Math.sign(e.dx) * (1.5 + 1.5 * Math.sin(t * .6 + i * 2)) + Math.sin(t * 1.7 + i * 3), y + e.dy + 1.5 * Math.sin(t * .45 + i * 1.3) + .5 * Math.sin(t * 1.3)] // it closes on the leader and drops back to its station, never wider than the formation's reserved span
      }
      const small = airFrames(look, kind, e.tier), [px, py] = ownPath(0)
      const next = small[(Math.floor((job.phase ?? look.frame) / (tempo * (0.83 + i * .11))) + job.seed + 3 * i) % small.length]!
      // A companion heads where the flock heads, a beat behind its leader: its own weave round its station is not a change of course.
      const o = drawn ? orient(ago => path(ago + e.lag), drawn, 0, job.talk ? { ...job.talk, sourceX: px } : undefined, job.lane?.roam) : undefined
      const piece = o ? shape(next, o.mirror, o.roll, design.turn, SPRITES[kind].turnPose?.[look.place ?? 'city']?.[e.tier]) : next
      const floor = (look.crewGround ?? c.H) - piece.length
      if (floor < 0) continue
      const top = Math.max(0, Math.min(floor, Math.round(py) - (piece.length >> 1))) // a roaming companion is held inside the sky, never blinked out at its edge
      const left = Math.round(px) - (piece[0]!.length >> 1)
      if (left < 0 || left + piece[0]!.length > c.W) continue
      if (job.hit && look.crewBoxes?.[job.hit.id]) (look.crewBoxes[job.hit.id]!.companions ??= []).push({ x0: left, y0: top, x1: left + piece[0]!.length - 1, y1: top + piece.length - 1 })
      draw(c, look, left, top, piece, pal, false)
    }
  }
  if (!quietMachine) air()
}

/** Place a grounded, floating or resting worker using the same sprite and hit owner as flight. */
function placeSurface(c: Canvas, look: Look, x: number, job: Job, right: number) {
  const design = designFor(job.kind ?? 'codex', look.place), surface = look.crewSurface
  if (!surface) return undefined
  const resting = job.isStale || (job.pace !== undefined && job.pace <= 0.15)
  const habit = design.habit ?? 'air'
  if (habit === 'air') return undefined
  if (habit === 'water' && !surface.water) return undefined
  const rest = resting
  look.crewBoxes ??= {}
  look.crewMessagePoints ??= {}
  const state = { ...look, crewRest: rest }
  const frames = airFrames(state, job.kind ?? 'codex', job.tier ?? 1), art = frames[0]!
  const w = art[0]!.length, h = art.length
  const hard = look.crewHard ?? [], others = (look.crewSpriteZones ?? []).filter(z => !hard.includes(z))
  const obstacles = look.crewSurfaceObstacles ?? []
  const overlap = (left: number, top: number, z: { x: number; y: number; w: number; h: number }) =>
    Math.max(0, Math.min(left + w, z.x + z.w) - Math.max(left, z.x)) * Math.max(0, Math.min(top + h, z.y + z.h) - Math.max(top, z.y))
  const clear = (left: number, top: number, zones: typeof hard) => left >= 0 && left + w <= right && top >= 0 && top + h <= c.H && zones.every(z => left + w <= z.x || left >= z.x + z.w || top + h <= z.y || top >= z.y + z.h)
  const tempo = frames.length >= 8 ? 1.5 : TEMPO[job.kind ?? 'codex']
  const beat = (Math.floor((job.phase ?? look.frame) / tempo) + job.seed) % frames.length
  const pose = frames[beat]!
  const turning = design.facing ? orient(() => [0, 0], design.facing, 0, job.talk) : undefined
  const shown = turning ? shape(pose, turning.mirror, turning.roll, design.turn, SPRITES[job.kind ?? 'codex'].turnPose?.[look.place ?? 'city']?.[job.tier ?? 1]) : pose
  const initialBottom = Math.max(...shown.flatMap((row, y) => /[^.]/.test(row) ? [y] : []))
  const bottoms = frames.map(frame => Math.max(...frame.flatMap((row, y) => /[^.]/.test(row) ? [y] : [])))
  const minBottom = Math.min(initialBottom, ...bottoms), maxBottom = Math.max(initialBottom, ...bottoms)
  const spans = habit === 'water' ? surface.water!.spans : [surface.ground]
  const options: { cx: number; foot: number }[] = []
  for (const span of spans) for (let cx = span.x0 + (w >> 1); cx + (w - (w >> 1)) <= span.x1; cx++) options.push({ cx, foot: habit === 'water' ? surface.water!.y + 1 : surface.ground.y })
  options.sort((a, b) => Math.abs(a.cx - x) - Math.abs(b.cx - x))
  const phase = job.route ?? job.phase ?? look.frame
  const bob = habit === 'water' && Math.sin(phase * 0.12 + job.seed) > 0.3 ? -1 : 0
  const fits = (cx: number, foot: number, zones: typeof hard) => spans.some(span => cx - (w >> 1) >= span.x0 && cx + w - (w >> 1) <= span.x1) && clear(cx - (w >> 1), foot - minBottom, zones) && clear(cx - (w >> 1), foot - maxBottom - Number(habit === 'water'), zones)
  const strict = [...hard, ...others, ...obstacles]
  const free = options.find(p => fits(p.cx, p.foot, strict))
  const prior = (look.crewAnchors ?? []).slice(look.crewAnchorsFrom ?? 0)
  // Foreground and other crew are soft boundaries: a crowded surface is still preferable to flying.
  const cost = (p: { cx: number; foot: number }) => {
    const left = p.cx - (w >> 1), top = p.foot - maxBottom - Number(habit === 'water')
    return others.reduce((sum, z) => sum + 5 * overlap(left, top, z), 0)
      + obstacles.reduce((sum, z) => sum + overlap(left, top, z), 0)
  }
  let chosen = free, best = Infinity
  if (!chosen) for (const requireNewColumn of [true, false]) {
    for (const candidate of options) {
      if (!fits(candidate.cx, candidate.foot, hard) || prior.includes((candidate.foot + bob - initialBottom + (h >> 1)) * c.W + candidate.cx) || (requireNewColumn && prior.some(anchor => anchor % c.W === candidate.cx))) continue
      const penalty = cost(candidate)
      if (penalty < best) { chosen = candidate; best = penalty }
    }
    if (chosen) break
  }
  if (!chosen) return undefined
  let leftReach = 0, rightReach = 0
  const maxReach = (look.crewCount ?? 1) > 1 && (look.crewRoam ?? PATROL) <= 3 ? 0 : job.lane?.roam ?? PATROL
  const travelZones = [...hard, ...others]
  while (!rest && leftReach < maxReach && fits(chosen.cx - leftReach - 1, chosen.foot, travelZones)) leftReach++
  while (!rest && rightReach < maxReach && fits(chosen.cx + rightReach + 1, chosen.foot, travelZones)) rightReach++
  const g = gait(gaitKind(job, look), job.tier ?? 1, job.seed, phase, Math.max(leftReach, rightReach))
  let cx = chosen.cx + Math.round((g.u < 0 ? leftReach : rightReach) * roamShare(job.pace ?? 0.6) * g.u)
  const anchorY = chosen.foot + bob - initialBottom + (h >> 1)
  if (prior.includes(anchorY * c.W + cx)) {
    const alternate = options.find(p => fits(p.cx, p.foot, hard) && !prior.includes((p.foot + bob - initialBottom + (h >> 1)) * c.W + p.cx))
    if (!alternate) return undefined
    chosen = alternate
    cx = alternate.cx
    leftReach = rightReach = 0
  }
  const home = chosen, reach = Math.max(leftReach, rightReach), roam = (leftReach + rightReach) / 2
  const route = (ago: number): Vec => {
    const next = gait(gaitKind(job, look), job.tier ?? 1, job.seed, phase - ago * 10 * clockRate(job.pace ?? 0.6), reach)
    return [home.cx + (next.u < 0 ? leftReach : rightReach) * roamShare(job.pace ?? 0.6) * next.u, home.foot]
  }
  const actualTurn = design.facing ? orient(route, design.facing, 0, job.talk, roam) : undefined
  const turnPose = SPRITES[job.kind ?? 'codex'].turnPose?.[look.place ?? 'city']?.[job.tier ?? 1]
  const actual = actualTurn ? shape(pose, actualTurn.mirror, actualTurn.roll, design.turn, turnPose) : pose
  const bottom = Math.max(...actual.flatMap((row, y) => /[^.]/.test(row) ? [y] : []))
  const top = chosen.foot + bob - bottom, left = cx - (w >> 1)
  const zone = { x: left, y: top, w, h }
  const reserved = { x: chosen.cx - (w >> 1) - leftReach, y: chosen.foot - maxBottom - Number(habit === 'water'), w: w + leftReach + rightReach, h: h + maxBottom - minBottom + Number(habit === 'water') }
  ;(look.crewZones ??= []).push(reserved)
  ;(look.crewSpriteZones ??= []).push(reserved)
  ;(look.crewAnchors ??= []).push((top + (h >> 1)) * c.W + cx)
  const centerY = top + (h >> 1), kind = job.kind ?? 'codex'
  const member = { ...job, lane: { x: chosen.cx, roam } }
  if (look.crewDeferred) fly(c, { ...state, crewLocateOnly: true }, cx, centerY, { ...member, talk: undefined }, kind, false, ago => [route(ago)[0], centerY], [])
  schedule(look, job, () => {
    const turn = design.facing ? orient(route, design.facing, 0, job.talk, roam) : undefined
    const frame = turn ? shape(pose, turn.mirror, turn.roll, design.turn, turnPose) : pose
    const base = Math.max(...frame.flatMap((row, y) => /[^.]/.test(row) ? [y] : []))
    const drawTop = chosen.foot + bob - base, drawY = drawTop + (h >> 1)
    if (habit === 'water' && look.effects !== false) for (let d = 1; d <= 3; d++) c.glow(cx + (w >> 1) + d, surface.water!.y, P.white, 0.25 / d)
    if (habit === 'ground' && !rest) groundStep(c, look, kind, cx, chosen.foot, job.seed, phase)
    drawWithHit(c, job, () => fly(c, state, cx, drawY, member, kind, false, ago => [route(ago)[0], drawY], []))
    if (habit === 'water') for (let dx = 0; dx < w; dx++) for (let dy = 1; dy <= 2; dy++) {
      const yy = surface.water!.y + dy + 1, sy = drawTop + base - dy
      if (yy < c.H && sy >= drawTop) c.glow(left + dx, yy, c.get(left + dx, sy), 0.12)
    }
  })
  return zone
}

function placeRest(c: Canvas, look: Look, job: Job, x: number, y: number, right: number, company?: Design['escorts'][Tier]): { x: number; y: number; w: number; h: number } | undefined {
  const resting = job.isStale || (job.pace !== undefined && job.pace <= 0.15)
  const amount = job.settle ?? Number(resting)
  if (!designFor(job.kind ?? 'codex', look.place).rests || amount <= 0) return undefined
  const kind = job.kind ?? 'codex', tier = job.tier ?? 1
  const art = airFrames({ ...look, crewRest: true }, kind, tier)[0]!, w = art[0]!.length, h = art.length
  const bottom = Math.max(...art.flatMap((row, rowIndex) => /[^.]/.test(row) ? [rowIndex] : []))
  const feet = [...art[bottom]!].flatMap((ch, col) => ch === '.' ? [] : [col])
  const foot = feet.reduce((best, col) => Math.abs(col - (w >> 1)) < Math.abs(best - (w >> 1)) ? col : best)
  const [contactX, contactY] = SPRITES[kind].restContact?.[look.place ?? 'city']?.[tier] ?? [foot, bottom]
  const used = look.crewPerchesUsed ??= [], obstacles = [...(look.crewHard ?? []), ...(look.crewSpriteZones ?? []), ...used]
  const clear = (z: { x: number; y: number; w: number; h: number }) => z.x >= 0 && z.x + z.w <= right && z.y >= 0 && z.y + z.h <= c.H && obstacles.every(o => z.x + z.w <= o.x || z.x >= o.x + o.w || z.y + z.h <= o.y || z.y >= o.y + o.h)
  const perches = [...(look.crewSurface?.perches ?? [])].sort((a, b) => Math.abs(a.x - x) + Math.abs(a.y - y) - Math.abs(b.x - x) - Math.abs(b.y - y))
  for (const perch of perches) {
    const target = { x: perch.x - contactX, y: perch.y - contactY, w, h }
    if (!clear(target)) continue
    const ease = amount * amount * (3 - 2 * amount)
    const cx = Math.round(x + (target.x + (w >> 1) - x) * ease), cy = Math.round(y + (target.y + (h >> 1) - y) * ease)
    const zone = { x: cx - (w >> 1), y: cy - (h >> 1), w, h }
    if (!clear(zone)) continue
    used.push(target)
    ;(look.crewZones ??= []).push(zone)
    ;(look.crewSpriteZones ??= []).push(zone)
    ;(look.crewAnchors ??= []).push(cy * c.W + cx)
    look.crewBoxes ??= {}
    look.crewMessagePoints ??= {}
    if (look.crewDeferred) fly(c, { ...look, crewRest: amount >= 1, crewLocateOnly: true }, cx, cy, { ...job, talk: undefined }, kind, false, () => [cx, cy], company)
    schedule(look, job, () => drawWithHit(c, job, () => fly(c, { ...look, crewRest: amount >= 1 }, cx, cy, job, kind, false, () => [cx, cy], company)))
    return zone
  }
  return undefined
}

/** Reserve the nearest clear lane; compact silhouettes keep a crowded sky readable. */
export function placeFly(c: Canvas, look: Look, x: number, y: number, job: Job, right: number) {
  if (job.lane) x = job.lane.x // a flyer with a lane of the sky is centred in it, and roams it end to end
  const design = designFor(job.kind ?? 'codex', look.place)
  if (design.depth === 'far') y = 4
  const placed = placeSurface(c, look, x, job, right)
  if (placed) return placed
  if (design.altitude === 'low') y = (look.crewGround ?? c.H) - 2
  if (design.altitude === 'high') y = 3 // the top of the sky, clear of a busy skyline
  const zones = look.crewZones ??= []
  const anchors = look.crewAnchors ??= []
  const sprites = look.crewSpriteZones ??= []
  const occupied = new Uint8Array(c.W * c.H)
  for (const z of zones) for (let py = Math.max(0, z.y); py < Math.min(c.H, z.y + z.h); py++) for (let px = Math.max(0, z.x); px < Math.min(c.W, z.x + z.w); px++) occupied[py * c.W + px] = 1
  const blocked = (px: number, py: number) => px >= 0 && px < c.W && py >= 0 && py < c.H && occupied[py * c.W + px] === 1
  {
    const frames = airFrames(look, job.kind ?? 'codex', job.tier ?? 1)
    const art = frames[0]!
    const w = art[0]!.length, h = art.length
    const company = [...(designFor(job.kind ?? 'codex', look.place).escorts[job.tier ?? 1] ?? [])]
    const extent = () => {
      let left = 0, right = w, top = 0, bottom = h
      for (const e of company) {
        const small = airFrames(look, job.kind ?? 'codex', e.tier)[0]!
        const y = (h >> 1) + e.dy - (small.length >> 1)
        const x = (w >> 1) + (e.dx ?? 0) - (small[0]!.length >> 1)
        const drift = e.dx === undefined ? 2 : 3, bob = e.dx === undefined ? 0 : 1
        left = Math.min(left, x - drift); right = Math.max(right, x + small[0]!.length + drift)
        top = Math.min(top, y - bob); bottom = Math.max(bottom, y + small.length + bob)
      }
      return { left, right, top, bottom }
    }
    // Keep whole companions in the sky; a narrow view may have room for only one wingman.
    const widthBudget = job.lane ? w + 2 * job.lane.roam : right
    while (company.length && (extent().bottom - extent().top > (look.crewGround ?? c.H) || extent().right - extent().left > widthBudget)) company.pop()
    const formation = extent()
    const pixels: [number, number][] = []
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      if (frames.some(frame => frame[dy]![dx] !== '.')) pixels.push([dx, dy])
    }
    for (const e of company) {
      const small = airFrames(look, job.kind ?? 'codex', e.tier)[0]!
      const left = (w >> 1) + (e.dx ?? 0) - (small[0]!.length >> 1), top = (h >> 1) + e.dy - (small.length >> 1)
      const drift = e.dx === undefined ? 2 : 3, bob = e.dx === undefined ? 0 : 1
      for (let y = -bob; y < small.length + bob; y++) for (let x = -drift; x < small[0]!.length + drift; x++) pixels.push([left + x, top + y])
    }
    // Only Mochi and her laptop are hard (`crewHard`). The rest of the crew is a soft boundary like the scenery: a flyer prefers
    // clear sky but may pass through another worker when the sky is crowded, so nobody is ever pushed out of the scene.
    const padded = new Uint8Array(c.W * c.H), soft = new Uint8Array(c.W * c.H), crowd = new Uint8Array(c.W * c.H)
    const hard = look.crewHard ?? []
    const skyFloor = (look.crewGround ?? c.H) - 6 // workers may overlap one another only in the open sky, never down among the street and the foreground
    for (const z of hard) for (let py = Math.max(0, z.y - 1); py < Math.min(c.H, z.y + z.h + 1); py++) for (let px = Math.max(0, z.x - 1); px < Math.min(c.W, z.x + z.w + 1); px++) padded[py * c.W + px] = 1
    for (const z of sprites) if (!hard.includes(z)) for (let py = Math.max(0, z.y); py < Math.min(c.H, z.y + z.h); py++) for (let px = Math.max(0, z.x); px < Math.min(c.W, z.x + z.w); px++) crowd[py * c.W + px] = 1
    for (const z of zones) for (let py = Math.max(0, z.y); py < Math.min(c.H, z.y + z.h); py++) for (let px = Math.max(0, z.x); px < Math.min(c.W, z.x + z.w); px++) soft[py * c.W + px] = 1
    const candidates: { x: number; y: number; distance: number }[] = []
    for (let cy = (h >> 1) - formation.top; cy <= (look.crewGround ?? c.H) - formation.bottom + (h >> 1); cy++) {
      for (let cx = Math.ceil(w / 2) - formation.left; cx <= right - Math.ceil(w / 2) - (formation.right - w); cx++) {
        candidates.push({ x: cx, y: cy, distance: Math.abs(cx - x) + 2 * Math.abs(cy - y) })
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x)
    // Home: clear sky near where it wants to be if any is free (candidates run nearest first, so the first with no scenery under
    // it is the answer); else the spot nearby with the least scenery under it, hiding as little as it can.
    let best: { k: (typeof candidates)[number]; hidden: number } | undefined
    for (const k of candidates) {
      if (Math.abs(k.x - x) > 16 || Math.abs(k.y - y) > 4) continue
      const zx = k.x - (w >> 1), zy = k.y - (h >> 1)
      if (!pixels.every(([dx, dy]) => !padded[(zy + dy) * c.W + zx + dx])) continue
      if (zy + h > skyFloor && pixels.some(([dx, dy]) => crowd[(zy + dy) * c.W + zx + dx])) continue
      let hidden = design.altitude === 'high' ? Math.max(0, k.y - Math.max(h >> 1, y)) * pixels.length * 2 : 0
      for (const [dx, dy] of pixels) {
        const i = (zy + dy) * c.W + zx + dx
        hidden += soft[i]! + 3 * crowd[i]! + (design.depth === 'far' ? 3 * (look.crewOcclusion?.[i] ?? 0) : 0)
      }
      if (!best || hidden < best.hidden) best = { k, hidden }
      if (hidden === 0) break
    }
    for (const candidate of best ? [best.k, ...candidates] : candidates) {
      const zone = { x: candidate.x - (art[0]!.length >> 1), y: candidate.y - (art.length >> 1), w, h }
      if (pixels.some(([dx, dy]) => padded[(zone.y + dy) * c.W + zone.x + dx])) continue
      if (zone.y + h > skyFloor && pixels.some(([dx, dy]) => crowd[(zone.y + dy) * c.W + zone.x + dx])) continue
      // Neighboring airspace is shared during short excursions; only the viewport, ground and Mochi stop a flight.
      const ground = look.crewGround ?? c.H
      const free = (sx: number, sy: number) => pixels.every(([dx, dy]) => {
        const px = zone.x + dx + sx, py = zone.y + dy + sy
        return px >= 0 && px < c.W && py >= 0 && py < ground && !padded[py * c.W + px]
      })
      const homeRoam = job.lane?.roam ?? look.crewRoam ?? PATROL
      const maxX = homeRoam + ((look.crewCount ?? 1) > 1 ? Math.max(10, Math.floor(homeRoam * 1.2)) : 0), maxY = design.depth === 'far' ? 1 : (job.tier ?? 1) >= 3 ? 3 : 4
      let leftReach = 0, rightReach = 0
      while (leftReach < maxX && free(-(leftReach + 1), 0)) leftReach++
      while (rightReach < maxX && free(rightReach + 1, 0)) rightReach++
      if ((look.crewCount ?? 1) <= 1) leftReach = rightReach = Math.min(leftReach, rightReach)
      const rx = Math.max(leftReach, rightReach)
      // Rows above and below are tried apart (a rooftop below must not take away the open sky above), each as a full-width
      // band: a row counts only if the sprite fits there at both ends and in the middle of its horizontal range.
      const across = [-leftReach, -(leftReach >> 1), 0, rightReach >> 1, rightReach]
      const rowFree = (sy: number) => across.every(sx => free(sx, sy))
      // Dipping is free only in open air: a row that sinks the body further into the rooftops or the trees than its home row
      // does is not room to bob into, or a bat over the city wades through the skyline.
      const buried = (sx: number, sy: number) => { let n = 0; for (const [dx, dy] of pixels) n += soft[(zone.y + dy + sy) * c.W + zone.x + dx + sx] ?? 0; return n }
      const sinks = (sy: number) => across.some(sx => buried(sx, sy) > buried(sx, 0))
      let up = 0, down = 0
      while (up < maxY && rowFree(-(up + 1))) up++
      while (design.altitude !== 'high' && down < maxY && rowFree(down + 1) && !sinks(down + 1)) down++
      // A hop of up to two rows more when something real happens to this worker (it acted, sent or received a message).
      let hopRoom = 0
      while (hopRoom < 2 && rowFree(-(up + hopRoom + 1))) hopRoom++
      const hop = Math.round(hopRoom * Math.min(1, job.lift ?? 0))
      // Where in the box it is now: its family's gait, over the room that its activity earns it (a calm worker hovers near home).
      const pace = job.pace ?? 0.6
      const core = Math.min(leftReach, rightReach, homeRoam)
      const visit = candidate.x < right / 2 ? rightReach - core : core - leftReach
      const at = (time: number) => {
        const g = gait(gaitKind(job, look), job.tier ?? 1, job.seed, time, core)
        // On the side with a neighbour, each run carries on into the shared air: further out, never out and back mid-run.
        return { x: core * g.u + visit * Math.max(0, Math.sign(visit) * g.u) ** 2, v: g.v }
      }
      const { x: travel, v } = at(job.route ?? job.phase ?? look.frame)
      const share = roamShare(pace)
      const offset = -Math.round(share * (v > 0 ? v * up : v * down)) - hop
      let drift = Math.round(share * travel)
      // Crew may overlap (a soft boundary), but every worker keeps an anchor of its own, so a message wire finds only one of them.
      // (only this pass's anchors count: the array is shared across the passes of one scene)
      for (let tries = 0; tries < 8 && anchors.indexOf((candidate.y + offset) * c.W + candidate.x + drift, look.crewAnchorsFrom ?? 0) >= 0; tries++) drift += tries % 2 ? -tries : tries + 1
      const settled = placeRest(c, look, job, candidate.x + drift, candidate.y + offset, right, company)
      if (settled) return settled
      const reserved = { x: zone.x + formation.left - core, y: zone.y + formation.top - up - hopRoom, w: formation.right - formation.left + 2 * core, h: formation.bottom - formation.top + up + down + hopRoom }
      zones.push(reserved)
      sprites.push(reserved)
      anchors.push((candidate.y + offset) * c.W + candidate.x + drift)
      // where it was a moment ago: the same gait at earlier times, so its trail is exactly its own path
      const kind = job.kind ?? 'codex', now = job.route ?? job.phase ?? look.frame
      const path = (ago: number): Vec => { // the same gait at the time `ago` seconds back: a trail follows this
        const g = at(now - ago * 10 * clockRate(pace))
        // Keep the path continuous for heading and effects; rasterising it here makes slow craft turn at every pixel step.
        return [candidate.x + share * g.x, candidate.y - share * (g.v > 0 ? g.v * up : g.v * down) - hop]
      }
      const member = { ...job, lane: { x: candidate.x, roam: rx * share } }
      if (look.crewDeferred) fly(c, { ...look, crewLocateOnly: true }, candidate.x + drift, candidate.y + offset, { ...member, talk: undefined }, kind, false, path, company)
      schedule(look, job, () => drawWithHit(c, job, () => fly(c, look, candidate.x + drift, candidate.y + offset, member, kind, false, path, company)))
      return zone
    }
  }
  const compactSlots: { x: number; y: number }[] = []
  for (let py = 0; py + 2 < (look.crewGround ?? c.H); py++) for (let px = 0; px + 2 < c.W; px++) compactSlots.push({ x: px, y: py })
  compactSlots.sort((a, b) => Math.abs(a.x + 1 - x) + 2 * Math.abs(a.y + 1 - y) - Math.abs(b.x + 1 - x) - 2 * Math.abs(b.y + 1 - y) || a.y - b.y || a.x - b.x)
  for (const { x: px, y: py } of compactSlots) {
    const zone = { x: px, y: py, w: 3, h: 3 }
    const art = LANE[job.kind ?? 'codex']
    const fits = (shift: number) => art.every((row, dy) => [...row].every((ch, dx) => ch === '.' || !blocked(px + dx + shift, py + dy) && px + dx + shift >= 0 && px + dx + shift < right))
    if (!fits(0)) continue
    // even the compact mark patrols the clear stretch beside it, so no crew member ever just stands there
    let reach = 0
    while (reach < (look.crewRoam ?? PATROL) && fits(-(reach + 1)) && fits(reach + 1)) reach++
    const drift = Math.round(reach * roamShare(job.pace ?? 0.6) * gait(gaitKind(job, look), job.tier ?? 1, job.seed, job.route ?? job.phase ?? look.frame, reach).u)
    const lift = -Math.round(Math.min(1, job.lift ?? 0) * (py > 0 && fits(0) ? 1 : 0))
    anchors.push((py + 2 + lift) * c.W + px + 1 + drift)
    art.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch !== '.') zones.push({ x: px + dx - reach, y: py + dy, w: 1 + 2 * reach, h: 1 }) }))
    sprites.push({ ...zone, x: zone.x - reach, w: zone.w + 2 * reach })
    rememberPoint(look, job, art, px + drift, py + lift)
    schedule(look, job, () => drawWithHit(c, job, () => draw(c, look, px + drift, py + lift, art, paint(job, look), false)))
    return zone
  }
  return undefined
}

/** Who comes first when two want the same place: the lower seed, then kind and class, so a tie never falls to list order. */
const byIdentity = (a: Job, b: Job) => a.seed - b.seed || (a.kind ?? '').localeCompare(b.kind ?? '') || (a.tier ?? 1) - (b.tier ?? 1)

/**
 * Each crew member's slot of `count`, in identity order (also the draw order, so overlaps don't hang on the list's order):
 * its own hashed pick, or the next free one when a lower seed holds that. So adding, removing or reordering the others
 * moves only one that collides with them. Past `count` slots stack: slot `count + n` is slot n again, half a slot over.
 */
export function stations<T extends Job>(crew: readonly T[], count: number): [T, number][] {
  const taken = new Set<number>()
  return [...crew].sort(byIdentity).map(job => {
    const want = hash(job.seed) % count
    let slot = want
    for (let k = 1; taken.has(slot); k++) slot = Math.floor(k / count) * count + ((want + k) % count)
    taken.add(slot)
    return [job, slot]
  })
}

/**
 * How far each flyer may roam from its home, each way: the sky's width left over once every sprite has its own, shared out
 * among the crew, so a lone worker ranges a long way and a full sky still lets each move a little. At most 26 cells; the
 * clear sky around a flyer (buildings, others' boxes) can only shorten it.
 */
export function roamOf(crew: readonly Job[], right: number): number {
  const widths = [0, 5, 9, 15, 19]
  const used = crew.reduce((sum, job) => sum + widths[job.tier ?? 1]!, 0)
  return Math.max(3, Math.min(26, Math.floor((right - 16 - used) / (2 * Math.max(1, crew.length)))))
}

/**
 * Lanes: the whole width of the sky shared out among the flyers, each its own stretch to roam end to end. A flyer's stretch is as
 * wide as its sprite and a margin in proportion to the others', so a big craft gets more room, and together they cover the scene
 * from edge to edge however many there are: one worker ranges the whole sky, four a quarter each. Order is by identity (never
 * list order), so the same crew always flies the same lanes. A lane's `x` is its centre and `roam` how far the flyer may go each
 * way (capped, so a lone worker does not cross the whole scene in a single beat).
 */
export function lanes(crew: readonly Job[], right: number): Map<Job, { x: number; roam: number }> {
  const widths = [0, 5, 9, 15, 19], margin = 6
  const order = [...crew].sort(byIdentity)
  const span = Math.max(8, right - 16), total = order.reduce((sum, job) => sum + widths[job.tier ?? 1]! + margin, 0)
  const out = new Map<Job, { x: number; roam: number }>()
  let at = 8
  for (const job of order) {
    const need = widths[job.tier ?? 1]! + margin, lane = (span * need) / Math.max(total, 1)
    out.set(job, { x: Math.round(at + lane / 2), roam: Math.max(3, Math.floor((lane - widths[job.tier ?? 1]!) / 2)) })
    at += lane
  }
  return out
}

/** Slots of sky across `right` columns: the sprite's home before lanes (a flyer without a lane, as in the dev sheets, still keeps one). */
export const airSlots = (right: number) => Math.max(1, Math.floor((right - 16) / 22))

/** Where a hovering job sits in the sky, in its slot of `count`: small ones flit about the lower sky, big ones glide high and slow. */
export function hover(c: Canvas, look: Look, job: Job, slot: number, count: number, right: number): [number, number] {
  const t = job.seed * 97 // a flyer's home is fixed by who it is; the drift around it is placeFly's, so a lane never flips
  const tier = job.tier ?? 1
  const width = Math.max(8, right - 16) / count
  const speed = [0, 0.07, 0.045, 0.025, 0.02][tier]!
  const at = (slot % count) + 0.5 + (Math.floor(slot / count) % 2) * 0.5 // a stacked slot sits half a slot over
  const x = Math.round(8 + at * width + Math.min(width * 0.3, tier >= 3 ? 6 : 4) * Math.sin(t * speed + job.seed))
  const y = [0, 7, 6, 4, 4][tier]! + (slot % 2) * (tier >= 3 ? 0 : 1) + Math.round([0, 1.5, 1, 0.5, 0.5][tier]! * Math.sin(t * 0.09 + job.seed * 2))
  return [x, y]
}

/** Budget compact flyers together before any one of them can occupy another's only slot. */
function packCompact(c: Canvas, look: Look, jobs: Job[]): boolean {
  if (c.W > 40 && jobs.length <= 12) return false
  let occupied = 0n
  for (const z of look.crewZones ?? []) for (let y = Math.max(0, z.y); y < Math.min(c.H, z.y + z.h); y++) for (let x = Math.max(0, z.x); x < Math.min(c.W, z.x + z.w); x++) occupied |= 1n << BigInt(y * c.W + x)
  const slots: { x: number; y: number; mask: bigint }[] = []
  for (let y = 0; y + 2 < (look.crewGround ?? c.H); y++) for (let x = 0; x + 2 < c.W; x++) {
    let mask = 0n
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) mask |= 1n << BigInt((y + dy) * c.W + x + dx)
    if (!(mask & occupied)) slots.push({ x, y, mask })
  }
  const positions = jobs.map(() => slots)
  const picked: { x: number; y: number; mask: bigint }[] = []
  const last = new Map<Kind, number>()
  let visits = 0
  const search = (i: number, used: bigint): boolean => {
    if (i === jobs.length) return true
    if (++visits > 50_000) return false
    const kind = jobs[i]!.kind ?? 'codex'
    const previous = last.get(kind) ?? -1
    for (let index = previous + 1; index < positions[i]!.length; index++) {
      const slot = positions[i]![index]!
      if (slot.mask & used) continue
      picked.push(slot)
      last.set(kind, index)
      if (search(i + 1, used | slot.mask)) return true
      if (previous < 0) last.delete(kind)
      else last.set(kind, previous)
      picked.pop()
    }
    return false
  }
  if (jobs.length > 12) {
    // shortcut: tiled greedy packing can leave usable space; use a maximum-packing solver if exact capacity is needed.
    for (let phase = -1; phase < 9; phase++) {
      const trial: typeof picked = []
      let used = 0n
      const candidates = positions[0] ?? []
      const preferred = phase < 0 ? [] : candidates.filter(s => s.x % 3 === phase % 3 && s.y % 3 === Math.floor(phase / 3))
      for (const slot of [...preferred, ...candidates]) {
        if (slot.mask & used) continue
        trial.push(slot)
        used |= slot.mask
        if (trial.length === jobs.length) break
      }
      if (trial.length > picked.length) picked.splice(0, picked.length, ...trial)
      if (picked.length === jobs.length) break
    }
  } else if (!search(0, 0n)) return false
  jobs.slice(0, picked.length).forEach((job, i) => {
    const { x, y } = picked[i]!, art = LANE[job.kind ?? 'codex']
    look.crewZones!.push({ x, y, w: 3, h: 3 })
    look.crewSpriteZones!.push({ x, y, w: 3, h: 3 })
    look.crewAnchors!.push((y + 2) * c.W + x + 1)
    rememberPoint(look, job, art, x, y)
    schedule(look, job, () => drawWithHit(c, job, () => draw(c, look, x, y, art, paint(job, look), false)))
  })
  return true
}

/** Every landscape that keeps its crew in the air. */
export function airJobs(c: Canvas, look: Look, jobs: Job[], right: number) {
  const count = airSlots(right)
  const ordered = stations(jobs, count).sort(([a], [b]) => (b.tier ?? 1) - (a.tier ?? 1) || byIdentity(a, b))
  const before = c.px.slice()
  const beforeOwners = c.hitOwners?.slice()
  const zones = look.crewZones ??= [], sprites = look.crewSpriteZones ??= [], anchors = look.crewAnchors ??= []
  const perches = look.crewPerchesUsed ??= []
  const counts = [zones.length, sprites.length, anchors.length, perches.length]
  const deferredCount = look.crewDeferred?.length ?? 0
  if (jobs.length * 9 > right * Math.max(1, (look.crewGround ?? c.H) - 3) && packCompact(c, look, ordered.map(([member]) => member))) return
  for (const [job, slot] of ordered) {
    const [x, y] = hover(c, look, job, slot, count, right)
    if (placeFly(c, look, x, y, job, right)) continue
    c.px.set(before)
    if (beforeOwners) c.hitOwners!.set(beforeOwners)
    zones.length = counts[0]!
    sprites.length = counts[1]!
    anchors.length = counts[2]!
    perches.length = counts[3]!
    if (look.crewDeferred) look.crewDeferred.length = deferredCount
    if (look.crewBoxes) for (const [member] of ordered) if (member.hit) delete look.crewBoxes[member.hit.id]
    if (look.crewMessagePoints) for (const [member] of ordered) if (member.hit) delete look.crewMessagePoints[member.hit.id]
    if (look.crewPaths) for (const [member] of ordered) if (member.hit) delete look.crewPaths[member.hit.id]
    if (packCompact(c, look, ordered.map(([member]) => member))) return
    for (const [member, memberSlot] of ordered) {
      const [cx, cy] = hover(c, look, member, memberSlot, count, right)
      placeFly(c, look, cx, cy, member, right)
    }
    return
  }
}

