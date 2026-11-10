import { expect, test } from 'claude-code/testing'
import { MessageTrails, scenePixels, type SceneInput } from '../hooks/scene'
import { TURN_LEAD_MS, PACKET_STAGGER_MS } from '../hooks/crew-row'

test('each shot freezes its own route at launch and records only visited cells', () => {
  const trails = new MessageTrails(), edge = { source: 'a', target: 'b', strength: 1, stamp: 'one', lead: TURN_LEAD_MS, fresh: 3 }
  expect(trails.path(edge, () => [1, 2])).toBeUndefined()
  expect(trails.path({ ...edge, arriving: TURN_LEAD_MS - 1 }, () => [1, 2])).toBeUndefined()
  const first = { ...edge, arriving: TURN_LEAD_MS }, flying = { ...edge, arriving: TURN_LEAD_MS + PACKET_STAGGER_MS }
  expect(trails.path(first, () => [1, 2, 3])).toEqual([1, 2, 3])
  expect(trails.visit(first, 0)).toBe(-1)
  trails.visit(first, 0, 1)
  expect(trails.path(flying, () => [7, 8, 9])).toEqual([1, 2, 3])
  expect(trails.path(flying, () => [7, 8, 9], 1)).toEqual([7, 8, 9])
  expect(trails.visit(flying, 0)).toBe(1)
  expect(trails.visit(flying, 1)).toBe(-1)
  expect(trails.path(edge, () => [100])).toEqual([1, 2, 3])
  expect(trails.count({ ...edge, fresh: undefined })).toBe(2)
  expect(trails.path({ ...edge, stamp: 'two' }, () => [100])).toBeUndefined()
})

test('all families charge locally, launch independently and leave no residue ahead of the projectile', () => {
  for (const kind of ['codex', 'claude', 'agy', 'opencode'] as const) for (const preset of ['city', 'harbor', 'tundra'] as const) {
    const trails = new MessageTrails(), edge = { source: 'worker', target: 'mochi', family: kind, strength: 1, lead: TURN_LEAD_MS, stamp: 'one' }
    const job = { kind, tier: 3 as const, seed: 11, route: 0, phase: 0, isStale: false, hit: { id: 'worker', title: 'worker', details: [] } }
    const base: SceneInput = { width: 190, frame: 0, hour: 22, sun: { rise: 6, set: 18 }, moonPhase: .3, season: 'summer', snowy: false, weather: null, preset, seed: 12345, turns: [], live: null, mood: 'work', jobs: [job], agents: [], plan: null, effect: null, effects: false, messageTrails: trails }
    const charge = scenePixels({ ...base, peerEdges: [{ ...edge, arriving: 700 }] })
    const plain = scenePixels(base)
    expect(charge.some((p, i) => p !== plain[i]), `${kind} charges`).toBe(true)
    expect(trails.path(edge, () => [])).toBeUndefined()
    const launch = { ...edge, arriving: TURN_LEAD_MS }
    const px = scenePixels({ ...base, peerEdges: [launch] })
    const path = trails.path(launch, () => [])!
    expect(path.length).toBeGreaterThan(10)
    expect(trails.visit(edge, 0)).toBe(0)
    for (const cell of path.slice(12, -12)) expect(px[cell], `${kind}.${preset} no preview at ${cell}`).toBe(plain[cell])
    scenePixels({ ...base, frame: 80, jobs: [{ ...job, route: 80, phase: 80 }], peerEdges: [{ ...edge, arriving: TURN_LEAD_MS + 300 }] })
    expect(trails.path(launch, () => [])).toBe(path)
    expect(trails.visit(edge, 0)).toBeGreaterThan(0)
  }
})
