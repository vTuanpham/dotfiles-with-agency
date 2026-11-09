import { expect, test } from 'claude-code/testing'

import { type Emitter, type Light, coneEnd, emit, shine } from '../hooks/landscapes/particles'
import { PhaseClock, clockRate, gait, paceOf } from '../hooks/landscapes/gait'
import { canvas } from '../hooks/pixels'

const SPEC: Emitter = { count: 12, life: 1, speed: [2, 6], angle: [0, 6.28], gravity: 4, drag: 0.5, swirl: 0.5, colors: [0xffffff, 0x88aaff], alpha: 0.9, envelope: 'fade', streak: 2 }
const source = (t: number, at: (ago: number) => readonly [number, number] = () => [20, 10]) => ({ at, t, seed: 3, strength: 1, wind: 20 })
const draw = (e: Emitter, s: ReturnType<typeof source>) => { const c = canvas(40, 20); emit(c, e, s); return Array.from(c.px) }

test('an emitter is a pure function of its clock: the same inputs draw the same picture, and a stream keeps going', () => {
  expect(draw(SPEC, source(2.3))).toEqual(draw(SPEC, source(2.3)))
  expect(draw(SPEC, source(2.3))).not.toEqual(draw(SPEC, source(2.4)))
  for (const t of [0.1, 5.7, 120.3]) expect(draw(SPEC, source(t)).some(v => v !== 0), `t=${t}`).toBe(true)
})

test('a burst begins at its delay, ends with its life, and drawing out of bounds is harmless', () => {
  const burst: Emitter = { ...SPEC, burst: true, delay: 1, life: 0.8 }
  expect(draw(burst, source(0.5)).every(v => v === 0)).toBe(true) // not yet
  expect(draw(burst, source(1.3)).some(v => v !== 0)).toBe(true)
  expect(draw(burst, source(2.0)).every(v => v === 0)).toBe(true) // over
  expect(() => draw({ ...burst, speed: [500, 900] }, source(1.3))).not.toThrow()
})

test('played in reverse, a burst gathers into its origin: the cloud is smaller the later it is', () => {
  const spread = (px: number[]) => { const xs = px.flatMap((v, i) => (v ? [i % 40] : [])); return Math.max(...xs) - Math.min(...xs) }
  const burst: Emitter = { ...SPEC, burst: true, gravity: 0, swirl: 0, drag: 0, streak: 0, life: 1, envelope: 'pulse' }
  const out = [0.2, 0.5, 0.8].map(t => spread(draw(burst, source(t))))
  const gather = [0.2, 0.5, 0.8].map(t => spread(draw({ ...burst, reverse: true }, source(t))))
  expect(out[2]!).toBeGreaterThan(out[0]!)
  expect(gather[0]!).toBeGreaterThan(gather[2]!)
})

test('a stream follows a moving origin: its particles are born where the origin was, so a trail is the origin\'s own path', () => {
  const trail: Emitter = { count: 20, life: 1, speed: [0, 0], angle: [0, 0], colors: [0xffffff], alpha: 1, envelope: 'pulse' }
  const px = draw(trail, source(10, ago => [30 - ago * 20, 10])) // the origin moves right at 20 cells a second
  const xs = px.flatMap((v, i) => (v && Math.floor(i / 40) === 10 ? [i % 40] : []))
  expect(Math.min(...xs)).toBeLessThan(26) // particles still hang where it was a second ago, far behind it
})

test('a light shines only when it is dark enough, and a cone sweeps', () => {
  const lamp: Light = { shape: 'halo', color: 0xffff00, alpha: 0.8, reach: 2, from: 0.3 }
  const lit = (dark: number) => { const c = canvas(20, 20); shine(c, lamp, 10, 10, 0, dark, 1); return c.px.some(v => v !== 0) }
  expect(lit(0.1)).toBe(false)
  expect(lit(0.9)).toBe(true)
  const beam: Light = { shape: 'cone', color: 0xffff00, alpha: 1, reach: 10, angle: 2, modulate: 'sweep', swing: 0.7 }
  expect(coneEnd(beam, 10, 5, 0, 1)).not.toEqual(coneEnd(beam, 10, 5, 2, 1))
})

test('a worker\'s pace follows what it really did: busy after an event, calm when waiting or stalled, never idle while running', () => {
  const now = 1_000_000
  const busy = paceOf({ isStale: false, lastEventAt: now - 2_000 }, now)
  const later = paceOf({ isStale: false, lastEventAt: now - 100_000 }, now)
  expect(busy).toBeGreaterThan(0.9)
  expect(later).toBeLessThan(busy)
  expect(later).toBeGreaterThanOrEqual(0.35)
  expect(paceOf({ isStale: true, lastEventAt: now }, now)).toBeLessThan(0.2)
  expect(paceOf({ isStale: false, waitingForRoot: true, lastEventAt: now }, now)).toBeLessThan(0.2)
  expect(Math.abs(paceOf({ isStale: false }, now) - 0.45)).toBeLessThan(1e-9)
})

test('a change of pace never jumps a sprite: the gait clock only runs on, faster or slower, and a long pause owes at most half a second', () => {
  const clock = new PhaseClock()
  const a = clock.advance('w', 1, 1_000)
  const b = clock.advance('w', 1, 1_050), c = clock.advance('w', 0.1, 1_100)
  expect(Math.abs(b - a - 0.5 * clockRate(1))).toBeLessThan(1e-9)
  expect(Math.abs(c - b - 0.5 * clockRate(0.1))).toBeLessThan(1e-9)
  expect(c - b).toBeLessThan(b - a)
  expect(clock.advance('w', 1, 900_000) - c).toBeLessThanOrEqual(5 * clockRate(1) + 1e-9) // half a second, not fifteen minutes
})

test('every family\'s gait stays inside its unit square and keeps moving', () => {
  for (const kind of ['codex', 'claude', 'agy', 'opencode'] as const) for (const tier of [1, 2, 3, 4]) {
    const samples = Array.from({ length: 400 }, (_, i) => gait(kind, tier, 9, i * 0.5))
    for (const { u, v } of samples) { expect(Math.abs(u)).toBeLessThanOrEqual(1.0001); expect(Math.abs(v)).toBeLessThanOrEqual(1.0001) }
    expect(Math.max(...samples.map(s => s.u)) - Math.min(...samples.map(s => s.u)), `${kind} ${tier}`).toBeGreaterThan(0.8)
  }
})
