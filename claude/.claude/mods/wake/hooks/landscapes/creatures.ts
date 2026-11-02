import type { WakePreset } from '../../types'

// Claude's workers (its subagents, and Bridge jobs on the Claude backend) are the winged things of each place, not one bird
// everywhere. They keep the family's pink and the footprints of the generic birds (3, 7, 13 and 17 cells wide, 2, 3, 4 and 4
// rows tall) so the sky slots do not change, and each has two frames so it flaps, flutters or sways. Sprite keys are
// crew.ts's: a the family colour, W white, l light, d shadow, s yellow (an eye), h wood.
//
//   city         pigeon      round body, fanned tail
//   harbor       gull        long thin wings with dark tips
//   beach        kite        a pink diamond on a string, its tail whipping
//   mountains    eagle       broad wings with feathered tips and a hooked beak
//   countryside  butterfly   four wing lobes that open and close
//   forest       owl         a wide face with two yellow eyes
//   desert       dragonfly   a long body and four slim wings
//   tundra       snowy owl   the owl, white and speckled
// To add or change one: draw its eight frames (two for each class) here and name the place; a test holds the footprints.

type Frames = readonly (readonly string[])[]
type Tier = 1 | 2 | 3 | 4
type Species = Record<Tier, Frames>

/** Cells wide and rows tall of each class: the generic birds', which every creature keeps (a test holds them to it). */
export const CREATURE_SIZE: Record<Tier, { w: number; h: number }> = { 1: { w: 3, h: 2 }, 2: { w: 7, h: 3 }, 3: { w: 13, h: 4 }, 4: { w: 17, h: 4 } }

const PIGEON: Species = {
  1: [['a.a', '.d.'], ['.a.', 'a.a']],
  2: [['a..W..a', '.aaaaa.', '..ddd..'], ['...W...', 'aaaaaaa', '.a.d.a.']],
  3: [['aa.........aa', '.aaa..W..aaa.', '..aaaaaaaaa..', '....dd.dd....'], ['.............', 'aaa...W...aaa', '.aaaaaaaaaaa.', '...a.ddd.a...']],
  4: [['aaa...........aaa', '.aaaa...W...aaaa.', '..aaaaaaaaaaaaa..', '.....dd...dd.....'], ['.................', 'aaaa....W....aaaa', '.aaaaaaaaaaaaaaa.', '...a...ddd...a...']],
}

const GULL: Species = {
  1: [['W.W', '.a.'], ['.W.', 'W.W']],
  2: [['d.....d', '.WW.WW.', '...a...'], ['.......', 'dWW.WWd', '...a...']],
  3: [['dd.........dd', '.WWW.....WWW.', '...WWWaWWW...', '......a......'], ['.............', 'ddWWW.a.WWWdd', '...WWWaWWW...', '......a......']],
  4: [['dd.............dd', '.WWWW.......WWWW.', '...WWWWWaWWWWW...', '........a........'], ['.................', 'ddWWWWW.a.WWWWWdd', '...WWWWWaWWWWW...', '........a........']],
}

const KITE: Species = {
  1: [['.a.', '.d.'], ['.a.', 'd..']],
  2: [['...a...', '..aWa..', '...d...'], ['...a...', '..aWa..', '..d....']],
  3: [['......a......', '....aaWaa....', '.....aaa.....', '......d..a...'], ['......a......', '....aaWaa....', '.....aaa.....', '....a..d.....']],
  4: [['........a........', '......aaWaa......', '.......aaa.......', '........d..a.....'], ['........a........', '......aaWaa......', '.......aaa.......', '......a..d.......']],
}

const EAGLE: Species = {
  1: [['aaa', '.d.'], ['.a.', 'a.a']],
  2: [['la...al', '.aaWaa.', '..dsd..'], ['...W...', 'laaaaal', '..dsd..']],
  3: [['ll.........ll', '.lla.....all.', '..aaaaWaaaa..', '....ddsdd....'], ['.............', 'lllaa.W.aalll', '..aaaaWaaaa..', '....ddsdd....']],
  4: [['lll...........lll', '.llaa.......aall.', '..aaaaaaWaaaaaa..', '......ddsdd......'], ['.................', 'lllaa.......aalll', '..aaaaaaWaaaaaa..', '......ddsdd......']],
}

const BUTTERFLY: Species = {
  1: [['aWa', '.d.'], ['.W.', 'a.a']],
  2: [['aa.d.aa', 'aaaWaaa', '.a...a.'], ['..a.a..', '..aWa..', '..a.a..']],
  3: [['aaa...d...aaa', 'aaaaa.W.aaaaa', '.aaaaadaaaaa.', '..aaa.d.aaa..'], ['......d......', '....aaWaa....', '....aaWaa....', '.....a.a.....']],
  4: [['aaaa....d....aaaa', 'aaaaaa..W..aaaaaa', '.aaaaaaadaaaaaaa.', '..aaaa..d..aaaa..'], ['........d........', '.....aaaWaaa.....', '.....aaaWaaa.....', '......aa.aa......']],
}

const OWL: Species = {
  1: [['aWa', '.a.'], ['.W.', 'a.a']],
  2: [['a.s.s.a', 'aaaWaaa', '.a.d.a.'], ['..s.s..', '.aaWaa.', 'aa.d.aa']],
  3: [['aa....W....aa', '.aaas.W.saaa.', '.aaaaaWaaaaa.', '...a..d..a...'], ['.............', 'aaa..sWs..aaa', '.aaaaaWaaaaa.', '...a..d..a...']],
  4: [['aaa.....W.....aaa', '.aaaas..W..saaaa.', '.aaaaaaaWaaaaaaa.', '....a...d...a....'], ['.................', 'aaaa..s.W.s..aaaa', '.aaaaaaaWaaaaaaa.', '....a...d...a....']],
}

const DRAGONFLY: Species = {
  1: [['WdW', '.a.'], ['.d.', 'WaW']],
  2: [['.WW.WW.', 'sdaaadd', '..W.W..'], ['.......', 'sdaaadd', '.WWWWW.']],
  3: [['...WW..WW....', '..WWWWWWWW...', 'sdaaaaaaaaadd', '....W....W...'], ['.............', '...WW..WW....', 'sdaaaaaaaaadd', '..WWWWWWWW...']],
  4: [['....WW...WW......', '...WWWWWWWWWW....', 'sdaaaaaaaaaaaaadd', '.....W.....W.....'], ['.................', '....WW...WW......', 'sdaaaaaaaaaaaaadd', '...WWWWWWWWWW....']],
}

/** The snowy owl is the owl in white with dark speckles: the same silhouette, so one drawing serves both. */
const speckle = (frames: Frames): Frames => frames.map(art => art.map((row, r) => [...row].map((cell, i) => (cell === 'a' ? ((i + r) % 5 === 0 ? 'd' : 'W') : cell)).join('')))
const SNOWY_OWL: Species = { 1: speckle(OWL[1]), 2: speckle(OWL[2]), 3: speckle(OWL[3]), 4: speckle(OWL[4]) }

export const ALL_CREATURES: Record<WakePreset, Species> = {
  city: PIGEON, harbor: GULL, beach: KITE, mountains: EAGLE, countryside: BUTTERFLY, forest: OWL, desert: DRAGONFLY, tundra: SNOWY_OWL,
}

/** The creature a Claude worker of this class is in this place. */
export const creatureFrames = (place: WakePreset | undefined, tier: Tier): Frames | undefined => (place ? ALL_CREATURES[place]?.[tier] : undefined)
