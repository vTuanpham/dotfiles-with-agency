import type { WakePreset } from '../../types'
import type { Tier } from './design'
import { flex } from './flex'

// Codex is the clockwork crew: every place has its own automaton, built of the same plated metal with a glass eye and a gear.
// Over the city the clockwork dragon (a generator, see `dragon` below: one design that grows from a small, slim whelp to a long
// plated one); elsewhere a tug, saucer, airship, crop drone, probe, sun skiff and snowcat.
// Four classes grow the same machine, each a rectangle inside CRAFT_MAX and larger than the
// one before. Sprite keys are crew.ts's: a body, W highlight, l light plate, d shade, s lamp, g glass, k grey metal. Only the
// dragon undulates; the others move a part of their own (a fluke, a bell, a propeller, wings, pincers, legs).
// What a craft stirs up, lights and trails is data in fx.ts, not drawn here.

type Frames = readonly (readonly string[])[]

/**
 * The room a sprite may take in the shared shallow sky: no craft is wider than `w` or taller than `h`.
 * Each class draws larger than the one before; inside these limits a craft has the cells its own shape needs. A test
 * holds every craft to this. Keep the silhouette clear, with at least three structural tones and one lit accent.
 */
export const CRAFT_MAX = { w: 19, h: 7 }

/**
 * City: the clockwork dragon, the city's festival dragon rebuilt by Codex out of metal. A small horned head with a glowing eye and
 * a jaw, a slim armoured body of plates three cells long (a light crest, a dark belly, seams between plates) with a gear tooth
 * along the spine, and a bladed tail. Thin and long, so it threads the towers without taking over the sky. It is one dragon at
 * four sizes: a bigger model is a longer dragon with a deeper wave, never a different picture. It undulates (eight frames to a wave, so the motion flows) while a pulse of light runs down
 * its plates from the tail to the head, and the tail blade flicks. Sprite keys are crew.ts's: l light, a body, d shade, W the lit
 * plate and the eye, k the horns and the spine's gear teeth.
 */
const DRAGON = {
  // class: grid, the head's size, the body's thickness in rows and the wave's amplitude in rows
  1: { w: 5, h: 3, head: 3, thick: 1, wave: 0 },
  2: { w: 9, h: 5, head: 3, thick: 2, wave: 0.9 },
  3: { w: 15, h: 6, head: 3, thick: 2, wave: 1.4 },
  4: { w: 19, h: 7, head: 3, thick: 2, wave: 1.8 },
} as const
const BEATS = 8

const dragonAt = (tier: Tier, beat: number, x: number) => (DRAGON[tier].h - 1) / 2 + DRAGON[tier].wave * Math.sin(x * 0.5 - beat * 2 * Math.PI / BEATS)

/** One thrust at each plate group's low stroke, on the very same eight-beat grid as the visible body. */
export const dragonCrests = (tier: Tier): readonly { beat: number; x: number; y: number }[] => {
  const { w, h, thick } = DRAGON[tier]
  if (tier === 1) return [{ beat: 0, x: w - 1, y: Math.min(h - 1, Math.round(dragonAt(tier, 0, w - 1)) + 1) }]
  return Array.from({ length: Math.ceil((w - 4) / 6) }, (_, i) => {
    const x = 4 + i * 6, beat = ((Math.round((x * 0.5 - Math.PI / 2) * BEATS / (2 * Math.PI)) % BEATS) + BEATS) % BEATS
    const y = Math.min(h - 1, Math.round(dragonAt(tier, beat, x) - (thick - 1) / 2) + thick - 1)
    return { beat, x, y }
  })
}

