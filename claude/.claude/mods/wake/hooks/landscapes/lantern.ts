import type { WakePreset } from '../../types'
import type { Tier } from './design'
import { hash } from '../pixels'
import { P } from './kit'

const PAPER_INKS = [P.green, P.yellow, P.red, P.blue, P.lavender] as const
/** Stable worker hue, shared by the paper shades and their torn scraps. */
export const lanternInk = (seed: number) => PAPER_INKS[hash(seed ^ 0x5bf03635) % PAPER_INKS.length]!
/** Remove the pastel's neutral component, preserving its hue while giving the paper real depth. */
export function lanternPaper(ink: number, night: number): number {
  const channels = [ink >> 16 & 255, ink >> 8 & 255, ink & 255]
  const floor = Math.min(...channels) * 0.75
  const scale = (115 + 55 * night) / (Math.max(...channels) - floor)
  const [r, g, b] = channels.map(value => Math.round((value - floor) * scale))
  return r! << 16 | g! << 8 | b!
}

type Point = readonly [number, number]
type Rect = { x: number; y: number; w: number; h: number }
type Lamp = { flame: Point; heat: Point; force: number; window: Rect; shade: Rect; rib: Point }
type Pose = { rows: readonly string[]; lamps: readonly Lamp[]; flame: Point; heat: Point; force: number; window: Rect }
const BEATS = 8
const COUNT = { 1: 1, 2: 2, 3: 3, 4: 5 } as const
const WIDTH = { 1: 5, 2: 9, 3: 13, 4: 19 } as const

/**
 * How each place hangs its garland: how many rows below the string's top line lantern `i` of `n` hangs. This is the first thing the
 * eye sees at one pixel to the cell, before any corner or tassel: flat in the city, a sagging swag of bunting in the harbor,
 * swinging alternately on the beach, stepping down the slope in the mountains, an arch over the fields, an uneven drift in the
 * forest; the desert and the tundra stay level and differ by their own tassels and crowns.
 */
const hang = (place: WakePreset, i: number, n: number): number => {
  if (n < 2) return 0
  switch (place) {
    case 'harbor': return Math.round(1.3 * Math.sin(Math.PI * i / (n - 1))) // sags in the middle
    case 'beach': return i % 2 // swings up and down
    case 'mountains': return Math.round(i / (n - 1)) // steps down the slope
    case 'countryside': return 1 - Math.round(1.3 * Math.sin(Math.PI * i / (n - 1))) // an arch: the middle hangs high
    case 'forest': return [0, 1, 0, 0, 1][i % 5]! // uneven, like leaves on a twig
    default: return 0
  }
}

