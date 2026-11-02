// Mochi, the session's mood, and the other characters one can pick in her place (`/wake mochi <name>`).
//
// Each character is two hand-drawn frames (tail up, tail down) of the same size and a palette. Letters in a frame:
//   B body   S shade   W white (paws, chest, muzzle)   D stripe/marking   T tail   I inner ear   E eye   P cheek
//   N nose   M whisker   C collar   G bell
// A frame is CAT_COLUMNS wide and every character is MOCHI_ROWS tall, so the scene lays all of them out alike. To add a
// character: draw two frames, give it a palette and list it in CHARACTERS; the command, the store and the tests follow.
import { P } from './landscapes/kit'

export const CAT_COLUMNS = 10
export const MOCHI_ROWS = 8

export type Character = {
  label: string
  note: string
  up: string[] // tail up
  down: string[] // tail down
  ink: Record<string, number> // letter -> colour; E is the open eye (a blink or sleep closes it in the scene)
}

const SHADE = 0x9399d6

export const CHARACTERS = {
  // the default: a lavender cat with a belled collar, white paws and whiskers
  mochi: {
    label: 'Mochi', note: 'lavender cat, belled collar',
    up: ['.B.....B..', '.BB...BB..', '.BIBBBIB..', '.BBBBBBS..', 'MBEBBBEBM.', 'MBPBNBPBM.', '..BCGCS..T', '..BWBWBTT.'],
    down: ['.B.....B..', '.BB...BB..', '.BIBBBIB..', '.BBBBBBS..', 'MBEBBBEBM.', 'MBPBNBPBM.', '..BCGCS...', '..BWBWBTTT'],
    ink: { B: P.lavender, S: SHADE, T: P.lavender, I: P.pink, E: P.crust, P: P.pink, N: P.maroon, M: P.snow, C: P.red, G: P.yellow, W: P.snow },
  },
  // an orange tabby with stripes on the brow and flanks
  tabby: {
    label: 'Tabby', note: 'orange tabby, striped',
    up: ['.B.....B..', '.BB...BB..', '.BIDBDIB..', '.BBBDBBS..', 'MBEBBBEBM.', 'MBPBNBPBM.', '..BDBDS..T', '..BWBWBTT.'],
    down: ['.B.....B..', '.BB...BB..', '.BIDBDIB..', '.BBBDBBS..', 'MBEBBBEBM.', 'MBPBNBPBM.', '..BDBDS...', '..BWBWBTTT'],
    ink: { B: P.peach, S: 0xd9895f, T: P.peach, D: 0xc46a45, I: P.pink, E: P.crust, P: P.flamingo, N: P.maroon, M: P.snow, W: P.snow },
  },
  // a black cat in a white bib; its eyes are bright because the fur is not
  tuxedo: {
    label: 'Tuxedo', note: 'black and white, yellow eyes',
    up: ['.B.....B..', '.BB...BB..', '.BIBBBIB..', '.BBBBBBS..', 'MBEBWBEBM.', 'MBBWNWBBM.', '..BWWWS..T', '..BWBWBTT.'],
    down: ['.B.....B..', '.BB...BB..', '.BIBBBIB..', '.BBBBBBS..', 'MBEBWBEBM.', 'MBBWNWBBM.', '..BWWWS...', '..BWBWBTTT'],
    ink: { B: 0x3a3b52, S: 0x2b2c40, T: 0x3a3b52, I: P.pink, E: P.yellow, N: P.maroon, M: P.overlay2, W: P.snow },
  },
  // not a cat: a rabbit with tall ears and a cotton tail
  bun: {
    label: 'Bun', note: 'white rabbit, tall ears',
    up: ['.BB...BB..', '.BIB.BIB..', '.BIB.BIB..', '.BBBBBBS..', '.BEBBBEB..', '.BPBNBPB..', '..BBBBS..T', '..BWBWBTT.'],
    down: ['.BB...BB..', '.BIB.BIB..', '.BIB.BIB..', '.BBBBBBS..', '.BEBBBEB..', '.BPBNBPB..', '..BBBBS...', '..BWBWBTTT'],
    ink: { B: P.snow, S: 0xc9cde4, T: P.white, I: P.pink, E: P.crust, P: P.pink, N: P.maroon, W: P.white },
  },
} satisfies Record<string, Character>

export type CharacterId = keyof typeof CHARACTERS
export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[]
export const DEFAULT_CHARACTER: CharacterId = 'mochi'

/** A stored or typed name, only if it is a character: anything else (an older shape, a hand edit) falls to the default. */
export const asCharacter = (value: unknown): CharacterId => (typeof value === 'string' && value in CHARACTERS ? (value as CharacterId) : DEFAULT_CHARACTER)
export const isCharacter = (value: unknown): value is CharacterId => typeof value === 'string' && value in CHARACTERS
