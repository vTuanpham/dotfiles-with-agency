import { expect, test } from 'claude-code/testing'
import { ALL_LANTERNS, lanternInk, lanternNose, lanternPaper, lanternPose } from '../hooks/landscapes/lantern'
import { fly } from '../hooks/landscapes/crew'
import { CRAFT_MAX } from '../hooks/landscapes/craft'
import { DESIGNS } from '../hooks/landscapes/design'
import { crewFx, type Aura } from '../hooks/landscapes/fx'
import { clockRate, gait } from '../hooks/landscapes/gait'
import { type Look, P } from '../hooks/landscapes/kit'
import { canvas, mix } from '../hooks/pixels'
import { react } from '../hooks/reactions'
import { styleFor } from '../hooks/exit-styles'

const tiers = [1, 2, 3, 4] as const
const places = Object.keys(ALL_LANTERNS) as (keyof typeof ALL_LANTERNS)[]
const mask = (art: readonly string[]) => art.map(row => row.replace(/[^.]/g, '#')).join('\n')

test('festival lanterns grow sideways by length inside the shared seven-row budget', () => {
  for (const place of places) {
    let area = 0
    for (const tier of tiers) {
      const frames = ALL_LANTERNS[place][tier], w = frames[0]![0]!.length, h = frames[0]!.length
      expect(frames.length).toBe(8)
      expect(w).toBeLessThanOrEqual(CRAFT_MAX.w)
      expect(h).toBeLessThanOrEqual(CRAFT_MAX.h)
      expect(w * h).toBeGreaterThan(area); area = w * h
      for (const art of frames) {
        expect(art.length).toBe(h)
        expect(art.every(row => row.length === w)).toBe(true)
        for (const ch of ['a', 'l', 'd', 'p', 's']) expect(art.join('')).toContain(ch)
      }
    }
  }
})

