import { expect, test } from 'claude-code/testing'

import { type WakePreset } from '../types'
import { styleFor } from '../hooks/exit-styles'
import { ALL_CRAFT } from '../hooks/landscapes/craft'
import { ALL_LANTERNS } from '../hooks/landscapes/lantern'
import { ALL_CREATURES } from '../hooks/landscapes/creatures'
import { CARRIED, CREW } from '../hooks/landscapes/fx'
import { LANDSCAPES } from '../hooks/landscapes'
import { DESIGNS } from '../hooks/landscapes/design'
import { P } from '../hooks/landscapes/kit'

// The crew is a matrix: four families by eight places. Each cell has a sprite, effects in the air and a passage. A cell left out is a
// family that looks, moves or leaves the same everywhere: these tests fail when one is missing, so whoever adds a place or a family
// is told where to add its row (see landscapes/CREW.md).

const places = Object.keys(LANDSCAPES) as WakePreset[]
const families = ['codex', 'claude', 'agy', 'opencode'] as const

test('non-city Codex air stays sparse and separate in tone from the mechanical body', () => {
  for (const place of places) {
    if (place === 'city') continue
    for (const stream of [...(CREW.codex[place]?.streams ?? []), ...(CREW.codex[place]?.talking ?? [])]) {
      expect(stream.emitter.count, `${place} air must stay subordinate`).toBeLessThanOrEqual(3)
      expect(stream.emitter.colors, `${place} air is not a cloud of body-coloured pixels`).not.toContain(P.teal)
    }
  }
})

test('every place has what each family needs: a Codex machine, a Claude creature and wind', () => {
  for (const place of places) {
    expect(ALL_CREATURES[place], `${place} creature`).toBeDefined()
    expect(CARRIED[place], `${place} wind-borne`).toBeDefined()
    expect(ALL_CRAFT[place], `${place} craft`).toBeDefined()
    expect(ALL_LANTERNS[place], `${place} festival lantern`).toBeDefined()
  }
})

test('every family/place has a complete motion design with an explicit front, cruise and turn', () => {
  for (const kind of families) for (const place of places) {
    const d = DESIGNS[kind][place]
    expect(d, `${kind}.${place}`).toBeDefined()
    expect([null, 'left', 'right']).toContain(d.facing)
    expect(typeof d.cruise).toBe('boolean')
    expect(['coil', 'bank', 'none']).toContain(d.turn)
    if (d.facing === null) expect(d.turn, `${kind}.${place} is symmetric`).toBe('none')
    expect(d.escorts).toBeDefined()
  }
  expect(DESIGNS.codex.city.turn).toBe('coil')
  for (const place of ['beach', 'tundra'] as const) expect(DESIGNS.codex[place].turn, `${place} is a rigid plane`).toBe('bank')
})

test('escort formations reference existing smaller classes and finite path offsets', () => {
  for (const kind of families) for (const place of places) for (const [leader, escorts] of Object.entries(DESIGNS[kind][place].escorts)) {
    expect([1, 2, 3, 4]).toContain(Number(leader))
    for (const e of escorts ?? []) {
      expect([1, 2, 3, 4]).toContain(e.tier)
      expect(e.tier).toBeLessThan(Number(leader))
      expect(Number.isFinite(e.lag) && e.lag > 0, `${kind}.${place} lag`).toBe(true)
      expect(Number.isFinite(e.dy), `${kind}.${place} offset`).toBe(true)
      expect(Number.isFinite(e.dx ?? 0), `${kind}.${place} horizontal offset`).toBe(true)
      if (kind === 'codex') expect(ALL_CRAFT[place][e.tier]).toBeDefined()
      if (kind === 'claude') expect(ALL_CREATURES[place][e.tier]).toBeDefined()
    }
  }
})

test('every family has air effects for all places', () => {
  for (const kind of families) expect(CREW[kind].any, `${kind} family-wide effects`).toBeDefined()
})

test('every family leaves every place in a style of its own', () => {
  for (const kind of families) for (const place of places) expect(typeof styleFor(kind, place), `${kind} in ${place}`).toBe('function')
})

test('effect tables name only anchors, tiers and places that exist', () => {
  for (const kind of families) for (const [place, cell] of Object.entries(CREW[kind])) {
    expect(place === 'any' || places.includes(place as WakePreset), `${kind}.${place}`).toBe(true)
    for (const s of [...(cell?.streams ?? []), ...(cell?.lights ?? [])]) {
      expect(s.at, `${kind}.${place}`).toBeTruthy()
      for (const tier of s.tiers ?? []) expect([1, 2, 3, 4]).toContain(tier)
    }
  }
})

test('a light is only on a design that has a reason for it: no searchlight cones, and navigation lights only on aeroplanes', () => {
  for (const kind of families) for (const [place, cell] of Object.entries(CREW[kind])) for (const l of cell?.lights ?? []) expect(l.light.shape, `${kind}.${place}`).not.toBe('cone')
  const lit = (place: WakePreset) => (CREW.codex[place]?.lights ?? []).some(l => l.light.color === 0xf38ba8 || l.light.color === 0xa6e3a1)
  for (const place of ['beach', 'countryside', 'tundra'] as const) expect(lit(place), `${place} has aeroplanes`).toBe(true)
  for (const place of ['mountains', 'forest', 'desert'] as const) expect(lit(place), `${place} has no aeroplanes`).toBe(false)
})
