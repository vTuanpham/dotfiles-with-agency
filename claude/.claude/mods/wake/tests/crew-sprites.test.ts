import { expect, test } from 'claude-code/testing'

import { ALL_CREATURES } from '../hooks/landscapes/creatures'
import { CAT_COLUMNS, CHARACTERS, MOCHI_ROWS } from '../hooks/mochi'

test('every place-bound creature has animated rectangular classes inside the craft budget and differs per place', () => {
  const tiers = [1, 2, 3, 4] as const
  for (const [place, species] of Object.entries(ALL_CREATURES)) for (const tier of tiers) {
    const frames = species[tier]
    const h = frames[0]!.length, w = frames[0]![0]!.length
    expect(frames.length, place).toBeGreaterThanOrEqual(2)
    expect(w, `${place} class ${tier} width`).toBeLessThanOrEqual(CRAFT_MAX.w)
    expect(h, `${place} class ${tier} height`).toBeLessThanOrEqual(CRAFT_MAX.h)
    for (const art of frames) {
      expect(art.length, `${place} class ${tier} rows`).toBe(h)
      for (const rowText of art) expect(rowText.length, `${place} class ${tier}: ${rowText}`).toBe(w)
    }
    expect(new Set(frames.map(f => f.join('\n'))).size, `${place} class ${tier} moves`).toBeGreaterThanOrEqual(2)
  }
  const larger = Object.values(ALL_CREATURES).map(species => JSON.stringify(species[3]))
  expect(new Set(larger).size).toBe(larger.length) // eight places, eight different creatures
})

test('every character is drawn on the same grid, with a colour for each letter it uses', () => {
  for (const character of Object.values(CHARACTERS)) {
    for (const frame of [character.up, character.down]) {
      expect(frame.length).toBe(MOCHI_ROWS)
      for (const row of frame) {
        expect(row.length).toBe(CAT_COLUMNS)
        for (const letter of row) if (letter !== '.') expect((character.ink as Record<string, number>)[letter]).toBeDefined()
      }
    }
  }
})
import { airJobs, boat, fly, placeBoat, placeFly, shape } from '../hooks/landscapes/crew'
import { ALL_CRAFT, CRAFT_MAX, MACHINE_SIZE, craftFrames, craftNose, craftPush, dragonCrests } from '../hooks/landscapes/craft'
import { DESIGNS } from '../hooks/landscapes/design'
import { type Job, type Look, P } from '../hooks/landscapes/kit'
import { canvas } from '../hooks/pixels'

const look = { frame: 0, night: 1, effects: false } as Look // bare sprites: these tests are about shape, not about the air round it
const kinds = ['codex', 'agy', 'claude', 'opencode'] as const
const tiers = [1, 2, 3, 4] as const


function render(job: Job, frame: number, water = false) {
  const c = canvas(40, 20)
  if (water) boat(c, { ...look, frame }, 10, 5, job)
  else fly(c, { ...look, frame }, 20, 10, job)
  return Array.from(c.px)
}

function bounds(px: number[]) {
  const points = px.flatMap((color, i) => color ? [[i % 40, Math.floor(i / 40)]] : [])
  const xs = points.map(p => p[0]!)
  const ys = points.map(p => p[1]!)
  return [Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1]
}

test('each crew class has its own size and animated image, including stale amber', () => {
  for (const kind of kinds) for (const isStale of [false, true]) {
    const pictures = tiers.map(tier => render({ kind, tier, seed: 0, isStale }, 0))
    expect(new Set(pictures.map(p => bounds(p).join(','))).size).toBe(4)
    expect(new Set(pictures.map(p => p.join(','))).size).toBe(4)
    for (const [i, tier] of tiers.entries()) {
      const job = { kind, tier, seed: 0, isStale }
      // Compare on the same stale pulse so the sprite animation itself must change.
      expect(render(job, 15)).not.toEqual(pictures[i])
    }
  }
  for (const isStale of [false, true]) {
    const pictures = tiers.map(tier => render({ kind: 'codex', tier, seed: 0, isStale }, 0, true))
    expect(new Set(pictures.map(p => bounds(p).join(','))).size).toBe(4)
    expect(new Set(pictures.map(p => p.join(','))).size).toBe(4)
  }
})

