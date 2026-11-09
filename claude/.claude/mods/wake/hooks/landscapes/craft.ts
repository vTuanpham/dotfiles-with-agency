import type { WakePreset } from '../../types'

// Codex is the mechanical crew, and each place gives its machines a body of its own: what a person would actually build and
// fly there, drawn by hand rather than trimmed onto a generic drone: the city a courier drone, a parcel drone, a news helicopter
// and an advertising blimp; the harbor and beach have boats. Four classes grow the same machine, each a rectangle inside
// CRAFT_MAX and larger than the one before. Sprite keys are crew.ts's: a body, W highlight, l light stripe, d shade or rope,
// s lamp, p bunting, h hull or wood, r red (a beacon, a tail fin), g glass, k grey metal. Each craft has two or more frames so its
// image moves (the helicopter's rotor has four). What a craft stirs up, lights and trails is data in fx.ts, not drawn here.

type Frames = readonly (readonly string[])[]
type Tier = 1 | 2 | 3 | 4

/**
 * The room a sprite may take: the sky slots are 22 cells wide and the sky is ten rows, so no craft is wider than `w` or taller
 * than `h`. Each class draws larger than the one before; inside these limits a craft has the cells its own shape needs (a
 * helicopter wants a rotor, a mast, a cabin and skids: six rows). A test holds every craft to this.
 */
export const CRAFT_MAX = { w: 19, h: 7 }

/**
 * City: what a city actually flies. A courier drone, a delivery drone with its parcel on a tether, a news helicopter (rotor,
 * tail boom, a nose lamp that blinks) and an advertising blimp (fins, a gondola and a ticker that scrolls along its flank).
 * The helicopter's searchlight and the blimp's glow are the city aura's (aura.ts); the machines themselves stay solid pixels.
 */
const CITY_CRAFT: Record<Tier, Frames> = {
  // r is a red beacon: it blinks on the second frame of the helicopter and the drones
  1: [['ll.ll', '.aWa.', '..d..'], ['.l.l.', '.aWa.', '..r..']],
  2: [
    ['lll...lll', '.d.aaa.d.', '..aaWaa..', '....d....', '...hph...'],
    ['.l.....l.', '.d.ara.d.', '..aaWaa..', '....d....', '...hph...'],
  ],
  // the news helicopter: rotor with dark tips over a hub, an engine on the roof, tinted glass in the nose, a white livery
  // stripe, a red tail fin and a tail rotor that spins, a nose lamp, and skids on struts
  // four frames: the blades sweep long and short, left and right, and the tail rotor flicks between its two positions
  3: [
    ['.d' + 'l'.repeat(11) + 'd.', '.......k.......', '..llkkkll.....r', 'gggaaaaaaaaaaar', 'ggaWWWWWWaa...d', '.skddddddkd...d', '..kkkkkkkkkk...'],
    ['...d' + 'l'.repeat(7) + 'd...', '.......r.......', '..llkkkll.....r', 'gggaaaaaaaaaaar', 'ggaWWWWWWaa....', '.skddddddkd....', '..kkkkkkkkkk...'],
    ['..d' + 'l'.repeat(9) + 'd..', '.......k.......', '..llkkkll.....r', 'gggaaaaaaaaaaar', 'ggaWWWWWWaa...d', '.skddddddkd...d', '..kkkkkkkkkk...'],
    ['....d' + 'l'.repeat(5) + 'd....', '.......k.......', '..llkkkll.....r', 'gggaaaaaaaaaaar', 'ggaWWWWWWaa....', '.skddddddkd....', '..kkkkkkkkkk...'],
  ],
  4: [
    ['.................d.', '....lllllllllll.dd.', '.llaaaaaaaaaaaaaaad', 'aaaWsWsWsWsWsWsaadd', '.ddaaaaaaaaaaaaaadd', '....dddddddddd.dd..', '........kssk.......'],
    ['.................d.', '....lllllllllll.dd.', '.llaaaaaaaaaaaaaaad', 'aaasWsWsWsWsWsWaadW', '.ddaaaaaaaaaaaaaadd', '....dddddddddd.dd..', '........ksdk.......'],
  ],
}

/** Mountains: a paraglider. The canopy arches over a rider on lines that meet at the harness, and its stripes ripple. */
const PARAGLIDER: Record<Tier, Frames> = {
  1: [['.lal.', '..W..'], ['.ala.', '..W..']],
  2: [['.lalal.', 'a.....a', '..d.d..', '...W...'], ['.alala.', 'a.....a', '..d.d..', '...W...']],
  3: [['..lalalalal..', '.a.........a.', '....d...d....', '.....aWa.....'], ['..alalalala..', '.a.........a.', '....d...d....', '.....aWa.....']],
  4: [['...lalalalalal...', '..a...........a..', '.....d.....d.....', '.......aWa.......'], ['...alalalalala...', '..a...........a..', '.....d.....d.....', '.......aWa.......']],
}

