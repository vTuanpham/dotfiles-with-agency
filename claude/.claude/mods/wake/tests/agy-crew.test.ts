import { expect, test } from 'claude-code/testing'
import { ALL_AGY, agyCore, agyOrbit, agyPulse } from '../hooks/landscapes/agy'
import { CRAFT_MAX } from '../hooks/landscapes/craft'
import { DESIGNS, type Tier } from '../hooks/landscapes/design'
import { CREW } from '../hooks/landscapes/fx'
import { fly, shape } from '../hooks/landscapes/crew'
import { canvas, mix } from '../hooks/pixels'
import { P, type Look } from '../hooks/landscapes/kit'

const tiers: readonly Tier[] = [1, 2, 3, 4]
const places = Object.keys(ALL_AGY) as (keyof typeof ALL_AGY)[]
const mask = (rows: readonly string[]) => rows.join('').replace(/[^.]/g, '#')
const look: Look = {
  W: 50, H: 24, frame: 0, seed: 1, hour: 13, night: 0, isDay: true, phase: 'afternoon',
  blend: { dawn: 0, morning: 0, noon: 0, afternoon: 1, dusk: 0, night: 0 }, top: P.blue, horizon: P.sky,
  season: 'summer', snowy: false, wet: false, wind: 0, working: false, effects: false,
}

test('agy has eight shaded beats of a few stars within the shared footprint, growing through four classes', () => {
  for (const place of places) {
    let area = 0
    for (const tier of tiers) {
      const frames = ALL_AGY[place][tier], w = frames[0]![0]!.length, h = frames[0]!.length
      expect(frames.length).toBe(8)
      expect(w).toBeLessThanOrEqual(CRAFT_MAX.w)
      expect(h).toBeLessThanOrEqual(CRAFT_MAX.h)
      expect(w * h).toBeGreaterThan(area); area = w * h
      for (const [beat, rows] of frames.entries()) {
        expect(rows.length).toBe(h)
        expect(rows.every(row => row.length === w)).toBe(true)
        expect(new Set(rows.join('').replaceAll('.', '')).size).toBeGreaterThanOrEqual(3)
        const stars = [...rows.join('')].filter(ch => ch === 'W' || ch === 'M').length
        expect(stars >= 3 && stars <= 9, `${place} ${tier} beat ${beat}: a few bright stars, not a cloud of them`).toBe(true)
        const [x, y] = agyCore(place, tier, beat), pulse = agyPulse(place, tier, beat)
        expect(rows[y]![x], `${place} visible light core`).toBe('M')
        expect(rows[pulse.y]![pulse.x], `${place} physical shedding point`).not.toBe('.')
        expect(pulse.force >= 0 && pulse.force <= 1).toBe(true)
      }
    }
  }
})

test('agy moves its figure rather than only blinking, with eight different silhouettes', () => {
  const minimum = { 1: 4, 2: 6, 3: 8, 4: 10 }
  for (const place of places) for (const tier of tiers) {
    const frames = ALL_AGY[place][tier], masks = frames.map(mask)
    const changes = masks.flatMap(a => masks.map(b => [...a].filter((cell, i) => cell !== b[i]).length))
    expect(Math.max(...changes), `${place} class ${tier} structural stroke`).toBeGreaterThanOrEqual(minimum[tier])
    for (let beat = 0; beat < 8; beat++) expect(frames[beat], `${place} ${tier} loop seam`).not.toEqual(frames[(beat + 1) % 8])
  }
  for (let beat = 0; beat < 8; beat++) expect(new Set(places.map(place => mask(ALL_AGY[place][4][beat]!))).size).toBe(8)
})

test('agy satellites follow beat-locked ellipses and the same core in both half-orbits', () => {
  for (const place of places) for (const tier of tiers) for (const beat of [0, 1.25, 2.5, 4, 6.75]) {
    const [cx, cy] = agyCore(place, tier, Math.floor(beat))
    const a = agyOrbit(place, tier, beat), b = agyOrbit(place, tier, beat, Math.PI)
    expect(Math.abs(((a[0] - cx) / 2.6) ** 2 + ((a[1] - cy) / 2.2) ** 2 - 1)).toBeLessThan(0.00001)
    expect(Math.abs(a[0] + b[0] - 2 * cx) + Math.abs(a[1] + b[1] - 2 * cy)).toBeLessThan(0.00001)
  }
})

test('agy sends from its current luminous face, preserves solid light under effects and has small companions', () => {
  for (const place of places) {
    expect(DESIGNS.agy[place].escorts[3]!.length).toBeGreaterThan(0)
    expect(DESIGNS.agy[place].escorts[4]!.length).toBeGreaterThan(0)
    expect(CREW.agy[place]!.talking![0]!.at).toBe('nose')
    for (const tier of tiers) for (let beat = 0; beat < 8; beat++) {
      const job = { kind: 'agy' as const, tier, seed: 0, isStale: false, phase: beat * 1.5, talk: { ms: 1200, sending: true } }
      const bare = canvas(50, 24), lit = canvas(50, 24)
      fly(bare, { ...look, place }, 25, 10, job, 'agy', false, () => [25, 10], [])
      fly(lit, { ...look, place, night: 1, effects: true }, 25, 10, job, 'agy', false, () => [25, 10], [])
      for (let i = 0; i < bare.px.length; i++) if (bare.px[i]) expect(lit.px[i], `${place} ${tier} body stays solid`).toBe(bare.px[i])
      for (const mirror of [1, -1] as const) {
        const rows = shape(ALL_AGY[place][tier][beat]!, mirror, undefined, DESIGNS.agy[place].turn)
        const [x, y] = agyCore(place, tier, beat)
        expect(rows[y]![mirror > 0 ? x : rows[0]!.length - 1 - x]).toBe('M')
      }
    }
  }
})

test('agy keeps its projected core visible through the turn before speech', () => {
  for (const place of places) {
    const design = DESIGNS.agy[place]
    if (!design.facing) continue
    for (const tier of tiers) for (const ms of [150, 300, 450, 600, 750]) {
      const roll = ms / 900, mirror = roll < 0.5 ? 1 : -1
      const marker = shape(ALL_AGY[place][tier][0]!.map(row => row.replace(/[^M]/g, '.')), mirror, roll, design.turn)
      const c = canvas(50, 24)
      fly(c, { ...look, place }, 25, 10, { kind: 'agy', tier, seed: 0, isStale: false, phase: 0, talk: { ms, sending: true } }, 'agy', false, ago => [25 + ago, 10], [])
      for (const [y, row] of marker.entries()) {
        const x = row.indexOf('M')
        if (x >= 0) expect(c.get(25 - (row.length >> 1) + x, 10 - (marker.length >> 1) + y), `${place} ${tier} core at ${ms}ms`).toBe(mix(P.mauve, P.white, 0.7))
      }
    }
  }
})
