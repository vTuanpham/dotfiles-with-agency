import { expect, test } from 'claude-code/testing'
import { ALL_CREATURES, CREATURE_BEATS, creatureNose, creatureStroke } from '../hooks/landscapes/creatures'
import { CRAFT_MAX } from '../hooks/landscapes/craft'
import { DESIGNS } from '../hooks/landscapes/design'
import { fly } from '../hooks/landscapes/crew'
import { CREW, crewFx } from '../hooks/landscapes/fx'
import { TURN_LEAD_MS } from '../hooks/crew-row'
import { emit } from '../hooks/landscapes/particles'
import { canvas } from '../hooks/pixels'
import type { Look } from '../hooks/landscapes/kit'

const tiers = [1, 2, 3, 4] as const
const places = Object.keys(ALL_CREATURES) as (keyof typeof ALL_CREATURES)[]
const mask = (rows: readonly string[]) => rows.join('').replace(/[^.]/g, '#')

test('Claude grows a shaded creature through twelve poses inside the sky budget', () => {
  for (const place of places) {
    let area = 0
    for (const tier of tiers) {
      const frames = ALL_CREATURES[place][tier], w = frames[0]![0]!.length, h = frames[0]!.length
      expect(frames.length).toBe(CREATURE_BEATS)
      expect(w).toBeLessThanOrEqual(CRAFT_MAX.w); expect(h).toBeLessThanOrEqual(CRAFT_MAX.h)
      expect(w * h).toBeGreaterThan(area); area = w * h
      for (const [beat, art] of frames.entries()) {
        expect(art.length).toBe(h); expect(art.every(row => row.length === w)).toBe(true)
        const inks = new Set(art.join('').replaceAll('.', ''))
        expect(inks.size, `${place} ${tier} beat ${beat}: shaded, not one flat colour`).toBeGreaterThanOrEqual(3)
        if (tier > 1) expect(inks.has('s') || inks.has('W'), `${place} ${tier} beat ${beat}: a bright eye, bill or foot`).toBe(true)
        const filled = [...art.join('')].filter(ch => ch !== '.').length
        if (tier > 1) expect(filled / (w * h),`${place} ${tier} beat ${beat}: a shape with air around it, not a slab`).toBeLessThan(0.6)
        const [x, y] = creatureNose(place, tier, beat)
        expect(art[y]![x], `${place} ${tier} beat ${beat}: the face is on the body`).not.toBe('.')
        const stroke = creatureStroke(place, tier, beat)
        expect(art[stroke.y]![stroke.x]).not.toBe('.')
        expect(stroke.force).toBeGreaterThanOrEqual(0); expect(stroke.force).toBeLessThanOrEqual(1)
      }
    }
  }
})

test('Claude species have distinct silhouettes and move occupied structure across the wingbeat', () => {
  for (let beat = 0; beat < CREATURE_BEATS; beat++) expect(new Set(places.map(place => mask(ALL_CREATURES[place][4][beat]!))).size, `different silhouettes at beat ${beat}`).toBe(8)
  for (const place of places) for (const tier of tiers) {
    const silhouettes = ALL_CREATURES[place][tier].map(mask)
    const delta = silhouettes.flatMap(a => silhouettes.map(b => [...a].filter((ch, i) => ch !== b[i]).length))
    expect(Math.max(...delta), `${place} ${tier} structural movement`).toBeGreaterThanOrEqual([0, 1, 2, 4, 6][tier]!)
  }
})

test('Claude fronts, turns, cruise and flock belong to every species', () => {
  for (const place of places) {
    const d = DESIGNS.claude[place]
    expect(d.turn, `${place}: a creature seen face on has no heading to turn`).toBe(d.facing ? 'pose' : 'none')
    const flocking = ['city', 'countryside', 'tundra'].includes(place)
    expect(d.escorts[3]?.length ?? 0).toBe(flocking ? 1 : 0); expect(d.escorts[4]?.length ?? 0).toBe(flocking ? 2 : 0)
    expect(CREW.claude[place]!.talking![0]!.emitter.arc).toBe(true)
  }
})

test('Claude air cannot repaint the plumage, face or eye on either heading', () => {
  for (const place of places) for (const tier of tiers) for (const beat of [0, 3, 6, 9]) for (const direction of [-1, 1]) {
    const maskCanvas = canvas(48, 20), bare = canvas(48, 20), air = canvas(48, 20), phase = beat * 1.5
    const look = { place, frame: phase, night: 1, wind: 8, crewGround: 18 } as Look
    const job = { kind: 'claude' as const, tier, seed: 0, isStale: false, phase }
    const path = (ago: number) => [24 - direction * ago * 10, 8] as const
    fly(maskCanvas, { ...look, night: 0, effects: false }, 24, 8, job, 'claude', false, path, [])
    fly(bare, { ...look, effects: false }, 24, 8, job, 'claude', false, path, [])
    fly(air, { ...look, effects: true }, 24, 8, job, 'claude', false, path, [])
    for (let i = 0; i < bare.px.length; i++) if (maskCanvas.px[i]) expect(air.px[i], `${place} ${tier} ${beat} heading ${direction}`).toBe(bare.px[i])
  }
})

