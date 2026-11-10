import { expect, test } from 'claude-code/testing'
import { CREW } from '../hooks/landscapes/fx'
import { P } from '../hooks/landscapes/kit'
import { canvas } from '../hooks/pixels'
import { react } from '../hooks/reactions'
import { circuitCells, scenePixels, type SceneInput } from '../hooks/scene'
import { sceneInput, type BandState } from '../hooks/band'

test('families select their message style in the effects table', () => {
  expect([CREW.codex.message, CREW.claude.message, CREW.agy.message, CREW.opencode.message]).toEqual(['packet', 'song', 'starfall', 'ember'])
})

test('packet traces run through orthogonal adjacent cells from sender to receiver', () => {
  for (const [a, b] of [[{ x: 2, y: 3 }, { x: 17, y: 8 }], [{ x: 8, y: 9 }, { x: 8, y: 2 }]] as const) {
    const path = circuitCells(a, b, 20, 12)
    expect(path[0]).toBe(a.y * 20 + a.x)
    expect(path.at(-1)).toBe(b.y * 20 + b.x)
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i]! % 20 - path[i - 1]! % 20) + Math.abs(Math.floor(path[i]! / 20) - Math.floor(path[i - 1]! / 20))).toBe(1)
  }
})

test('each style paints a distinct landing on a worker and on root', () => {
  for (const id of ['worker', 'mochi']) {
    const results = []
    for (const style of ['packet', 'song', 'starfall', 'ember'] as const) {
      const c = canvas(20, 12, true)
      for (let y = 4; y < 8; y++) for (let x = 7; x < 13; x++) { c.set(x, y, P.white); c.hitOwners![y * 20 + x] = 1 }
      react(c, [{ id }], [{ id, role: 'land', v: 1, t: 50, style, point: { x: 8, y: 5 } }], () => id === 'mochi' ? 'mochi' : 'codex')
      results.push(Array.from(c.px).join(','))
    }
    expect(new Set(results).size).toBe(4)
  }
})

test('both root directions render distinct family flights and landings', () => {
  const base: SceneInput = { width: 120, frame: 0, hour: 12, sun: { rise: 6, set: 18 }, moonPhase: .3, season: 'summer', snowy: false, weather: null, preset: 'city', seed: 7, turns: [], live: null, mood: 'work', jobs: [{ kind: 'codex', tier: 3, seed: 11, isStale: false, hit: { id: 'worker', title: 'worker', details: [] } }], agents: [], plan: null, effect: null }
  for (const [source, target] of [['mochi', 'worker'], ['worker', 'mochi']] as const) for (const arriving of [550, 1050]) {
    const pictures = (['codex', 'claude', 'agy', 'opencode'] as const).map(family => Array.from(scenePixels({ ...base, peerEdges: [{ source, target, family, strength: 1, arriving }] })).join(','))
    expect(new Set(pictures).size).toBe(4)
  }
})

test('packet landing makes a filled three by three flash before the eye blinks', () => {
  const c = canvas(20, 12, true)
  for (let y = 4; y < 8; y++) for (let x = 7; x < 13; x++) { c.set(x, y, P.ink); c.hitOwners![y * 20 + x] = 1 }
  react(c, [{ id: 'worker' }], [{ id: 'worker', role: 'land', v: 1, t: 50, style: 'packet', point: { x: 9, y: 5 } }], () => 'codex')
  for (let y = 4; y <= 6; y++) for (let x = 8; x <= 10; x++) expect(c.get(x, y)).not.toBe(P.ink)
})

test('night strengthens the landing glow', () => {
  const draw = (night: number) => {
    const c = canvas(20, 12, true)
    for (let y = 4; y < 8; y++) for (let x = 7; x < 13; x++) { c.set(x, y, P.ink); c.hitOwners![y * 20 + x] = 1 }
    react(c, [{ id: 'worker' }], [{ id: 'worker', role: 'land', v: 0.4, t: 200, style: 'ember', point: { x: 9, y: 5 } }], () => 'opencode', {}, {}, night)
    return c.get(9, 4)
  }
  const brightness = (c: number) => (c >> 16 & 255) + (c >> 8 & 255) + (c & 255)
  expect(brightness(draw(1))).toBeGreaterThan(brightness(draw(0)))
})

test('the scene keeps a peer arrival long enough for the starfall landing', () => {
  const now = 10_000
  const state: BandState = {
    here: null, tally: { turns: 0, added: 0, removed: 0, files: [], lastTurnMs: 0 }, turnStartedAt: null, pulse: [], plan: [], mood: 'idle', subagents: [],
    chips: [{ id: 'a', name: 'A', backend: 'agy', account: '01', model: '', effort: '', running: true, isStale: false, since: 0,
      peers: [{ target: 'b', count: 1, lastAt: now - 2400, observedAt: now - 2400, outgoing: true }] },
      { id: 'b', name: 'B', backend: 'agy', account: '01', model: '', effort: '', running: true, isStale: false, since: 0 }],
  }
  const edge = sceneInput(state, 160, 0, null, now).peerEdges!.find(item => item.source === 'a' && item.target === 'b')!
  expect(edge.arriving).toBe(2400)
})
