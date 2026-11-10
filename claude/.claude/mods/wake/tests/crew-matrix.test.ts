import { expect, test } from 'claude-code/testing'

import { type WakePreset } from '../types'
import { styleFor } from '../hooks/exit-styles'
import { ALL_CRAFT } from '../hooks/landscapes/craft'
import { ALL_LANTERNS } from '../hooks/landscapes/lantern'
import { ALL_CREATURES } from '../hooks/landscapes/creatures'
import { CARRIED, CREW, crewFx } from '../hooks/landscapes/fx'
import { canvas } from '../hooks/pixels'
import type { Look } from '../hooks/landscapes/kit'
import { LANDSCAPES } from '../hooks/landscapes'
import { DESIGNS } from '../hooks/landscapes/design'

// The crew is a matrix: four families by eight places. Each cell has a sprite, effects in the air and a passage. A cell left out is a
// family that looks, moves or leaves the same everywhere: these tests fail when one is missing, so whoever adds a place or a family
// is told where to add its row (see landscapes/CREW.md).

const places = Object.keys(LANDSCAPES) as WakePreset[]
const families = ['codex', 'claude', 'agy', 'opencode'] as const

test('every family and place has a trail and a voice', () => {
  for (const kind of families) for (const place of places) {
    const cells = [CREW[kind].any, CREW[kind][place]]
    expect(cells.some(cell => cell?.streams?.some(stream => stream.follow)), `${kind}.${place} trail`).toBe(true)
    expect(cells.some(cell => cell?.talking?.length), `${kind}.${place} voice`).toBe(true)
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
  for (const place of places.filter(place => place !== 'city')) expect(DESIGNS.codex[place].turn).not.toBe('coil')
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
    expect(place === 'any' || place === 'night' || places.includes(place as WakePreset), `${kind}.${place}`).toBe(true)
    for (const s of [...(cell?.streams ?? []), ...(cell?.lights ?? [])]) {
      expect(s.at, `${kind}.${place}`).toBeTruthy()
      for (const tier of s.tiers ?? []) expect([1, 2, 3, 4]).toContain(tier)
    }
  }
})

test('each family supplies a night-only effect', () => {
  for (const kind of families) expect((CREW[kind].night?.streams?.length ?? 0) + (CREW[kind].night?.lights?.length ?? 0)).toBeGreaterThan(0)
})

test('night cells paint only after dusk', () => {
  for (const kind of families) {
    const cell = CREW[kind].night!
    const render = (night: number) => {
      const c = canvas(40, 20)
      crewFx(c, { night, place: 'city', frame: 25, wind: 0 } as Look, { x0: 15, y0: 7, w: 10, h: 6, cx: 20, cy: 10, kind, tier: 1, seed: 1, pace: 0.6, phase: 25, path: () => [20, 10], lift: 0, ground: 19 })
      return Array.from(c.px)
    }
    const day = render(0), night = render(1)
    try {
      delete CREW[kind].night
      expect(render(0), `${kind} day`).toEqual(day)
      const without = render(1)
      expect(without, `${kind} night`).not.toEqual(night)
      const local = CREW[kind].city!
      local.night = cell
      try {
        expect(render(0), `${kind} place by day`).toEqual(day)
        expect(render(1), `${kind} place at night`).toEqual(night)
      } finally { delete local.night }
    } finally { CREW[kind].night = cell }
  }
})

test('lights outside eye and lamp halos wait for dusk', () => {
  for (const kind of families) for (const [place, cell] of Object.entries(CREW[kind])) for (const l of cell?.lights ?? []) {
    if (l.always || l.light.shape === 'halo') continue
    expect(l.light.from, `${kind}.${place} ${l.at}`).toBeDefined()
  }
})
