import type { WakePreset } from '../../types'
import type { Tier } from './design'
import { hash } from '../pixels'
import { P } from './kit'

const PAPER_INKS = [P.green, P.yellow, P.red, P.blue, P.lavender] as const
/** Stable worker hue, shared by the paper shades and their torn scraps. */
export const lanternInk = (seed: number) => PAPER_INKS[hash(seed ^ 0x5bf03635) % PAPER_INKS.length]!
/** Remove the pastel's neutral component, preserving its hue while giving the paper real depth. */
export function lanternPaper(ink: number, night: number): number {
  const channels = [ink >> 16 & 255, ink >> 8 & 255, ink & 255]
  const floor = Math.min(...channels) * 0.75
  const scale = (115 + 55 * night) / (Math.max(...channels) - floor)
  const [r, g, b] = channels.map(value => Math.round((value - floor) * scale))
  return r! << 16 | g! << 8 | b!
}

// OpenCode's crew is paper and cloth with a flame inside: a different lit craft for each place, in the worker's own paper colour.
// An origami crane over the city, a carp streamer in the harbor wind, a kite on the beach, a sky lantern in the mountains, a
// balloon over the fields, a string of lanterns in the forest, a flying carpet in the desert and a paper star on the tundra.
// Each has one warm window (`s`, flaring to `f`) and moves in its own way: it flaps, ripples, trails, sways, bobs or turns.
// Letters: a paper, l its lit edge, d its shade, p trim, k dark, W white, s the flame's window, f the flare.
type Point = readonly [number, number]
type Rect = { x: number; y: number; w: number; h: number }
type Lamp = { flame: Point; heat: Point; force: number; window: Rect; shade: Rect; rib: Point }
type Pose = { rows: readonly string[]; lamps: readonly Lamp[]; flame: Point; heat: Point; force: number; window: Rect }
const BEATS = 8
export const LANTERN_SIZE: Record<Tier, { w: number; h: number }> = {
  1: { w: 5, h: 3 }, 2: { w: 7, h: 5 }, 3: { w: 11, h: 6 }, 4: { w: 15, h: 7 },
}

type Drawn = readonly (readonly string[])[]
/** A craft is either drawn pose by pose (`cycles` loops of its poses fit the eight beats) or generated, when it ripples. */
type Craft = { name: string } & ({ cycles: 1 | 2; art: Record<Tier, Drawn> } | { wave: (w: number, h: number, phase: number) => string[] })

function sheet(w: number, h: number) {
  const rows = Array.from({ length: h }, () => Array<string>(w).fill('.'))
  const dot = (x: number, y: number, ink: string) => {
    x = Math.round(x); y = Math.round(y)
    if (x >= 0 && x < w && y >= 0 && y < h) rows[y]![x] = ink
  }
  return { dot, rows: () => rows.map(row => row.join('')) }
}

/** A carp streamer: an open white mouth ring, a bright eye, a striped tube and a forked tail that swings in the wind. */
function carp(w: number, h: number, phase: number) {
  const s = sheet(w, h), cy = (h - 1) / 2, body = w - 3
  // The tube holds straight in the wind and only its tail half swings, as one piece: no wave travels down it (that is the dragon's).
  const at = (x: number) => cy + (h > 3 ? 1.4 : 0.7) * Math.sin(phase) * Math.max(0, (x - w * 0.45) / (w * 0.55))
  for (let x = 2; x < body; x++) {
    const half = h > 3 && x < w * 0.62 ? 1 : 0
    for (let dy = -half; dy <= half; dy++) s.dot(x, at(x) + dy, x % 3 === 1 ? 'd' : dy < 0 ? 'l' : 'a')
  }
  for (let x = body; x < w; x++) { s.dot(x, at(x) - (x - body + (h > 3 ? 0 : -1)) * 0.5 - 0.5, 'a'); s.dot(x, at(x) + (x - body) * 0.5 + 0.5, 'p') } // the forked tail
  if (h > 3) { s.dot(1, cy - 1, 'W'); s.dot(1, cy + 1, 'W') }
  s.dot(0, cy, 'W'); s.dot(2, at(2) - (h > 3 ? 0 : 0), 's')
  return s.rows()
}