function dragon(tier: Tier, beat: number): string[] {
  const { w, h, head, thick } = DRAGON[tier]
  const rows = Array.from({ length: h }, () => Array<string>(w).fill('.'))
  const set = (x: number, y: number, ch: string) => { x = Math.round(x); y = Math.round(y); if (ch !== '.' && x >= 0 && x < w && y >= 0 && y < h) rows[y]![x] = ch }
  const at = (x: number) => dragonAt(tier, beat, x)
  // the head: horns, a brow, an eye and a jaw
  const hy = Math.round(at(head - 0.5) - 1)
  const face = ['.kl', 'aWa', 'dda'] // small, so the length is in the body and the dragon never takes over the sky
  face.forEach((row, dy) => [...row].forEach((ch, dx) => set(dx, hy + dy, ch)))
  // the body: plates of three columns, seams between them, the pulse of light on one plate, and the tail tapering to a blade
  const plates = Math.ceil((w - head) / 3), lit = plates - 1 - (Math.floor(beat / 2) % plates)
  for (let x = head; x < w; x++) {
    const plate = Math.floor((x - head) / 3), seam = (x - head) % 3 === 2 && x < w - 1, tail = x >= w - 2
    const n = tail ? 1 : thick, top = Math.round(at(x) - (thick - 1) / 2) + (tail ? Math.floor((thick - 1) / 2) : 0)
    for (let r = 0; r < n; r++) set(x, top + r, seam ? r === 0 && plate % 2 === 0 ? 'g' : 'd' : r === 0 ? (plate === lit ? 'W' : 'l') : r === n - 1 && n > 1 ? 'd' : 'a')
    if (!seam && !tail && tier >= 2 && (x - head) % 3 === 1) set(x, top - 1, 'k') // a gear tooth on the spine, one to a plate
  }
  set(w - 1, Math.round(at(w - 1)) + [1, 0, -1, 0][beat % 4]!, 'l') // the tail's blade sweeps up and down (a cycle of four: no two neighbouring frames match)
  return rows.map(r => r.join(''))
}
const dragonFrames = (tier: Tier): Frames => Array.from({ length: BEATS }, (_, beat) => dragon(tier, beat))
const CITY_CRAFT: Record<Tier, Frames> = { 1: dragonFrames(1), 2: dragonFrames(2), 3: dragonFrames(3), 4: dragonFrames(4) }

export const MACHINE_SIZE: Record<Tier, { w: number; h: number }> = {
  1: { w: 5, h: 3 }, 2: { w: 7, h: 5 }, 3: { w: 11, h: 6 }, 4: { w: 15, h: 7 },
}
/** An automaton: two poses of its moving part in each class, and how many times it works that part in the eight beats. Every
 *  pose has a glass eye (`Wg`, its face, where its signal leaves) and a gear (`k`). All are drawn heading left. */
type Machine = { name: string; strokes: 1 | 2 | 4; art: Record<Tier, readonly [readonly string[], readonly string[]]> }

