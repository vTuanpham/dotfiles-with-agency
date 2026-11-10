import type { WakePreset } from '../../types'
import type { Tier } from './design'
import { flex, type Flex } from './flex'

// Claude's crew is alive: a different rose-plumaged creature for each place, not one bird in eight coats. Each is a shape you can
// name at a glance (a pelican's bill and pouch, a flamingo's neck and legs, a butterfly's wings, an owl's face), hand-drawn in the
// family's few tones with a bright eye, and each beats its wings at its own rate: the eagle soars, the dragonfly whirrs.
// Letters: a body, l light, d shade, k dark, W white, s the bright eye, bill or feet.
type Frames = readonly (readonly string[])[]
type Point = readonly [number, number]
type Pose = { rows: readonly string[]; beak: Point; feather: { x: number; y: number; force: number } }
type Species = Record<Tier, Frames>

/** At night the body darkens with the sky; the eye (and a bright bill or foot) still catches the light. */
export const emissive = 's'
export const CREATURE_BEATS = 12
export const CREATURE_SIZE: Record<Tier, { w: number; h: number }> = {
  1: { w: 5, h: 3 }, 2: { w: 7, h: 5 }, 3: { w: 11, h: 6 }, 4: { w: 15, h: 7 },
}

/** One creature: its wings up and its wings down in each class, how many strokes fit the twelve-pose loop, and where its face is. */
/** The parts that move freely between the drawn strokes: the eagle's fanned tail, the fox's brush and
 *  the puffin's trailing feet stream and sway on every beat. */
const LOOSE: Partial<Record<WakePreset, Flex>> = {
  mountains: { from: 0.78, amp: 1, wave: 0.5 },
  desert: { from: 0.68, amp: 1.3, wave: 0.6, rows: [0, 0.6] },
  tundra: { from: 0.7, amp: 1, wave: 0.7 },
}

type Creature = { name: string; strokes: 1 | 2 | 3 | 6; face: 'left' | 'centre'; art: Record<Tier, readonly [up: readonly string[], down: readonly string[], mid?: readonly string[]]> }
/** With a middle pose the stroke runs up, level, down, level: the wing passes through the body's line instead of jumping it. */
const STROKE = [0, 2, 1, 2] as const

