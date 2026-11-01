import { type Canvas, hash, mix } from '../pixels'
import { type Job, jobAccent, type Look, P } from './kit'

// The crew's look: one family per harness, four classes that grow in size and detail.
//   codex     mechanical  drone -> big drone -> airship -> mothership (a skiff -> tug -> steamship on the water)
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

const AIR: Record<Kind, Record<1 | 2 | 3 | 4, Frames>> = {
  codex: {
    1: [['a...a', '.aWa.'], ['.a.a.', '.aWa.']],
    2: [['aa...aa', '.aaaaa.', '..aWa..', '..s.s..'], ['.a...a.', '.aaaaa.', '..aWa..', '..s.s..']],
    // Sol and Astra are airships, four rows so they fit the sky band: a light upper hull, the accent body with its lit
    // window row, a dark tail fin and a small grey gondola; the windows twinkle, and Astra's nose light blinks.
    3: [
      ['..llllllll...', 'dlaaaaaaaaal.', 'ddaWaWaWaaad.', '....dkkd.....'],
      ['..llllllll...', 'dlaaaaaaaaal.', 'ddaaWaWaWaad.', '....dkkd.....'],
    ],
    4: [
      ['...llllllllll....', 'dllaaaaaaaaaaal..', 'ddaWaWaWaWaWaaads', '.....dkkkkd......'],
      ['...llllllllll....', 'dllaaaaaaaaaaal..', 'ddaaWaWaWaWaWaad.', '.....dkkkkd......'],
    ],
  },
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
 * What each country does to the air around its crew, so a worker belongs to the place it flies over. Only soft light,
 * never a solid pixel: the sprite stays the silhouette and the place only adds its weather to it.
 *   city a searchlight beam at night   harbor a pennant streaming from the mast   beach a ribbon trailing behind
 *   mountains a thin cold contrail     countryside petals and pollen falling    forest fireflies circling
 *   desert heat-haze dust behind       tundra a drift of aurora light and snow glitter
 */
function atmosphere(canvas: Canvas, look: Look, x0: number, y0: number, w: number, h: number, job: Job, ink: number) {
  const f = look.frame, s = job.seed, cx = x0 + (w >> 1), cy = y0 + (h >> 1), tier = job.tier ?? 1
  const night = look.night
  const c = onlyOwnAir(canvas, look, cx, cy)
  switch (look.place) {
    case 'city':
      if (night > 0.3 && tier > 1) for (let k = 1; k <= 4; k++) for (let dx = -(k >> 1); dx <= k >> 1; dx++) c.glow(cx + dx, y0 + h - 1 + k, P.yellow, 0.22 * night * (1 - k / 5) * (dx ? 0.5 : 1)) // a widening beam
      break
    case 'harbor':
      c.glow(cx + 1 + ((f >> 3) & 1), y0 - 1, ink, 0.9)
      c.glow(cx + 2 + ((f >> 3) & 1), y0 - 1 + ((f >> 2) & 1), ink, 0.45)
      break
    case 'beach':
      for (let k = 1; k <= 4; k++) c.glow(x0 - k, cy + Math.round(Math.sin(f * 0.22 + k * 0.9 + s)), ink, 0.62 - k * 0.12)
      break
    case 'mountains':
      for (let k = 1; k <= 6; k++) c.glow(x0 - k, cy + (k >> 2), P.white, 0.34 * (1 - k / 7) * (1 - night * 0.4))
      break
    case 'countryside':
      for (let k = 0; k < 3; k++) {
        const t = (f / 5 + k * 3 + s) % 9
        c.glow(cx - 2 + k * 2 + Math.round(Math.sin(t * 0.9 + k)), y0 + h + Math.floor(t / 2), k % 2 ? P.pink : P.yellow, 0.6 * (1 - t / 9))
      }
      break
    case 'forest':
      for (let k = 0; k < 2; k++) {
        const a = f * 0.1 + k * Math.PI + s
        c.glow(Math.round(cx + Math.cos(a) * (w / 2 + 2)), Math.round(cy + Math.sin(a) * (h / 2 + 1.5)), P.yellow, 0.35 + 0.5 * night)
      }
      break
    case 'desert':
      for (let k = 1; k <= 5; k++) c.glow(x0 - k * 2, y0 + h - 1 + (k & 1), P.sand, 0.34 * (1 - k / 6))
      break
    case 'tundra':
      c.glow(cx + Math.round(Math.sin(f * 0.1 + s) * (w / 2)), y0 + h, P.green, 0.38)
      c.glow(cx + Math.round(Math.cos(f * 0.13 + s) * (w / 2 + 1)), y0 + h + 1, P.white, 0.4)
      break
  }
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
    case 'mountains': { // paraglider: a striped canopy on two lines
      const cw = Math.max(w, 3 + tier * 2), left = x0 - ((cw - w) >> 1)
      for (let i = 0; i < cw; i++) put(left + i, y0 - 2 + (i === 0 || i === cw - 1 ? 1 : 0), i % 2 ? l : a)
      put(left + 1, y0 - 1, d)
      put(left + cw - 2, y0 - 1, d)
      break
    }
    case 'harbor': // a mast and a fluttering pennant
      put(cx, y0 - 1, d)
      put(cx, y0 - 2, d)
      put(cx + 1 + ((f >> 3) & 1), y0 - 2, l)
      put(cx + 1, y0 - 3 + ((f >> 4) & 1), a)
      break
    case 'beach': // a ribbon streaming behind, longer for a bigger model
      for (let k = 1; k <= 2 + tier; k++) put(x0 - k, y0 + (h >> 1) + Math.round(Math.sin(f * 0.22 + k * 0.9 + job.seed)), k % 2 ? l : a)
      break
    case 'desert': // a lateen sail on a mast
      put(cx, y0 - 1, d)
      put(cx, y0 - 2, l)
      put(cx + 1, y0 - 2, a)
      put(cx, y0 - 3, a)
      break
    case 'tundra': // skis with turned-up tips
      for (let i = -1; i <= w; i++) put(x0 + i, y0 + h, d)
      put(x0 - 2, y0 + h - 1, d)
      break
    case 'countryside': // a windmill's turning rotor
      put(cx, y0 - 1, d)
      for (const dx of f % 8 < 4 ? [-2, 2] : [-1, 1]) put(cx + dx, y0 - 2, l)
      put(cx, y0 - 2, a)
      break
    case 'forest': // a lantern on a string
      put(cx, y0 + h, d)
      put(cx, y0 + h + 1, P.yellow)
      break
    case 'city': // an aerial with a blinking light
      put(cx, y0 - 1, d)
      put(cx, y0 - 2, (f >> 3) % 2 ? (look.night > 0.3 ? P.red : P.white) : d)
      break
  }
}