test('every place-built Codex craft is a rectangle inside the sky slot, grows with its class and animates', () => {
  for (const [place, classes] of Object.entries(ALL_CRAFT)) {
    let area = 0
    for (const tier of tiers) {
      const frames = classes![tier]
      expect(frames.length, place).toBeGreaterThanOrEqual(2) // a craft may have more (the dragon has eight)
      const [h, w] = [frames[0]!.length, frames[0]![0]!.length]
      expect(w, `${place} class ${tier} width`).toBeLessThanOrEqual(CRAFT_MAX.w)
      expect(h, `${place} class ${tier} height`).toBeLessThanOrEqual(CRAFT_MAX.h)
      for (const art of frames) {
        expect(art.length, `${place} class ${tier} rows`).toBe(h)
        for (const rowText of art) expect(rowText.length, `${place} class ${tier}: ${rowText}`).toBe(w)
      }
      expect(w * h, `${place} class ${tier} is larger than the class before`).toBeGreaterThan(area)
      area = w * h
      expect(new Set(frames.map(f => f.join('\n'))).size, `${place} class ${tier} moves`).toBeGreaterThanOrEqual(2)
    }
  }
})

test('non-city machines have two poses, an eye and a gear in each', () => {
  for (const [place, classes] of Object.entries(ALL_CRAFT)) for (const tier of tiers) {
    if (place === 'city') continue
    expect(new Set(classes[tier].map(art => art.join('\n'))).size, `${place} ${tier} poses`).toBe(2)
    for (const art of classes[tier]) {
      expect({ w: art[0]!.length, h: art.length }).toEqual(MACHINE_SIZE[tier])
      expect(art.join('')).toContain('Wg')
      expect(art.join('')).toContain('k')
    }
  }
})

test('non-city Codex silhouettes form one connected body at every beat', () => {
  for (const [place, classes] of Object.entries(ALL_CRAFT)) {
    if (place === 'city') continue
    for (const tier of tiers) for (const art of classes[tier]) {
      const w = art[0]!.length
      const cells = new Set(art.flatMap((row, y) => [...row].flatMap((ch, x) => ch === '.' ? [] : [y * w + x])))
      const first = cells.values().next().value!
      const seen = new Set([first]), queue = [first]
      for (let i = 0; i < queue.length; i++) for (const [dx, dy] of Array.from({ length: 25 }, (_, n) => [n % 5 - 2, Math.floor(n / 5) - 2])) {
        const x = queue[i]! % w + dx!, y = Math.floor(queue[i]! / w) + dy!, cell = y * w + x
        if (x < 0 || x >= w || y < 0 || y >= art.length || !cells.has(cell) || seen.has(cell)) continue
        seen.add(cell); queue.push(cell)
      }
      expect(seen.size, `${place} class ${tier} has no stray pixels`).toBe(cells.size)
    }
  }
})

test('Codex places have distinct uncoloured silhouettes, and the smallest craft keeps its animated trait', () => {
  const mask = (art: readonly string[]) => art.map(row => row.replace(/[^.]/g, '#')).join('\n')
  for (let beat = 0; beat < 8; beat++) {
    const silhouettes = Object.values(ALL_CRAFT).map(classes => mask(classes[4][beat % classes[4].length]!))
    expect(new Set(silhouettes).size, `eight different class-4 silhouettes at beat ${beat}`).toBe(8)
  }
  for (const [place, classes] of Object.entries(ALL_CRAFT)) {
    if (place === 'city') continue
    expect(new Set(classes[1].map(mask)).size, `${place} miniature has visible secondary motion`).toBeGreaterThanOrEqual(2)
  }
})

test('every Codex send anchor follows the visible face on every class and beat', () => {
  for (const [place, classes] of Object.entries(ALL_CRAFT)) for (const tier of tiers) for (let beat = 0; beat < 8; beat++) {
    const [x, y] = craftNose(place as keyof typeof ALL_CRAFT, tier, beat), art = classes[tier][beat % classes[tier].length]!
    expect(art[y]![x], `${place} class ${tier} beat ${beat} mouth/prow`).not.toBe('.')
    if (place !== 'city') expect(art[y]!.slice(x, x + 2), `${place} retains its bright forward eye and glass`).toBe('Wg')
  }
})

test('non-city Codex poses move their structure', () => {
  for (const [place, classes] of Object.entries(ALL_CRAFT)) {
    if (place === 'city') continue
    for (const tier of tiers) {
      const silhouettes = classes[tier].map(art => [...art.join('')].map(ch => ch !== '.'))
      const changed = silhouettes.flatMap(a => silhouettes.map(b => a.filter((solid, i) => solid !== b[i]).length))
      expect(Math.max(...changed), `${place} class ${tier} changes occupied body cells`).toBeGreaterThan(0)
    }
  }
})

