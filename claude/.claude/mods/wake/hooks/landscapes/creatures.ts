import type { WakePreset } from '../../types'
import type { Tier } from './design'

// Living rose-plumaged birds in profile: beak, bright eye, covert band, primaries and a trimming tail.
// Shoulder, elbow and feather tips lag through twelve poses; the body lifts against the downstroke.
// Art and anchors are cached together, so the call and the loose feather follow the actual pose.
type Frames = readonly (readonly string[])[]
type Point = readonly [number, number]
type Pose = { rows: readonly string[]; beak: Point; feather: { x: number; y: number; force: number } }
type Species = Record<Tier, Frames>

export const CREATURE_BEATS = 12
export const CREATURE_SIZE: Record<Tier, { w: number; h: number }> = {
  1: { w: 7, h: 5 }, 2: { w: 11, h: 6 }, 3: { w: 15, h: 7 }, 4: { w: 19, h: 7 },
}

/** Anatomy, not alternate class pictures: every class grows the same local species. */
const BIRDS = {
  city:        { name: 'rose swift',       sweep: 0.82, elbow: 0.51, breadth: 1, flex: 2.3, tail: 'fan' },
  harbor:      { name: 'skimming tern',    sweep: 0.91, elbow: 0.43, breadth: 1, flex: 1.9, tail: 'notch' },
  beach:       { name: 'rose frigate',     sweep: 0.75, elbow: 0.53, breadth: 1, flex: 1.7, tail: 'scissor' },
  mountains:   { name: 'bearded vulture',  sweep: 0.88, elbow: 0.46, breadth: 2, flex: 1.25, tail: 'wedge' },
  countryside: { name: 'ribbon swallow',  sweep: 0.65, elbow: 0.45, breadth: 1, flex: 2.4, tail: 'ribbon' },
  forest:      { name: 'tufted moth-owl',  sweep: 0.81, elbow: 0.50, breadth: 2, flex: 2.0, tail: 'round' },
  desert:      { name: 'rose hoopoe',      sweep: 0.77, elbow: 0.48, breadth: 2, flex: 2.2, tail: 'paddle' },
  tundra:      { name: 'rosy ptarmigan',   sweep: 0.69, elbow: 0.46, breadth: 2, flex: 1.8, tail: 'snowfan' },
} as const

