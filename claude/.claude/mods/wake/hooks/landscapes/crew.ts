import { type Canvas, hash, mix } from '../pixels'
import { craftFrames } from './craft'
import { creatureFrames } from './creatures'
import { boatFx, crewFx } from './fx'
import type { Vec } from './particles'
import { clockRate, gait, roamShare } from './gait'
import { type Job, jobAccent, type Look, P } from './kit'

// The crew's look: one family per harness, four classes that grow in size and detail.
//   codex     mechanical  what each place builds (craft.ts): in the city a drone -> parcel drone -> helicopter -> blimp
//   agy       celestial   spark -> comet -> constellation
//   claude    living      sparrow -> gull -> eagle (also the subagents' birds)
//   opencode  festival    hot-air balloons, free to drift: hopper -> striped balloon -> big balloon with a bunting band
// Sprite keys: a body, W highlight, l light stripe, d shade or rope, s lamp, beak or flame, p bunting, k smoke, h hull or basket,
// m / M the maker's mark (a body / highlight pixel that takes the maker's colour when another family made the model).
// Where each one flies comes from who it is (its seed), never from its place in the list: see stations.

type Kind = NonNullable<Job['kind']>
type Frames = readonly (readonly string[])[]

const drawWithHit = <T>(c: Canvas, job: Job, draw: () => T): T => job.hitOwner ? c.withHit(job.hitOwner, draw) : draw()
/** How far a flyer patrols each way from its home, when the sky there is clear: about half a sky slot. */
const PATROL = 9

const LANE: Record<Kind, readonly string[]> = {
  codex: ['.a.', 'aWa', '.a.'],
  agy: ['.W.', 'WaW', '.W.'],
  claude: ['a.a', '.a.', '.d.'],
  opencode: ['aWa', 'aaa', '.h.'],
}

const ROAD: Record<1 | 2 | 3 | 4, readonly string[]> = {
  1: ['..WW...', '.aaaaa.', '.d...d.'],
  2: ['...WW....', '.aaaaaaaa', '.d.....d.'],
  3: ['...WW.WW...', '.aaaaaaaaaa', '.dd.....dd.'],
  4: ['...WW.WW.WW..', '.aaaaaaaaaaaa', '.dd.......dd.'],
}

/** The sprites no place changes (agy's sparks and OpenCode's balloons) and the generic Claude bird; Codex's machines are
 *  craft.ts's and Claude's creatures creatures.ts's, one for each place. */
const AIR: Record<Exclude<Kind, 'codex'>, Record<1 | 2 | 3 | 4, Frames>> = {
  agy: {
    1: [['.W.', 'WmW', '.W.'], ['W.W', '.m.', 'W.W']],
    2: [['.......mm.', 'd.dd.ddmWm', '.......mm.'], ['.......mm.', '.d.dd.dmWm', '.......mm.']],
    3: [
      ['.........M...', '...W....d.d..', '....d..d...d.', '.....dW.....W'],
      ['.........m...', '...a....d.d..', '....d..d...d.', '.....dW.....a'],
    ],
    4: [['..W.......M......', '...d....d.d..W...', '....d..d...dd....', '.....dW.....W....', '....d........d...'], ['..a.......m......', '...d....d.d..a...', '....d..d...dd....', '.....dW.....W....', '....d........d...']],
  },
  claude: {
    1: [['a.a', '.a.'], ['.a.', 'a.a']],
    2: [['a.....a', '.aa.aa.', '...d...'], ['...a...', 'aaadaaa', '.a...a.']],
    3: [
      ['aaa.......aaa', '.aaaaa.aaaaa.', '...aaaaaaWWs.', '.dd..aaa.....'],
      ['.............', '.aaa.....aaa.', 'aaaaaaaaaWWs.', '.dd..aaa.....'],
    ],
    4: [['aaaa.........aaaa', '.aaaaaa.aaaaaa...', '...aaaaaaaaaWWs..', '..dd...aaaa..d...'], ['.................', '.aaaa.......aaaa.', 'aaaaaaaaaaaaWWs..', '..dd...aaaa..d...']],
  },
  opencode: {
    1: [['ala', 'ala', '.a.', '.s.', '.h.'], ['ala', 'ala', '.a.', '.d.', '.h.']],
    2: [['.lal.', 'alala', 'alala', '.lal.', '..a..', '.dsd.', '.hhh.'], ['.lal.', 'alala', 'alala', '.lal.', '..a..', '.ddd.', '.hhh.']],
    3: [
      ['..alala..', '.lalalal.', 'alalalala', 'ppppppppp', '.lalalal.', '..alala..', '...lal...', '...dsd...', '...hhh...'],
      ['..alala..', '.lalalal.', 'alalalala', 'ppppppppp', '.lalalal.', '..alala..', '...lal...', '...ddd...', '...hhh...'],
    ],
    4: [['...alalala...', '.alalalalala.', 'alalalalalala', 'ppppppppppppp', 'alalalalalala', '.alalalalala.', '...alalala...', '....dsdsd....', '....hhhhh....'], ['...alalala...', '.alalalalala.', 'alalalalalala', 'ppppppppppppp', 'alalalalalala', '.alalalalala.', '...alalala...', '....dddsd....', '....hhhhh....']],
  },
}