/** A flyer centred on (cx, cy): its family and class decide the sprite and which frame this beat shows. */
export function fly(c: Canvas, look: Look, cx: number, cy: number, job: Job, kind: Kind = job.kind ?? 'codex', compact = false) {
  const frames = AIR[kind][compact ? 1 : job.tier ?? 1]
  const art = frames[(Math.floor(look.frame / (kind === 'claude' ? 3 : kind === 'opencode' ? 5 : 4)) + job.seed) % frames.length]!
  const pal = paint({ ...job, kind }, look)
  const x0 = cx - (art[0]!.length >> 1), y0 = cy - (art.length >> 1)
  draw(c, look, x0, y0, art, pal, true)
  if (!compact) {
    if (kind === 'codex') dress(c, look, x0, y0, art[0]!.length, art.length, { ...job, kind }, pal)
    atmosphere(c, look, x0, y0, art[0]!.length, art.length, { ...job, kind }, pal.a!)
  }
}

/** Reserve the nearest clear lane; compact silhouettes keep a crowded sky readable. */
export function placeFly(c: Canvas, look: Look, x: number, y: number, job: Job, right: number) {
  const zones = look.crewZones ??= []
  const anchors = look.crewAnchors ??= []
  const sprites = look.crewSpriteZones ??= []
  const occupied = new Uint8Array(c.W * c.H)
  for (const z of zones) for (let py = Math.max(0, z.y); py < Math.min(c.H, z.y + z.h); py++) for (let px = Math.max(0, z.x); px < Math.min(c.W, z.x + z.w); px++) occupied[py * c.W + px] = 1
  const blocked = (px: number, py: number) => px >= 0 && px < c.W && py >= 0 && py < c.H && occupied[py * c.W + px] === 1
  {
    const frames = AIR[job.kind ?? 'codex'][job.tier ?? 1]
    const art = frames[0]!
    const w = art[0]!.length, h = art.length
    const pixels: [number, number][] = []
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      if (frames.some(frame => frame[dy]![dx] !== '.')) pixels.push([dx, dy])
    }
    const padded = new Uint8Array(c.W * c.H)
    for (let py = 0; py < c.H; py++) for (let px = 0; px < c.W; px++) if (blocked(px, py)) {
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = px + ox, yy = py + oy
        if (xx >= 0 && xx < c.W && yy >= 0 && yy < c.H) padded[yy * c.W + xx] = 1
      }
    }
    const candidates: { x: number; y: number; distance: number }[] = []
    for (let cy = art.length >> 1; cy <= (look.crewGround ?? c.H) - Math.ceil(art.length / 2); cy++) {
      for (let cx = Math.ceil(w / 2); cx <= right - Math.ceil(w / 2); cx++) {
        candidates.push({ x: cx, y: cy, distance: Math.abs(cx - x) + 2 * Math.abs(cy - y) })
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x)
    for (const candidate of candidates) {
      const zone = { x: candidate.x - (art[0]!.length >> 1), y: candidate.y - (art.length >> 1), w, h }
      if (pixels.some(([dx, dy]) => padded[(zone.y + dy) * c.W + zone.x + dx])) continue
      const clearAt = (rise: number) => zone.y - rise >= 0 && pixels.every(([dx, dy]) => !padded[(zone.y + dy - rise) * c.W + zone.x + dx])
      const bob = zone.y > 0 && zone.y + zone.h < (look.crewGround ?? c.H) && clearAt(1) && pixels.every(([dx, dy]) => !padded[(zone.y + dy + 1) * c.W + zone.x + dx])
      // A hop of up to two pixels when something real happens to this worker (it acted, sent or received a message).
      const hopRoom = bob && clearAt(2) ? 2 : bob ? 1 : 0
      const hop = Math.round(hopRoom * Math.min(1, job.lift ?? 0))
      const offset = bob ? Math.round(Math.sin(look.frame * 0.09 + job.seed)) - hop : 0
      // Patrol: travel the clear sky beside its home, up to PATROL px each way, smoothly (well under a pixel a frame), so a
      // working crew visibly goes about its business while never crossing a building or another flyer's stretch.
      let reach = 0
      while (reach < PATROL && pixels.every(([dx, dy]) => !padded[(zone.y + dy) * c.W + zone.x + dx - reach - 1] && !padded[(zone.y + dy) * c.W + zone.x + dx + reach + 1] && zone.x - reach - 1 >= 0 && zone.x + w + reach + 1 <= c.W)) reach++
      const speed = [0, 0.045, 0.032, 0.022, 0.016][job.tier ?? 1]! * (job.isStale ? 0.3 : 1)
      const drift = Math.round(reach * Math.sin(look.frame * speed + job.seed * 5))
      const reserved = { ...zone, x: zone.x - reach, w: zone.w + 2 * reach, ...(bob ? { y: zone.y - Math.max(1, hopRoom), h: zone.h + 1 + Math.max(1, hopRoom) } : {}) }
      zones.push(reserved)
      sprites.push(reserved)
      anchors.push((candidate.y + offset) * c.W + candidate.x + drift)
      drawWithHit(c, job, () => fly(c, look, candidate.x + drift, candidate.y + offset, job, job.kind ?? 'codex'))
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
    while (reach < PATROL && fits(-(reach + 1)) && fits(reach + 1)) reach++
    const speed = [0, 0.045, 0.032, 0.022, 0.016][job.tier ?? 1]! * (job.isStale ? 0.3 : 1)
    const drift = Math.round(reach * Math.sin(look.frame * speed + job.seed * 5))
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

/** Slots of sky across `right` columns: each flyer keeps a stretch wide enough for an airship and its sway. */
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
  if ((job.tier ?? 1) > 1 && !job.isStale && look.frame % 8 < 5) c.glow(x + art[0]!.indexOf('k') + (look.frame % 2), y - 1, P.white, 0.35) // funnel smoke
  return art[0]!.length
}

/** Find a clear berth in the water before drawing the boat. */
export function placeBoat(c: Canvas, look: Look, wanted: number, y: number, job: Job, compactOnly = false) {
  const zones = look.crewZones ??= []
  const sprites = look.crewSpriteZones ??= []
  const anchors = look.crewAnchors ??= []
  const compact = ['.s.', 'aaa', 'hhh'] as const
  for (const art of compactOnly ? [compact] : [BOATS[job.tier ?? 1], compact]) {
    const w = art[0]!.length, h = art.length
    const xs = Array.from({ length: Math.max(0, c.W - w + 1) }, (_, i) => i).sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b)
    const tops = h === 3 ? [y + 1, y, y + 2, y + 3] : [y]
    for (const top of tops) for (const x of xs) {
      if (top < 0 || top + h > c.H) continue
      const zone = { x, y: top, w, h }
      if (zones.some(z => zone.x < z.x + z.w && zone.x + zone.w > z.x && zone.y < z.y + z.h && zone.y + zone.h > z.y)) continue
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

