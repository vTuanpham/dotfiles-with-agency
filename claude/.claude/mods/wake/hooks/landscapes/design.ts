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

/** The motion contract of every family/place design. Sprite and effect owners plug into this table, never family checks. */
export const DESIGNS: Record<Kind, Record<WakePreset, Design>> = {
  codex: {
    city: { facing: 'left', cruise: true, turn: 'coil', escorts: { 3: [{ tier: 1, lag: 0.45, dy: -5 }], 4: [{ tier: 1, lag: 0.4, dy: -5 }, { tier: 1, lag: 0.85, dy: 5 }] } },
    harbor: { facing: 'left', cruise: false, turn: 'none', escorts: { 3: [{ tier: 1, lag: 0.8, dy: 1 }], 4: [{ tier: 1, lag: 0.8, dy: 1 }] } },
    beach: { facing: 'left', cruise: true, turn: 'bank', escorts: wingmen },
    mountains: { facing: 'left', cruise: true, turn: 'bank', escorts: wingmen },
    countryside: { facing: 'left', cruise: true, turn: 'bank', escorts: wingmen },
    forest: { facing: 'left', cruise: false, turn: 'bank', escorts: wingmen },
    desert: { facing: 'left', cruise: false, turn: 'bank', escorts: wingmen },
    tundra: { facing: 'left', cruise: true, turn: 'bank', escorts: wingmen },
  },
  // These retain the other families' existing motion while their place-specific art is developed.
  claude: { city: symmetric, harbor: symmetric, beach: symmetric, mountains: symmetric, countryside: symmetric, forest: symmetric, desert: symmetric, tundra: symmetric },
  agy: {
    city: { facing: 'left', cruise: true, turn: 'bank', escorts: wingmen },
    harbor: { facing: 'left', cruise: false, turn: 'coil', escorts: wingmen },
    beach: { facing: null, cruise: false, turn: 'none', escorts: wingmen },
    mountains: { facing: 'left', cruise: true, turn: 'coil', escorts: wingmen },
    countryside: { facing: null, cruise: false, turn: 'none', escorts: wingmen },
    forest: { facing: null, cruise: false, turn: 'none', escorts: wingmen },
    desert: { facing: null, cruise: false, turn: 'none', escorts: wingmen },
    tundra: { facing: 'left', cruise: true, turn: 'coil', escorts: wingmen },
  },
  opencode: { city: symmetric, harbor: symmetric, beach: symmetric, mountains: symmetric, countryside: symmetric, forest: symmetric, desert: symmetric, tundra: symmetric },
}

export const designFor = (kind: Kind, place: WakePreset = 'city'): Design => DESIGNS[kind][place]