const BOATS: Record<1 | 2 | 3 | 4, readonly string[]> = {
  1: ['.......', '...s...', '..aaa..', '.aWaaa.', 'hhhhhhh', '.hhhhh.'],
  2: ['.....k....', '.....k.s..', '..aaaaaa..', '..aWaWaa..', 'hhhhhhhhhh', '.hhhhhhhh.'],
  3: ['...k..k....s..', '...k..k.....a..', '.aaaaaaaaaaaa.', '.aWaWaWaWaWaa.', 'hhhhhhhhhhhhhh', '.hhhhhhhhhhhh.'],
  4: ['...k...k....s....', '..aaaaaaa...a....', '.aaWaWaaaaaaaaaa.', '.aWaWaWaWaWaWaaa.', 'hhhhhhhhhhhhhhhhh', '.hhhhhhhhhhhhhhh.'],
}

/** OpenCode's festival: a handful of existing inks no other family owns (Codex teal, agy mauve, Claude pink, stale
 *  peach all stay out), each bright enough to read on a day or night sky. A balloon keeps the colours it drew here. */
const BALLOON_INKS = [P.green, P.yellow, P.red, P.blue, P.lavender] as const

/** A balloon's envelope colour from its stable identity: one of the palette, never another family's accent. */
export const balloonInk = (seed: number) => BALLOON_INKS[hash(seed ^ 0x5bf03635) % BALLOON_INKS.length]!

/** The family's palette; a stale job stays amber. */
function paint(job: Job, look: Look) {
  const family = job.isStale ? P.peach : job.kind === 'opencode' ? balloonInk(job.seed) : jobAccent(job, P.teal)
  const base = job.signal ? mix(family, P.white, 0.65) : family
  const mark = job.maker && job.maker !== job.kind && !job.isStale ? jobAccent({ ...job, kind: job.maker }, P.teal) : undefined
  const a = base
  const W = job.isStale ? P.yellow : mix(base, P.white, 0.7)
  return {
    a,
    W,
    m: mark ?? a,
    M: mark === undefined ? W : mix(mark, P.white, 0.45),
    l: mix(base, P.white, 0.5),
    d: mix(base, P.ink, 0.45),
    s: P.yellow,
    p: job.isStale ? P.woodDark : P.yellow,
    k: P.surface2,
    r: job.isStale ? P.peach : P.red, // a beacon, a tail fin
    g: job.isStale ? mix(P.peach, P.white, 0.4) : mix(P.sapphire, P.white, 0.35), // glass
    h: job.isStale ? mix(P.peach, P.woodDark, 0.5) : P.wood,
  } as Record<string, number>
}

function draw(c: Canvas, look: Look, x0: number, y0: number, art: readonly string[], pal: Record<string, number>, glow: boolean) {
  art.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]!
      if (ch === '.') continue
      c.set(x0 + i, y0 + r, pal[ch]!)
      if (glow && (ch === 'W' || ch === 'M' || ch === 's')) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) c.glow(x0 + i + dx, y0 + r + dy, pal.a!, 0.25 * (0.4 + look.night))
    }
  })
}