const AUTOMATA: Record<Exclude<WakePreset, 'city'>, Machine> = {
  harbor: { name: 'tug', strokes: 2, art: { // a tugboat on the water: a lit wheelhouse, a mast lamp that blinks, a funnel puffing, a screw that churns
    1: [['...k.', '.Wgd.', 'laaad'], ['..k..', '.Wgd.', 'laaad']],
    2: [['....k..', 'r.Wgk..', '.paaad.', 'laaaaad', '.......'], ['.....k.', 'W.Wgk..', '.paaad.', 'laaaaad', '.......']],
    3: [
      ['......k.k..', '..r...k....', '..lWgl.rd..', 'l.llllddd.s', 'alapaapaaad', '.dkdkdkdkd.'],
      ['.......k.k.', '..W....k...', '..lWgl.rd..', 'l.llllddd.s', 'alapaapaaad', '.dkdkdkdkd.'],
    ],
    4: [ // a high bow, a white wheelhouse, a red-banded funnel, tyres hung along the hull
      ['.........k.k...', '....r....kk....', '...lll...rr....', '...lWgl..dd....', 'l..lllladdd..s.', 'alaapaapaapaaad', '.dkdkdkdkdkdkd.'],
      ['..........k.k..', '....W.....k....', '...lll...rr....', '...lWgl..dd....', 'l..lllladdd..s.', 'alaapaapaapaaad', '.dkdkdkdkdkdkd.'],
    ],
  } },
  beach: { name: 'saucer', strokes: 4, art: { // seen face on: a glass dome, a rim of lamps that chase each other round, thrusters that flicker
    1: [['.Wgl.', 'sakas', '.f.f.'], ['.Wgl.', 'askal', '..f..']],
    2: [['...r...', '..Wgl..', 'lsakasl', '.ddddd.', '..f.f..'], ['...r...', '..Wgl..', 'laskasl', '.ddddd.', '...f...']],
    3: [
      ['.....r.....', '...lWggl...', '.llaaaaall.', 'dsakasakasd', '..ddddddd..', '...f...f...'],
      ['.....r.....', '...lWggl...', '.llaaaaall.', 'daskaasksad', '..ddddddd..', '....f.f....'],
    ],
    4: [
      ['.......r.......', '.....lWggl.....', '...llaaaaaall..', 'dsaakaasaakaasd', '..ddddddddddd..', '....f..f..f....', '...............'],
      ['.......r.......', '.....lWggl.....', '...llaaaaaall..', 'dasaksaaaskasad', '..ddddddddddd..', '.....f...f.....', '...............'],
    ],
  } },
  mountains: { name: 'airship', strokes: 4, art: { // a ribbed hull, a gondola with its porthole, and a propeller that spins
    1: [['.ll..', 'aaadk', '.Wg..'], ['.llk.', 'aaad.', '.Wg..']],
    2: [['.llll..', 'aWaaadk', '.dddd..', '.kWg...', '.......'], ['.llllk.', 'aaaWad.', '.ddddk.', '.kWg...', '.......']],
    3: [
      ['..llllll.d.', 'Walalalaadd', '.dadadaddd.', '..ddddd..d.', '...lWgdk...', '....s......'],
      ['..llllll.d.', 'Walalalaadd', '.dadadaddd.', '..ddddd..d.', '...lWgdkk..', '....s......'],
    ],
    4: [ // a bright nose cone, ribs along the envelope, a row of ports, two tail fins, and the gondola's propeller
      ['...llllllll..d.', '.lalalalalaaadd', 'Waapaaapaaapaad', '.dadadadadaddd.', '...ddddddd...d.', '.....lWgadk....', '......s........'],
      ['...llllllll..d.', '.lalalalalaaadd', 'Waapaaapaaapaad', '.dadadadadaddd.', '...ddddddd...d.', '.....lWgadkk...', '......s........'],
    ],
  } },
  countryside: { name: 'crop drone', strokes: 4, art: { // two rotors on masts over a slim pod, a camera eye forward, a tail beacon, and a long spray boom misting the field
    1: [['lllll', 'sWgkr', '.p.p.'], ['.lkl.', 'sWgkr', 'p.p.p']],
    2: [['lll.lll', '.k...k.', 'sWgaadr', '.ppppp.', '..l.l..'], ['.l...l.', '.k...k.', 'sWgaadr', '.ppppp.', '.l.l.l.']],
    3: [
      ['.lll...lll.', '..k.....k..', 'sWgaaaaaadr', '..dakakad..', '.ppppppppp.', '..l..l..l..'],
      ['..l.....l..', '..k.....k..', 'sWgaaaaaadr', '..dakakad..', '.ppppppppp.', '.l..l..l...'],
    ],
    4: [
      ['.lllll...lllll.', '...k.......k...', '.sWgaaaaaaaaadr', '..ddakaaakadd..', '.....k...k.....', '.ppppppppppppp.', '..l..l...l..l..'],
      ['..ldl.....ldl..', '...k.......k...', '.sWgaaaaaaaaadr', '..ddakaaakadd..', '.....k...k.....', '.ppppppppppppp.', '...l..l.l..l...'],
    ],
  } },
  forest: { name: 'probe', strokes: 2, art: { // a probe droid, face on: aerials, one glass eye between two lamps, and jointed arms that reach and tuck
    1: [['lWgl.', 'dakad', 'k.d.k'], ['lWgl.', 'dakad', '.kdk.']],
    2: [['.k...k.', 'lsWgsl.', '.dkpkd.', 'k.d.d.k', 'k..d..k'], ['.k...k.', 'lsWgsl.', '.dkpkd.', '.kd.dk.', '.k.d.k.']],
    3: [
      ['...k...k...', '..lllllll..', '.asaWgasad.', '..dkpppkd..', '.k.d.d.d.k.', 'k....d....k'],
      ['...k...k...', '..lllllll..', '.asaWgasad.', '..dkpppkd..', '..kd.d.dk..', '..k..d..k..'],
    ],
    4: [
      ['.....k...k.....', '....lllllll....', '...asaWgasad...', '....dkpppkd....', '...k.d.d.d.k...', '..k..d.d.d..k..', '..k....d....k..'],
      ['.....k...k.....', '....lllllll....', '...asaWgasad...', '....dkpppkd....', '....kd.d.dk....', '....k..d..k....', '...k...d...k...'],
    ],
  } },
  desert: { name: 'sun skiff', strokes: 4, art: { // a long low hull under a tall sail of solar glass that shimmers, a pennant astern, a jet that stutters
    1: [['.lg.k', 'sWgaf', '.dd..'], ['.lp.k', 'sWgdf', '.dd..']],
    2: [['..l....', '.lgl.p.', '..k..k.', 'sWgaadf', '.dddd..'], ['..l....', '.lpl..p', '..k..k.', 'sWgaaff', '.dddd..']],
    3: [
      ['....l......', '...lgl.....', '..lgpgl.p..', '....k...k..', 'sWgaaaaaadf', '.dddkdddd..'],
      ['....l......', '...lpl.....', '..lpgpl..p.', '....k...k..', 'sWgaaaaaaff', '.dddkdddd..'],
    ],
    4: [
      ['......l........', '.....lgl.......', '....lgpgl......', '...lgpgpgl..p..', '......k.....k..', 'sWgaaaaaaaaaadf', '..ddddkdddkdd..'],
      ['......l........', '.....lpl.......', '....lpgpl......', '...lpgpgpl...p.', '......k.....k..', 'sWgaaaaaaaaaaff', '..ddddkdddkdd..'],
    ],
  } },
  tundra: { name: 'snowcat', strokes: 2, art: { // a tracked crawler: a plough, a windscreen, a beacon that turns on its roof, and tracks whose wheels roll
    1: [['.Wgr.', 'paaad', '.klkl'], ['.Wgs.', 'paaad', '.lklk']],
    2: [['...r...', '.lWgl.k', 'plaaaad', '.klklkl', '.......'], ['...s...', '.lWgl.k', 'plaaaad', '.lklklk', '.......']],
    3: [
      ['....r......', '..lWgl.p.k.', 'p.aaapaaad.', 'ppaakaakad.', '.klkklkklk.', '..kkkkkkk..'],
      ['....s......', '..lWgl.p.k.', 'p.aaapaaad.', 'ppaakaakad.', '.kklkklkkl.', '..kkkkkkk..'],
    ],
    4: [ // a cab up front, a flat bed with a crate and an exhaust stack behind, a plough ahead, dark tracks with bright wheels
      ['......r........', '....llll.....k.', '...lWggal.pp.k.', 'p..aaapaaaaaad.', 'pp.aakaaaakaad.', '..klkklkklkklk.', '...kkkkkkkkk...'],
      ['......s........', '....llll.....k.', '...lWggal.pp.k.', 'p..aaapaaaaaad.', 'pp.aakaaaakaad.', '..kklkklkklkkl.', '...kkkkkkkkk...'],
    ],
  } },
}