/** A flying carpet seen edge on: a flat patterned rug whose ends flap, a tassel at each end and a lamp riding on it. */
function carpet(w: number, h: number, phase: number) {
  const s = sheet(w, h), cy = (h - 1) / 2 + (h > 3 ? 0.5 : 0)
  // The rug lies flat on the air; its front edge curls up and its back edge flaps, turn about. No wave runs along it.
  const curl = h > 3 ? 1.2 : 0.6, end = Math.max(2, Math.round(w * 0.2))
  const at = (x: number) => cy - curl * (x < end ? (end - x) / end * Math.max(0, Math.sin(phase)) : x >= w - end ? (x - (w - end - 1)) / end * Math.max(0, -Math.sin(phase)) : 0)
  for (let x = 1; x < w - 1; x++) {
    s.dot(x, at(x), x % 4 === 2 ? 'l' : x % 2 ? 'a' : 'p') // the weave: a light motif between darker bands
    if (h > 3) s.dot(x, at(x) + 1, x % 2 ? 'd' : '.') // the fringe along its near edge
  }
  for (const [x, edge] of [[0, 1], [w - 1, w - 2]] as const) { s.dot(x, at(edge) + 1, 'p'); if (h > 5) s.dot(x, at(edge) + 2, 'p') } // a tassel hanging at each end
  const lamp = Math.round(w * 0.35), top = Math.round(at(lamp)) - 1
  s.dot(lamp, top, 's')
  if (h > 3) { s.dot(lamp - 1, top, 'k'); s.dot(lamp + 1, top, 'k'); s.dot(lamp, top - 1, 'k') }
  return s.rows()
}