/** The canvas as a flyer's trimmings may touch it: never a cell inside another thing's reserved zone (the sun, a lamp, a roof sign, another flyer). */
function onlyOwnAir(c: Canvas, look: Look, cx: number, cy: number): Canvas {
  // Only this sprite's own zone is exempt; scenery, buildings and other crew stay untouched even when the sprite's
  // centre happens to fall inside one of their zones.
  const own = new Set((look.crewSpriteZones ?? []).filter(z => cx >= z.x && cx < z.x + z.w && cy >= z.y && cy < z.y + z.h))
  const others = (look.crewZones ?? []).filter(z => !own.has(z))
  const free = (x: number, y: number) => !others.some(z => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h)
  return { ...c, set: (x, y, color) => { if (free(x, y)) c.set(x, y, color) }, glow: (x, y, color, t) => { if (free(x, y)) c.glow(x, y, color, t) } }
}

/**
 * A Codex machine takes the gear of the country it flies over, in solid pixels a row or two outside its body, so each place
 * gives it a different silhouette: a paraglider's canopy over the mountains, a pennant in the harbor, a trailing ribbon on the
 * beach, a lateen sail in the desert, skis in the tundra, a windmill rotor in the countryside, a hanging lantern in the forest,
 * an aerial and a blinking light in the city. Class grows the canopy and the ribbon.
 */
function dress(canvas: Canvas, look: Look, x0: number, y0: number, w: number, h: number, job: Job, pal: Record<string, number>) {
  const c = onlyOwnAir(canvas, look, x0 + (w >> 1), y0 + (h >> 1))
  const f = look.frame, tier = job.tier ?? 1, cx = x0 + (w >> 1), ground = look.crewGround ?? c.H
  const put = (x: number, y: number, col: number) => { if (y >= 0 && y < ground) c.set(x, y, col) }
  const { a, l, d } = pal as { a: number; l: number; d: number }
  switch (look.place) {
    // (mountains, countryside, forest, desert and tundra build their own craft: see craft.ts)
    case 'harbor': // a mast and a fluttering pennant
      put(cx, y0 - 1, d)
      put(cx, y0 - 2, d)
      put(cx + 1 + ((f >> 3) & 1), y0 - 2, l)
      put(cx + 1, y0 - 3 + ((f >> 4) & 1), a)
      break
    case 'beach': // a ribbon streaming behind, longer for a bigger model
      for (let k = 1; k <= 2 + tier; k++) put(x0 - k, y0 + (h >> 1) + Math.round(Math.sin(f * 0.22 + k * 0.9 + job.seed)), k % 2 ? l : a)
      break
  }
}

/** A flyer's frames: a Codex machine is the craft its place builds (a glider over the mountains, a biplane over the fields),
 * and the generic drone and airship only where the place has none; a Claude worker is the winged creature of its place (a
 * kite on the beach, a butterfly in the fields); agy and OpenCode look the same everywhere. */
const airFrames = (look: Look, kind: Kind, tier: 1 | 2 | 3 | 4): Frames =>
  kind === 'codex' ? craftFrames(look.place, tier) : (kind === 'claude' && creatureFrames(look.place, tier)) || AIR[kind][tier]

/** A flyer centred on (cx, cy): its family and class decide the sprite and which frame this beat shows. */
export function fly(c: Canvas, look: Look, cx: number, cy: number, job: Job, kind: Kind = job.kind ?? 'codex', compact = false, path: (ago: number) => Vec = () => [cx, cy]) {
  const frames = airFrames(look, kind, compact ? 1 : job.tier ?? 1)
  // its wings, rotors and lights beat on its own clock, so a busy worker's run faster than a calm one's
  const art = frames[(Math.floor((job.phase ?? look.frame) / (kind === 'claude' ? 3 : kind === 'opencode' ? 5 : 4)) + job.seed) % frames.length]!
  const pal = paint({ ...job, kind }, look)
  const x0 = cx - (art[0]!.length >> 1), y0 = cy - (art.length >> 1)
  draw(c, look, x0, y0, art, pal, true)
  if (!compact) {
    if (kind === 'codex') dress(c, look, x0, y0, art[0]!.length, art.length, { ...job, kind }, pal)
    crewFx(c, look, { x0, y0, w: art[0]!.length, h: art.length, cx, cy, kind, tier: job.tier ?? 1, seed: job.seed, pace: job.pace ?? 0.6, phase: job.phase ?? look.frame, path, lift: job.lift ?? 0, ground: look.crewGround ?? c.H })
  }
}

