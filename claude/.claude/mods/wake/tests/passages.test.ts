import { expect, test } from 'claude-code/testing'

import type { WakeChip } from '../types'
import { type BandState, passageStamps, sceneInput } from '../hooks/band'
import { ARRIVE_MS, EXIT_MS } from '../hooks/exits'
import { styleFor } from '../hooks/exit-styles'
import { canvas } from '../hooks/pixels'

// A worker's arrival and exit run on Wake's own clock. Bridge is read every few seconds, and its own start and finish
// times are already old by then; a passage measured from them would be over before the scan that finds it.

const T = 1_000_000

test('a worker first seen running a few seconds after it started still arrives, from the moment it was seen', () => {
  const stamps = passageStamps(undefined, { running: true, startedAt: T - 9_000 }, T)
  expect(stamps.arrivedAt).toBe(T)
})

test('a worker already running when Wake first looked does not replay its arrival', () => {
  expect(passageStamps(undefined, { running: true, startedAt: T - 10 * 60_000 }, T).arrivedAt).toBeUndefined()
})

test('a resumed worker arrives again; one that stays running keeps its first stamp', () => {
  expect(passageStamps({ running: false }, { running: true, startedAt: T - 3 * 3600_000 }, T).arrivedAt).toBe(T)
  expect(passageStamps({ running: true, arrivedAt: T - 20_000 }, { running: true }, T).arrivedAt).toBe(T - 20_000)
})

test('a worker seen to stop leaves from that moment, whenever Bridge says it finished', () => {
  expect(passageStamps({ running: true }, { running: false, finishedAt: T - 11_000 }, T).leftAt).toBe(T)
  expect(passageStamps({ running: false, leftAt: T - 5_000 }, { running: false, finishedAt: T - 16_000 }, T).leftAt).toBe(T - 5_000)
})

test('a finished worker Wake never saw run does not leave unless it just finished', () => {
  expect(passageStamps(undefined, { running: false, finishedAt: T - 60 * 60_000 }, T).leftAt).toBeUndefined()
  expect(passageStamps(undefined, { running: false, finishedAt: T - 6_000 }, T).leftAt).toBe(T)
})

const state = (chip: Partial<WakeChip>): BandState => ({
  here: null, tally: { turns: 0, added: 0, removed: 0, files: [], lastTurnMs: 0 }, turnStartedAt: null, pulse: [], plan: [], mood: 'idle', subagents: [],
  chips: [{ id: 'o/j', name: 'j', backend: 'codex', account: '01', model: '', effort: '', running: true, isStale: false, since: 0, ...chip }],
})
const job = (chip: Partial<WakeChip>, now: number) => sceneInput(state(chip), 120, 0, null, now).jobs[0]

test('the scene plays an arrival for ARRIVE_MS after the stamp, though Bridge started the job long before', () => {
  const chip = { arrivedAt: T, startedAt: T - 14_000 }
  expect(job(chip, T + 500)!.arriving).toBe(500)
  expect(job(chip, T + ARRIVE_MS - 1)!.arriving).toBe(ARRIVE_MS - 1)
  expect(job(chip, T + ARRIVE_MS)!.arriving).toBeUndefined()
})

test('the scene keeps a finished worker for EXIT_MS after it was seen to stop, then drops it', () => {
  const chip = { running: false, leftAt: T, since: T - 12_000 }
  expect(job(chip, T + 1_000)!.leaving).toBe(1_000)
  expect(job(chip, T + EXIT_MS)).toBeUndefined()
})

test('a worker with no stamp neither arrives nor leaves', () => {
  expect(job({}, T)!.arriving).toBeUndefined()
  expect(job({ running: false, since: T - 1_000 }, T)).toBeUndefined()
})

test('a worker whose last turn was interrupted leaves struck down; any other leaves as its place does', () => {
  const left = { running: false, leftAt: T, since: T - 12_000 }
  expect(job({ ...left, interrupted: true }, T + 500)!.struck).toBe(true)
  expect(job(left, T + 500)!.struck).toBeUndefined()
})

test('every family\'s strike ends clean and shows something on the way', () => {
  const clean = (kind: 'codex' | 'claude' | 'agy' | 'opencode', p: number) => {
    const c = canvas(40, 16)
    let marks = 0
    styleFor(kind, 'city', true)({ c, p, seed: 3, arriving: false, cx: 20, cy: 8, x0: 17, x1: 23, y0: 6, y1: 9, sprite: () => { marks++ }, lit: (x, y, color, alpha) => { if (alpha > 0) c.set(x, y, color) }, behind: () => p, flip: 1 })
    return { painted: c.px.some(px => px !== 0), marks }
  }
  for (const kind of ['codex', 'claude', 'agy', 'opencode'] as const) {
    expect(clean(kind, 0.3).painted, `${kind} sheds debris mid-fall`).toBe(true)
    expect(clean(kind, 1).painted, `${kind} leaves nothing at the end`).toBe(false)
  }
})
