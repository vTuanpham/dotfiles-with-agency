import type { WakePreset } from '../../types'
import type { Tier } from './design'

/** Balloons trade the usual seven-row ceiling for a narrow envelope; classes grow sideways. */
export const BALLOON_MAX = { w: 13, h: 9 }
type Point = readonly [number, number]
type Pose = { rows: readonly string[]; burner: Point; heat: Point; ember: Point; force: number }
const BEATS = 8

// Six cross-sections of fabric: ticker oval, sail, globe, quilted pear, hay stack, leaf, sun disc, ribbed lantern.
const CUT: Record<WakePreset, readonly number[]> = {
  city: [0.4, 0.8, 1, 1, 0.65, 0.25],
  harbor: [0.05, 0.3, 0.65, 1, 0.75, 0.2],
  beach: [0.3, 0.8, 1, 1, 0.65, 0.15],
  mountains: [0.15, 0.45, 0.8, 1, 0.85, 0.45],
  countryside: [0.6, 0.8, 0.85, 1, 0.7, 0.5],
  forest: [0, 0.25, 0.6, 0.85, 0.55, 0.1],
  desert: [0.35, 0.85, 1, 0.85, 0.6, 0.25],
  tundra: [0.5, 0.65, 1, 0.7, 0.65, 0.35],
}

function balloon(place: WakePreset, tier: Tier, beat: number): Pose {
  const w = 5 + tier * 2, h = tier === 1 ? 8 : 9, cx = w >> 1, bottom = h - 4
  const phase = beat * Math.PI / 4, force = Math.max(0, Math.cos(phase)) ** 2
  const radius = 1.3 + tier * 0.7
  const rows = Array.from({ length: h }, () => Array<string>(w).fill('.'))
  const dot = (x: number, y: number, ch: string) => {
    x = Math.round(x); y = Math.round(y)
    if (x >= 0 && x < w && y >= 0 && y < h) rows[y]![x] = ch
  }
  // Orthogonal steps keep the narrow suspension lines attached while the basket swings.
  const line = (x0: number, y0: number, x1: number, y1: number, ch: string) => {
    let x = Math.round(x0), y = Math.round(y0)
    const endX = Math.round(x1), endY = Math.round(y1)
    dot(x, y, ch)
    while (x !== endX || y !== endY) {
      if (x !== endX) x += Math.sign(endX - x)
      dot(x, y, ch)
      if (y !== endY) y += Math.sign(endY - y)
      dot(x, y, ch)
    }
  }
  const spans: { left: number; right: number; centre: number }[] = []
  for (let y = 0; y <= bottom; y++) {
    const section = Math.round(y * 5 / bottom)
    // Pressure expands the whole envelope; a delayed ripple bends each successive gore.
    const centre = cx + Math.round(0.65 * Math.sin(phase - y * 0.65))
    const r = Math.max(0, Math.round(radius * CUT[place][section]! + 0.65 * Math.cos(phase - y * 0.4)))
    const left = Math.max(0, centre - r), right = Math.min(w - 1, centre + r)
    spans.push({ left, right, centre })
    for (let x = left; x <= right; x++) {
      const gore = Math.round((x - centre) / Math.max(1, r) * (tier + 1) + 0.4 * Math.sin(phase - y * 0.8))
      let ch = x === left ? 'l' : x === right ? 'd' : gore % 2 === 0 ? 'a' : 'l'
      if (place === 'mountains') ch = (Math.floor((x - left) / 2) + y) % 3 === 0 ? 'd' : (x + y) % 2 ? 'a' : 'l'
      if (place === 'countryside') ch = y % 2 === 0 ? (x % 3 === 0 ? 'd' : 'l') : 'a'
      if (place === 'forest') ch = x === centre ? 'l' : x < centre ? 'a' : 'd'
      if (place === 'desert') ch = Math.abs(x - centre) < Math.max(1, r - 1) ? 'a' : 'l'
      if (place === 'tundra') ch = y === 0 ? 'd' : y % 2 === 0 ? 'l' : (gore % 2 ? 'a' : 'd')
      if (place === 'harbor' && Math.abs(x - centre - y / 2 + 1) < 0.7) ch = 'l'
      dot(x, y, ch)
    }
    if (y > 0) {
      const before = spans[y - 1]!
      if (before.right < left) line(before.right, y - 1, left, y, 'l')
      if (before.left > right) line(before.left, y - 1, right, y, 'l')
    }
  }
  // A narrow mouth ring, flexing ropes and a woven basket are shared by every local cut.
  const mouth = spans[bottom]!.centre, my = bottom + 1
  const swing = Math.round(Math.sin(phase - 1.1)), basket = cx + swing, by = h - 1
  line(mouth - 1, my, mouth + 1, my, 'd'); dot(mouth, my, 'l')
  line(mouth - 1, my, basket - 1, by, 'd'); line(mouth + 1, my, basket + 1, by, 'd')
  line(mouth, my, basket, by, 'd')
  const weave = tier === 4 ? 2 : 1
  for (let x = basket - weave; x <= basket + weave; x++) dot(x, by, (x - basket) % 2 ? 'd' : 'h')
  const burner: Point = [basket, by - 1]
  if (force > 0.4) dot(basket, my, 's')

  // Bunting is attached cloth: its moving lower hem is also part of the silhouette.
  const band = place === 'city' ? Math.max(1, bottom - 1) : bottom
  const span = spans[band]!
  for (let x = span.left; x <= span.right; x++) {
    const y = band + Math.round(0.5 + 0.5 * Math.sin(phase - (x - span.left) * 0.75))
    line(x, band, x, y, x % 2 ? 'p' : 'd')
  }
  if (place === 'city') { // a broad ticker fringe, with its text lights travelling across the cloth
    dot(span.left + ((beat + tier) % Math.max(1, span.right - span.left)), band, 'W')
    line(span.left, band, Math.max(0, span.left - 1), band + 1, 'a')
  }
  if (place === 'harbor') { // the pennant is sewn to the sail's apex and bends downwind
    const top = spans[0]!
    line(top.centre, 0, Math.min(w - 1, top.centre + tier), 0, 'd')
    dot(Math.min(w - 1, top.centre + tier), Math.sin(phase) > 0.3 ? 1 : 0, 'p')
  }
  if (place === 'beach' || place === 'desert') {
    const shoulder = spans[place === 'beach' ? 2 : 1]!
    for (const side of [-1, 1]) {
      const root = side < 0 ? shoulder.left : shoulder.right
      let last = root
      for (let y = 3; y <= (place === 'beach' ? my + 1 : my); y++) {
        const x = Math.max(0, Math.min(w - 1, root + Math.round(Math.sin(phase - y * 0.8) * side)))
        line(last, y - 1, x, y, place === 'beach' ? 'l' : 'p'); last = x
      }
    }
  }
  if (place === 'forest') { // a folded leaf tip, pulled sideways by the same travelling ripple
    dot(spans[0]!.centre, 0, 'l')
    const leaf = spans[2]!
    line(leaf.centre, 2, leaf.right, 3, 'l')
  }
  dot(span.left, band, 'p')
  dot(spans[1]!.centre, 1, 'a')
  dot(...burner, force > 0.4 ? 'W' : 's')
  const outside = (y: number) => rows[y]!.findLastIndex(ch => ch !== '.') + 1
  const heat: Point = [outside(my + 1), my + 1]
  const ember: Point = [outside(by), by]
  return { rows: rows.map(row => row.join('')), burner, heat, ember, force }
}