/** What runs on a machine beat by beat, over its two drawn poses: the saucer's rim lamps chase each other all the way round
 *  (one lamp in four lit, stepping a cell each beat), and the skiff's pennant streams on the wind. */
const LIVE: Partial<Record<WakePreset, (rows: readonly string[], beat: number) => readonly string[]>> = {
  beach: (rows, beat) => {
    const rim = rows.reduce((best, row, y) => [...row].filter(c => c === 'k').length > [...rows[best]!].filter(c => c === 'k').length ? y : best, 0)
    return rows.map((row, y) => y !== rim ? row : [...row].map((c, x) => c === 's' || c === 'a' ? ((x + beat) % 4 === 0 ? 's' : 'a') : c).join(''))
  },
  desert: (rows, beat) => flex(rows, { from: 0.72, amp: 1, wave: 0.9, rows: [0, 0.5] }, beat, BEATS),
}

/** A machine's physical push point and strength come from the same pose as its plates. Kept alongside the drawn frame. */
type MachineFrame = { rows: readonly string[]; push: { x: number; y: number; force: number }; lamp?: readonly [number, number] }
function machine(place: Exclude<WakePreset, 'city'>, tier: Tier, beat: number): MachineFrame {
  const { w, h } = MACHINE_SIZE[tier], kind = AUTOMATA[place], down = Math.floor(beat * kind.strokes / 4) % 2
  const drawn = Array.from({ length: h }, (_, y) => (kind.art[tier][down]![y] ?? '').padEnd(w, '.').slice(0, w))
  const rows = LIVE[place]?.(drawn, beat) ?? drawn
  const cells = rows.flatMap((row, y) => [...row].flatMap((ink, x) => ink === '.' ? [] : [[x, y, ink] as const]))
  // It pushes from the lowest cell of its trailing half (a fluke, a leg, a propeller); its lamp, if it carries one, is its first.
  const low = cells.filter(([x]) => x >= w >> 1).reduce((a, b) => b[1] > a[1] || b[1] === a[1] && b[0] > a[0] ? b : a)
  const lamp = cells.find(c => c[2] === 's')
  return { rows, push: { x: low[0], y: low[1], force: down ? 1 : 0.3 }, ...(lamp ? { lamp: [lamp[0], lamp[1]] as const } : {}) }
}

