import { expect, test } from 'claude-code/testing'
import { PASSAGE_STYLES } from '../hooks/passage-styles'
import { styleFor } from '../hooks/exit-styles'
import { ARRIVE_MS, EXIT_MS, passages } from '../hooks/exits'
import { DESIGNS, type PassageStyle } from '../hooks/landscapes/design'
import { fly } from '../hooks/landscapes/crew'
import { type Look } from '../hooks/landscapes/kit'
import { canvas } from '../hooks/pixels'

const families = ['codex', 'claude', 'agy', 'opencode'] as const

test('every design selects its requested passage for entry and exit', () => {
  for (const kind of families) for (const [place, design] of Object.entries(DESIGNS[kind])) {
    const expected: PassageStyle | undefined = design.habit === 'water' ? 'surface' : kind === 'agy' ? 'ignite' : kind === 'opencode' ? 'unfold' : kind === 'codex' ? 'boot' : ['city', 'mountains', 'forest', 'tundra'].includes(place) ? 'swoop' : undefined
    expect(design.enter, `${kind}.${place} entry`).toBe(expected)
    expect(design.leave, `${kind}.${place} exit`).toBe(expected)
    if (expected) {
      expect(styleFor(kind, place, false, true)).toBe(PASSAGE_STYLES[expected])
      expect(styleFor(kind, place)).toBe(PASSAGE_STYLES[expected])
      expect(styleFor(kind, place, true)).not.toBe(PASSAGE_STYLES[expected])
    }
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
  for (const [name, kind, place] of [['surface', 'codex', 'harbor'], ['ignite', 'agy', 'city'], ['unfold', 'opencode', 'city'], ['swoop', 'claude', 'city'], ['boot', 'codex', 'city']] as const) for (const tier of [1, 2, 3, 4] as const) for (const arriving of [false, true]) {
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
  for (const arriving of [false, true]) {
    const c = canvas(8, 4, true)
    for (let y = 0; y < c.H; y++) for (let x = 0; x < c.W; x++) c.set(x, y, 0x100000 + x + y * c.W)
    const background = c.px.slice()
    c.withHit(1, () => { c.set(3, 2, 0xffffff); c.set(4, 2, 0xffffff) })
    passages(c, [{ id: 'one' }], [{ id: 'one', kind: 'codex', place: 'city', seed: 1, age: arriving ? 1 : EXIT_MS - 1, arriving, struck: arriving }], background)
    expect(c.px[2 * c.W + 3]).toBe(background[2 * c.W + 3])
    expect(c.px[2 * c.W + 4]).toBe(background[2 * c.W + 4])
  }
})