test('paper, ribbon, flame windows and tassels form one connected body on every beat', () => {
  for (const place of places) for (const tier of tiers) for (const art of ALL_LANTERNS[place][tier]) {
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

test('each lantern is a filled saturated shade around a large filled warm window, never a light outline', () => {
  for (const place of places) for (const tier of tiers) for (let beat = 0; beat < 8; beat++) {
    const pose = lanternPose(place, tier, beat)
    for (const lamp of pose.lamps) {
      const { x, y, w, h } = lamp.window
      expect(w).toBe(tier === 1 ? 1 : 2)
      expect(h).toBe(2)
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) expect(['s', 'f']).toContain(pose.rows[y + dy]![x + dx])
      const shade = lamp.shade, cells = pose.rows.slice(shade.y, shade.y + shade.h).flatMap(row => [...row.slice(shade.x, shade.x + shade.w)])
      expect(cells.filter(ch => ch !== '.').length, `${place} ${tier} solid shade`).toBeGreaterThanOrEqual(shade.w * shade.h * 0.75)
      const paper = cells.filter(ch => ch !== '.' && ch !== 's' && ch !== 'f')
      expect(paper.filter(ch => ch === 'a').length, `${place} ${tier} paper dominates its rib and caps`).toBeGreaterThanOrEqual(paper.length * 0.6)
      expect(paper.filter(ch => ch === 'l').length).toBeLessThanOrEqual(1)
    }
  }
})

test('the shades and ribbon move occupied cells, with eight different silhouettes per place', () => {
  for (let beat = 0; beat < 8; beat++) {
    expect(new Set(places.map(place => mask(ALL_LANTERNS[place][4][beat]!))).size, `local silhouettes beat ${beat}`).toBe(8)
  }
  for (const place of places) for (const tier of tiers) {
    const frames = ALL_LANTERNS[place][tier]
    const masks = frames.map(art => [...mask(art)])
    const changed = masks.flatMap(a => masks.map(b => a.filter((ch, i) => ch !== b[i]).length))
    expect(Math.max(...changed), `${place} ${tier} structure moves`).toBeGreaterThanOrEqual([0, 6, 12, 16, 20][tier]!)
    for (let beat = 0; beat < 8; beat++) expect(frames[beat]).not.toEqual(frames[(beat + 1) % 8])
  }
})

test('the voice follows the visible lead flame and pressure drives both the flare and heat anchors', () => {
  for (const place of places) for (const tier of tiers) for (let beat = 0; beat < 8; beat++) {
    const pose = lanternPose(place, tier, beat), [x, y] = lanternNose(place, tier, beat)
    expect(pose.rows[y]![x]).toBe('s')
    expect(pose.force).toBeGreaterThanOrEqual(0); expect(pose.force).toBeLessThanOrEqual(1)
    expect(pose.rows[pose.heat[1]]?.[pose.heat[0]] ?? '.').toBe('.')
    expect(pose.lamps.length).toBe([0, 1, 2, 3, 5][tier])
    for (const lamp of pose.lamps) expect(pose.rows[lamp.flame[1]]![lamp.flame[0]]).toBe('s')
  }
  for (const place of places) for (const tier of tiers) {
    const flickers = lanternPose(place, tier, 0).lamps.map((_, i) => Array.from({ length: 8 }, (_, beat) => {
      const pose = lanternPose(place, tier, beat), { x, y, w, h } = pose.lamps[i]!.window
      return pose.rows[y + h - 1]![x + w - 1]
    }))
    for (const flicker of flickers) {
      expect(flicker, `${place} ${tier} flame grows`).toContain('f')
      expect(flicker, `${place} ${tier} flame relaxes`).toContain('s')
    }
    expect(new Set(flickers.map(f => f.join(''))).size).toBe(flickers.length)
  }
})

test('seed ink stays with each worker and drifting sisters never acquire a heading', () => {
  const inks = new Set(Array.from({ length: 100 }, (_, seed) => lanternInk(seed)))
  expect(inks.size).toBe(5)
  for (const ink of inks) expect([P.green, P.yellow, P.red, P.blue, P.lavender]).toContain(ink)
  const rgb = (color: number) => [color >> 16 & 255, color >> 8 & 255, color & 255]
  for (const ink of inks) for (const night of [0, 1]) {
    const paper = rgb(lanternPaper(ink, night)), source = rgb(ink)
    // The paper keeps the worker's hue order, with visible saturation and a brighter warm window.
    expect(paper.indexOf(Math.max(...paper))).toBe(source.indexOf(Math.max(...source)))
    expect(paper.indexOf(Math.min(...paper))).toBe(source.indexOf(Math.min(...source)))
    expect(Math.min(...paper) / Math.max(...paper)).toBeLessThan(0.65)
    expect(Math.max(...paper)).toBeLessThan(Math.min(...rgb(P.yellow)))
  }
  for (const place of places) {
    const d = DESIGNS.opencode[place]
    expect(d.facing).toBe(null); expect(d.turn).toBe('none'); expect(d.cruise).toBe(false)
    expect(d.escorts[3]!.length).toBe(1); expect(d.escorts[4]!.length).toBe(2)
  }
})

test('sister lanterns keep clear of the leader through the widest, fastest real drift', () => {
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
    expect(pieces, `${place} ${tier} phase ${phase} separate lanterns`).toBe(tier - 1)
  }
})

test('heat, embers and the lead flame voice leave every solid lantern cell intact by day and night', () => {
  for (const place of places) for (const tier of tiers) for (let beat = 0; beat < 8; beat++) for (const night of [0, 1]) {
    const job = { kind: 'opencode' as const, tier, seed: 0, isStale: false, phase: beat * 1.5, talk: { ms: 1050, sending: true } }
    const look = { place, frame: 0, night, wind: 12, crewGround: 18 } as Look
    const bare = canvas(40, 20), air = canvas(40, 20)
    fly(bare, { ...look, effects: false }, 20, 10, job, 'opencode', false, () => [20, 10], [])
    fly(air, { ...look, effects: true }, 20, 10, job, 'opencode', false, () => [20, 10], [])
    for (let i = 0; i < bare.px.length; i++) if (bare.px[i]) expect(air.px[i], `${place} ${tier} ${beat} solid ink`).toBe(bare.px[i])
  }
})

test('the lead flame waits for the shared message lead before speaking', () => {
  const aura: Aura = { kind: 'opencode', tier: 4, seed: 2, phase: 0, pace: 1, lift: 0, ground: 18,
    w: 19, h: 7, x0: 11, y0: 7, cx: 20, cy: 10, path: () => [20, 10] }
  const draw = (ms?: number) => {
    const c = canvas(40, 20)
    crewFx(c, { place: 'city', night: 0, wind: 0, effects: true } as Look, { ...aura, ...(ms === undefined ? {} : { talk: { ms, sending: true } }) })
    return [...c.px]
  }
  expect(draw(600)).toEqual(draw())
  expect(draw(1050)).not.toEqual(draw())
  const sprite = (ms: number, over?: number) => {
    const c = canvas(40, 20)
    fly(c, { place: 'city', frame: 6, night: 0, effects: false } as Look, 20, 10,
      { kind: 'opencode', tier: 4, seed: 0, isStale: false, talk: { ms, sending: true, over } }, 'opencode', false, () => [20, 10], [])
    return [...c.px]
  }
  expect(sprite(600)).toEqual(sprite(0))
  expect(sprite(1050)).not.toEqual(sprite(600))
  expect(sprite(1050, 0)).toEqual(sprite(600))
})

test('a message brightens the seed fabric with white and uses only festival confetti colours', () => {
  const c = canvas(40, 20, true), ink = lanternInk(0)
  c.withHit(1, () => c.set(20, 10, ink))
  react(c, [{ id: 'lantern' }], [{ id: 'lantern', role: 'land', v: 1, t: 0 }], () => 'opencode')
  expect(c.get(20, 10)).toBe(mix(ink, P.white, 0.5))
  const confetti = [P.green, P.yellow, P.red, P.blue, P.lavender].map(color => mix(0, mix(color, P.white, 0.45), 0.9))
  for (let i = 0; i < c.px.length; i++) if (c.px[i] && i !== 10 * c.W + 20) expect(confetti).toContain(c.px[i])
  const debris: number[] = []
  styleFor('opencode', 'city', true)({ c, p: 0.55, seed: 0, arriving: false, cx: 20, cy: 10,
    x0: 10, x1: 30, y0: 6, y1: 13, flip: 1, sprite: () => {}, behind: () => 0,
    lit: (_x, _y, color, alpha) => { if (alpha > 0) debris.push(color) } })
  expect(debris.filter(color => color === ink).length).toBe(4)
  expect(debris.filter(color => color === mix(ink, P.white, 0.55)).length).toBe(4)
  expect(debris.filter(color => color === P.yellow).length).toBe(2)
})
