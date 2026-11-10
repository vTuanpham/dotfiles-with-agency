import { expect, test } from 'claude-code/testing'
import { crewFx, surfaceLights } from '../hooks/landscapes/fx'
import { DESIGNS } from '../hooks/landscapes/design'
import { type Look, type SurfaceLight } from '../hooks/landscapes/kit'
import { passages } from '../hooks/exits'
import { canvas } from '../hooks/pixels'

test('light lands on the nearest roof or ground, weakens with height, and leaves sky untouched', () => {
  const render = (height: number) => {
    const c = canvas(24, 20)
    c.px.fill(0x202020)
    surfaceLights(c, { frame: 0, crewSurfaceAt: x => x < 12 ? 10 : 17 },
      [{ x: 12, y: height, color: 0xffffff, radius: 5, alpha: .5 }])
    return c
  }
  const high = render(2), low = render(8)
  expect(low.get(11, 10)).toBeGreaterThan(high.get(11, 10))
  expect(low.get(13, 17)).toBeGreaterThan(0x202020)
  for (let y = 0; y < 20; y++) for (let x = 0; x < 24; x++) if (y !== (x < 12 ? 10 : 17)) expect(low.get(x, y)).toBe(0x202020)
})

test('every distant design omits surface lighting and shadows', () => {
  for (const kind of ['codex', 'claude', 'agy', 'opencode'] as const) for (const [place, design] of Object.entries(DESIGNS[kind])) {
    if (design.depth !== 'far') continue
    const lights: SurfaceLight[] = []
    const look = { place, night: 1, wind: 0, frame: 10, crewLights: lights } as Look
    crewFx(canvas(40, 20), look, { kind, tier: 4, seed: 1, x0: 10, y0: 2, w: 15, h: 7, cx: 17, cy: 5, pace: .5, phase: 10, lift: 0, ground: 18, path: () => [17, 5] })
    expect(lights, `${kind}/${place}`).toEqual([])
  }
})

test('warp moves the light source without lifting a patch of scenery', () => {
  const c = canvas(80, 24, true)
  c.px.fill(0x202020)
  const background = c.px.slice(), lights = [{ id: 'dragon', x: 37, y: 12, color: 0x80ffff, radius: 6, alpha: .4 }]
  c.withHit(1, () => c.rect(35, 9, 5, 3, 0xffffff))
  passages(c, [{ id: 'dragon' }], [{ id: 'dragon', kind: 'codex', place: 'city', seed: 1, age: 1400, arriving: false }], background,
    { dragon: { x0: 35, x1: 39, y0: 9, y1: 11 } }, undefined, lights)
  expect(lights[0]!.y).toBeLessThan(12)
  const before = c.px.slice()
  surfaceLights(c, { frame: 0, crewSurfaceAt: () => 20 }, lights)
  for (let y = 0; y < 24; y++) if (y !== 20) for (let x = 0; x < 80; x++) expect(c.get(x, y)).toBe(before[y * 80 + x])
})