test('mechanical wash and thrust points belong to their generated physical pose', () => {
  for (const [place, classes] of Object.entries(ALL_CRAFT)) {
    if (place === 'city') continue
    for (const tier of tiers) for (let beat = 0; beat < 8; beat++) {
      const { x, y, force } = craftPush(place as Exclude<keyof typeof ALL_CRAFT, 'city'>, tier, beat)
      const art = classes[tier][beat % classes[tier].length]!
      expect(art[y]![x]).toBeDefined()
      expect(art[y]![x], `${place} class ${tier} beat ${beat} push cell`).not.toBe('.')
      expect(force).toBeGreaterThanOrEqual(0)
      expect(force).toBeLessThanOrEqual(1)
    }
  }
})

test('a harbor machine keeps its full footprint at its berth', () => {
  const c = canvas(80, 20)
  const state = { ...look, place: 'harbor' as const, crewZones: [{ x: 13, y: 13, w: 2, h: 1 }], crewSpriteZones: [] as { x: number; y: number; w: number; h: number }[] }
  const placed = placeBoat(c, state, 5, 13, { kind: 'codex', tier: 4, seed: 0, isStale: false })!
  expect(placed.w).toBe(MACHINE_SIZE[4].w)
  expect(state.crewSpriteZones[0]).toBeDefined()
})

test('non-city machine effects cannot repaint the body, including its lit plates and eye', () => {
  for (const place of Object.keys(ALL_CRAFT) as (keyof typeof ALL_CRAFT)[]) {
    if (place === 'city') continue
    for (const tier of tiers) for (const beat of [0, 3]) {
      const job: Job = { kind: 'codex', tier, seed: 0, isStale: false, phase: beat * 1.5, talk: { ms: 400, sending: true } }
      const bare = canvas(40, 20), air = canvas(40, 20)
      fly(bare, { ...look, place, crewGround: 18 }, 20, 10, job, 'codex', false, () => [20, 10], [])
      fly(air, { ...look, place, crewGround: 18, effects: true }, 20, 10, job, 'codex', false, () => [20, 10], [])
      const frames = craftFrames(place, tier), art = frames[beat % frames.length]!
      const left = 20 - (art[0]!.length >> 1), top = 10 - (art.length >> 1)
      // A message mirrors a left-facing machine toward Mochi. Compare the actual solid pixels, whichever way it faces.
      for (let y = top; y < top + art.length; y++) for (let x = left; x < left + art[0]!.length; x++) {
        if (bare.get(x, y)) expect(air.get(x, y), `${place} class ${tier} body`).toBe(bare.get(x, y))
      }
    }
  }
})

test('the low non-city flight formation keeps its companions separate from the leader in both directions', () => {
  for (const place of ['beach', 'mountains', 'countryside', 'forest', 'desert', 'tundra'] as const) {
    for (const tier of [3, 4] as const) for (const speed of [-20, 20]) for (const beat of [0, 3, 6]) {
      const c = canvas(120, 20)
      fly(c, { ...look, place }, 60, 10, { kind: 'codex', tier, seed: 0, isStale: false, phase: beat * 1.5 }, 'codex', false, ago => [60 - speed * ago, 10])
      const remaining = new Set(Array.from(c.px).flatMap((v, i) => v ? [i] : []))
      let pieces = 0
      while (remaining.size) {
        pieces++
        const first = remaining.values().next().value!, queue = [first]
        remaining.delete(first)
        for (let i = 0; i < queue.length; i++) for (const [dx, dy] of Array.from({ length: 25 }, (_, n) => [n % 5 - 2, Math.floor(n / 5) - 2])) {
          const x = queue[i]! % c.W + dx!, y = Math.floor(queue[i]! / c.W) + dy!, cell = y * c.W + x
          if (x < 0 || x >= c.W || y < 0 || y >= c.H || !remaining.has(cell)) continue
          remaining.delete(cell); queue.push(cell)
        }
      }
      expect(pieces, `${place} class ${tier}, speed ${speed}, beat ${beat}`).toBe(1 + (DESIGNS.codex[place].escorts[tier]?.length ?? 0))
    }
  }
})