/** Countryside: a crop duster seen from above, wings spread (a second, shorter pair on the bigger ones) and the propeller blurring. */
const DUSTER: Record<Tier, Frames> = {
  1: [['..W..', 'lllll'], ['.lWl.', 'lllll']],
  2: [['...W...', 'lllalll', '...a...', '..lal..'], ['..lWl..', 'lllalll', '...a...', '..lal..']],
  3: [['.....lWl.....', 'llllllallllll', '.lllllalllll.', '.....lal.....'], ['......W......', 'llllllallllll', '.lllllalllll.', '.....lal.....']],
  4: [['.......lWl.......', 'llllllllallllllll', '.lllllllalllllll.', '.......lal.......'], ['........W........', 'llllllllallllllll', '.lllllllalllllll.', '.......lal.......']],
}

/** Forest: an autogyro. A rotor turning (it blurs shorter and longer) over a wooden pod, with a lantern hung beneath. */
const AUTOGYRO: Record<Tier, Frames> = {
  1: [['lllll', '.aWa.'], ['.lll.', '.aWa.']],
  2: [['lllllll', '...d...', '..aWa..', '...s...'], ['.lllll.', '...d...', '..aWa..', '...p...']],
  3: [['lllllllllllll', '......d......', '....aaWaa....', '....d.s.d....'], ['..lllllllll..', '......d......', '....aaWaa....', '....d.p.d....']],
  4: [['lllllllllllllllll', '........d........', '.....aaaWaaa.....', '.....d..s..d.....'], ['..lllllllllllll..', '........d........', '.....aaaWaaa.....', '.....d..p..d.....']],
}

/** Desert: a sail-skiff, a lateen sail over a long hull with a pennant at the masthead, riding the heat. */
const SKIFF: Record<Tier, Frames> = {
  1: [['.lal.', 'hhhhh'], ['.ala.', 'hhhhh']],
  2: [['...p...', '..lal..', '.laaal.', 'hhhhhhh'], ['...d...', '..lal..', '.laaal.', 'hhhhhhh']],
  3: [['......p......', '.....lal.....', '...llaaall...', '.hhhhhhhhhhh.'], ['......d......', '.....lal.....', '...llaaall...', '.hhhhhhhhhhh.']],
  4: [['........p........', '.......lal.......', '....lllaaalll....', '.hhhhhhhhhhhhhhh.'], ['........d........', '.......lal.......', '....lllaaalll....', '.hhhhhhhhhhhhhhh.']],
}

/** Tundra: a bush plane on skis. A high wing, a tail fin, a propeller that blurs and runners to land on snow. */
const SKIPLANE: Record<Tier, Frames> = {
  1: [['.lll.', 'daaaW'], ['.lll.', 'daaa.']],
  2: [['d.lllll', 'daaaWaW', '..d..d.', '.ddddd.'], ['d.lllll', 'daaaWad', '..d..d.', '.ddddd.']],
  3: [['d...lllllllll', 'daaaaaaaWaaaW', '....d.....d..', '.ddddddddddd.'], ['d...lllllllll', 'daaaaaaaWaaad', '....d.....d..', '.ddddddddddd.']],
  4: [['d.....lllllllllll', 'daaaaaaaaaaaWaaaW', '.....d.......d...', '.ddddddddddddddd.'], ['d.....lllllllllll', 'daaaaaaaaaaaWaaad', '.....d.......d...', '.ddddddddddddddd.']],
}

const CRAFT: Partial<Record<WakePreset, Record<Tier, Frames>>> = {
  city: CITY_CRAFT,
  mountains: PARAGLIDER,
  countryside: DUSTER,
  forest: AUTOGYRO,
  desert: SKIFF,
  tundra: SKIPLANE,
}

/** The Codex craft a place builds for a class. A place with none of its own (the harbor and beach float boats, and send only
 *  a crowded sky's overflow aloft) lends the city's machines, which are the ones that fly anywhere. */
export const craftFrames = (place: WakePreset | undefined, tier: Tier): Frames => (place && CRAFT[place]?.[tier]) || CITY_CRAFT[tier]

/** Every craft, for the test that holds them to their class's footprint. */
export const ALL_CRAFT = CRAFT
