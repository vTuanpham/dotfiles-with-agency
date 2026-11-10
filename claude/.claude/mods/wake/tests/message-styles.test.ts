import { expect, test } from 'claude-code/testing'
import { CREW } from '../hooks/landscapes/fx'
import { P } from '../hooks/landscapes/kit'
import { canvas } from '../hooks/pixels'
import { react } from '../hooks/reactions'
import { circuitCells, scenePixels, type SceneInput } from '../hooks/scene'

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
