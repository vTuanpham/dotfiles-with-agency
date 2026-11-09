import { expect, test } from 'claude-code/testing'
import { ALL_BALLOONS, BALLOON_MAX, balloonNose, balloonPose } from '../hooks/landscapes/balloon'
import { balloonInk, fly } from '../hooks/landscapes/crew'
import { DESIGNS } from '../hooks/landscapes/design'
import { crewFx, type Aura } from '../hooks/landscapes/fx'
import { clockRate, gait } from '../hooks/landscapes/gait'
import { type Look, P } from '../hooks/landscapes/kit'
import { canvas, mix } from '../hooks/pixels'
import { react } from '../hooks/reactions'

const tiers = [1, 2, 3, 4] as const
const places = Object.keys(ALL_BALLOONS) as (keyof typeof ALL_BALLOONS)[]
const mask = (art: readonly string[]) => art.map(row => row.replace(/[^.]/g, '#')).join('\n')

test('festival balloons grow sideways inside their narrow nine-row exception', () => {
  for (const place of places) {
    let area = 0
    for (const tier of tiers) {
      const frames = ALL_BALLOONS[place][tier], w = frames[0]![0]!.length, h = frames[0]!.length
      expect(frames.length).toBe(8)
      expect(w).toBeLessThanOrEqual(BALLOON_MAX.w)
      expect(h).toBeLessThanOrEqual(BALLOON_MAX.h)
      expect(w * h).toBeGreaterThan(area); area = w * h
      for (const art of frames) {
        expect(art.length).toBe(h)
        expect(art.every(row => row.length === w)).toBe(true)
        for (const ch of ['a', 'l', 'd', 'h', 'p']) expect(art.join('')).toContain(ch)
      }
    }
  }
})

test('fabric, bunting, rigging, flame and basket form one connected body on every beat', () => {
  for (const place of places) for (const tier of tiers) for (const art of ALL_BALLOONS[place][tier]) {
    const w = art[0]!.length
    const cells = new Set(art.flatMap((row, y) => [...row].flatMap((ch, x) => ch === '.' ? [] : [y * w + x])))
    const first = cells.values().next().value!, seen = new Set([first]), queue = [first]
    for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = queue[i]! % w + dx!, y = Math.floor(queue[i]! / w) + dy!, cell = y * w + x
      if (x < 0 || x >= w || y < 0 || y >= art.length || !cells.has(cell) || seen.has(cell)) continue
      seen.add(cell); queue.push(cell)
    }
    expect(seen.size, `${place} ${tier} connected`).toBe(cells.size)
  }
})

test('the envelope and hanging cloth move occupied cells, with eight different silhouettes per place', () => {
  for (let beat = 0; beat < 8; beat++) {
    expect(new Set(places.map(place => mask(ALL_BALLOONS[place][4][beat]!))).size, `local silhouettes beat ${beat}`).toBe(8)
  }
  for (const place of places) for (const tier of tiers) {
    const frames = ALL_BALLOONS[place][tier]
    const masks = frames.map(art => [...mask(art)])
    const changed = masks.flatMap(a => masks.map(b => a.filter((ch, i) => ch !== b[i]).length))
    expect(Math.max(...changed), `${place} ${tier} structure moves`).toBeGreaterThanOrEqual([0, 8, 12, 16, 20][tier]!)
    for (let beat = 0; beat < 8; beat++) expect(frames[beat]).not.toEqual(frames[(beat + 1) % 8])
  }
})

test('the voice follows the visible burner and pressure drives both the flare and heat anchors', () => {
  for (const place of places) for (const tier of tiers) for (let beat = 0; beat < 8; beat++) {
    const pose = balloonPose(place, tier, beat), [x, y] = balloonNose(place, tier, beat)
    expect(['s', 'W']).toContain(pose.rows[y]![x])
    expect(pose.force).toBeGreaterThanOrEqual(0); expect(pose.force).toBeLessThanOrEqual(1)
    expect(pose.rows[pose.heat[1]]?.[pose.heat[0]] ?? '.').toBe('.')
    expect(pose.rows[pose.ember[1]]?.[pose.ember[0]] ?? '.').toBe('.')
    if (pose.force > 0.4) expect(pose.rows[y]![x]).toBe('W')
  }
})

