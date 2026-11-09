import type { WakePreset } from '../../types'
import type { Tier } from './design'
import type { Vec } from './particles'

// Celestial bodies, not constellations of disconnected dots. Every filament is filled, and each
// pose carries the core and the shedding point calculated by its own physical motion.
type Pose = { rows: readonly string[]; core: Vec; pulse: { x: number; y: number; force: number } }
const BEATS = 8
const TAU = Math.PI * 2
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

function light(w: number) {
  const grid = Array.from({ length: 7 }, () => Array<string>(w).fill('.'))
  const dot = (x: number, y: number, ink: string) => {
    x = Math.round(x); y = Math.round(y)
    if (x >= 0 && x < w && y >= 0 && y < 7) grid[y]![x] = ink
  }
  // Supercover segments preserve a four-connected filament through diagonal bends.
  const line = (a: Vec, b: Vec, ink: string) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2))
    let y = Math.round(a[1])
    dot(a[0], y, ink)
    for (let i = 1; i <= n; i++) {
      const nx = Math.round(a[0] + (b[0] - a[0]) * i / n), ny = Math.round(a[1] + (b[1] - a[1]) * i / n)
      dot(nx, y, ink); dot(nx, ny, ink); y = ny
    }
  }
  const core = (x: number, y: number, radius = 1) => {
    x = Math.round(x); y = Math.round(y)
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dy) <= radius) dot(x + dx, y + dy, dy > 0 ? 'a' : 'l')
    }
    dot(x, y, 'M')
    return [x, y] as const
  }
  const ribbon = (from: number, to: number, at: (x: number) => number, thick = 2) => {
    for (let x = from; x <= to; x++) {
      const y = Math.round(at(x)), before = Math.round(at(Math.max(from, x - 1)))
      line([x - (x > from ? 1 : 0), before], [x, y], 'l')
      for (let r = 1; r < thick; r++) dot(x, y + r, r === thick - 1 ? 'a' : 'l')
    }
  }
  return { dot, line, core, ribbon, rows: () => grid.map(row => row.join('')) }
}