const classes = (place: WakePreset): Record<Tier, readonly Pose[]> => {
  const frames = (tier: Tier) => Array.from({ length: BEATS }, (_, beat) => balloon(place, tier, beat))
  return { 1: frames(1), 2: frames(2), 3: frames(3), 4: frames(4) }
}
const POSES: Record<WakePreset, Record<Tier, readonly Pose[]>> = {
  city: classes('city'), harbor: classes('harbor'), beach: classes('beach'), mountains: classes('mountains'),
  countryside: classes('countryside'), forest: classes('forest'), desert: classes('desert'), tundra: classes('tundra'),
}
export const balloonPose = (place: WakePreset, tier: Tier, beat: number) => POSES[place][tier][((beat % BEATS) + BEATS) % BEATS]!
const pictures = (place: WakePreset) => {
  const frames = (tier: Tier) => POSES[place][tier].map(pose => pose.rows)
  return { 1: frames(1), 2: frames(2), 3: frames(3), 4: frames(4) }
}
export const ALL_BALLOONS = {
  city: pictures('city'), harbor: pictures('harbor'), beach: pictures('beach'), mountains: pictures('mountains'),
  countryside: pictures('countryside'), forest: pictures('forest'), desert: pictures('desert'), tundra: pictures('tundra'),
}
export const balloonFrames = (place: WakePreset = 'city', tier: Tier) => ALL_BALLOONS[place][tier]
/** A balloon has no heading: its voice comes from the actual burner, never the rectangle's edge. */
export const balloonNose = (place: WakePreset, tier: Tier, beat: number) => balloonPose(place, tier, beat).burner
/** The send blast lights two actual flame cells; air effects still paint behind the fabric. */
export const balloonFlare = (place: WakePreset, tier: Tier, beat: number) => {
  const { rows, burner: [x, y] } = balloonPose(place, tier, beat)
  return rows.map((row, r) => r === y || r === y - 1 ? row.slice(0, x) + 'W' + row.slice(x + 1) : row)
}
