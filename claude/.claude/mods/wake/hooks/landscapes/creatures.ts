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
  harbor: { name: 'dolphin', strokes: 1, face: 'left', art: { // it leaps: arched up out of the water, then nose down and fluke high
    1: [['kaad.', 'lW.ad', '...d.'], ['...dd', 'kaaa.', 'lW...']],
    2: [['...d...', 'kaaaaa.', 'lWWl.ad', '....d.d', '.......'], ['....d.d', '...d.ad', 'kaaaaa.', 'lWWl...', '.......']],
    3: [
      ['.....d.....', '..aaaaaa...', 'akaaaaaaa..', 'lWWWl.daa..', '........ad.', '.......d.dd'],
      ['.......d.dd', '.....d..ad.', '..aaaaaaa..', 'akaaaaaa...', 'lWWWWl.....', '...........'],
    ],
    4: [ // a dark eye, a pale beak and belly, a dorsal fin, a notched fluke
      ['.......dd......', '...aaaaaaaa....', '.akaaaaaaaaaa..', 'llWWWWl..daaa..', '...........aad.', '............ad.', '...........d.dd'],
      ['...........d.dd', '............ad.', '.......dd..aad.', '...aaaaaaaaaa..', '.akaaaaaaaaa...', 'llWWWWWl.......', '...............'],
    ],
  } },
  beach: { name: 'flamingo', strokes: 2, face: 'left', art: { // it wades: an S of neck, a bent black-tipped bill, one leg tucked, then a step and a bob of the head
    1: [['sa...', '.aad.', '..r..'], ['sa...', '.aad.', '.r.r.']],
    2: [['.sa....', 'k..a...', '..aalk.', '...rr..', '...r...'], ['sa.....', 'k..a...', '..aalk.', '..r.r..', '..r.r..']],
    3: [
      ['..laa......', '.ks..a.....', '....aalak..', '.....aadd..', '.....r.rr..', '.....r.....'],
      ['.laa.......', 'ks..a......', '....aalak..', '.....aadd..', '....r..r...', '...rr..r...'],
    ],
    4: [
      ['...laa.........', '..ks..a........', '......a........', '.....aalaaak...', '......aaaadd...', '.......r.rr....', '.......r.......'],
      ['..laa..........', '.ks..a.........', '......a........', '.....aalaaak...', '......aaaadd...', '......r..r.....', '.....rr..r.....'],
    ],
  } },
  mountains: { name: 'eagle', strokes: 1, face: 'left', art: { // white head and tail, a yellow bill, broad fingered wings held out to soar
    1: [['..d.k', 'sWaaW', '.d...'], ['.....', 'sWadk', '.daW.']],
    2: [['....k.k', '...ad..', 'sWaaaWW', '.ddad..', '.......'], ['.......', '.......', 'sWaaadk', '.daaaWW', '..dd...']],
    3: [
      ['......dkk..', '.....daa...', '.W..daa....', 'sWaaaaaaWW.', '..llaaadWW.', '....s.s....'],
      ['...........', '.W.........', 'sWaaaaaaWW.', '..ldaadaWW.', '....daak...', '.....dkk...'],
    ],
    4: [ // one long wing swept up to its dark tip, then driven down under the body; a pale breast, yellow talons, a white fan of tail
      ['.........dkk...', '.......daak....', '......daaa.....', '.WW..daaa......', 'sWWaaaaaaaaaWW.', '...lllaaaadWWW.', '......s.s......'],
      ['...............', '...............', '.WW............', 'sWWaaaaaaaaaWW.', '...ldaaaadaWWW.', '.....daaak.....', '......dakk.....'],
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
  desert: { name: 'fox', strokes: 2, face: 'left', art: { // a fennec at a trot: great dark-tipped ears, an amber eye, a pale chest, a brush with a white tip
    1: [['d..aW', 'saaa.', '.d.d.'], ['d..aW', 'saaa.', 'd...d']],
    2: [['d.d....', 'ksa..aW', '.aaaaa.', '.d.d.d.', '.......'], ['d.d....', 'ksa..aW', '.aaaaa.', '..d.d..', '.......']],
    3: [
      ['.d.d.......', '.a.a....aa.', 'kasaa..aaWW', '.laaaaaaad.', '..d.d..d.d.', '.d...dd...d'],
      ['.d.d.......', '.a.a....aa.', 'kasaa..aaWW', '.laaaaaaad.', '...dd..dd..', '...d...d...'],
    ],
    4: [
      ['..d.d..........', '..a.a.......aa.', 'kaasaaa...aaaWW', '.llaaaaaaaaaad.', '...laaaaaaad...', '...d.d...d.d...', '..d...d.d...d..'],
      ['..d.d..........', '..a.a.......aa.', 'kaasaaa...aaaWW', '.llaaaaaaaaaad.', '...laaaaaaad...', '....dd....dd...', '.....d....d....'],
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