const CRAFTS: Record<WakePreset, Craft> = {
  city: { name: 'origami crane', cycles: 2, art: { // folded paper: a long neck, a peaked wing that beats, a pointed tail
    1: [['W.l.d', '.asd.', '.....'], ['W...d', '.asd.', '..l..']],
    2: [['...l...', 'W..la.d', '.aasad.', '..dd...', '.......'], ['.......', 'W.....d', '.aasad.', '..dla..', '...l...']],
    3: [['.....l.....', 'W...laa..d.', '.a..laad.d.', '..aalsaadd.', '...daadd...', '...........'], ['...........', 'W........d.', '.a.......d.', '..aalsaadd.', '...dlaad...', '....lld....']],
    4: [
      ['.......l.......', '......lla......', 'W.....laa....d.', '.a...llaad..dd.', '..aaalssaaadd..', '...daaaaadd....', '.....ddd.......'],
      ['...............', 'W............d.', '.a..........dd.', '..aaalssaaadd..', '...dlaaaadd....', '....llaad......', '.....lld.......'],
    ],
  } },
  harbor: { name: 'paper boat', cycles: 2, art: { // a folded boat on the water, a candle glowing through its peak; it rocks bow up, stern up
    1: [['..s..', 'laaad', '.ddd.'], ['..f..', 'laaad', '.ddd.']],
    2: [['...l...', '..lsd..', 'l.asa..', '.aapaa.', '..ddd..'], ['...l...', '..lsd..', '..asa.d', '.aapaa.', '..ddd..']],
    3: [
      ['.....l.....', '....lsd....', '...lassd...', 'l.laaaaad..', '.aapadapaa.', '..ddddddd..'],
      ['.....l.....', '....lsd....', '...lassd...', '..laaaaad.d', '.aapadapaa.', '..ddddddd..'],
    ],
    4: [ // the peak, the two raised points of the hull, a crease down the middle and a painted band
      ['.......l.......', '......lad......', '.....lasad.....', 'l...lasssad....', 'al.laaaaaaad..d', '.aapaaadaaapad.', '..ddddddddddd..'],
      ['.......l.......', '......lad......', '.....lasad.....', '....lasssad...d', 'l..laaaaaaad.ad', '.aapaaadaaapad.', '..ddddddddddd..'],
    ],
  } },
  beach: { name: 'kite', cycles: 1, art: { // a diamond on its cross spars, trailing a tail of bows that snakes behind
    1: [['ls...', '.d.p.', '.....'], ['ls...', '.d...', '..p..']],
    2: [['.l.....', 'lsa....', '.d.d...', '....p.d', '.......'], ['.l.....', 'lsa....', '.d.....', '..d.p..', '.....d.']],
    3: [['..l........', '.lla.......', 'llsaad.W.d.', '.dsa..d...W', '..d........', '...........'], ['..l........', '.lla.......', 'llsaa.d...W', '.dsa.d.W.d.', '..d........', '...........']],
    4: [ // a full diamond with its lit spar, and a tail of white bows on a dark string
      ['...l...........', '..lla..........', '.llsaa.........', 'lllsaaad.W.d.W.', '.ddsaa..d...d..', '..dda..........', '...d...........'],
      ['...l...........', '..lla..........', '.llsaa.........', 'lllsaaa.d...d..', '.ddsaa.d.W.d.W.', '..dda..........', '...d...........'],
    ],
  } },
  mountains: { name: 'sky lantern', cycles: 2, art: { // a tall paper lantern glowing right through, its flame guttering beneath
    1: [['.la..', '.ss..', '..f..'], ['.la..', '.ss..', '.f...']],
    2: [['.laad..', '.lssd..', '.lapd..', '..kk...', '...f...'], ['.laad..', '.lssd..', '.lapd..', '..kk...', '..f....']],
    3: [['...laad....', '..lssssd...', '..lsasad...', '..lapapd...', '...dkkd....', '....f......'], ['...laad....', '..lssssd...', '..lsasad...', '..lapapd...', '...dkkd....', '.....f.....']],
    4: [ // lit panels between paper seams, a painted band, a wire rim, and the flame guttering beneath
      ['.....laaad.....', '....lssssssd...', '....lsasasad...', '....lapapapd...', '.....aaaaad....', '......dkkd.....', '.......f.......'],
      ['.....laaad.....', '....lssssssd...', '....lsasasad...', '....lapapapd...', '.....aaaaad....', '......dkkd.....', '........f......'],
    ],
  } },
  countryside: { name: 'carp streamer', wave: carp },
  forest: { name: 'lantern string', cycles: 1, art: { // round lanterns on one thread, bobbing turn and turn about
    1: [['.la..', '.sa..', '.p...'], ['.la..', '.sa..', '..p..']],
    2: [['..d....', '.laad..', '.lsad..', '..ad...', '..p....'], ['.......', '..d....', '.laad..', '.lsad..', '..ad...']],
    3: [['.d.........', 'laad..d....', 'lsad.laad..', '.ad..lsad..', '.p....ad...', '......p....'], ['......d....', '.d...laad..', 'laad.lsad..', 'lsad..ad...', '.ad...p....', '.p.........']],
    4: [
      ['.d.............', 'laad..d........', 'lsad.laad..d...', '.ad..lsad.laad.', '.p....ad..lsad.', '......p....ad..', '...........p...'],
      ['......d........', '.d...laad..d...', 'laad.lsad.laad.', 'lsad..ad..lsad.', '.ad...p....ad..', '.p.........p...', '...............'],
    ],
  } },
  desert: { name: 'flying carpet', wave: carpet },
  tundra: { name: 'paper star', cycles: 1, art: { // a folded star with a lit heart: its long points turn from a cross to a saltire
    1: [['..l..', '.asd.', '..d..'], ['.l.d.', '..s..', '.l.d.']],
    2: [['...l...', 'llasadd', '...d...', '...p...', '.......'], ['.l...d.', '..asa..', '.l.p.d.', '.......', '.......']],
    3: [
      ['.....l.....', '..l.lsd.d..', '.llasssadd.', '..l.dsd.d..', '.....d.....', '.....p.....'],
      ['.l...l...d.', '..la.s.ad..', '...asfsa...', '..la.s.ad..', '.d...d...d.', '.....p.....'],
    ],
    4: [ // eight folded points round a lit heart: the long ones and the short ones change places as it turns
      ['.......l.......', '...l..lad..d...', '....lalsdad....', '.llaasssssaadd.', '....ladsdad....', '...l..dad..d...', '.......p.......'],
      ['..l....l....d..', '...la.lad.ad...', '....lassdad....', '..laasfffsaad..', '....lassdad....', '...la.dad.ad...', '..d....p....d..'],
    ],
  } },
}