const machineFrames = (place: Exclude<WakePreset, 'city'>): Record<Tier, readonly MachineFrame[]> => {
  const frames = (tier: Tier) => Array.from({ length: BEATS }, (_, beat) => machine(place, tier, beat))
  return { 1: frames(1), 2: frames(2), 3: frames(3), 4: frames(4) }
}

const MACHINES = {
  harbor: machineFrames('harbor'),
  beach: machineFrames('beach'),
  mountains: machineFrames('mountains'),
  countryside: machineFrames('countryside'),
  forest: machineFrames('forest'),
  desert: machineFrames('desert'),
  tundra: machineFrames('tundra'),
}
const pictures = (classes: Record<Tier, readonly MachineFrame[]>): Record<Tier, Frames> => ({
  1: classes[1].map(f => f.rows), 2: classes[2].map(f => f.rows), 3: classes[3].map(f => f.rows), 4: classes[4].map(f => f.rows),
})
const CRAFT: Record<WakePreset, Record<Tier, Frames>> = {
  city: CITY_CRAFT, harbor: pictures(MACHINES.harbor), beach: pictures(MACHINES.beach), mountains: pictures(MACHINES.mountains),
  countryside: pictures(MACHINES.countryside), forest: pictures(MACHINES.forest), desert: pictures(MACHINES.desert), tundra: pictures(MACHINES.tundra),
}

/** The real push point of this pose, before mirroring. Wash lands below it; thrust starts one cell outside it. */
export const craftPush = (place: Exclude<WakePreset, 'city'>, tier: Tier, beat: number) => MACHINES[place][tier][((beat % BEATS) + BEATS) % BEATS]!.push
/** A machine's own lamp travels with its pose. */
export const craftLamp = (place: Exclude<WakePreset, 'city'>, tier: Tier, beat: number) => MACHINES[place][tier][((beat % BEATS) + BEATS) % BEATS]!.lamp

/** The machine built for this place and class; the city dragon is the default outside a landscape. */
export const craftFrames = (place: WakePreset | undefined, tier: Tier): Frames => CRAFT[place ?? 'city'][tier]

