import type { WakePreset } from '../../types'
import type { Job } from './kit'

export type Tier = 1 | 2 | 3 | 4
export type Turn = 'coil' | 'bank' | 'none' | 'pose'
export type PassageStyle = 'surface' | 'ignite' | 'unfold' | 'swoop' | 'boot' | 'walk'
export type Design = {
  /** null means symmetric: no heading, no mirroring. */
  facing: 'left' | 'right' | null
  cruise: boolean
  escorts: Partial<Record<Tier, readonly { tier: Tier; lag: number; dx?: number; dy: number }[]>>
  turn: Turn
  habit?: 'air' | 'water' | 'ground'
  rests?: boolean
  altitude?: 'low'
  /** Distant crews occupy the sky behind terrain and buildings. */
  depth?: 'far'
  enter?: PassageStyle
  leave?: PassageStyle
}
type Kind = NonNullable<Job['kind']>

const flock: Design['escorts'] = {
  3: [{ tier: 1, lag: 0.12, dx: -16, dy: -1 }],
  4: [{ tier: 1, lag: 0.12, dx: -19, dy: -1 }, { tier: 1, lag: 0.18, dx: 19, dy: 1 }],
}
const sisters: Design['escorts'] = {
  3: [{ tier: 1, lag: 0.15, dx: -14, dy: 1 }],
  4: [{ tier: 1, lag: 0.15, dx: -16, dy: 1 }, { tier: 1, lag: 0.2, dx: 16, dy: -1 }],
}
const surface = { enter: 'surface', leave: 'surface' } as const
const ignite = { enter: 'ignite', leave: 'ignite' } as const
const unfold = { enter: 'unfold', leave: 'unfold' } as const
const boot = { enter: 'boot', leave: 'boot' } as const
const walk = { enter: 'walk', leave: 'walk' } as const

/** The motion contract of every family/place design. Sprite and effect owners plug into this table, never family checks. */
export const DESIGNS: Record<Kind, Record<WakePreset, Design>> = {
  codex: {
    city: { facing: 'left', cruise: true, turn: 'coil', rests: true, escorts: { 3: [{ tier: 1, lag: 0.45, dy: -5 }], 4: [{ tier: 1, lag: 0.4, dy: -5 }, { tier: 1, lag: 0.85, dy: 5 }] } },
    // Only the dragon keeps whelps: a second machine beside any of the others would read as another worker.
    harbor: { facing: 'left', cruise: false, turn: 'none', habit: 'water', escorts: {} }, // the tug
    beach: { ...boot, facing: null, cruise: false, turn: 'none', escorts: {} }, // the saucer is the same from every side: it hovers and drifts
    mountains: { depth: 'far', facing: 'left', cruise: true, turn: 'pose', escorts: {} }, // the airship
    countryside: { ...walk, facing: 'left', cruise: false, turn: 'pose', habit: 'ground', escorts: {} }, // the strider
    forest: { ...boot, facing: null, cruise: false, turn: 'none', escorts: {} }, // the probe looks straight at you
    desert: { facing: 'left', cruise: true, turn: 'pose', altitude: 'low', escorts: {} }, // the speeder
    tundra: { ...walk, facing: 'left', cruise: false, turn: 'pose', habit: 'ground', escorts: {} }, // the snowcat
  },
  // Birds in profile cruise and bank; the butterfly and the owl are seen face on, so they have no heading and wander.
  claude: {
    // Birds that flock keep a follower at the top classes; a second dolphin, flamingo, owl or fox would read as another worker.
    city: { facing: 'left', cruise: true, turn: 'pose', rests: true, escorts: flock }, // sparrows flock
    harbor: { ...walk, facing: null, cruise: false, turn: 'none', habit: 'ground', escorts: {} }, // the crab scuttles along the quay, face on
    beach: { ...walk, facing: 'left', cruise: false, turn: 'pose', habit: 'ground', escorts: {} }, // the flamingo wades
    mountains: { facing: 'left', cruise: true, turn: 'pose', escorts: {} }, // the eagle soars alone
    countryside: { facing: null, cruise: false, turn: 'none', escorts: flock }, // butterflies go in pairs
    forest: { facing: null, cruise: false, turn: 'none', rests: true, escorts: {} }, // the owl
    desert: { ...walk, facing: 'left', cruise: false, turn: 'pose', habit: 'ground', escorts: {} }, // the fox
    tundra: { facing: 'left', cruise: true, turn: 'pose', rests: true, escorts: flock }, // puffins flock
  },
  // Constellations keep their star map fixed while drifting; the message gathers at a node.
  agy: {
    // A constellation is complete in itself: no companion star figures.
    city: { ...ignite, depth: 'far', facing: null, cruise: false, turn: 'none', escorts: {} },
    harbor: { ...ignite, depth: 'far', facing: null, cruise: false, turn: 'none', escorts: {} },
    beach: { ...ignite, depth: 'far', facing: null, cruise: false, turn: 'none', escorts: {} },
    mountains: { ...ignite, depth: 'far', facing: null, cruise: false, turn: 'none', escorts: {} },
    countryside: { ...ignite, depth: 'far', facing: null, cruise: false, turn: 'none', escorts: {} },
    forest: { ...ignite, depth: 'far', facing: null, cruise: false, turn: 'none', escorts: {} },
    desert: { ...ignite, depth: 'far', facing: null, cruise: false, turn: 'none', escorts: {} },
    tundra: { ...ignite, depth: 'far', facing: null, cruise: false, turn: 'none', escorts: {} },
  },
  // The crane, the carp, the kite and the carpet have a front and fly along; lanterns, the balloon and the star drift with the air.
  opencode: {
    // Lanterns are released in numbers, so the sky lantern and the star keep sisters; the other crafts fly alone.
    city: { ...unfold, facing: 'left', cruise: true, turn: 'pose', escorts: {} }, // the crane
    harbor: { ...surface, facing: null, cruise: false, turn: 'none', habit: 'water', escorts: {} }, // the paper boat
    beach: { ...unfold, facing: 'left', cruise: false, turn: 'pose', escorts: {} }, // the kite
    mountains: { depth: 'far', facing: null, cruise: false, turn: 'none', escorts: sisters }, // sky lanterns
    countryside: { ...unfold, facing: 'left', cruise: true, turn: 'pose', escorts: {} }, // the carp streamer
    forest: { facing: null, cruise: false, turn: 'none', rests: true, escorts: {} }, // the lantern string is already several
    desert: { ...unfold, facing: 'left', cruise: true, turn: 'pose', escorts: {} }, // the carpet
    tundra: { facing: null, cruise: false, turn: 'none', escorts: sisters }, // paper stars
  },
}

export const designFor = (kind: Kind, place: WakePreset = 'city'): Design => DESIGNS[kind][place]