function pose(place: WakePreset, tier: Tier, beat: number): Pose {
  const { w, h } = LANTERN_SIZE[tier], craft = CRAFTS[place]
  const drawn = 'wave' in craft ? craft.wave(w, h, beat * Math.PI * 2 / BEATS) : craft.art[tier][Math.floor(beat * craft.cycles * craft.art[tier].length / BEATS) % craft.art[tier].length]!
  const rows = Array.from({ length: h }, (_, y) => (drawn[y] ?? '').padEnd(w, '.').slice(0, w))
  const cells = rows.flatMap((row, y) => [...row].flatMap((ink, x) => ink === '.' ? [] : [[x, y, ink] as const]))
  const xs = cells.map(c => c[0]), ys = cells.map(c => c[1])
  const shade: Rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 }
  const rib = cells.find(c => c[2] === 'l') ?? cells[0]!
  // Every separate window is a lamp: its own flame, the first clear cell above it for its heat, and a flicker out of step with the next.
  const lit = new Set(cells.filter(c => c[2] === 's' || c[2] === 'f').map(c => c[1] * w + c[0])), lamps: Lamp[] = []
  while (lit.size) {
    const first = lit.values().next().value!, queue = [first]
    lit.delete(first)
    for (let i = 0; i < queue.length; i++) for (const step of [-1, 1, -w, w]) {
      const next = queue[i]! + step
      if (lit.has(next) && (Math.abs(step) === w || Math.floor(next / w) === Math.floor(queue[i]! / w))) { lit.delete(next); queue.push(next) }
    }
    const wx = queue.map(c => c % w), wy = queue.map(c => Math.floor(c / w))
    const window: Rect = { x: Math.min(...wx), y: Math.min(...wy), w: Math.max(...wx) - Math.min(...wx) + 1, h: Math.max(...wy) - Math.min(...wy) + 1 }
    let heat = window.y
    while (heat >= 0 && rows[heat]![window.x] !== '.') heat--
    lamps.push({ flame: [window.x, window.y], heat: [window.x, heat], force: (0.5 + 0.5 * Math.cos(beat * Math.PI / 4 - lamps.length * 0.95 + 0.45)) ** 2, window, shade, rib: [rib[0], rib[1]] })
  }
  const lead = lamps[0]!, pulse = lamps.reduce((a, b) => a.force > b.force ? a : b)
  return { rows, lamps, flame: lead.flame, heat: pulse.heat, force: pulse.force, window: lead.window }
}

const classes = (place: WakePreset): Record<Tier, readonly Pose[]> => {
  const frames = (tier: Tier) => Array.from({ length: BEATS }, (_, beat) => pose(place, tier, beat))
  return { 1: frames(1), 2: frames(2), 3: frames(3), 4: frames(4) }
}
const POSES = {
  city: classes('city'), harbor: classes('harbor'), beach: classes('beach'), mountains: classes('mountains'),
  countryside: classes('countryside'), forest: classes('forest'), desert: classes('desert'), tundra: classes('tundra'),
}
export const lanternPose = (place: WakePreset, tier: Tier, beat: number) => POSES[place][tier][((beat % BEATS) + BEATS) % BEATS]!
const pictures = (place: WakePreset) => {
  const frames = (tier: Tier) => POSES[place][tier].map(p => p.rows)
  return { 1: frames(1), 2: frames(2), 3: frames(3), 4: frames(4) }
}
export const ALL_LANTERNS = {
  city: pictures('city'), harbor: pictures('harbor'), beach: pictures('beach'), mountains: pictures('mountains'),
  countryside: pictures('countryside'), forest: pictures('forest'), desert: pictures('desert'), tundra: pictures('tundra'),
}
export const lanternFrames = (place: WakePreset = 'city', tier: Tier) => ALL_LANTERNS[place][tier]
export const lanternNose = (place: WakePreset, tier: Tier, beat: number) => lanternPose(place, tier, beat).flame
/** The craft with every window flaring: the instant it sends. */
export const lanternFlare = (place: WakePreset, tier: Tier, beat: number) => lanternPose(place, tier, beat).rows.map(row => row.replaceAll('s', 'f'))
