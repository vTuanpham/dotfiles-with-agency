import type { WakePreset } from '../../types'
import type { Tier } from './design'
import type { Vec } from './particles'

// agy is a constellation: a few bright stars joined by dashed lines of light, one figure for each place. The figure itself moves
// (its stars shift against each other), a pulse of light runs along one line after another, and the lesser stars twinkle in turn.
// Few stars and clear lines: the figure has to read at a glance.
type Pose = { rows: readonly string[]; core: Vec; pulse: { x: number; y: number; force: number } }
/** The first star is the core (the maker's mark, where the voice and the glow sit); the last is the tip that sheds light. */
type Figure = { stars: Vec[]; links: (readonly [number, number])[] }
const BEATS = 8, H = 7
const TAU = Math.PI * 2
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const chain = (n: number, from = 0) => Array.from({ length: n - 1 }, (_, i) => [from + i, from + i + 1] as const)

/** The figure of a place at one beat, on a grid `X + 1` wide and seven tall. `p` is the beat as an angle, `big` classes 3 and 4. */
function figure(place: WakePreset, X: number, p: number, big: boolean): Figure {
  const c = X / 2, s = Math.sin(p), k = Math.cos(p)
  switch (place) {
    case 'city': { // the Crown: three points over a band, each jewel rising and settling in its turn
      const peak = (i: number) => 1 + 0.9 * Math.sin(p + i * 2.1)
      const stars: Vec[] = [[c, peak(0)], [1, 5.5], [1, 1 + peak(1)], [c * 0.5 + 0.5, 3.6], [c * 1.5 - 0.5, 3.6], [X - 1, 1 + peak(2)], [X - 1, 5.5]]
      return { stars, links: [[1, 2], [2, 3], [3, 0], [0, 4], [4, 5], [5, 6], [6, 1]] }
    }
    case 'harbor': { // the Sail: a mast, a sail and a hull that rock on the swell
      const tilt = 1.3 * s, roll = 0.7 * s
      const stars: Vec[] = [[c + tilt, 0], [1, 4 - roll], [c, 6], [X, 4 + roll]]
      return { stars, links: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]] }
    }
    case 'beach': { // the Starfish: five arms turning slowly about the core, a fifth of a turn each loop
      const stars: Vec[] = [[c, 3]], links: (readonly [number, number])[] = []
      for (let arm = 0; arm < 5; arm++) {
        const a = arm * TAU / 5 + p / 5 - Math.PI / 2
        stars.push([c + c * 0.8 * Math.cos(a), 3 + 3 * Math.sin(a)])
        links.push([0, stars.length - 1])
      }
      return { stars, links }
    }
    case 'mountains': { // the Condor: an arrowhead of two long wings that open wide and fold on each stroke
      const open = 1 + 2 * (0.5 + 0.5 * k), back = c + c * 0.3 * (0.5 - 0.5 * k)
      const stars: Vec[] = [[1, 3], [c * 0.7, 3], [back, 3 - open], [back, 3 + open], [X, 3]]
      return { stars, links: [[0, 1], [1, 2], [1, 3], [1, 4]] }
    }
    case 'countryside': { // the Plough: a square bowl and a long handle that swings like a whip
      const b = X * 0.4
      const stars: Vec[] = [[1, 2], [1, 5], [b, 5], [b, 2.4], [X * 0.62, 2 + 0.6 * s], [X * 0.82, 1.6 + 1.3 * s], [X, 1.4 + 2.2 * Math.sin(p - 0.7)]]
      return { stars, links: [[0, 1], [1, 2], [2, 3], [3, 0], ...chain(4, 3)] }
    }
    case 'forest': { // the Tree: a trunk rooted at the core, its boughs swaying further the higher they reach
      const sway = (h: number) => 1.4 * Math.sin(p - h * 0.5) * h / 3
      const stars: Vec[] = [[c, 6], [c + sway(1), 3.5], [c - c * 0.75 + sway(2), 1.5], [c + c * 0.75 + sway(2), 1.5], [c + sway(3), 0]]
      return { stars, links: [[0, 1], [1, 2], [1, 3], [1, 4]] }
    }
    case 'desert': { // the Scorpion: two claws that snap, a long body, and a tail that curls its sting over
      const snap = 0.8 * (0.5 + 0.5 * k)
      const stars: Vec[] = [[X * 0.42, 4], [X * 0.2, 3], [0, 1 + snap], [0, 5 - snap], [X * 0.68, 5], [X * 0.9, 4.4], [X, 2.2 - 0.5 * s], [X - 2 - 1.2 * s, 0.4 + 0.4 * k]]
      return { stars, links: [[1, 2], [1, 3], [1, 0], [0, 4], [4, 5], [5, 6], [6, 7]] }
    }
    default: { // tundra, the Aurora Arch: an arch of stars with curtains of light swaying beneath it
      const n = big ? 5 : 3
      const arch = Array.from({ length: n }, (_, i): Vec => { const a = Math.PI * (1 - i / (n - 1)); return [c + (c - 0.5) * Math.cos(a), 3.6 - 3.2 * Math.sin(a)] })
      const mid = n >> 1, stars: Vec[] = [arch[mid]!, ...arch.filter((_, i) => i !== mid)]
      const at = (i: number) => i === mid ? 0 : i < mid ? i + 1 : i // arch index -> star index
      const links: (readonly [number, number])[] = chain(n).map(([a, b]) => [at(a), at(b)] as const)
      for (let i = 0; i < n; i += big ? 2 : 1) {
        const [x, y] = arch[i]!
        stars.push([x + 1.1 * Math.sin(p - i * 1.2), Math.min(6, y + 2.6 + 0.4 * Math.cos(p - i * 1.2))])
        links.push([at(i), stars.length - 1])
      }
      return { stars, links }
    }
  }
}