test('seed ink stays with each worker and drifting sisters never acquire a heading', () => {
  const inks = new Set(Array.from({ length: 100 }, (_, seed) => balloonInk(seed)))
  expect(inks.size).toBe(5)
  for (const ink of inks) expect([P.green, P.yellow, P.red, P.blue, P.lavender]).toContain(ink)
  for (const place of places) {
    const d = DESIGNS.opencode[place]
    expect(d.facing).toBe(null); expect(d.turn).toBe('none'); expect(d.cruise).toBe(false)
    expect(d.escorts[3]!.length).toBe(1); expect(d.escorts[4]!.length).toBe(2)
  }
})

test('sister balloons keep clear of the leader through the widest, fastest real drift', () => {
  for (const place of places) for (const tier of [3, 4] as const) for (let phase = 0; phase < 360; phase += 3) {
    const c = canvas(120, 20), at = (ago: number) => {
      const g = gait('opencode', tier, 0, phase - ago * 10 * clockRate(1), 26)
      return [60 + 26 * g.u, 10 - 3 * g.v] as const
    }
    const [cx, cy] = at(0)
    fly(c, { place, frame: 0, effects: false, night: 0 } as Look, Math.round(cx), Math.round(cy),
      { kind: 'opencode', tier, seed: 0, isStale: false, phase, pace: 1 }, 'opencode', false, at)
    const remaining = new Set([...c.px].flatMap((color, i) => color ? [i] : []))
    let pieces = 0
    while (remaining.size) {
      pieces++
      const queue = [remaining.values().next().value!]; remaining.delete(queue[0]!)
      for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const x = queue[i]! % c.W + dx!, y = Math.floor(queue[i]! / c.W) + dy!, cell = y * c.W + x
        if (x < 0 || x >= c.W || y < 0 || y >= c.H || !remaining.has(cell)) continue
        remaining.delete(cell); queue.push(cell)
      }
    }
    expect(pieces, `${place} ${tier} phase ${phase} separate balloons`).toBe(tier - 1)
  }
})

test('heat, embers and the burner voice leave every solid balloon cell intact by day and night', () => {
  for (const place of places) for (const tier of tiers) for (let beat = 0; beat < 8; beat++) for (const night of [0, 1]) {
    const job = { kind: 'opencode' as const, tier, seed: 0, isStale: false, phase: beat * 1.5, talk: { ms: 1050, sending: true } }
    const look = { place, frame: 0, night, wind: 12, crewGround: 18 } as Look
    const bare = canvas(40, 20), air = canvas(40, 20)
    fly(bare, { ...look, effects: false }, 20, 10, job, 'opencode', false, () => [20, 10], [])
    fly(air, { ...look, effects: true }, 20, 10, job, 'opencode', false, () => [20, 10], [])
    for (let i = 0; i < bare.px.length; i++) if (bare.px[i]) expect(air.px[i], `${place} ${tier} ${beat} solid ink`).toBe(bare.px[i])
  }
})

test('the burner waits for the shared message lead before speaking', () => {
  const aura: Aura = { kind: 'opencode', tier: 4, seed: 2, phase: 0, pace: 1, lift: 0, ground: 18,
    w: 13, h: 9, x0: 14, y0: 6, cx: 20, cy: 10, path: () => [20, 10] }
  const draw = (ms?: number) => {
    const c = canvas(40, 20)
    crewFx(c, { place: 'city', night: 0, wind: 0, effects: true } as Look, { ...aura, ...(ms === undefined ? {} : { talk: { ms, sending: true } }) })
    return [...c.px]
  }
  expect(draw(600)).toEqual(draw())
  expect(draw(1050)).not.toEqual(draw())
  const sprite = (ms: number) => {
    const c = canvas(40, 20)
    fly(c, { place: 'city', frame: 6, night: 0, effects: false } as Look, 20, 10,
      { kind: 'opencode', tier: 4, seed: 0, isStale: false, talk: { ms, sending: true } }, 'opencode', false, () => [20, 10], [])
    return [...c.px]
  }
  expect(sprite(600)).toEqual(sprite(0))
  expect(sprite(1050)).not.toEqual(sprite(600))
})

test('a message brightens the seed fabric with white and uses only festival confetti colours', () => {
  const c = canvas(40, 20, true), ink = balloonInk(0)
  c.withHit(1, () => c.set(20, 10, ink))
  react(c, [{ id: 'balloon' }], [{ id: 'balloon', role: 'land', v: 1, t: 0 }], () => 'opencode')
  expect(c.get(20, 10)).toBe(mix(ink, P.white, 0.5))
  const confetti = [P.green, P.yellow, P.red, P.blue, P.lavender].map(color => mix(0, mix(color, P.white, 0.45), 0.9))
  for (let i = 0; i < c.px.length; i++) if (c.px[i] && i !== 10 * c.W + 20) expect(confetti).toContain(c.px[i])
})
