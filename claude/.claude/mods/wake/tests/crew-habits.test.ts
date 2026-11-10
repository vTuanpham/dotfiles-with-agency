import { expect, test } from 'claude-code/testing'
import { placeFly } from '../hooks/landscapes/crew'
import { DESIGNS } from '../hooks/landscapes/design'
import { type Job, type Look } from '../hooks/landscapes/kit'
import { canvas } from '../hooks/pixels'
import { scenePixels, type SceneInput } from '../hooks/scene'
import { LANDSCAPES } from '../hooks/landscapes'
import { craftFrames } from '../hooks/landscapes/craft'
import { creatureFrames } from '../hooks/landscapes/creatures'
import { lanternFrames } from '../hooks/landscapes/lantern'

test('real scenes keep each surface-habit worker on its declared surface', { timeoutMs: 30_000 }, () => {
  const framesFor = { codex: craftFrames, claude: creatureFrames, opencode: lanternFrames }
  const tempos = { codex: 4, claude: 3, opencode: 5 }
  for (const kind of ['codex', 'claude', 'opencode'] as const) for (const place of Object.keys(LANDSCAPES) as (keyof typeof LANDSCAPES)[]) {
    const habit = DESIGNS[kind][place].habit
    if (!habit || habit === 'air') continue
    const frames = framesFor[kind](place, 4), land = LANDSCAPES[place]
    for (const hour of [12, 0]) for (const frame of [400, 409, 418, 427]) for (const width of [40, 60, 100, 160]) for (const count of [1, 4]) for (const varied of count === 1 ? [false] : [false, true]) {
      const jobs: Job[] = Array.from({ length: count }, (_, i) => ({ isStale: false, seed: 6 + (varied ? i : 0), kind, tier: 4, pace: 0.8, hit: { id: `j${i}`, title: `j${i}`, details: [] } }))
      const expected = jobs.map(job => {
        const art = frames[(Math.floor(frame / (frames.length >= 8 ? 1.5 : tempos[kind])) + job.seed) % frames.length]!
        const bottom = Math.max(...art.flatMap((row, y) => /[^.]/.test(row) ? [y] : []))
        const foot = habit === 'water' ? land.water! + 1 - Number(Math.sin(frame * 0.12 + job.seed) > 0.3) : land.ground
        return foot - bottom + (art.length >> 1)
      }).sort((a, b) => a - b)
      const input: SceneInput = { width, frame, hour, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false, weather: { cloud: 0.1, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, preset: place, seed: 12345, turns: [], live: null, mood: 'work', plan: null, effect: null, effects: false, agents: [], jobs }
      const anchors: number[] = []
      const hits = { columns: width, rows: 0, owners: [] as number[], targets: [] as NonNullable<Job['hit']>[] }
      scenePixels(input, anchors, hits)
      expect(anchors.length, `${kind}.${place} width ${width} count ${count}`).toBe(count)
      expect(new Set(anchors).size, `${kind}.${place} width ${width} distinct anchors`).toBe(count)
      expect(anchors.map(anchor => Math.floor(anchor / width)).sort((a, b) => a - b), `${kind}.${place} width ${width} count ${count} varied ${varied}`).toEqual(expected)
      for (const job of jobs) {
        const owner = hits.targets.findIndex(target => target.id === job.hit!.id) + 1
        expect(owner, `${kind}.${place} hit target`).toBeGreaterThan(0)
        expect(hits.owners.includes(owner), `${kind}.${place} width ${width} visible ${job.hit!.id}`).toBe(true)
      }
    }
  }
})

test('surface habits use their declared row and keep their own sprite boxes', () => {
  for (const width of [48, 80, 140]) for (const kind of ['codex', 'claude', 'opencode'] as const) for (const place of ['harbor', 'beach', 'countryside', 'desert', 'tundra'] as const) {
    const habit = DESIGNS[kind][place].habit
    if (!habit || habit === 'air') continue
    for (const tier of [1, 2, 3, 4] as const) for (const phase of [0, 4, 8, 12]) {
      const c = canvas(width, 20, true), right = width - 14
      const look = { place, frame: 0, night: 0, top: 0, wind: 0, effects: false, crewGround: 14,
        crewSurface: { ground: { y: 14, x0: 0, x1: right }, water: { y: 16, spans: [{ x0: 0, x1: right }] }, perches: [] },
        crewHard: [{ x: right, y: 0, w: 14, h: 20 }], crewZones: [], crewSpriteZones: [], crewBoxes: {} } as unknown as Look
      const job: Job = { kind, tier, seed: 0, phase, isStale: false, hit: { id: 'one', title: 'one', details: [] }, hitOwner: 1 }
      const placed = placeFly(c, look, right >> 1, 5, job, right)!
      const box = look.crewBoxes!.one!
      expect(box.x0).toBe(placed.x)
      expect(box.x1).toBe(placed.x + placed.w - 1)
      const owned = Array.from(c.hitOwners!).flatMap((owner, i) => owner === 1 ? [i] : [])
      expect(owned.length).toBeGreaterThan(0)
      expect(Math.max(...owned.map(i => Math.floor(i / width))), `${kind}.${place} ${width} tier ${tier} phase ${phase}`).toBe(habit === 'water' ? 17 - Number(Math.sin(phase * 0.12) > 0.3) : 14)
      expect(Math.max(...owned.map(i => i % width))).toBeLessThan(right)
    }
  }
})

test('several grounded workers stay separate and away from Mochi', () => {
  for (const width of [80, 140]) for (const count of [1, 3, 5]) {
    const c = canvas(width, 20, true), right = width - 14
    const look = { place: 'desert', frame: 0, night: 0, top: 0, wind: 0, effects: false, crewGround: 16,
      crewSurface: { ground: { y: 16, x0: 0, x1: right }, perches: [] }, crewHard: [{ x: right, y: 0, w: 14, h: 20 }], crewZones: [], crewSpriteZones: [], crewBoxes: {} } as unknown as Look
    const boxes = Array.from({ length: count }, (_, i) => placeFly(c, look, Math.round((i + 0.5) * right / count), 5,
      { kind: 'claude', tier: 1, seed: i, phase: 0, isStale: false, hit: { id: `${i}`, title: `${i}`, details: [] }, hitOwner: i + 1 }, right)!)
    for (const [i, box] of boxes.entries()) {
      expect(box.x + box.w).toBeLessThanOrEqual(right)
      expect(box.y + box.h - 1).toBe(16)
      for (const other of boxes.slice(i + 1)) expect(box.x + box.w <= other.x || other.x + other.w <= box.x).toBe(true)
    }
  }
})

test('surface workers still roam when foreground forces a soft placement', () => {
  for (const [kind, preset] of [['codex', 'harbor'], ['codex', 'countryside'], ['claude', 'harbor'], ['claude', 'desert']] as const) {
    const xs = new Set<number>()
    for (let frame = 0; frame < 600; frame += 15) {
      const anchors: number[] = []
      scenePixels({ width: 60, frame, hour: 12, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false, weather: { cloud: 0.1, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, preset, seed: 12345, turns: [], live: null, mood: 'work', plan: null, effect: null, effects: false, agents: [], jobs: [{ isStale: false, seed: 6, kind, tier: 4, pace: 0.8 }] }, anchors)
      xs.add(anchors[0]! % 60)
    }
    expect(xs.size, `${kind}.${preset}`).toBeGreaterThan(1)
  }
})

test('resting workers claim distinct scenery perches', () => {
  const c = canvas(100, 20)
  const look = { place: 'city', frame: 0, night: 0, top: 0, wind: 0, effects: false, crewGround: 15,
    crewSurface: { ground: { y: 15, x0: 0, x1: 85 }, perches: [{ x: 18, y: 10 }, { x: 45, y: 10 }, { x: 70, y: 10 }] },
    crewZones: [], crewSpriteZones: [], crewHard: [], crewBoxes: {} } as unknown as Look
  const first = placeFly(c, look, 18, 5, { kind: 'claude', tier: 1, seed: 0, isStale: true }, 85)!
  const second = placeFly(c, look, 18, 5, { kind: 'claude', tier: 1, seed: 1, isStale: true }, 85)!
  expect(first.x).not.toBe(second.x)
  expect(look.crewSurface!.perches.some(p => p.x === first.x + (first.w >> 1))).toBe(true)
  expect(look.crewSurface!.perches.some(p => p.x === second.x + (second.w >> 1))).toBe(true)
})

test('landing and takeoff interpolate between flight and the perch', () => {
  const at = (settle: number) => {
    const c = canvas(100, 20)
    const look = { place: 'forest', frame: 0, night: 0, top: 0, wind: 0, effects: false, crewGround: 16,
      crewSurface: { ground: { y: 16, x0: 0, x1: 85 }, perches: [{ x: 40, y: 12 }] }, crewZones: [], crewSpriteZones: [], crewHard: [] } as unknown as Look
    return placeFly(c, look, 30, 4, { kind: 'claude', tier: 1, seed: 0, isStale: true, settle }, 85)!
  }
  const flying = at(0), midway = at(0.5), resting = at(1)
  expect(midway.x).toBeGreaterThan(flying.x)
  expect(midway.x).toBeLessThan(resting.x)
  expect(midway.y).toBeGreaterThan(flying.y)
  expect(midway.y).toBeLessThan(resting.y)
})
