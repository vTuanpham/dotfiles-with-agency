import { expect, test } from 'claude-code/testing'
import { PASSAGE_STYLES } from '../hooks/passage-styles'
import { styleFor } from '../hooks/exit-styles'
import { ARRIVE_MS, EXIT_MS, passages } from '../hooks/exits'
import { DESIGNS } from '../hooks/landscapes/design'
import { fly } from '../hooks/landscapes/crew'
import { type Look } from '../hooks/landscapes/kit'
import { canvas } from '../hooks/pixels'

const families = ['codex', 'claude', 'agy', 'opencode'] as const

test('every design selects its requested passage for entry and exit', () => {
  for (const kind of families) for (const [place, design] of Object.entries(DESIGNS[kind])) {
    if (design.enter) expect(styleFor(kind, place, false, true)).toBe(PASSAGE_STYLES[design.enter])
    if (design.leave) expect(styleFor(kind, place)).toBe(PASSAGE_STYLES[design.leave])
    expect(styleFor(kind, place, true)).not.toBe(styleFor(kind, place))
  }
})

test('entry and exit select their fields independently', () => {
  const design = DESIGNS.claude.beach, before = { enter: design.enter, leave: design.leave }
  try {
    design.enter = 'swoop'; design.leave = 'surface'
    expect(styleFor('claude', 'beach', false, true)).toBe(PASSAGE_STYLES.swoop)
    expect(styleFor('claude', 'beach')).toBe(PASSAGE_STYLES.surface)
    expect(styleFor('claude', 'beach', true)).not.toBe(PASSAGE_STYLES.surface)
  } finally { design.enter = before.enter; design.leave = before.leave }
})

test('every passage animates and finishes at all four classes', () => {
  for (const [name, kind, place] of [['surface', 'opencode', 'harbor'], ['ignite', 'agy', 'city'], ['unfold', 'opencode', 'city'], ['flight', 'claude', 'city'], ['warp', 'codex', 'city'], ['boot', 'codex', 'beach'], ['walk', 'claude', 'desert']] as const) for (const tier of [1, 2, 3, 4] as const) for (const arriving of [false, true]) {
    const render = (age: number) => {
      const c = canvas(80, 24, true)
      const job = { kind, tier, seed: 2, isStale: false, hit: { id: 'one', title: 'one', details: [] } }
      const look = { place, frame: 20, night: 0, top: 0x223344, wind: 0, effects: false, crewGround: 21 } as Look
      c.withHit(1, () => fly(c, look, 40, 10, job, kind, false, () => [40, 10], []))
      passages(c, [job.hit], [{ id: 'one', kind, place, seed: 2, age, arriving }])
      return Array.from(c.px)
    }
    const duration = arriving ? ARRIVE_MS : EXIT_MS
    const start = render(1), middle = render(duration / 2), end = render(duration - 1)
    expect(middle, `${name} class ${tier} ${arriving ? 'enter' : 'leave'}`).not.toEqual(start)
    expect(middle).not.toEqual(end)
    expect((arriving ? end : start).some(color => color !== 0)).toBe(true)
    expect((arriving ? start : end).every(color => color === 0)).toBe(true)
  }
})

test('a passage restores the actual background under its sprite', () => {
  for (const arriving of [false, true]) for (const struck of [false, true]) {
    const c = canvas(8, 4, true)
    for (let y = 0; y < c.H; y++) for (let x = 0; x < c.W; x++) c.set(x, y, 0x100000 + x + y * c.W)
    const background = c.px.slice()
    c.withHit(1, () => { c.set(3, 2, 0xffffff); c.set(4, 2, 0xffffff) })
    passages(c, [{ id: 'one' }], [{ id: 'one', kind: 'codex', place: 'city', seed: 1, age: arriving ? 1 : EXIT_MS - 1, arriving, struck }], background)
    expect(c.px[2 * c.W + 3]).toBe(background[2 * c.W + 3])
    expect(c.px[2 * c.W + 4]).toBe(background[2 * c.W + 4])
  }
})

test('a departing body does not take its ground shadow or wake into the sky', () => {
  const c = canvas(80, 24, true)
  c.px.fill(0x778899)
  const background = c.px.slice()
  c.withHit(1, () => {
    c.rect(35, 9, 5, 3, 0xff9988)
    c.rect(25, 20, 25, 1, 0x112233)
  })
  passages(c, [{ id: 'bird' }], [{ id: 'bird', kind: 'claude', place: 'forest', seed: 1, age: 1000, arriving: false }], background,
    { bird: { x0: 35, y0: 9, x1: 39, y1: 11 } })
  expect(c.px.includes(0x112233)).toBe(false)
  expect(c.px.includes(0xff9988)).toBe(true)
  for (let x = 25; x < 50; x++) expect(c.get(x, 20)).toBe(background[20 * c.W + x])
})

test('owl enters through the side with a visible body during its first half second', () => {
  for (const seed of [1, 2]) for (const tier of [1, 2, 3, 4] as const) {
    const c = canvas(100, 24, true)
    const look = { place: 'forest', frame: 20, night: 0, top: 0x223344, wind: 0, effects: false, crewGround: 21, crewBoxes: {} } as Look
    const job = { kind: 'claude' as const, tier, seed, isStale: false, hit: { id: 'owl', title: 'owl', details: [] } }
    c.withHit(1, () => fly(c, look, 40, 4, job, 'claude', false, () => [40, 4], []))
    passages(c, [job.hit], [{ id: 'owl', kind: 'claude', place: 'forest', seed, age: 450, arriving: true }], new Uint32Array(c.px.length), look.crewBoxes)
    expect(Array.from(c.px).filter(Boolean).length > 3, `owl class ${tier}, side ${seed}`).toBe(true)
  }
})

test('companions use the same passage as their leader while scenery effects stay behind', () => {
  for (const arriving of [true, false]) {
    const c = canvas(100, 24, true), background = c.px.slice()
    c.withHit(1, () => {
      c.rect(46, 10, 8, 4, 0xaa3300)
      c.rect(28, 9, 4, 2, 0x33aa00)
      c.rect(25, 21, 40, 1, 0x112233)
    })
    passages(c, [{ id: 'crew' }], [{ id: 'crew', kind: 'codex', place: 'city', seed: 1, age: arriving ? 2100 : 400, arriving }], background,
      { crew: { x0: 46, y0: 10, x1: 53, y1: 13, companions: [{ x0: 28, y0: 9, x1: 31, y1: 10 }] } })
    expect(c.px.includes(0xaa3300)).toBe(true)
    expect(c.px.includes(0x33aa00)).toBe(true)
    expect(c.px.includes(0x112233)).toBe(false)
  }
})

test('every companion-bearing design exposes its bodies for lifecycle effects, including rest poses', () => {
  for (const kind of families) for (const [place, design] of Object.entries(DESIGNS[kind])) for (const tier of [3, 4] as const) {
    const escorts = design.escorts[tier]
    if (!escorts?.length) continue
    for (const crewRest of [false, true]) {
      const c = canvas(160, 24, true)
      const look = { place, frame: 20, night: 0, top: 0x223344, wind: 0, effects: false, crewGround: 23, crewRest, crewBoxes: {} } as Look
      c.withHit(1, () => fly(c, look, 80, 11, { kind, tier, seed: 2, isStale: false, hit: { id: 'crew', title: 'crew', details: [] } }))
      expect(look.crewBoxes!.crew!.companions?.length, `${kind}/${place}/${tier}/${crewRest}`).toBe(escorts.length)
    }
  }
})