/** Reserve the nearest clear lane; compact silhouettes keep a crowded sky readable. */
export function placeFly(c: Canvas, look: Look, x: number, y: number, job: Job, right: number) {
  if (job.lane) x = job.lane.x // a flyer with a lane of the sky is centred in it, and roams it end to end
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
    const pixels: [number, number][] = []
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      if (frames.some(frame => frame[dy]![dx] !== '.')) pixels.push([dx, dy])
    }
    // What a flyer must not cross: Mochi, her laptop and the other crew (their roaming boxes: every worker stays visible and
    // hoverable), each with a ring of one cell. Scenery is only a preference (`soft`): a flyer is nearer than the buildings, so
    // it may pass in front of them and hide a few, though it settles in clear sky when there is any.
    const padded = new Uint8Array(c.W * c.H), soft = new Uint8Array(c.W * c.H)
    for (const z of sprites) for (let py = Math.max(0, z.y - 1); py < Math.min(c.H, z.y + z.h + 1); py++) for (let px = Math.max(0, z.x - 1); px < Math.min(c.W, z.x + z.w + 1); px++) padded[py * c.W + px] = 1
    for (const z of zones) for (let py = Math.max(0, z.y); py < Math.min(c.H, z.y + z.h); py++) for (let px = Math.max(0, z.x); px < Math.min(c.W, z.x + z.w); px++) soft[py * c.W + px] = 1
    const candidates: { x: number; y: number; distance: number }[] = []
    for (let cy = art.length >> 1; cy <= (look.crewGround ?? c.H) - Math.ceil(art.length / 2); cy++) {
      for (let cx = Math.ceil(w / 2); cx <= right - Math.ceil(w / 2); cx++) {
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
      let hidden = 0
      for (const [dx, dy] of pixels) hidden += soft[(zy + dy) * c.W + zx + dx]!
      if (!best || hidden < best.hidden) best = { k, hidden }
      if (hidden === 0) break
    }
    for (const candidate of best ? [best.k, ...candidates] : candidates) {
      const zone = { x: candidate.x - (art[0]!.length >> 1), y: candidate.y - (art.length >> 1), w, h }
      if (pixels.some(([dx, dy]) => padded[(zone.y + dy) * c.W + zone.x + dx])) continue
      // The room it may roam: around home, as wide as its share of the free sky (crewRoam) and a few rows high, stopping only
      // at Mochi and the other crew. The whole box is reserved, so no other flyer crosses a roaming worker; scenery does not
      // limit it (it passes in front of buildings).
      const ground = look.crewGround ?? c.H
      const free = (sx: number, sy: number) => pixels.every(([dx, dy]) => {
        const px = zone.x + dx + sx, py = zone.y + dy + sy
        return px >= 0 && px < c.W && py >= 0 && py < ground && !padded[py * c.W + px]
      })
      const maxX = job.lane?.roam ?? look.crewRoam ?? PATROL, maxY = (job.tier ?? 1) >= 3 ? 3 : 4
      let rx = 0
      while (rx < maxX && free(-(rx + 1), 0) && free(rx + 1, 0)) rx++
      // Rows above and below are tried apart (a rooftop below must not take away the open sky above), each as a full-width
      // band: a row counts only if the sprite fits there at both ends and in the middle of its horizontal range.
      const across = [-rx, -(rx >> 1), 0, rx >> 1, rx]
      const rowFree = (sy: number) => across.every(sx => free(sx, sy))
      let up = 0, down = 0
      while (up < maxY && rowFree(-(up + 1))) up++
      while (down < maxY && rowFree(down + 1)) down++
      // A hop of up to two rows more when something real happens to this worker (it acted, sent or received a message).
      let hopRoom = 0
      while (hopRoom < 2 && rowFree(-(up + hopRoom + 1))) hopRoom++
      const hop = Math.round(hopRoom * Math.min(1, job.lift ?? 0))
      // Where in the box it is now: its family's gait, over the room that its activity earns it (a calm worker hovers near home).
      const pace = job.pace ?? 0.6
      const { u, v } = gait(job.kind ?? 'codex', job.tier ?? 1, job.seed, job.phase ?? look.frame, rx)
      const share = roamShare(pace)
      const drift = Math.round(rx * share * u), offset = -Math.round(share * (v > 0 ? v * up : v * down)) - hop
      const reserved = { x: zone.x - rx, y: zone.y - up - hopRoom, w: zone.w + 2 * rx, h: zone.h + up + down + hopRoom }
      zones.push(reserved)
      sprites.push(reserved)
      anchors.push((candidate.y + offset) * c.W + candidate.x + drift)
      // where it was a moment ago: the same gait at earlier times, so its trail is exactly its own path
      const kind = job.kind ?? 'codex', now = job.phase ?? look.frame
      const path = (ago: number): Vec => { // the same gait at the time `ago` seconds back: a trail follows this
        const g = gait(kind, job.tier ?? 1, job.seed, now - ago * 10 * clockRate(pace), rx)
        return [candidate.x + Math.round(rx * share * g.u), candidate.y - Math.round(share * (g.v > 0 ? g.v * up : g.v * down))]
      }
      drawWithHit(c, job, () => fly(c, look, candidate.x + drift, candidate.y + offset, job, kind, false, path))
      return zone
    }
  }
  if ((job.kind ?? 'codex') === 'codex' && look.crewGround !== undefined) {
    const art = ROAD[job.tier ?? 1], py = look.crewGround - 3
    for (let px = 0; px + art[0]!.length <= right; px++) {
      const zone = { x: px, y: py, w: art[0]!.length, h: art.length }
      if (zones.some(z => zone.x < z.x + z.w && zone.x + zone.w > z.x && zone.y < z.y + z.h && zone.y + zone.h > z.y)) continue
      anchors.push((py + 1) * c.W + px + 1)
      zones.push(zone)
      sprites.push(zone)
      drawWithHit(c, job, () => draw(c, look, px, py, art, paint(job, look), false))
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
    const drift = Math.round(reach * roamShare(job.pace ?? 0.6) * gait(job.kind ?? 'codex', job.tier ?? 1, job.seed, job.phase ?? look.frame, reach).u)
    const lift = -Math.round(Math.min(1, job.lift ?? 0) * (py > 0 && fits(0) ? 1 : 0))
    anchors.push((py + 2 + lift) * c.W + px + 1 + drift)
    art.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch !== '.') zones.push({ x: px + dx - reach, y: py + dy, w: 1 + 2 * reach, h: 1 }) }))
    sprites.push({ ...zone, x: zone.x - reach, w: zone.w + 2 * reach })
    drawWithHit(c, job, () => draw(c, look, px + drift, py + lift, art, paint(job, look), false))
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
    drawWithHit(c, job, () => draw(c, look, x, y, art, paint(job, look), false))
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
  const counts = [zones.length, sprites.length, anchors.length]
  if (jobs.length * 9 > right * Math.max(1, (look.crewGround ?? c.H) - 3) && packCompact(c, look, ordered.map(([member]) => member))) return
  for (const [job, slot] of ordered) {
    const [x, y] = hover(c, look, job, slot, count, right)
    if (placeFly(c, look, x, y, job, right)) continue
    c.px.set(before)
    if (beforeOwners) c.hitOwners!.set(beforeOwners)
    zones.length = counts[0]!
    sprites.length = counts[1]!
    anchors.length = counts[2]!
    if (packCompact(c, look, ordered.map(([member]) => member))) return
    for (const [member, memberSlot] of ordered) {
      const [cx, cy] = hover(c, look, member, memberSlot, count, right)
      placeFly(c, look, cx, cy, member, right)
    }
    return
  }
}

