import type { WakePreset } from '../../types'
import type { Tier } from './design'

// Claude's crew is alive: a different rose-plumaged creature for each place, not one bird in eight coats. Each is a shape you can
// name at a glance (a pelican's bill and pouch, a flamingo's neck and legs, a butterfly's wings, an owl's face), hand-drawn in the
// family's few tones with a bright eye, and each beats its wings at its own rate: the eagle soars, the dragonfly whirrs.
// Letters: a body, l light, d shade, k dark, W white, s the bright eye, bill or feet.
type Frames = readonly (readonly string[])[]
type Point = readonly [number, number]
type Pose = { rows: readonly string[]; beak: Point; feather: { x: number; y: number; force: number } }
type Species = Record<Tier, Frames>

export const CREATURE_BEATS = 12
export const CREATURE_SIZE: Record<Tier, { w: number; h: number }> = {
  1: { w: 5, h: 3 }, 2: { w: 7, h: 5 }, 3: { w: 11, h: 6 }, 4: { w: 15, h: 7 },
}

/** One creature: its wings up and its wings down in each class, how many strokes fit the twelve-pose loop, and where its face is. */
type Creature = { name: string; strokes: 1 | 2 | 3 | 6; face: 'left' | 'centre'; art: Record<Tier, readonly [up: readonly string[], down: readonly string[]]> }