test('a call arc has a curved three-cell profile and waits for its burst', () => {
  const dots: number[][] = [], c = { glow: (x: number, y: number) => { dots.push([x, y]) } }
  const emitter = { count: 1, life: 0.5, burst: true, speed: [8, 8] as const, angle: [0, 0] as const, colors: [0xffffff], alpha: 0.5, arc: true }
  const source = { at: () => [10, 10] as const, seed: 0, strength: 1, wind: 0 }
  emit(c, emitter, { ...source, t: -0.01 }); expect(dots.length).toBe(0)
  emit(c, emitter, { ...source, t: 0.2 }); expect(dots.length).toBe(3)
  expect(dots[1]![0]).toBe(dots[0]![0]! - 1); expect(dots[2]![1]! - dots[0]![1]!).toBeGreaterThan(0)
})

test('a feather keeps its birth stroke while it drifts after the wing has risen', () => {
  const ages: number[] = [], dots: number[][] = []
  const emitter = CREW.claude.beach!.streams![0]!.emitter
  const c = { glow: (x: number, y: number) => { dots.push([x, y]) } }
  emit(c, emitter, { at: () => [10, 10], t: 0.75, seed: 0, strength: 1, wind: 0, strengthAtBirth: age => { ages.push(age); return age > 0.05 ? 1 : 0 } })
  expect(ages.length).toBe(2); expect(ages.every(age => age > 0)).toBe(true)
  expect(dots.length).toBeGreaterThan(0)
})

test('a bird finishes aiming before its call leaves the current mirrored beak', () => {
  for (const place of places) for (const tier of tiers) for (const beat of [0, 3, 6, 9]) {
    const art = ALL_CREATURES[place][tier][beat]!, w = art[0]!.length, h = art.length
    const look = { place, frame: beat * 1.5, night: 0, wind: 0 } as Look
    const aura = { x0: 24 - (w >> 1), y0: 10 - (h >> 1), w, h, cx: 24, cy: 10, kind: 'claude' as const, tier, seed: 0, phase: beat * 1.5, pace: 1, lift: 0, ground: 19, flip: true, path: () => [24, 10] as const }
    const silent = canvas(48, 24)
    crewFx(silent, look, aura)
    for (const ms of [0, 450, TURN_LEAD_MS - 1]) {
      const aiming = canvas(48, 24)
      crewFx(aiming, look, { ...aura, talk: { ms, sending: true } })
      expect(Array.from(aiming.px), `${place} ${tier} call waits for its turn`).toEqual(Array.from(silent.px))
    }
    const speaking = canvas(48, 24)
    crewFx(speaking, look, { ...aura, talk: { ms: TURN_LEAD_MS + 250, sending: true } })
    const [bx, by] = creatureNose(place, tier, beat), beakX = aura.x0 + w - 1 - bx
    const changed = Array.from(speaking.px).flatMap((color, i) => color !== silent.px[i] ? [i] : [])
    expect(changed.length, `${place} ${tier} a visible call`).toBeGreaterThan(0)
    expect(changed.every(i => i % 48 >= beakX), `${place} ${tier} call is ahead of its beak at row ${by}`).toBe(true)
  }
})

test('the flock stays separate from its leader in either heading', () => {
  for (const place of places) for (const tier of [3, 4] as const) for (const direction of [-1, 1]) for (const beat of [0, 3, 6, 9]) {
    const c = canvas(120, 24)
    fly(c, { place, frame: 0, night: 0, effects: false } as Look, 60, 12, { kind: 'claude', tier, seed: 0, phase: beat * 1.5, isStale: false }, 'claude', false, ago => [60 - direction * 20 * ago, 12])
    const remaining = new Set(Array.from(c.px).flatMap((v, i) => v ? [i] : []))
    let pieces = 0
    while (remaining.size) {
      pieces++
      const first = remaining.values().next().value!, queue = [first]
      remaining.delete(first)
      // A creature's own antennae, wing tips and feet may sit a cell off its body; a flock mate is many cells away.
      for (let i = 0; i < queue.length; i++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = queue[i]! % c.W + dx, y = Math.floor(queue[i]! / c.W) + dy, cell = y * c.W + x
        if (x < 0 || x >= c.W || y < 0 || y >= c.H || !remaining.has(cell)) continue
        remaining.delete(cell); queue.push(cell)
      }
    }
    expect(pieces, `${place} ${tier} heading ${direction} beat ${beat}`).toBe(1 + (DESIGNS.claude[place].escorts[tier]?.length ?? 0))
  }
})