/** A Codex boat of its class standing on `y` (its top row) at `x`; returns its width for reflections and slots. */
export function boat(c: Canvas, look: Look, x: number, y: number, job: Job): number {
  const art = BOATS[job.tier ?? 1]
  const pal = paint(job, look)
  draw(c, look, x, y, art, pal, false)
  const lamp = art[0]!.indexOf('s') >= 0 ? [art[0]!.indexOf('s'), 0] : [art[1]!.indexOf('s'), 1]
  if (look.night > 0.2) c.glow(x + lamp[0]!, y + lamp[1]!, job.isStale ? P.peach : P.yellow, 0.8)
  boatFx(c, look, { x, y, w: art[0]!.length, h: art.length, tier: job.tier ?? 1, seed: job.seed, pace: job.pace ?? 0.6 })
  return art[0]!.length
}

type Zone = { x: number; y: number; w: number; h: number }

/** Find a clear berth in the water before drawing the boat. `through` names reserved zones a boat may sail across (a
 * place's pier lamps: thin posts a hull passes in front of, which otherwise leave no room wide enough for any boat). */
export function placeBoat(c: Canvas, look: Look, wanted: number, y: number, job: Job, compactOnly = false, through: (zone: Zone) => boolean = () => false) {
  const zones = look.crewZones ??= []
  const sprites = look.crewSpriteZones ??= []
  const anchors = look.crewAnchors ??= []
  const compact = ['.s.', 'aaa', 'hhh'] as const
  for (const art of compactOnly ? [compact] : [BOATS[job.tier ?? 1], compact]) {
    const w = art[0]!.length, h = art.length
    const xs = Array.from({ length: Math.max(0, c.W - w + 1) }, (_, i) => i).sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b)
    // A full boat that cannot berth where it wants (the shore's lamps stand a column every nine cells, in reach of its hull) sails
    // further out instead: its mast crosses the horizon and its hull stays in open water.
    // (the small mark sits on the horizon first, where it reads as a distant sail, before it tries the water among the huts)
    const tops = h === 3 ? [y - 2, y - 1, y, y + 1, y + 2, y + 3, y - 3] : [y, y - 1, y - 2, y - 3, y - 4]
    for (const top of tops) for (const x of xs) {
      if (top < 0 || top + h > c.H) continue
      const zone = { x, y: top, w, h }
      if (zones.some(z => !through(z) && zone.x < z.x + z.w && zone.x + zone.w > z.x && zone.y < z.y + z.h && zone.y + zone.h > z.y)) continue
      drawWithHit(c, job, () => h === 3 ? draw(c, look, x, top, art, paint(job, look), false) : boat(c, look, x, top, job))
      anchors.push((top + h - 1) * c.W + x + (w >> 1))
      zones.push(zone)
      sprites.push(zone)
      return { x, w }
    }
  }
  return undefined
}