const CREATURES: Record<WakePreset, Creature> = {
  city: { name: 'pigeon', strokes: 3, face: 'left', art: { // plump and small-headed, beating fast
    1: [['..l..', 'saaad', '.dd..'], ['.....', 'saaad', '.ld..']],
    2: [['...ll..', '.s.la..', 'Waaaaad', '.daadd.', '.......'], ['.......', '.s.....', 'Waaaaad', '.dlaad.', '...ld..']],
    3: [['.....ll....', '....lda....', '.sa.lda....', 'Wkaaaadaadk', '.llaaaadd..', '...lll.....'], ['...........', '.sa........', 'Wkaaaaaaadk', '.llldaadd..', '....lda....', '.....ld....']],
    4: [ // a dark collar, two wing bars, a pale belly and a banded tail
      ['.......ll......', '......lda......', '.sa...lad......', 'Wkaa.ldaa....k.', '.aaaaaadaaaadk.', '..llaaaaaddd...', '....lllld......'],
      ['...............', '.sa............', 'Wkaaaaaaa....k.', '.aaaaadaaaaadk.', '..llldadaddd...', '.....ldad......', '......ld.......'],
    ],
  } },
  harbor: { name: 'pelican', strokes: 2, face: 'left', art: { // a great bill with its yellow pouch, on slow heavy wings
    1: [['..l..', 'Wsaad', '.sd..'], ['.....', 'Wsaad', '.sld.']],
    2: [['...ll..', '.s.la..', 'WWaaaad', '.sdadd.', '.......'], ['.......', '.s.....', 'WWaaaad', '.sdlad.', '...ld..']],
    3: [['......kk...', '.sa..lka...', 'WWaa.laa...', '.ssaaaaaaak', '..llaaadd..', '....lld....'], ['...........', '.sa........', 'WWaaaaaaa..', '.ssaaaaaaak', '..lldaadd..', '....lkk....']],
    4: [ // black wing tips and a pale breast
      ['.........kk....', '........lka....', '..sa...llaa....', 'WWWaa.laaaa....', '.sssaaaaaaaaak.', '...llaaaaaadd..', '.....llldd.....'],
      ['...............', '..sa...........', 'WWWaaaaaaaa....', '.sssaaaaaaaaak.', '...lldlaaadd...', '.....llak......', '......lkk......'],
    ],
  } },
  beach: { name: 'flamingo', strokes: 2, face: 'left', art: { // all neck and trailing legs, with a bent bill and black wing tips
    1: [['..l..', 'Waadd', 'k....'], ['.....', 'Waadd', 'k.l..']],
    2: [['...kl..', '.s.la..', 'Waaaadd', 'k..d...', '.......'], ['.......', '.s.....', 'Waaaadd', 'k..la..', '...lk..']],
    3: [['......kl...', '.s...lla...', 'Waaaaaaaddd', 'k...ddaa..d', '...........', '...........'], ['...........', '.s.........', 'Waaaaaaaddd', 'k...dlaa..d', '.....lla...', '......lk...']],
    4: [
      ['........kl.....', '.......lla.....', '.s.....laa.....', 'Waaaaaaaaaadddd', 'k.....ddaa....d', '...............', '...............'],
      ['...............', '.s.............', 'Waaaaaaaaaadddd', 'k.....dlaa....d', '.......lla.....', '........lk.....', '...............'],
    ],
  } },
  mountains: { name: 'eagle', strokes: 1, face: 'left', art: { // white head and tail, a yellow bill, broad fingered wings held out to soar
    1: [['..d.k', 'sWaaW', '.d...'], ['.....', 'sWadk', '.daW.']],
    2: [['....k.k', '...ad..', 'sWaaaWW', '.ddad..', '.......'], ['.......', '.......', 'sWaaadk', '.daaaWW', '..dd...']],
    3: [['.......k.k.', '......ddd..', '.W..aaad...', 'sWaaaaaaaWW', '..ddaaadW..', '....dd.....'], ['...........', '...........', '.W...aaadkk', 'sWaaaaaadk.', '..daaaaaaWW', '...dddd.W..']],
    4: [
      ['..........k.k.k', '.........ddddd.', '.......aaaad...', '.WW..aaaaa.....', 'sWWaaaaaaaaaWWW', '...ddaaaaaddWW.', '.....dddd......'],
      ['...............', '...............', '.WW....aaaadk.k', 'sWWaaaaaaaaddk.', '...daaaaaaaaWWW', '....dddddd.WW..', '...............'],
    ],
  } },
  countryside: { name: 'butterfly', strokes: 3, face: 'centre', art: { // seen face on: two pairs of wings that open wide and shut
    1: [['l.s.l', 'aadaa', 'd...d'], ['..s..', '.ada.', '.....']],
    2: [['.k...k.', 'lW.s.Wl', 'aaadaaa', '.dadad.', '.......'], ['.k...k.', '.W.s.W.', '.aadaa.', '..dad..', '.......']],
    3: [['...k...k...', 'll..k.k..ll', 'laWl.s.lWal', 'daaa.d.aaad', '.laa.d.aal.', '..d.....d..'], ['...k...k...', '....k.k....', '..Wl.s.lW..', '..aa.d.aa..', '..la.d.al..', '...........']],
    4: [
      ['.....k...k.....', '.lll..k.k..lll.', 'laWal..s..laWal', 'laaaal.d.laaaal', '.daaad.d.daaad.', '..laad.d.daal..', '...dd.....dd...'],
      ['.....k...k.....', '...ll.k.k.ll...', '...lWl.s.lWl...', '...laa.d.aal...', '...daa.d.aad...', '....ld.d.dl....', '...............'],
    ],
  } },
  forest: { name: 'owl', strokes: 2, face: 'centre', art: { // seen face on: two round eyes, ear tufts, broad silent wings
    1: [['l.a.l', '.sWs.', '..d..'], ['..a..', 'lsWsl', 'd.d.d']],
    2: [['l.k.k.l', '.lsasl.', '..aWa..', '..ldl..', '.......'], ['..k.k..', '..sas..', 'laaWaal', 'd.ldl.d', '.......']],
    3: [['l...k.k...l', '.ll.aaa.ll.', '..alsasla..', '...aaWaa...', '....lll....', '....k.k....'], ['....k.k....', '....aaa....', '.llasasall.', 'laaaaWaaaal', 'd.d.lll.d.d', '....k.k....']],
    4: [
      ['ll...k...k...ll', '.lll.aaaaa.lll.', '..aalasasalaa..', '...aaaaWaaaa...', '....dalllad....', '.....aldla.....', '......k.k......'],
      ['.....k...k.....', '.....aaaaa.....', '..lllasasalll..', '.laaaaaWaaaaal.', 'laa.dalllad.aal', 'd.d..aldla..d.d', '......k.k......'],
    ],
  } },
  desert: { name: 'dragonfly', strokes: 6, face: 'left', art: { // a long jointed needle under four whirring glass wings
    1: [['.W.W.', 'sakad', '.....'], ['.....', 'sakad', '.W.W.']],
    2: [['.W..W..', '..ll...', 'saakdad', '.......', '.......'], ['.......', '.......', 'saakdad', '..ll...', '.W..W..']],
    3: [['..W....W...', '...l..l....', 'ssaakadadad', '.s.........', '...........', '...........'], ['...........', '...........', 'ssaakadadad', '.s.l..l....', '..W....W...', '...........']],
    4: [
      ['..WW.....WW....', '...ll...ll.....', '....ll.ll......', 'ssaaakkadadadad', '.s.............', '...............', '...............'],
      ['...............', '...............', '...............', 'ssaaakkadadadad', '.s..ll.ll......', '...ll...ll.....', '..WW.....WW....'],
    ],
  } },
  tundra: { name: 'puffin', strokes: 6, face: 'left', art: { // stout, dark-backed and white-fronted, a bright bill and feet, wings a blur
    1: [['.d.d.', 'sWdd.', '.WWs.'], ['.d...', 'sWdd.', '.WdWs']],
    2: [['...dd..', '.dd.d..', 'sWdddd.', '.WWWWs.', '.......'], ['.......', '.dd....', 'sWdddd.', '.WWdWs.', '...dd..']],
    3: [['.....dd....', '.dd..dl....', 'ssWdddddd..', '.sWWWWWWdd.', '..WWWWW.s..', '...........'], ['...........', '.dd........', 'ssWdddddd..', '.sWWddWWdd.', '..WWdl..s..', '....dd.....']],
    4: [
      ['.......dd......', '......ddl......', '..ddd.dd.......', 'ssaWWdddddd....', '.sWWWaWWWWddd..', '...WWWWWWW.ss..', '....WWWWW......'],
      ['...............', '..ddd..........', 'ssaWWdddddd....', '.sWWWaWWWWddd..', '...WWddWWW.ss..', '....WWddl......', '.......dd......'],
    ],
  } },
}