/** A mouth/prow on the actual frame: the dragon's jaw uses its wave; every other face has an eye immediately before glass. */
export function craftNose(place: WakePreset, tier: Tier, beat: number): readonly [number, number] {
  beat = ((beat % BEATS) + BEATS) % BEATS
  if (place === 'city') return [0, Math.max(0, Math.min(DRAGON[tier].h - 1, Math.round(dragonAt(tier, beat, DRAGON[tier].head - 0.5) - 1) + 2))]
  const art = CRAFT[place][tier][beat]!
  for (const [y, row] of art.entries()) {
    const eye = row.indexOf('Wg')
    if (eye >= 0) return [eye, y]
  }
  throw new Error(`Missing Codex face: ${place} class ${tier} beat ${beat}`)
}

/** Every design, for the rectangle, growth and animation checks. */
export const ALL_CRAFT = CRAFT

/** The middle of a turn, seen head on: each machine swings round through its own front view. (The dragon coils instead; the
 *  tug, the saucer and the probe do not turn.) */
export const turnPose: Partial<Record<WakePreset, Record<Tier, readonly string[]>>> = {
  mountains: { // the airship's round nose, its four fins and the gondola slung beneath
    1: ['.lll.', 'daWad', '.Wgk.'],
    2: ['...d...', '..lll..', '.daWad.', '..ddd..', '..Wgk..'],
    3: ['.....d.....', '...lllll...', '.d.laWad.d.', '...daaad...', '....ddd....', '....Wgk....'],
    4: ['.......d.......', '.....lllll.....', '....laaaaad....', '..d.aaWaaad.d..', '....daaaaad....', '.....ddddd.....', '......Wgk......'],
  },
  countryside: { // the drone nose on: a rotor either side of the pod, both lenses, the boom square across
    1: ['lllll', 'kWgWk', '.p.p.'],
    2: ['lll.lll', '.k...k.', '.dWgWd.', '.ppppp.', '..l.l..'],
    3: ['.lll...lll.', '..k.....k..', '..daWgWad..', '....dkd....', '.ppppppppp.', '..l..l..l..'],
    4: ['.lllll...lllll.', '...k.......k...', '...daaWgWaad...', '......dkd......', '.....k...k.....', '.ppppppppppppp.', '..l..l...l..l..'],
  },
  desert: { // the skiff bow on: its sail turned edge to you, one bright line above the prow and its two lamps
    1: ['..g..', 'sWgWs', '.dkd.'],
    2: ['...l...', '...g...', '...k...', '.sWgWs.', '..dkd..'],
    3: ['.....l.....', '.....g.....', '.....p.....', '.....k.....', '...sWgWs...', '....dkd....'],
    4: ['.......l.......', '.......g.......', '.......p.......', '.......g.......', '.......k.......', '....saWgWas....', '.....ddkdd.....'],
  },
  tundra: { // the snowcat's wide cab, a headlamp at each side, the plough right across, a track at each end
    1: ['..r..', 'sWgWs', 'kpppk'],
    2: ['...r...', '.lWgWl.', '.saaas.', 'kpppppk', 'k.....k'],
    3: ['.....r.....', '...lllll...', '...aWgWa...', '..saaaaas..', '.kkpppppkk.', '.kk.....kk.'],
    4: ['.......r.......', '....lllllll....', '....aWgggWa....', '...saaaaaaas...', '...aaakkkaaa...', '..kkpppppppkk..', '..kk.......kk..'],
  },
}

/** The dragon at rest: coiled down on a rooftop, its head laid on its own loops and the tail blade still showing. The other
 *  machines simply stop where they stand or float. */
export const rest: Partial<Record<WakePreset, Record<Tier, readonly string[]>>> = {
  city: {
    1: ['.kl..', 'aWdl.', 'ddddW'],
    2: ['...kll...', '.kldddl..', 'aWad.dl.W', 'ddadlldl.', '.ddddd...'],
    3: ['.....kllk......', '....ldddddl....', '.k.ld.ll.dl....', 'aWald.ldl.dl..W', 'ddadd.ldlldd.l.', '.dddllddddd....'],
    4: ['...................', '......kllllk.......', '.....ldddddddl.....', '.k..ld..lll..dl....', 'aWalld.ldddl..dl..W', 'ddaddd.ld..dllld.l.', '.ddddllddddddddd...'],
  },
}
