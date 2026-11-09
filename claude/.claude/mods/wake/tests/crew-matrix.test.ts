import { expect, test } from 'claude-code/testing'

import { type WakePreset } from '../types'
import { BURSTS, SCENE } from '../hooks/reactions'
import { styleFor } from '../hooks/exit-styles'
import { ALL_CRAFT } from '../hooks/landscapes/craft'
import { ALL_CREATURES } from '../hooks/landscapes/creatures'
import { CARRIED, CREW } from '../hooks/landscapes/fx'
import { LANDSCAPES } from '../hooks/landscapes'

// The crew is a matrix: four families by eight places. Each cell has a sprite, effects in the air, a passage, and a way to send
// and to receive. A cell left out is a family that looks, moves or leaves the same everywhere: these tests fail when one is missing,
// so whoever adds a place or a family is told where to add its row (see landscapes/CREW.md).

const places = Object.keys(LANDSCAPES) as WakePreset[]
const families = ['codex', 'claude', 'agy', 'opencode'] as const

test('every place has what each family needs: a craft or a boat for Codex, a creature for Claude, wind and a scene accent', () => {
  for (const place of places) {
    expect(ALL_CREATURES[place], `${place} creature`).toBeDefined()
    expect(CARRIED[place], `${place} wind-borne`).toBeDefined()
    expect(SCENE[place], `${place} scene accent`).toBeDefined()
    if (!['harbor', 'beach'].includes(place)) expect(ALL_CRAFT[place], `${place} craft`).toBeDefined() // (the harbor and the beach float boats)
  }
})

test('every family has air effects for all places, and a send and a receive of its own', () => {
  for (const kind of families) {
    expect(CREW[kind].any, `${kind} family-wide effects`).toBeDefined()
    expect(BURSTS[kind].send.length, `${kind} send`).toBeGreaterThan(0)
    expect(BURSTS[kind].land.length, `${kind} receive`).toBeGreaterThan(0)
    // a receive is not a send played backwards: it gathers in and then lands (a reversed or a delayed burst)
    expect(BURSTS[kind].land.some(e => e.reverse || e.delay), `${kind} receive has a gathering or an impact`).toBe(true)
    expect(JSON.stringify(BURSTS[kind].send), kind).not.toEqual(JSON.stringify(BURSTS[kind].land))
  }
  const sends = families.map(kind => JSON.stringify(BURSTS[kind].send))
  expect(new Set(sends).size).toBe(families.length) // each crew sends in its own way
  const lands = families.map(kind => JSON.stringify(BURSTS[kind].land))
  expect(new Set(lands).size).toBe(families.length)
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