test('dragon thrust anchors sit on the visible low stroke of the actual generated body', () => {
  for (const tier of tiers) {
    const frames = craftFrames('city', tier)
    for (const { beat, x, y } of dragonCrests(tier)) {
      expect(frames[beat]![y]![x], `class ${tier} beat ${beat} is on the visible bend`).not.toBe('.')
      const lowest = (b: number) => Math.max(...frames[(b + 8) % 8]!.flatMap((row, r) => row[x] === '.' ? [] : [r]))
      expect(y, `class ${tier} reaches its low stroke`).toBeGreaterThanOrEqual(lowest(beat - 1))
      expect(lowest(beat + 2), `class ${tier} rises after thrust`).toBeLessThanOrEqual(y)
    }
  }
})

test('rigid bodies bank edge-on without coiling; none keeps a symmetric design unchanged', () => {
  const rows = craftFrames('beach', 4)[0]!
  expect(shape(rows, 1, 0, 'bank')).toEqual([...rows])
  expect(shape(rows, -1, 1, 'bank')).toEqual(rows.map(r => [...r].reverse().join('')))
  expect(shape(rows, 1, 0.5, 'bank')).not.toEqual(shape(rows, 1, 0.5, 'coil'))
  expect(shape(rows, 1, 0.5, 'none')).toEqual([...rows])
  const turned = shape(rows, 1, 0.5, 'bank')
  const xs = turned.flatMap(row => [...row].flatMap((ch, x) => ch === '.' ? [] : [x]))
  expect(Math.max(...xs) - Math.min(...xs), 'bank presents the narrow end of the rigid body').toBeLessThan(rows[0]!.length / 2)
  expect(turned.length).toBe(rows.length)
  expect(turned.every(row => row.length === rows[0]!.length)).toBe(true)
})

test('a slowly cruising craft keeps its heading between raster steps instead of repeatedly turning', () => {
  const left = canvas(40, 20), right = canvas(40, 20)
  const state = { ...look, place: 'mountains' as const }
  const job: Job = { kind: 'codex', tier: 1, seed: 0, isStale: false }
  fly(left, state, 20, 10, job, 'codex', false, ago => [20 + 0.3 * ago, 10])
  fly(right, state, 20, 10, job, 'codex', false, ago => [20 - 0.3 * ago, 10])
  expect(Array.from(left.px)).not.toEqual(Array.from(right.px))
  for (let y = 6; y <= 14; y++) for (let x = 14; x <= 26; x++) expect(Boolean(right.get(x, y))).toBe(Boolean(left.get(40 - x, y)))
})

test('a craft turns by coiling up and uncurling the other way: straight at both ends, a compact spiral mid-turn, mirrored by the flag', () => {
  const rows = craftFrames('city', 4)[0]!
  const painted = (grid: readonly string[]) => grid.join('').replaceAll('.', '').length
  const span = (grid: readonly string[]) => { const xs = grid.flatMap(row => [...row].flatMap((ch, x) => (ch === '.' ? [] : [x]))); return Math.max(...xs) - Math.min(...xs) + 1 }
  expect(shape(rows, 1)).toEqual([...rows])
  expect(shape(rows, -1)[3]).toBe([...rows[3]!].reverse().join(''))
  expect(shape(rows, 1, 0)).toEqual([...rows]) // the turn begins straight
  expect(shape(rows, 1, 1)).toEqual([...rows]) // and ends straight
  for (const roll of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const turned = shape(rows, 1, roll)
    expect(turned.length, `rows at ${roll}`).toBe(rows.length)
    expect(turned.every(row => row.length === rows[0]!.length), `width at ${roll}`).toBe(true)
    expect(painted(turned), `cells kept at ${roll}`).toBeGreaterThan(painted(rows) * 0.5) // coiled, not dissolved
  }
  expect(span(shape(rows, 1, 0.5))).toBeLessThan(span(rows) * 0.9) // coiled up, it is shorter than it was
  // the reversal happens mid-coil, where mirroring the picture changes almost nothing: the two sides of the switch are near-identical
  const left = shape(rows, 1, 0.5), right = shape(rows, -1, 0.5).map(row => [...row].reverse().join(''))
  expect(left).toEqual(right)
})