function bird(place: WakePreset, tier: Tier, beat: number): Pose {
  const species = BIRDS[place], { w, h } = CREATURE_SIZE[tier], phase = beat * Math.PI * 2 / CREATURE_BEATS
  const rows = Array.from({ length: h }, () => Array<string>(w).fill('.'))
  const clipY = (y: number) => Math.max(0, Math.min(h - 1, Math.round(y)))
  const dot = (x: number, y: number, ink: string) => {
    x = Math.round(x); y = clipY(y)
    if (x >= 0 && x < w) rows[y]![x] = ink
  }
  // Stair-step the joints: diagonal feather edges remain a solid, four-connected silhouette.
  const line = (a: Point, b: Point, ink: string) => {
    let x = Math.round(a[0]), y = clipY(a[1])
    const ex = Math.round(b[0]), ey = clipY(b[1]), dx = Math.abs(ex - x), dy = Math.abs(ey - y)
    const sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1
    let error = dx - dy
    dot(x, y, ink)
    while (x !== ex || y !== ey) {
      const twice = error * 2
      if (twice > -dy) { error -= dy; x += sx; dot(x, y, ink) }
      if (twice < dx) { error += dx; y += sy; dot(x, y, ink) }
    }
  }
  const base = (h - 1) / 2, bob = tier === 1 ? 0.7 : 0.55, body = clipY(base - bob * Math.sin(phase))
  const shoulder = Math.max(3, Math.round(w * 0.22)), rump = Math.max(4, Math.round(w * 0.43))
  const bodyAt = (x: number) => clipY(base - bob * Math.sin(phase - (x - 2) * 0.14))

  const wing = (far: boolean) => {
    const lag = far ? 0.7 : 0, root = shoulder - (far ? 1 : 0), side = far ? -1 : 1
    const fold = (1 + Math.sin(phase - 0.55 - lag)) / 2
    const elbow = Math.max(root + 1, Math.round(w * species.elbow - fold * tier * 0.35))
    const tip = Math.max(elbow + 1, Math.round((w - 1) * species.sweep - fold * tier * 0.8))
    const lift = species.flex * (tier === 1 ? 0.85 : 1)
    const ey = clipY(base + side * lift * Math.sin(phase - 0.55 - lag))
    const ty = clipY(base + side * lift * Math.sin(phase - 1.1 - lag) + (place === 'harbor' ? side * 0.8 : 0))
    const ry = bodyAt(root), trailing = Math.max(root + 1, Math.round((root + tip) / 2))
    const trailingY = clipY(ry + (far ? -0.5 : 0.8))
    for (let x = root; x <= tip; x++) {
      const u = (x - root) / (tip - root)
      const rounded = place === 'forest' || place === 'desert' || place === 'tundra'
      const arch = (place === 'forest' ? 1.7 : place === 'tundra' ? 1.2 : 1.5) + (place === 'tundra' ? 1.2 : 1) * Math.sin(phase - 0.55 - lag - u * 0.7)
      const leading = rounded ? ry + side * arch * Math.sin(Math.PI * u)
        : x <= elbow ? ry + (ey - ry) * (x - root) / (elbow - root) : ey + (ty - ey) * (x - elbow) / (tip - elbow)
      const back = rounded ? ry + side * 0.25 * Math.sin(Math.PI * u)
        : x <= trailing ? ry + (trailingY - ry) * (x - root) / (trailing - root) : trailingY + (ty - trailingY) * (x - trailing) / (tip - trailing)
      const top = clipY(Math.min(leading, back)), edge = clipY(Math.max(leading, back))
      for (let y = top; y <= edge; y++) dot(x, y, far ? y === top ? 'a' : 'd' : y === top ? 'l' : 'a')
      if (x > root && !rounded) {
        const prev = x - 1 <= elbow ? ry + (ey - ry) * (x - 1 - root) / (elbow - root) : ey + (ty - ey) * (x - 1 - elbow) / (tip - elbow)
        line([x - 1, prev], [x, leading], far ? 'd' : 'l')
      }
      if (!far && x > elbow && !rounded) {
        dot(x, edge, (x - elbow) % 2 ? 'a' : 'd') // separate primaries under the covert band
        if (species.breadth === 2 && (x - elbow) % 2 === 0) dot(x, edge + 1, 'a')
      }
      if (place === 'mountains' && x >= elbow && x % 2 === 0) {
        const feather = leading + (leading < base ? -1 : 1) * (1 + 0.65 * Math.sin(phase - (x - elbow) * 0.7))
        line([x, leading], [x, feather], 'd') // each finger yields after the next: a ripple, not a rigid comb
      }
      if (rounded && x > root + 1 && x < tip) {
        if (place === 'desert' && x % 3 === 0) for (let y = top; y <= edge; y++) dot(x, y, far ? 'd' : 'l')
        if (place === 'forest' && !far) dot(x, edge, x % 3 ? 'a' : 'd')
        if (place === 'tundra' && !far) dot(x, edge, x % 3 ? 'l' : 'a')
      }
    }
    return tip
  }
  wing(true)

  // The torso flexes from neck to rump rather than holding a rigid horizontal baseline.
  for (let x = 2; x <= rump; x++) {
    const y = bodyAt(x)
    if (x > 2) line([x - 1, bodyAt(x - 1)], [x, y], 'a')
    dot(x, y, 'a')
    if (x < rump) dot(x, y + 1, 'd')
  }
  const tailY = bodyAt(rump), trim = Math.sin(phase - 1.6), tail = species.tail
  if (tail === 'scissor' || tail === 'ribbon' || tail === 'notch') {
    const split = tail === 'ribbon' ? 2 : tail === 'scissor' ? 2.7 : 0.9, join = Math.min(w - 2, rump + 1)
    line([rump, tailY], [join, tailY], 'a')
    line([join, tailY], [w - 1, tailY - split + trim * 0.7], 'l')
    line([join, tailY], [w - 1, tailY + split + trim * 0.7], 'd')
  } else {
    const spread = tail === 'snowfan' ? 1.7 : tail === 'fan' ? 1.1 : tail === 'wedge' ? 0.5 : 1
    const end = tail === 'round' ? rump + 2 : tail === 'snowfan' ? rump + 4 : tail === 'wedge' ? rump + 3 : tail === 'fan' ? rump + 3 : w - 2
    for (let x = rump; x <= end; x++) {
      const t = (x - rump) / Math.max(1, end - rump), y = tailY + trim * t
      const fan = spread * (tail === 'wedge' ? 1 - t : t)
      for (let dy = -Math.round(fan); dy <= Math.round(fan); dy++) dot(x, y + dy, dy < 0 ? 'l' : dy > 0 ? 'd' : 'a')
      if (x > rump) line([x - 1, tailY + trim * (t - 1 / (end - rump))], [x, y], 'a')
    }
  }
  const tip = wing(false)

  // The forward face survives a wing passing behind it: yellow eye, ivory beak, rose cheek.
  const headY = clipY(body - (place === 'forest' || place === 'tundra' ? 1 : 0))
  line([1, headY], [3, bodyAt(3)], 'a')
  dot(1, headY, 'W'); dot(2, headY, 's'); dot(3, headY, 'a')
  dot(1, headY + 1, 'a'); dot(2, headY + 1, 'l'); dot(0, headY + 1, 'W')
  if (place === 'mountains') dot(1, headY + 2, 'd') // beard beneath the hooked bill
  if (place === 'forest') {
    dot(2, headY - 1, 'a')
    line([3, headY], [3 + Math.round(0.6 * Math.sin(phase - 0.8)), headY - 1], 'd')
    dot(3, headY + 1, 'l')
  }
  if (place === 'desert') {
    const crown = 1 + Math.max(0, Math.sin(phase - 0.4))
    for (let x = 2; x <= Math.min(4, w - 2); x++) line([x, headY], [x, headY - crown + (x % 2) * 0.8], x % 2 ? 'd' : 'l')
    dot(2, headY, 's')
  }
  if (place === 'tundra') { dot(3, body + 1, 'l'); dot(4, bodyAt(4) + 1, 'l') }
  dot(2, headY, 's') // a crest can fold over the brow, never over the eye

  const rowsOut = rows.map(row => row.join(''))
  // The first empty cell below a primary is the shedding edge, not a guessed rectangle corner.
  const x = Math.min(w - 1, tip - 1), y = Math.max(...rowsOut.flatMap((row, r) => row[x] === '.' ? [] : [r]))
  return { rows: rowsOut, beak: [0, headY + 1], feather: { x, y, force: Math.max(0, Math.cos(phase - 0.7)) ** 6 } }
}