/** Reserve crowded water berths together before painting any boat. */
export function packBoats(c: Canvas, look: Look, boats: { job: Job; x: number; y: number }[]): { x: number; w: number }[] | undefined {
  const zones = look.crewZones ??= [], sprites = look.crewSpriteZones ??= [], anchors = look.crewAnchors ??= []
  const options = boats.map(boat => {
    const slots: { x: number; y: number; w: number; h: number }[] = []
    for (const y of [boat.y + 1, boat.y, boat.y + 2, boat.y + 3]) for (let x = 0; x + 3 <= c.W; x++) {
      if (y < 0 || y + 3 > c.H) continue
      const z = { x, y, w: 3, h: 3 }
      if (!zones.some(o => z.x < o.x + o.w && z.x + z.w > o.x && z.y < o.y + o.h && z.y + z.h > o.y)) slots.push(z)
    }
    return slots.sort((a, b) => Math.abs(a.x - boat.x) - Math.abs(b.x - boat.x) || a.y - b.y || a.x - b.x)
  })
  const picked: { x: number; y: number; w: number; h: number }[] = []
  let visits = 0
  const search = (i: number): boolean => {
    if (i === boats.length) return true
    if (++visits > 20_000) return false
    for (const z of options[i]!) {
      if (picked.some(o => z.x < o.x + o.w && z.x + z.w > o.x && z.y < o.y + o.h && z.y + z.h > o.y)) continue
      picked.push(z)
      if (search(i + 1)) return true
      picked.pop()
    }
    return false
  }
  if (!search(0)) return undefined
  picked.forEach((z, i) => {
    drawWithHit(c, boats[i]!.job, () => draw(c, look, z.x, z.y, ['.s.', 'aaa', 'hhh'], paint(boats[i]!.job, look), false))
    anchors.push((z.y + 2) * c.W + z.x + 1)
    zones.push(z)
    sprites.push(z)
  })
  return picked.map(z => ({ x: z.x, w: z.w }))
}

