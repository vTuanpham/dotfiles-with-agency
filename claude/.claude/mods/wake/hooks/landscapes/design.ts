import type { WakePreset } from '../../types'
import type { Job } from './kit'

export type Tier = 1 | 2 | 3 | 4
export type Turn = 'coil' | 'bank' | 'none'
export type Design = {
  /** null means symmetric: no heading, no mirroring. */
  facing: 'left' | 'right' | null
  cruise: boolean
  escorts: Partial<Record<Tier, readonly { tier: Tier; lag: number; dx?: number; dy: number }[]>>
  turn: Turn
}
type Kind = NonNullable<Job['kind']>

const wingmen: Design['escorts'] = {
  3: [{ tier: 1, lag: 0.1, dx: -16, dy: -1 }],
  4: [{ tier: 1, lag: 0.1, dx: -18, dy: -1 }, { tier: 1, lag: 0.15, dx: 18, dy: 1 }],
}
const symmetric: Design = { facing: null, cruise: false, escorts: {}, turn: 'none' }
const flock: Design['escorts'] = {
  3: [{ tier: 1, lag: 0.12, dx: -16, dy: -1 }],
  4: [{ tier: 1, lag: 0.12, dx: -19, dy: -1 }, { tier: 1, lag: 0.18, dx: 19, dy: 1 }],
}
const sisters: Design['escorts'] = {
  3: [{ tier: 1, lag: 0.15, dx: -14, dy: 1 }],
  4: [{ tier: 1, lag: 0.15, dx: -16, dy: 1 }, { tier: 1, lag: 0.2, dx: 16, dy: -1 }],
}

/** The motion contract of every family/place design. Sprite and effect owners plug into this table, never family checks. */
export const DESIGNS: Record<Kind, Record<WakePreset, Design>> = {
  codex: {
    city: { facing: 'left', cruise: true, turn: 'coil', escorts: { 3: [{ tier: 1, lag: 0.45, dy: -5 }], 4: [{ tier: 1, lag: 0.4, dy: -5 }, { tier: 1, lag: 0.85, dy: 5 }] } },
    // Only the dragon keeps whelps: a second machine beside any of the others would read as another worker.
    harbor: { facing: 'left', cruise: false, turn: 'none', escorts: {} }, // the tug
    beach: { facing: null, cruise: false, turn: 'none', escorts: {} }, // the saucer is the same from every side: it hovers and drifts
    mountains: { facing: 'left', cruise: true, turn: 'bank', escorts: {} }, // the airship
    countryside: { facing: 'left', cruise: false, turn: 'bank', escorts: {} }, // the strider
    forest: { facing: null, cruise: false, turn: 'none', escorts: {} }, // the probe looks straight at you
    desert: { facing: 'left', cruise: true, turn: 'bank', escorts: {} }, // the speeder
    tundra: { facing: 'left', cruise: false, turn: 'bank', escorts: {} }, // the snowcat
  },
  // Birds in profile cruise and bank; the butterfly and the owl are seen face on, so they have no heading and wander.
  claude: {
    city: { facing: 'left', cruise: true, turn: 'bank', escorts: flock },
    harbor: { facing: 'left', cruise: true, turn: 'bank', escorts: flock },
    beach: { facing: 'left', cruise: true, turn: 'bank', escorts: flock },
    mountains: { facing: 'left', cruise: true, turn: 'bank', escorts: flock },
    countryside: { facing: null, cruise: false, turn: 'none', escorts: flock },
    forest: { facing: null, cruise: false, turn: 'none', escorts: flock },
    desert: { facing: 'left', cruise: false, turn: 'bank', escorts: flock },
    tundra: { facing: 'left', cruise: true, turn: 'bank', escorts: flock },
  },
  // The coil is the dragon's turn alone. Figures with a front (the condor's arrowhead, the plough, the scorpion) bank; the rest
  // are the same from either side and simply drift.
  agy: {
    city: { facing: null, cruise: false, turn: 'none', escorts: wingmen },
    harbor: { facing: null, cruise: false, turn: 'none', escorts: wingmen },
    beach: { facing: null, cruise: false, turn: 'none', escorts: wingmen },
    mountains: { facing: 'left', cruise: true, turn: 'bank', escorts: wingmen },
    countryside: { facing: 'left', cruise: true, turn: 'bank', escorts: wingmen },
    forest: { facing: null, cruise: false, turn: 'none', escorts: wingmen },
    desert: { facing: 'left', cruise: false, turn: 'bank', escorts: wingmen },
    tundra: { facing: null, cruise: false, turn: 'none', escorts: wingmen },
  },
  // The crane, the carp, the kite and the carpet have a front and fly along; lanterns, the balloon and the star drift with the air.
  opencode: {
    city: { facing: 'left', cruise: true, turn: 'bank', escorts: sisters },
    harbor: { facing: 'left', cruise: true, turn: 'bank', escorts: sisters },
    beach: { facing: 'left', cruise: false, turn: 'bank', escorts: sisters },
    mountains: { facing: null, cruise: false, turn: 'none', escorts: sisters },
    countryside: { facing: null, cruise: false, turn: 'none', escorts: sisters },
    forest: { facing: null, cruise: false, turn: 'none', escorts: sisters },
    desert: { facing: 'left', cruise: true, turn: 'bank', escorts: sisters },
    tundra: { facing: null, cruise: false, turn: 'none', escorts: sisters },
  },
}

export const designFor = (kind: Kind, place: WakePreset = 'city'): Design => DESIGNS[kind][place]