function generate(place: WakePreset, tier: Tier, beat: number): Pose {
  const w = 3 + tier * 4, grid = Array.from({ length: H }, () => Array<string>(w).fill('.'))
  const put = (x: number, y: number, ink: string, over = true) => { if (x >= 0 && x < w && y >= 0 && y < H && (over || grid[y]![x] === '.')) grid[y]![x] = ink }
  const { stars, links } = figure(place, w - 1, beat * TAU / BEATS, tier >= 3)
  const at = stars.map(([x, y]): Vec => [clamp(Math.round(x), 0, w - 1), clamp(Math.round(y), 0, H - 1)])
  const lit = Math.floor(beat * links.length / BEATS) // the pulse: one line after another burns solid
  for (const [n, [from, to]] of links.entries()) {
    const [ax, ay] = at[from]!, [bx, by] = at[to]!, steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
    for (let i = 1; i < steps; i++) put(Math.round(ax + (bx - ax) * i / steps), Math.round(ay + (by - ay) * i / steps), n === lit ? 'a' : 'd')
  }
  for (const [i, [x, y]] of at.entries()) if (i) put(x, y, (i + beat) % 4 ? 'W' : 'a')
  const [cx, cy] = at[0]!
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) put(cx + dx, cy + dy, 'l', false) // the core's four rays
  put(cx, cy, 'M')
  const [tx, ty] = at[at.length - 1]!
  return { rows: grid.map(row => row.join('')), core: [cx, cy], pulse: { x: tx, y: ty, force: 0 } }
}

const build = (place: WakePreset): Record<Tier, readonly Pose[]> => {
  const frames = (tier: Tier) => {
    const poses = Array.from({ length: BEATS }, (_, beat) => generate(place, tier, beat))
    const low = Math.max(...poses.map(p => p.pulse.y)), high = Math.min(...poses.map(p => p.pulse.y))
    // The tip sheds light on its low stroke: strength is measured from the tip's own excursion.
    return poses.map(p => ({ ...p, pulse: { ...p.pulse, force: clamp(0.2 + 0.8 * (p.pulse.y - high) / Math.max(1, low - high), 0, 1) } }))
  }
  return { 1: frames(1), 2: frames(2), 3: frames(3), 4: frames(4) }
}
const POSES = {
  city: build('city'), harbor: build('harbor'), beach: build('beach'), mountains: build('mountains'),
  countryside: build('countryside'), forest: build('forest'), desert: build('desert'), tundra: build('tundra'),
}
const pose = (place: WakePreset, tier: Tier, beat: number) => POSES[place][tier][((beat % BEATS) + BEATS) % BEATS]!
const pictures = (place: WakePreset) => {
  const rows = (tier: Tier) => POSES[place][tier].map(p => p.rows)
  return { 1: rows(1), 2: rows(2), 3: rows(3), 4: rows(4) }
}
export const ALL_AGY = {
  city: pictures('city'), harbor: pictures('harbor'), beach: pictures('beach'), mountains: pictures('mountains'),
  countryside: pictures('countryside'), forest: pictures('forest'), desert: pictures('desert'), tundra: pictures('tundra'),
}
export const agyFrames = (place: WakePreset = 'city', tier: Tier) => ALL_AGY[place][tier]
export const agyCore = (place: WakePreset, tier: Tier, beat: number) => pose(place, tier, beat).core
export const agyPulse = (place: WakePreset, tier: Tier, beat: number) => pose(place, tier, beat).pulse
/** Pale satellites take real elliptical orbits around this beat's core, never a random particle box. */
export const agyOrbit = (place: WakePreset, tier: Tier, beat: number, offset = 0): Vec => {
  const [x, y] = agyCore(place, tier, Math.floor(beat)), p = beat * TAU / BEATS + offset
  return [x + 2.6 * Math.cos(p), y + 2.2 * Math.sin(p)]
}