function lantern(place: WakePreset, tier: Tier, beat: number): Pose {
  const w = WIDTH[tier], h = 7, phase = beat * Math.PI / 4
  const rows = Array.from({ length: h }, () => Array<string>(w).fill('.'))
  const dot = (x: number, y: number, ch: string) => {
    x = Math.round(x); y = Math.round(y)
    if (x >= 0 && x < w && y >= 0 && y < h) rows[y]![x] = ch
  }
  const line = (x0: number, y0: number, x1: number, y1: number, ch: string) => {
    let x = Math.round(x0), y = Math.round(y0)
    const ex = Math.round(x1), ey = Math.round(y1)
    dot(x, y, ch)
    while (x !== ex || y !== ey) {
      if (x !== ex) x += Math.sign(ex - x)
      dot(x, y, ch)
      if (y !== ey) y += Math.sign(ey - y)
      dot(x, y, ch)
    }
  }
  const ribbon = (x: number) => Math.round(0.5 + 0.5 * Math.sin(phase - x * 0.55))
  const centres = Array.from({ length: COUNT[tier] }, (_, i) => (tier === 4 ? 1 : 2) + i * 4)
  for (let x = centres[0]!; x < centres.at(-1)!; x++) line(x, ribbon(x), x + 1, ribbon(x + 1), 'd')
  const lamps: Lamp[] = []
  for (const [i, cx] of centres.entries()) {
    const q = phase - i * 0.95, top = 1 + hang(place, i, centres.length) + Math.round(0.5 + 0.5 * Math.sin(q))
    const depth = place === 'harbor' || place === 'desert' ? 3 : 4
    const force = (0.5 + 0.5 * Math.cos(q + 0.45)) ** 2
    const left = cx - 1, bottom = top + depth - 1
    line(cx, ribbon(cx), cx, top - 1, 'd')
    // Fill the volume first. Only outer corners breathe; both window rows stay solid.
    for (let y = 0; y < depth; y++) for (let x = left; x <= cx + 1; x++) {
      const relaxTop = Math.cos(q) < 0.3, relaxBottom = Math.cos(q - 1.3) < 0.3
      const cutLeft = place === 'mountains' || place === 'forest'
        || ['city', 'harbor', 'countryside', 'tundra'].includes(place) && relaxTop
      const cutRight = ['beach', 'desert', 'mountains', 'forest'].includes(place) && relaxTop
      const cutFootLeft = ['beach', 'mountains', 'tundra'].includes(place) && relaxBottom
      const cutFootRight = place === 'forest' && Math.cos(q - 0.8) < -0.2 || ['city', 'countryside'].includes(place) && relaxBottom
      if (!(y === 0 && (x === left && cutLeft || x === cx + 1 && cutRight)
        || y === 3 && (x === left && cutFootLeft || x === cx + 1 && cutFootRight))) dot(x, top + y, 'a')
    }
    // A single rib catches the light; the paper is never painted as a pale outline.
    const rib = rows[top]!.findIndex((ch, x) => x >= left && x <= cx + 1 && ch === 'a')
    if (depth === 4) dot(cx, bottom, 'd')
    else dot(cx, bottom + 1, 'd')
    dot(cx, top - 1, 'd')
    const sway = Math.round(Math.sin(q - 1.1))
    const end = Math.min(6, bottom + (depth === 3 ? 1 + Math.round(0.5 + 0.5 * Math.cos(q - 1.1)) : 1))
    const tassel = Math.max(0, Math.min(w - 1, cx + sway))
    line(cx, Math.min(6, bottom + 1), tassel, end, 'd')
    dot(tassel, end, 'p')
    if (place === 'city') dot(cx + ((beat + i) % 2), top, 'a')
    if (place === 'harbor') { line(cx, top - 1, cx + 1, top - 1, 'd'); dot(cx + 1, top - 1, 'p') }
    if (place === 'beach') {
      const side = i % 2 ? -1 : 1, edge = cx + side
      line(edge, bottom, Math.max(0, Math.min(w - 1, edge + side)), Math.min(6, bottom + 1), 'a')
    }
    if (place === 'mountains') line(cx - 1, top - 1, cx, top - 1, 'd')
    if (place === 'countryside') line(cx + 1, Math.min(6, bottom + 1), Math.min(w - 1, cx + 2), Math.min(6, bottom + 1), 'p')
    if (place === 'forest') { dot(cx + 1, top - 1, 'd'); line(cx, top - 1, cx + 1, top - 1, 'd') }
    if (place === 'desert') for (const x of [left, cx + 1]) dot(x, Math.min(6, bottom + 1), 'p')
    if (place === 'tundra') { line(left, top - 1, cx + 1, top - 1, 'd'); dot(cx, top - 2, 'd') }
    const window: Rect = { x: cx, y: top + 1, w: tier === 1 ? 1 : 2, h: 2 }
    const flame: Point = [window.x, window.y]
    lamps.push({ flame, heat: [cx, top - 1], force, window, shade: { x: left, y: top, w: 3, h: depth }, rib: [rib, top] })
  }
  // Filled windows are last: neither a rib nor a tassel can make a hollow arch.
  for (const lamp of lamps) {
    // A neighbour's sagging ribbon cannot repaint the filled paper as a dark frame.
    const shade = lamp.shade
    for (let y = shade.y; y < shade.y + shade.h; y++) for (let x = shade.x; x < shade.x + shade.w; x++) {
      if ('dp'.includes(rows[y]![x]!)) dot(x, y, 'a')
    }
    if (shade.h === 4) dot(shade.x + 1, shade.y + shade.h - 1, 'd')
    dot(...lamp.rib, 'l')
    const { x, y, w, h } = lamp.window
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) dot(x + dx, y + dy,
      dx === w - 1 && dy === h - 1 && lamp.force > 0.45 ? 'f' : 's')
    dot(...lamp.flame, 's')
    let heatY = lamp.heat[1]
    while (heatY >= 0 && rows[heatY]![lamp.heat[0]] !== '.') heatY--
    lamp.heat = [lamp.heat[0], heatY]
  }
  const lead = lamps.at(-1)!, pulse = lamps.reduce((a, b) => a.force > b.force ? a : b)
  return { rows: rows.map(row => row.join('')), lamps, flame: lead.flame, heat: pulse.heat, force: pulse.force, window: lead.window }
}

const classes = (place: WakePreset): Record<Tier, readonly Pose[]> => {
  const frames = (tier: Tier) => Array.from({ length: BEATS }, (_, beat) => lantern(place, tier, beat))
  return { 1: frames(1), 2: frames(2), 3: frames(3), 4: frames(4) }
}
const POSES = {
  city: classes('city'), harbor: classes('harbor'), beach: classes('beach'), mountains: classes('mountains'),
  countryside: classes('countryside'), forest: classes('forest'), desert: classes('desert'), tundra: classes('tundra'),
}
export const lanternPose = (place: WakePreset, tier: Tier, beat: number) => POSES[place][tier][((beat % BEATS) + BEATS) % BEATS]!
const pictures = (place: WakePreset) => {
  const frames = (tier: Tier) => POSES[place][tier].map(pose => pose.rows)
  return { 1: frames(1), 2: frames(2), 3: frames(3), 4: frames(4) }
}
export const ALL_LANTERNS = {
  city: pictures('city'), harbor: pictures('harbor'), beach: pictures('beach'), mountains: pictures('mountains'),
  countryside: pictures('countryside'), forest: pictures('forest'), desert: pictures('desert'), tundra: pictures('tundra'),
}
export const lanternFrames = (place: WakePreset = 'city', tier: Tier) => ALL_LANTERNS[place][tier]
export const lanternNose = (place: WakePreset, tier: Tier, beat: number) => lanternPose(place, tier, beat).flame
export const lanternFlare = (place: WakePreset, tier: Tier, beat: number) => {
  const { rows, window: { x, y, w, h } } = lanternPose(place, tier, beat)
  return rows.map((row, r) => r >= y && r < y + h ? row.slice(0, x) + 'f'.repeat(w) + row.slice(x + w) : row)
}