const poses = (place: WakePreset, tier: Tier) => Array.from({ length: CREATURE_BEATS }, (_, beat) => bird(place, tier, beat))
const species = (place: WakePreset) => ({ 1: poses(place, 1), 2: poses(place, 2), 3: poses(place, 3), 4: poses(place, 4) })
const POSES: Record<WakePreset, Record<Tier, readonly Pose[]>> = {
  city: species('city'), harbor: species('harbor'), beach: species('beach'), mountains: species('mountains'),
  countryside: species('countryside'), forest: species('forest'), desert: species('desert'), tundra: species('tundra'),
}
const frames = (place: WakePreset): Species => {
  const rows = (tier: Tier) => POSES[place][tier].map(pose => pose.rows)
  return { 1: rows(1), 2: rows(2), 3: rows(3), 4: rows(4) }
}
export const ALL_CREATURES: Record<WakePreset, Species> = {
  city: frames('city'), harbor: frames('harbor'), beach: frames('beach'), mountains: frames('mountains'),
  countryside: frames('countryside'), forest: frames('forest'), desert: frames('desert'), tundra: frames('tundra'),
}

const poseAt = (place: WakePreset, tier: Tier, beat: number) => POSES[place][tier][((Math.floor(beat) % CREATURE_BEATS) + CREATURE_BEATS) % CREATURE_BEATS]!
export const creatureNose = (place: WakePreset, tier: Tier, beat: number): Point => poseAt(place, tier, beat).beak
export const creatureStroke = (place: WakePreset, tier: Tier, beat: number) => poseAt(place, tier, beat).feather
export const creatureFrames = (place: WakePreset | undefined, tier: Tier): Frames => ALL_CREATURES[place ?? 'city'][tier]