function pose(place: WakePreset, tier: Tier, beat: number): Pose {
  const { w, h } = CREATURE_SIZE[tier], kind = CREATURES[place], down = Math.floor(beat * kind.strokes / 6) % 2
  const rows = Array.from({ length: h }, (_, y) => (kind.art[tier][down]![y] ?? '').padEnd(w, '.').slice(0, w))
  const cells = rows.flatMap((row, y) => [...row].flatMap((ink, x) => ink === '.' ? [] : [[x, y, ink] as const]))
  const mid = w >> 1
  // The face: the foremost cell of a creature in profile, the eye or bill on the centre line of one seen face on.
  const beak = kind.face === 'centre' ? cells.find(([x, , ink]) => x === mid && (ink === 's' || ink === 'W'))! : cells.reduce((a, b) => b[0] < a[0] ? b : a)
  // The loose feather falls from the lowest cell of the trailing half.
  const low = cells.filter(([x]) => x >= mid).reduce((a, b) => b[1] > a[1] ? b : a)
  return { rows, beak: [beak[0], beak[1]], feather: { x: low[0], y: low[1], force: down } }
}

const poses = (place: WakePreset, tier: Tier) => Array.from({ length: CREATURE_BEATS }, (_, beat) => pose(place, tier, beat))
const species = (place: WakePreset) => ({ 1: poses(place, 1), 2: poses(place, 2), 3: poses(place, 3), 4: poses(place, 4) })
const POSES: Record<WakePreset, Record<Tier, readonly Pose[]>> = {
  city: species('city'), harbor: species('harbor'), beach: species('beach'), mountains: species('mountains'),
  countryside: species('countryside'), forest: species('forest'), desert: species('desert'), tundra: species('tundra'),
}
const frames = (place: WakePreset): Species => {
  const rows = (tier: Tier) => POSES[place][tier].map(p => p.rows)
  return { 1: rows(1), 2: rows(2), 3: rows(3), 4: rows(4) }
}
export const ALL_CREATURES: Record<WakePreset, Species> = {
  city: frames('city'), harbor: frames('harbor'), beach: frames('beach'), mountains: frames('mountains'),
  countryside: frames('countryside'), forest: frames('forest'), desert: frames('desert'), tundra: frames('tundra'),
}

const poseAt = (place: WakePreset, tier: Tier, beat: number) => POSES[place][tier][((Math.floor(beat) % CREATURE_BEATS) + CREATURE_BEATS) % CREATURE_BEATS]!
export const creatureNose = (place: WakePreset, tier: Tier, beat: number): Point => poseAt(place, tier, beat).beak
export const creatureStroke = (place: WakePreset, tier: Tier, beat: number) => poseAt(place, tier, beat).feather
export const creatureFrames = (place: WakePreset | undefined, tier: Tier): Frames => ALL_CREATURES[place ?? 'city'][tier]