test('flyers choose deterministic clear lanes and reserve space for the next sprite', () => {
  const obstacle = { x: 16, y: 4, w: 8, h: 8 }
  const makeLook = () => ({ ...look, crewZones: [{ ...obstacle }] })
  const job: Job = { kind: 'codex', tier: 1, seed: 0, isStale: false }
  const a = makeLook(), b = makeLook()
  const first = placeFly(canvas(40, 20), a, 20, 8, job, 38)!
  expect(first).toEqual(placeFly(canvas(40, 20), b, 20, 8, job, 38))
  const second = placeFly(canvas(40, 20), a, 20, 8, job, 38)!
  const overlaps = (x: typeof first, y: typeof first) => x.x < y.x + y.w && x.x + x.w > y.x && x.y < y.y + y.h && x.y + x.h > y.y
  expect(overlaps(first, obstacle)).toBe(false)
  expect(overlaps(first, second)).toBe(false)
})

test('flyers are drawn without an outline or backing, on any sky', () => {
  const job: Job = { kind: 'codex', tier: 1, seed: 0, isStale: false }
  for (const night of [0, 1]) {
    const c = canvas(40, 20)
    c.rect(0, 0, 40, 20, P.snow)
    fly(c, { ...look, night, top: P.blue }, 20, 10, job)
    const painted = Array.from(c.px).flatMap((color, i) => color !== P.snow ? [i] : [])
    // only the sprite's own pixels and their soft glow: nothing within a pixel of the art but empty sky
    expect(painted.length).toBeLessThanOrEqual(26) // (the smallest dragon is about fifteen cells, and its eye glows a little)
  }
})

test('a crowded sky places twelve mixed flyers, each in its own place, and mostly leaves reserved decor clear (a soft preference)', () => {
  for (const width of [160, 260]) {
    const c = canvas(width, 16)
    const obstacles = [{ x: 30, y: 2, w: 5, h: 4 }, { x: 85, y: 7, w: 6, h: 5 }]
    const state = { ...look, top: P.blue, crewZones: [...obstacles], crewAnchors: [] as number[], crewSpriteZones: [] as { x: number; y: number; w: number; h: number }[] }
    const jobs = Array.from({ length: 12 }, (_, i): Job => ({ kind: kinds[i % 4]!, tier: (i % 4 + 1) as 1 | 2 | 3 | 4, seed: i + 1, isStale: false }))
    airJobs(c, state, jobs, width - 16)
    expect(state.crewSpriteZones.length).toBe(12)
    expect(new Set(state.crewAnchors).size).toBe(12)
    // flyers are nearer than scenery, so they may pass in front of it; they settle in clear sky where there is any
    let covered = 0, cells = 0
    for (const obstacle of obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.h; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.w; x++) { cells++; if (c.get(x, y)) covered++ }
    expect(covered / cells).toBeLessThan(0.5)
    for (const zone of state.crewSpriteZones) {
      expect(zone.w).toBeGreaterThanOrEqual(3)
      expect(zone.h).toBeGreaterThanOrEqual(2)
      let painted = 0
      for (let y = zone.y; y < zone.y + zone.h; y++) for (let x = zone.x; x < zone.x + zone.w; x++) if (c.get(x, y)) painted++
      expect(painted).toBeGreaterThanOrEqual(3)
    }
  }
})

test('failed initial placements leave no invisible hit owners', () => {
  const c = canvas(30, 16, true)
  const state = { ...look, top: P.blue, crewZones: [{ x: 0, y: 0, w: 22, h: 12 }], crewAnchors: [], crewSpriteZones: [], crewGround: 10 }
  const jobs = Array.from({ length: 13 }, (_, i): Job => ({ kind: kinds[i % 4]!, tier: 4, seed: i + 1, isStale: false, hitOwner: i + 1 }))
  airJobs(c, state, jobs, 20)
  expect(c.px.every((color, i) => color !== 0 || c.hitOwners![i] === 0)).toBe(true)
})

test('after a message the worker turns back to its own course (a coil), instead of being slid round in one frame', () => {
  const job: Job = { kind: 'codex', tier: 4, seed: 0, isStale: false }
  const at = (over?: number) => render({ ...job, talk: over === undefined ? undefined : { ms: 3000, sending: true, over } }, 0)
  const facingHer = at(0), turning = at(450), home = at(1000)
  expect(turning).not.toEqual(facingHer) // mid-turn it is coiled up, neither facing her nor facing home
  expect(turning).not.toEqual(home)
  expect(home).not.toEqual(facingHer) // and it ends facing its own way
  expect(home).toEqual(at(undefined)) // exactly as if it had never turned
})
