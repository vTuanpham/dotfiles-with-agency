import type { WakePreset } from '../../types'
import type { Tier } from './design'

// Codex is the clockwork crew: every place has its own automaton, built of the same plated metal with a glass eye and a gear.
// Over the city the clockwork dragon (a generator, see `dragon` below: one design that grows from a small, slim whelp to a long
// plated one); elsewhere a hand-drawn machine animal that belongs there: a whale that spouts in the harbor, a jellyfish over the
// beach, an airship in the mountains, a bee over the fields, a spider on its thread in the forest, a scarab rolling a sun across the
// desert and a narwhal on the tundra. Four classes grow the same machine, each a rectangle inside CRAFT_MAX and larger than the
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
    for (let r = 0; r < n; r++) set(x, top + r, seam ? 'd' : r === 0 ? (plate === lit ? 'W' : 'l') : r === n - 1 && n > 1 ? 'd' : 'a')
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
  harbor: { name: 'whale', strokes: 1, art: { // it swims at the surface: the fluke beats, and it spouts on the upstroke
    1: [['.aa.a', 'Wgkaa', '.....'], ['.aa..', 'Wgkaa', '....a']],
    2: [['.W...a.', 'aaaa.a.', 'Wgakaa.', 'dddd...', '.......'], ['.......', 'aaaa...', 'Wgakaa.', 'dddd.a.', '.......']],
    3: [['..W........', '..W......a.', '.aaaaa...a.', 'Wgalakaaaa.', 'aaaaaaa....', '.dddd......'], ['...........', '...........', '.aaaaa.....', 'Wgalakaaaa.', 'aaaaaaa..a.', '.dddd....a.']],
    4: [
      ['..WWW..........', '...W.........a.', '..aaaaaaa....a.', 'aWgalalakaaaaa.', 'aaaaaaaaaaa....', '.ddddddd.......', '...............'],
      ['...............', '...............', '..aaaaaaa......', 'aWgalalakaaaaa.', 'aaaaaaaaaaa..a.', '.ddddddd.....a.', '...............'],
    ],
  } },
  beach: { name: 'jellyfish', strokes: 2, art: { // a glass bell that squeezes and opens, trailing wires tipped with lamps
    1: [['kWgaa', '.d.d.', '.....'], ['kWga.', '.aaa.', '.d.d.']],
    2: [['.laaad.', 'akWgaad', '.d.d.d.', '.s...s.', '.......'], ['..lad..', '.kWgad.', '.aaaaa.', '..d.d..', '..s.s..']],
    3: [['..laaaaad..', '.lakWgaaad.', '.aaaaaaaaa.', '..d.d.d.d..', '..d.s.d.s..', '..s...s....'], ['...laaad...', '..lakWgad..', '..aaaaaaa..', '...d.d.d...', '...d.d.d...', '...s.s.s...']],
    4: [
      ['....laaaaad....', '...lakWgaaad...', '...aaaaaaaaa...', '....d.d.d.d....', '....d.d.d.d....', '....s.d.s.d....', '......s...s....'],
      ['.....laaad.....', '....lakWgad....', '....aaaaaaa....', '.....aaaaa.....', '.....d.d.d.....', '.....d.d.d.....', '.....s.s.s.....'],
    ],
  } },
  mountains: { name: 'airship', strokes: 4, art: { // a ribbed hull, a gondola with its porthole, and a propeller that spins
    1: [['.ll..', 'aaadk', '.Wg..'], ['.llk.', 'aaad.', '.Wg..']],
    2: [['.llll..', 'aWaaadk', '.dddd..', '.kWg...', '.......'], ['.llllk.', 'aaaWad.', '.ddddk.', '.kWg...', '.......']],
    3: [['...........', '..llllll...', '.alalalaad.', 'aaWaaaaaadk', '.ddddddddd.', '...kWgk....'], ['...........', '..llllll...', '.alalalaadk', 'aaaaaWaaad.', '.dddddddddk', '...kWgk....']],
    4: [
      ['...............', '...llllllll....', '.aalalalalaaad.', 'aaaWaaaaaaaaadk', '.ddddddddddddd.', '....kWgk.......', '.....s.........'],
      ['...............', '...llllllll....', '.aalalalalaaadk', 'aaaaaaaWaaaaad.', '.dddddddddddddk', '....kWgk.......', '.....s.........'],
    ],
  } },
  countryside: { name: 'bee', strokes: 4, art: { // feelers, a brass-and-iron striped abdomen, six legs, a sting, and glass wings that whirr
    1: [['.W.W.', 'Wgskd', '.....'], ['.....', 'Wgskd', '.W.W.']],
    2: [['..W.W..', 'k.lWl..', 'Wgasksd', '.dask..', '.......'], ['.......', 'k.WWW..', 'Wgasksd', '.dask..', '.......']],
    3: [['...WW.WW...', 'k...lWl....', '.kasksks...', 'Wgasksksd..', '.dasksk....', '..k..k.....'], ['...........', 'k..WWWWW...', '.kasksks...', 'Wgasksksd..', '.dasksk....', '...k..k....']],
    4: [
      ['....WW...WW....', 'k....lW.Wl.....', '.kaaasksksks...', 'Wgaaasksksksad.', '.daaasksksks...', '..k..k..k......', '...............'],
      ['...............', 'k....WWWWWW....', '.kaaasksksks...', 'Wgaaasksksksad.', '.daaasksksks...', '...k..k..k.....', '...............'],
    ],
  } },
  forest: { name: 'spider', strokes: 2, art: { // it hangs on its own thread, face on: two glass eyes and eight legs that reach and tuck
    1: [['..d..', 'kWgak', '.....'], ['..d..', '.Wga.', 'k.d.k']],
    2: [['...d...', 'k.lal.k', 'kWgagWk', '..ddd..', '.......'], ['...d...', '..lal..', 'kWgagWk', 'k.ddd.k', '.......']],
    3: [['.....d.....', '.k.k.d.k.k.', 'k.klaaalk.k', 'k.kWgagWk.k', '...ddddd...', '...........'], ['.....d.....', '.....d.....', '.k.laaal.k.', 'k.kWgagWk.k', 'k..ddddd..k', '...........']],
    4: [
      ['.......d.......', '.k..k..d..k..k.', 'k.k.klaaalk.k.k', 'k..kaWgagWak..k', '....kaaaaak....', '.....ddddd.....', '...............'],
      ['.......d.......', '.......d.......', '.k.k.laaal.k.k.', 'k.k.aWgagWa.k.k', 'k..k.aaaaa.k..k', '.....ddddd.....', '...............'],
    ],
  } },
  desert: { name: 'scarab', strokes: 2, art: { // it rolls a glowing sun ahead of it: the sun turns, the legs paddle
    1: [['s.a..', 'sWgkd', '.....'], ['..a..', 'sWgkd', 's....']],
    2: [['sW.la..', 'ssWgkd.', '.s.k.k.', '.......', '.......'], ['ss.la..', 'ssWgkd.', '.W..k..', '.......', '.......']],
    3: [['.ss........', 'sWss.laaa..', 'ssssWgakad.', '.ss..dakd..', '.....k.k...', '...........'], ['.ss........', 'ssss.laaa..', 'ssssWgakad.', '.sW..dakd..', '......k.k..', '...........']],
    4: [
      ['..sss..........', '.sssWs..laaaa..', 'ssssssWgaakaad.', '.sssss.daakaad.', '..sss..k..k.k..', '...............', '...............'],
      ['..sss..........', '.sssss..laaaa..', 'ssssssWgaakaad.', '.sWsss.daakaad.', '..sss...k.k..k.', '...............', '...............'],
    ],
  } },
  tundra: { name: 'narwhal', strokes: 1, art: { // a long bright tusk, a plated body, and a fluke that beats
    1: [['....a', 'WWgka', '.....'], ['.....', 'WWgka', '....a']],
    2: [['......a', '...la.a', 'WWWgkaa', '...dd..', '.......'], ['.......', '...la..', 'WWWgkaa', '...dd.a', '......a']],
    3: [['...........', '.........a.', '....laa..a.', 'WWWaWgakaa.', '....dddd...', '...........'], ['...........', '...........', '....laa....', 'WWWaWgakaa.', '....dddd.a.', '.........a.']],
    4: [
      ['...............', '.............a.', '......laaaa..a.', 'WWWWWaWgaakaaa.', '.....ddddddd...', '...............', '...............'],
      ['...............', '...............', '......laaaa....', 'WWWWWaWgaakaaa.', '.....ddddddd.a.', '.............a.', '...............'],
    ],
  } },
}

/** A machine's physical push point and strength come from the same pose as its plates. Kept alongside the drawn frame. */
type MachineFrame = { rows: readonly string[]; push: { x: number; y: number; force: number }; lamp?: readonly [number, number] }
function machine(place: Exclude<WakePreset, 'city'>, tier: Tier, beat: number): MachineFrame {
  const { w, h } = MACHINE_SIZE[tier], kind = AUTOMATA[place], down = Math.floor(beat * kind.strokes / 4) % 2
  const rows = Array.from({ length: h }, (_, y) => (kind.art[tier][down]![y] ?? '').padEnd(w, '.').slice(0, w))
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