const CREATURES: Record<WakePreset, Creature> = {
  city: { name: 'bat', strokes: 3, face: 'centre', art: { // seen face on: two ears, two lit eyes, and thin wings whose scalloped edge hangs from the finger bones
    1: [['d...d', 'asWsa', '..d..'], ['.....', 'dsWsd', 'a.d.a']],
    2: [
      ['k.....k', 'adk.kda', '.dsasd.', '...W...', '.......'],
      ['.......', '..k.k..', '.dsasd.', 'ad.W.da', 'k.....k'],
      ['.......', '..k.k..', 'adsasda', 'a..W..a', '.......'],
    ],
    3: [
      ['k.........k', 'ad..k.k..da', '.addsasdda.', '..a.aWa.a..', '.....d.....', '...........'],
      ['...........', '....k.k....', '.addsasdda.', 'aa.aaWaa.aa', 'a.a..d..a.a', 'k.........k'],
      ['...........', '....k.k....', 'aaddsasddaa', 'a.a.aWa.a.a', '.....d.....', '...........'],
    ],
    4: [
      ['k.............k', 'ak....k.k....ka', 'aad...aaa...daa', '.aadddsasdddaa.', '..a.a.aWa.a.a..', '.......d.......', '...............'],
      ['...............', '......k.k......', '...dd.aaa.dd...', '.aadaasasaadaa.', 'aa.a..aWa..a.aa', 'a.a....d....a.a', 'k.............k'],
      ['...............', '......k.k......', '.aa...aaa...aa.', 'aaaddasasaddaaa', 'a.a.a.aWa.a.a.a', '.......d.......', '...............'],
    ],
  } },
  harbor: { name: 'crab', strokes: 2, face: 'centre', art: { // seen face on, on the quay: eyes on stalks, two claws that lift and snap, a marked shell, legs that scuttle
    1: [['d.s.d', '.aWa.', 'd...d'], ['..s..', 'daWad', '.d.d.']],
    2: [['d.....d', 'a.s.s.a', '.aaWaa.', 'd.aaa.d', '.d...d.'], ['.......', 'd.s.s.d', '.aaWaa.', '.daaad.', 'd.....d']],
    3: [
      ['dd.......dd', '.a..s.s..a.', '..aaaaaaa..', '.aalaWalaa.', 'd.daaaaad.d', '.d.d...d.d.'],
      ['...........', 'dd..s.s..dd', '.daaaaaaad.', '.aalaWalaa.', '.ddaaaaadd.', 'd.d.....d.d'],
    ],
    4: [
      ['.dd.........dd.', 'd..a..s.s..a..d', '.aa...a.a...aa.', '...aaaaaaaaa...', '..aaalaWalaaa..', '.d.ddaaaaadd.d.', 'd.d.d.....d.d.d'],
      ['...............', '.dd...s.s...dd.', '.aad..a.a..daa.', '...aaaaaaaaa...', '..aaalaWalaaa..', 'd.dddaaaaaddd.d', '.d.d.......d.d.'],
    ],
  } },
  beach: { name: 'flamingo', strokes: 2, face: 'left', art: { // it wades: an S of neck, a bent black-tipped bill, one leg tucked, then a step and a bob of the head
    1: [['sa...', '.aad.', '..r..'], ['sa...', '.aad.', '.r.r.']],
    2: [['ksa....', '..a....', '..aWad.', '...rr..', '...r...'], ['ksa....', '..a....', '..aWad.', '..r.r..', '..r.r..']],
    3: [
      ['.ksla......', '....a......', '....aWlaad.', '.....r.r...', '.....r.rr..', '.....r.....'],
      ['.ksla......', '....a......', '....aWlaad.', '.....r.r...', '....r..r...', '...rr..r...'],
    ],
    4: [
      ['..ksla.........', '.....a.........', '.....a.llll....', '.....aaWaaaad..', '........r.r....', '........r.rr...', '........r......'],
      ['..ksla.........', '.....a.........', '.....a.llll....', '.....aaWaaaad..', '........r.r....', '.......r..r....', '......rr..r....'],
    ],
  } },
  mountains: { name: 'eagle', strokes: 1, face: 'left', art: { // white head and tail, a yellow bill, broad fingered wings held out to soar
    1: [['..d.k', 'sWaaW', '.d...'], ['.....', 'sWadk', '.daW.']],
    2: [['....k.k', '...ad..', 'sWaaaWW', '.ddad..', '.......'], ['.......', '.......', 'sWaaadk', '.daaaWW', '..dd...']],
    3: [
      ['......dkk..', '.....daa...', '.W..daa....', 'sWaaaaaaWW.', '..llaaadWW.', '....s.s....'],
      ['...........', '.W.........', 'sWaaaaaaWW.', '..ldaadaWW.', '....daak...', '.....dkk...'],
      ['...........', '...........', '.W...daak..', 'sWaaaaaaWW.', '..llaaadWW.', '....s.s....'],
    ],
    4: [ // one long wing swept up to its dark tip, then driven down under the body; a pale breast, yellow talons, a white fan of tail
      ['.........dkk...', '.......daak....', '......daaa.....', '.WW..daaa......', 'sWWaaaaaaaaaWW.', '...lllaaaadWWW.', '......s.s......'],
      ['...............', '...............', '.WW............', 'sWWaaaaaaaaaWW.', '...ldaaaadaWWW.', '.....daaak.....', '......dakk.....'],
      ['...............', '...............', '...............', '.WW....daaak...', 'sWWaaaaaaaaaWW.', '...lllaaaadWWW.', '......s.s......'],
    ],
  } },
  countryside: { name: 'butterfly', strokes: 3, face: 'centre', art: { // seen face on: two pairs of wings that open wide and shut
    1: [['l.s.l', 'aadaa', 'd...d'], ['..s..', '.ada.', '.....']],
    2: [['.k...k.', 'lW.s.Wl', 'aaadaaa', '.dadad.', '.......'], ['.k...k.', '.W.s.W.', '.aadaa.', '..dad..', '.......']],
    3: [['...k...k...', 'll..k.k..ll', 'laWl.s.lWal', 'daaa.d.aaad', '.laa.d.aal.', '..d.....d..'], ['...k...k...', '....k.k....', '..Wl.s.lW..', '..aa.d.aa..', '..la.d.al..', '...........'], ['...k...k...', '.l..k.k..l.', '.aWl.s.lWa.', '.aaa.d.aaa.', '..la.d.al..', '...........']],
    4: [
      ['.....k...k.....', '.lll..k.k..lll.', 'laWal..s..laWal', 'laaaal.d.laaaal', '.daaad.d.daaad.', '..laad.d.daal..', '...dd.....dd...'],
      ['.....k...k.....', '...ll.k.k.ll...', '...lWl.s.lWl...', '...laa.d.aal...', '...daa.d.aad...', '....ld.d.dl....', '...............'],
      ['.....k...k.....', '..ll..k.k..ll..', '.laWl..s..lWal.', '.laaal.d.laaal.', '..daad.d.daad..', '...lad.d.dal...', '....d.....d....'],
    ],
  } },
  forest: { name: 'owl', strokes: 2, face: 'centre', art: { // seen face on: two round eyes, ear tufts, broad silent wings
    1: [['l.a.l', '.sWs.', '..d..'], ['..a..', 'lsWsl', 'd.d.d']],
    2: [['l.k.k.l', '.lsasl.', '..aWa..', '..ldl..', '.......'], ['..k.k..', '..sas..', 'laaWaal', 'd.ldl.d', '.......']],
    3: [['l...k.k...l', '.ll.aaa.ll.', '..alsasla..', '...aaWaa...', '....lll....', '....k.k....'], ['....k.k....', '....aaa....', '.llasasall.', 'laaaaWaaaal', 'd.d.lll.d.d', '....k.k....'], ['....k.k....', '....aaa....', 'lllasasalll', '.aaaaWaaaa.', '....lll....', '....k.k....']],
    4: [
      ['ll...k...k...ll', '.lll.aaaaa.lll.', '..aalasasalaa..', '...aaaaWaaaa...', '....dalllad....', '.....aldla.....', '......k.k......'],
      ['.....k...k.....', '.....aaaaa.....', '..lllasasalll..', '.laaaaaWaaaaal.', 'laa.dalllad.aal', 'd.d..aldla..d.d', '......k.k......'],
      ['.....k...k.....', '.....aaaaa.....', '.lllaasasaalll.', 'laaaaaaWaaaaaal', '....dalllad....', '.....aldla.....', '......k.k......'],
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
  const { w, h } = CREATURE_SIZE[tier], kind = CREATURES[place]
  const at = kind.art[tier][2] ? STROKE[Math.floor(beat * kind.strokes / 3) % 4]! : Math.floor(beat * kind.strokes / 6) % 2, down = at === 1 ? 1 : at === 2 ? 0.5 : 0
  const rows = flex(Array.from({ length: h }, (_, y) => (kind.art[tier][at]![y] ?? '').padEnd(w, '.').slice(0, w)), LOOSE[place], beat, CREATURE_BEATS)
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

/** The middle of a turn, seen head on: each creature comes round through its own front view. (The butterfly and the owl are
 *  already face on and do not turn.) */
export const turnPose: Partial<Record<WakePreset, Record<Tier, readonly string[]>>> = {
  beach: { // the flamingo face on: almost nothing but a neck, a body and two legs
    1: ['.ksk.', '.aaa.', '.r.r.'],
    2: ['..ksk..', '...a...', '..aaa..', '..r.r..', '..r.r..'],
    3: ['.....a.....', '....ksk....', '.....a.....', '....aaa....', '....r.r....', '....r.r....'],
    4: ['.......a.......', '......ksk......', '.......a.......', '......aaa......', '.....aalaa.....', '......r.r......', '......r.r......'],
  },
  mountains: { // the eagle banking: the full span of both wings, dark tips up, the white head between
    1: ['k.W.k', 'dasad', '.....'],
    2: ['k.....k', 'daWsWad', '..dad..', '..s.s..', '.......'],
    3: ['k.........k', 'da..WWW..ad', '.aaaWsWaaa.', '...daaad...', '....s.s....', '...........'],
    4: ['...............', 'k.............k', 'dd....WWW....dd', '.aaad.WsW.daaa.', '...aaaaaaaaa...', '.....daaad.....', '......s.s......'],
  },
  desert: { // the fox stops and looks at you: both ears, both eyes, the brush curled round to one side
    1: ['d.d.W', 'sksa.', 'd.d..'],
    2: ['.d.d...', '.sks.W.', '.aaaa..', '.d.d...', '.......'],
    3: ['..d...d....', '..aaaaa..W.', '..sakas.a..', '...laaaa...', '...d.d.....', '...........'],
    4: ['...d.....d.....', '...aa...aa.....', '...aaaaaaa.....', '...asaaasa..aW.', '....lakal..aa..', '....laaal.aa...', '....d...d......'],
  },
  tundra: { // the puffin head on: a white front between dark sides, the bright bill in the middle, wings a blur
    1: ['.dsd.', 'dWWWd', '.s.s.'],
    2: ['..ddd..', '.dWsWd.', 'd.WWW.d', '..s.s..', '.......'],
    3: ['....ddd....', '...dWsWd...', '.d.dWWWd.d.', '...dWWWd...', '....s.s....', '...........'],
    4: ['...............', '......ddd......', '.....dWsWd.....', '.dd.dWWsWWd.dd.', '...ddWWWWWdd...', '.....WWWWW.....', '......s.s......'],
  },
}

// The bat roosts upside down: its contact is the feet at the top of the sprite, so it hangs below the ledge.
export const restContact: Partial<Record<WakePreset, Record<Tier, Point>>> = {
  city: { 1: [1, 0], 2: [2, 0], 3: [4, 0], 4: [6, 0] },
}

/** How each creature rests when its worker waits: perched, standing, curled up or asleep on one leg. */
export const rest: Partial<Record<WakePreset, Record<Tier, readonly string[]>>> = {
  city: { // hanging by its feet, wings wrapped round it, ears down, eyes still open
    1: ['.rdr.', '.sas.', '.k.k.'],
    2: ['..r.r..', '..dad..', '..sas..', '..kWk..', '.......'],
    3: ['....r.r....', '....dad....', '...daaad...', '....sas....', '....kWk....', '...........'],
    4: ['......r.r......', '......ddd......', '.....daaad.....', '.....daaad.....', '......sas......', '......aWa......', '......k.k......'],
  },
  beach: { // the flamingo asleep: its head laid back into its feathers, balanced on one leg
    1: ['.aa..', '.aad.', '..r..'],
    2: ['.......', '..aa...', '.asadk.', '...r...', '...r...'],
    3: ['...........', '.....aa....', '....asaak..', '.....aadd..', '.....r.....', '.....r.....'],
    4: ['...............', '...............', '.......aaa.....', '.....aasaaak...', '......aaaadd...', '.......r.......', '.......r.......'],
  },
  forest: { // the owl perched upright, wings folded, still watching
    1: ['.sWs.', '.aaa.', '.k.k.'],
    2: ['..k.k..', '.asWsa.', '.dalad.', '..k.k..', '.......'],
    3: ['....k.k....', '....aaa....', '...asWsa...', '...alllad..', '....ada....', '....k.k....'],
    4: ['.....k...k.....', '.....aaaaa.....', '....asaWasa....', '....aalllaa....', '....daldlad....', '.....aldla.....', '......k.k......'],
  },
  desert: { // the fox curled asleep, its brush laid over its nose
    1: ['.....', 'd.aa.', 'kWaad'],
    2: ['.......', '.......', 'd.aaa..', 'kaWaaa.', '.laad..'],
    3: ['...........', '...........', '...........', '.d.d.aaa...', 'kakaaaaad..', '.WWddddd...'],
    4: ['...............', '...............', '...............', '...d.d..aaaa...', '...aaaaaaaaaad.', '.kakaaaaaaaadd.', '..WWdddddddd...'],
  },
  tundra: { // the puffin standing on its bright feet
    1: ['sWd..', '.Wdd.', '.s.s.'],
    2: ['.dd....', 'sWdd...', '.WWdd..', '..s.s..', '.......'],
    3: ['...........', '..dd.......', 'ssWdd......', '..WWdd.....', '..WWddd....', '...s.s.....'],
    4: ['...............', '....ddd........', '..ssaWdd.......', '....WWddd......', '....WWWddd.....', '....WWWdddd....', '.....s.s.......'],
  },
}
