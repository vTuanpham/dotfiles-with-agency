import type { WakePreset } from '../../types'

// Codex is the mechanical crew, and each place gives its machines a body of its own: what a person would actually build and
// fly there, drawn by hand rather than trimmed onto a generic drone. The city keeps the drones and blimps (it is a place of
// them); the harbor and beach have boats. Four classes grow the same machine in the footprints the sky slots assume: 5, 7, 13
// and 17 cells wide, and 2, 4, 4 and 4 rows tall. Sprite keys are crew.ts's: a body, W highlight, l light stripe, d shade or
// rope, s lamp, p bunting, h hull or wood. Each craft has two frames so its image moves.

type Frames = readonly (readonly string[])[]
type Tier = 1 | 2 | 3 | 4

/** Cells wide and rows tall of each class, which every craft keeps (a test holds them to it). */
export const CRAFT_SIZE: Record<Tier, { w: number; h: number }> = { 1: { w: 5, h: 2 }, 2: { w: 7, h: 4 }, 3: { w: 13, h: 4 }, 4: { w: 17, h: 4 } }

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
  mountains: PARAGLIDER,
  countryside: DUSTER,
  forest: AUTOGYRO,
  desert: SKIFF,
  tundra: SKIPLANE,
}

/** The Codex craft a place builds for a class, or undefined where the generic machine belongs (the city). */
export const craftFrames = (place: WakePreset | undefined, tier: Tier): Frames | undefined => place && CRAFT[place]?.[tier]

/** Every craft, for the test that holds them to their class's footprint. */
export const ALL_CRAFT = CRAFT