function generate(place: WakePreset, tier: Tier, beat: number): Pose {
  const w = 3 + tier * 4, mid = w >> 1, p = beat * TAU / BEATS
  const b = light(w), { dot, line, ribbon, core } = b
  let heart: Vec = [2, 3], tip: Vec = heart
  if (place === 'city') {
    // A filled star-kite, its shoulders opening against the travelling wave of its knotted train.
    const cy = 3 + Math.round(0.6 * Math.sin(p)), end = Math.min(8, w - 2)
    for (let x = 0; x <= end; x++) {
      const half = Math.max(0, Math.round((1 - Math.abs(x - end / 2) / (end / 2)) * (2 + 0.45 * Math.cos(p))))
      for (let y = cy - half; y <= cy + half; y++) dot(x, y, y === cy - half ? 'l' : y === cy + half ? 'd' : 'a')
    }
    const at = (x: number) => cy + 1.25 * Math.sin((x - end) * 0.65 - p)
    ribbon(end - 1, w - 1, at)
    for (let x = end + 2; x < w - 1; x += 5) { dot(x, at(x) - 1, 'l'); dot(x, at(x), 'W') }
    heart = core(2, cy); tip = [w - 1, Math.round(at(w - 1)) + 1]
  } else if (place === 'harbor') {
    // A pear-shaped flame rolls above a low, sweeping reflection ribbon.
    const cy = 2 + Math.round(0.7 * Math.sin(p))
    const at = (x: number) => clamp(cy + 1 + (x - 2) / w + 1.1 * Math.sin((x - 2) * 0.45 - p), 1, 5)
    ribbon(2, w - 1, at)
    line([1, cy], [3, cy], 'a'); line([2, cy - 1], [3, cy + 1], 'l')
    dot(3 + Math.round(Math.sin(p)), cy - 2, 'l'); line([3, cy - 1], [3 + Math.round(Math.sin(p)), cy - 2], 'l')
    heart = core(1, cy); tip = [w - 1, Math.round(at(w - 1)) + 1]
  } else if (place === 'beach') {
    // Six tapered rays of a sun-glint star flex in opposing pairs; no travel heading.
    const reach = mid - Math.round(0.8 + 0.8 * Math.sin(p))
    for (let ray = 0; ray < 6; ray++) {
      const angle = ray * TAU / 6 + 0.24 * Math.sin(p), rx = Math.max(2, reach)
      const end: Vec = [mid + rx * Math.cos(angle), 3 + 2.6 * Math.sin(angle)]
      line([mid, 3], end, 'l')
      line([mid, 4], [mid + (end[0] - mid) * 0.65, 3 + (end[1] - 3) * 0.65], 'a')
      dot(end[0], end[1], ray === beat % 6 ? 'W' : 'l')
    }
    heart = core(mid, 3); tip = [mid + Math.round(reach), 3 + Math.round(2.6 * Math.sin(0.24 * Math.sin(p)))]
  } else if (place === 'mountains') {
    // A folded aurora curtain: its lit hem and shaded folds rise in sequence, not all together.
    const at = (x: number) => 1 + Math.round(0.9 + 0.9 * Math.sin(x * 0.6 - p))
    for (let x = 0; x < w; x++) {
      const y = at(x), depth = 1 + Math.round(1 + Math.sin(x * 0.6 - p - 0.8))
      line([x, y], [x, Math.min(6, y + depth)], 'a')
      line([Math.max(0, x - 1), at(Math.max(0, x - 1))], [x, y], 'l')
      dot(x, Math.min(6, y + depth), 'd')
    }
    heart = core(1, at(1) + 1); tip = [w - 1, at(w - 1)]
  } else if (place === 'countryside') {
    // Twin lantern-fireflies, joined by a pliant cord of light, trade height on alternate strokes.
    const left = 1, right = w - 2, ly = 3 + Math.round(Math.sin(p)), ry = 3 - Math.round(Math.sin(p))
    const at = (x: number) => ly + (ry - ly) * (x - left) / (right - left) - Math.sin((x - left) / (right - left) * Math.PI) * Math.cos(p)
    ribbon(left, right, at)
    for (const [x, y] of [[left, ly], [right, ry]] as const) {
      line([x - 1, y - 1], [x + 1, y - 1], 'l'); line([x - 1, y], [x + 1, y], 'a')
      dot(x, y + 1, 'l'); dot(x, y - 2, 'l'); dot(x, y, 'W')
    }
    heart = core(left, ly); tip = [right, ry + 1]
  } else if (place === 'forest') {
    // A hovering spore bell: the whole dome opens and its three mycelial roots sway beneath it.
    const inset = Math.round(0.8 + 0.8 * Math.sin(p)), radius = mid - inset
    for (let x = inset; x <= w - 1 - inset; x++) {
      const top = clamp(Math.round(0.4 + 1.6 * ((x - mid) / radius) ** 2 + 0.6 * Math.sin(p - x * 0.45)), 0, 3)
      const bottom = 3 + Math.round(0.6 * Math.sin(p - x * 0.55))
      line([x, top], [x, bottom], 'a'); dot(x, top, 'l'); dot(x, bottom, 'd')
    }
    line([inset, 3], [w - 1 - inset, 3], 'a')
    for (const root of [mid - Math.max(1, tier), mid, mid + Math.max(1, tier)]) {
      const end = root + Math.round(1.1 * Math.sin(p - root * 0.5)), depth = 5 + Math.round(0.7 * Math.cos(p - root * 0.5))
      line([root, 3], [end, depth], 'l'); dot(end, depth, 'a')
      if (root === mid) tip = [end, depth]
    }
    heart = core(mid, 2)
  } else if (place === 'desert') {
    // A closed mirage torus tilts and breathes; a bright knot orbits on its actual elliptical rim.
    const rx = mid - Math.round(0.6 + 0.6 * Math.sin(p)), ry = 1.6 + 0.5 * Math.cos(p)
    const at = (angle: number): Vec => [mid + rx * Math.cos(angle), 3 + ry * Math.sin(angle) + 0.55 * Math.sin(p) * Math.cos(angle)]
    for (let i = 0; i < 64; i++) {
      const a = at(i * TAU / 64), next = at((i + 1) * TAU / 64)
      line(a, next, i < 32 ? 'a' : 'l')
      if (i % 2 === 0) line(a, [mid + (a[0] - mid) * 0.8, 3 + (a[1] - 3) * 0.7], i < 32 ? 'd' : 'a')
    }
    const knot = at(p)
    dot(knot[0], knot[1], 'W')
    heart = core(Math.round(at(Math.PI)[0]), Math.round(at(Math.PI)[1])); tip = [Math.round(knot[0]), Math.round(knot[1])]
  } else {
    // A crowned aurora spirit. Two separate tails breathe apart, then stream together at the head.
    const cy = 3 + Math.round(0.6 * Math.sin(p))
    for (const side of [-1, 1]) {
      const at = (x: number) => clamp(cy + side * (0.4 + (x - 2) / (w - 3) * 1.5) + 0.8 * Math.sin(x * 0.55 - p), 0, 5)
      ribbon(2, w - 1, at)
      tip = [w - 1, Math.round(at(w - 1)) + 1]
    }
    line([1, cy], [1, cy - 2], 'l'); line([3, cy], [3, cy - 2], 'l'); dot(2, cy - 1, 'a')
    heart = core(1, cy)
  }
  // A pulse runs through the connected material. It never creates a new silhouette cell.
  const rows = b.rows(), occupied = rows.flatMap((row, y) => [...row].flatMap((ink, x) => ink === '.' || ink === 'M' ? [] : [[x, y] as const]))
  const target: Vec = place === 'desert' ? tip : [1 + beat * (w - 2) / BEATS, 3]
  const distance = (cell: Vec) => Math.abs(cell[0] - target[0]) * 4 + Math.abs(cell[1] - target[1])
  const pulse = occupied.reduce((a, b) => distance(a) < distance(b) ? a : b)
  dot(pulse[0], pulse[1], 'W')
  const shedding = occupied.reduce((a, b) => Math.hypot(a[0] - tip[0], a[1] - tip[1]) < Math.hypot(b[0] - tip[0], b[1] - tip[1]) ? a : b)
  return { rows: b.rows(), core: heart, pulse: { x: shedding[0], y: shedding[1], force: 0 } }
}

const build = (place: WakePreset): Record<Tier, readonly Pose[]> => {
  const frames = (tier: Tier) => {
    const poses = Array.from({ length: BEATS }, (_, beat) => generate(place, tier, beat))
    const low = Math.max(...poses.map(p => p.pulse.y)), high = Math.min(...poses.map(p => p.pulse.y))
    // The visible low stroke sheds light: strength is measured from the actual tip's excursion.
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
