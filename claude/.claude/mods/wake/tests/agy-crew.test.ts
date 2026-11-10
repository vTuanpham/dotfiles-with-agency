import { expect, test } from 'claude-code/testing'
import { AGY_TEMPO, ALL_AGY, agyCore, agyOrbit, agyPulse } from '../hooks/landscapes/agy'
import { CRAFT_MAX } from '../hooks/landscapes/craft'
import { DESIGNS, type Tier } from '../hooks/landscapes/design'
import { CREW } from '../hooks/landscapes/fx'
import { fly, orient, shape } from '../hooks/landscapes/crew'
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

test('star lighting crosses each beat boundary continuously in daylight and at night', () => {
  for (const night of [0, 1]) for (let beat = 1; beat <= 8; beat++) {
    const render = (phase: number) => {
      const c = canvas(50, 24)
      c.px.fill(0x334455)
      fly(c, { ...look, place: 'city', night, effects: false }, 25, 10,
        { kind: 'agy', tier: 4, seed: 0, isStale: false, phase }, 'agy', false, () => [25, 10], [])
      return c.px
    }
    const before = render(beat * AGY_TEMPO - .01), after = render(beat * AGY_TEMPO + .01)
    for (let i = 0; i < before.length; i++) for (const shift of [0, 8, 16])
      expect(Math.abs((before[i]! >> shift & 255) - (after[i]! >> shift & 255))).toBeLessThan(3)
  }
})

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

test('agy holds its figure while light travels its lines', () => {
  for (const place of places) for (const tier of tiers) {
    const frames = ALL_AGY[place][tier], masks = frames.map(mask)
    expect(new Set(masks).size, `${place} class ${tier} fixed figure`).toBe(1)
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

test('agy sends from its current luminous face and preserves solid light under effects', () => {
  for (const place of places) {
    expect(DESIGNS.agy[place].escorts).toEqual({})
    expect(CREW.agy[place]!.talking![0]!.at).toBe('nose')
    for (const tier of tiers) for (let beat = 0; beat < 8; beat++) {
      const job = { kind: 'agy' as const, tier, seed: 0, isStale: false, phase: beat * AGY_TEMPO, talk: { ms: 1200, sending: true } }
      const bare = canvas(50, 24), lit = canvas(50, 24)
      fly(bare, { ...look, place, night: 1 }, 25, 10, job, 'agy', false, () => [25, 10], [])
      fly(lit, { ...look, place, night: 1, effects: true }, 25, 10, job, 'agy', false, () => [25, 10], [])
      const facing = DESIGNS.agy[place].facing
      const mirror = facing ? orient(() => [25, 10], facing, 0, job.talk).mirror : 1
      const solid = shape(ALL_AGY[place][tier][beat]!, mirror, undefined, DESIGNS.agy[place].turn)
      solid.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch !== '.' && ch !== 'e') {
          const i = (10 - (solid.length >> 1) + y) * 50 + 25 - (row.length >> 1) + x
          expect(lit.px[i], `${place} ${tier} solid star stays solid`).toBe(bare.px[i])
        }
      }))
      for (const mirror of [1, -1] as const) {
        const rows = shape(ALL_AGY[place][tier][beat]!, mirror, undefined, DESIGNS.agy[place].turn)
        const [x, y] = agyCore(place, tier, beat)
        expect(rows[y]![mirror > 0 ? x : rows[0]!.length - 1 - x]).toBe('M')
      }
    }
  }
})

test('agy keeps its figure and core fixed while aiming a message in either direction', () => {
  for (const place of places) {
    const design = DESIGNS.agy[place]
    expect(design.facing).toBe(null)
    for (const tier of tiers) for (const ms of [150, 300, 450, 600, 750]) {
      const frames = [5, 45].map(targetX => {
        const c = canvas(50, 24)
        fly(c, { ...look, place }, 25, 10, { kind: 'agy', tier, seed: 0, isStale: false, phase: 0, talk: { ms, sending: true, targetX } }, 'agy', false, ago => [25 + ago, 10], [])
        const art = ALL_AGY[place][tier][0]!, [x, y] = agyCore(place, tier, 0)
        expect(c.get(25 - (art[0]!.length >> 1) + x, 10 - (art.length >> 1) + y), `${place} ${tier} core at ${ms}ms`).toBe(mix(P.mauve, P.white, 0.7))
        return c.px
      })
      expect(frames[0]).toEqual(frames[1])
    }
  }
})
