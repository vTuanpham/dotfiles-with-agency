// How a crew member reacts to a message: the sender pulses as the comet leaves, the receiver as it lands. Pure pixels.
//
// Workers each react in their harness's way; the root (whoever stands in Mochi's place) catches or sends the signal with a
// little gadget that pops out of its head, a different one for each character. To change or add a reaction: write one
// `Effect` below and list it in EFFECTS under its kind. The scene knows nothing about the individual effects: it only
// reports who sent or received and how strongly (see `Reaction`), and `react` paints.
import type { CharacterId } from './mochi'
import { P } from './landscapes/kit'
import { type Canvas, hash, mix } from './pixels'
import { NIGHT_GAIN, type MessageStyle } from './landscapes/fx'

export type ReactionKind = 'codex' | 'claude' | 'agy' | 'opencode' | CharacterId

/** One worker reacting: `v` is its strength now (1 at the moment, fading to 0), `t` the ms since the message arrived in view. */
export type Reaction = { id: string; role: 'charge' | 'send' | 'land'; v: number; t: number; style?: MessageStyle; point?: { x: number; y: number } }

export type Box = { x0: number; y0: number; x1: number; y1: number }
/** Light one pixel toward the effect's colour (or `color`) by `strength`, 0..1. Out of bounds is ignored. */
type Paint = (x: number, y: number, strength: number, color?: number) => void
/** `v` is the strength now (already quieter for a sender), `t` ms since the message arrived, `role` which end of it this is. */
type Effect = (paint: Paint, box: Box, v: number, t: number, role: Reaction['role']) => void

/** The colour each reaction is drawn in: a harness's trail colour, a character's coat. */
const ACCENT: Record<ReactionKind, number> = {
  codex: P.teal, claude: P.pink, agy: P.mauve, opencode: P.white,
  mochi: P.lavender, tabby: P.peach, tuxedo: P.yellow, bun: P.pink,
}
const SOFTER_SEND = 0.6 // the sender's reaction is the receiver's, a little quieter
const SPRITE_GLOW = 0.5 // how far the sprite itself is lit toward white at full strength

/** Stamp a little pattern ('.' is empty) with its top-left at (x, y), each letter a colour from `inks`. */
function stamp(paint: Paint, rows: string[], x: number, y: number, inks: Record<string, number>, strength: number) {
  rows.forEach((row, dy) => [...row].forEach((cell, dx) => { if (cell !== '.') paint(x + dx, y + dy, strength, inks[cell]) }))
}

/** Arcs of signal over a point, closing in on it for a message caught and spreading from it for one sent. */
function arcs(paint: Paint, cx: number, cy: number, v: number, role: Reaction['role'], color: number) {
  const phase = role === 'land' ? v : 1 - v
  for (let ring = 0; ring < 2; ring++) {
    const r = 2.5 + phase * 4 + ring * 2.2
    for (let a = 215; a <= 325; a += 14) paint(cx + r * Math.cos((a * Math.PI) / 180) * 1.3, cy + r * Math.sin((a * Math.PI) / 180), v * (ring ? 0.5 : 0.85), color)
  }
}

// ── the workers' reactions ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Codex: a ripple that widens around the sprite (an oval: it never runs under the sprite's feet). */
const ring: Effect = (paint, b, v) => {
  const spread = 1.5 + (1 - v) * 5
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
  const rx = (b.x1 - b.x0) / 2 + spread, ry = (b.y1 - b.y0) / 2 + spread
  const steps = Math.ceil(2 * Math.PI * Math.max(rx, ry) * 1.5)
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    const y = cy + ry * Math.sin(angle)
    if (y <= b.y1) paint(cx + rx * Math.cos(angle), y, v * 0.8)
  }
}

/** Claude: four-point stars that twinkle above and beside it. */
const sparkles: Effect = (paint, b, v, t) => {
  const width = b.x1 - b.x0
  const stars: [number, number][] = [[0.1, -2], [0.9, -3], [0.5, -5], [0.3, -1]]
  stars.forEach(([along, up], i) => {
    const s = v * (0.55 + 0.45 * Math.sin(t * 0.02 + i * 2))
    const x = Math.round(b.x0 + width * along), y = b.y0 + up
    paint(x, y, s)
    if (s > 0.35) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) paint(x + dx, y + dy, s * 0.6)
  })
}

/** agy: sparks that rise off it like heat. */
const risingSparks: Effect = (paint, b, v) => {
  for (let i = 0; i < 4; i++) paint(b.x0 + Math.round(((b.x1 - b.x0) * (i + 0.5)) / 4), b.y0 - 1 - Math.round((1 - v) * 6) - (i % 2) * 2, v)
}

/** OpenCode: a little burst of colour thrown up and out. */
const confetti: Effect = (paint, b, v) => {
  const colors = [P.green, P.yellow, P.red, P.blue, P.lavender]
  const cx = (b.x0 + b.x1) / 2
  colors.forEach((color, i) => paint(cx + (i - 2.5) * (1.2 + (1 - v) * 2.2), b.y0 - 1 - (1 - v) * 5 + (i % 2) * 1.5, v, color))
}

// ── the root's gadgets: each character catches (or sends) the signal in its own way ─────────────────────────────────────────

/** How far a gadget has popped out of the head: it springs up quickly and folds back as the reaction fades. */
const pop = (v: number) => Math.min(1, v * 2.4)

/** Mochi: a satellite dish rises on a stalk between her ears, its feed blinking, signal arcs closing in on it. */
const dish: Effect = (paint, b, v, t, role) => {
  const cx = Math.round((b.x0 + b.x1) / 2), base = b.y0 - 1
  const stalk = Math.round(1 + 2 * pop(v))
  for (let i = 0; i < stalk; i++) paint(cx, base - i, 1, P.overlay1)
  const top = base - stalk
  stamp(paint, ['.XXXXX.', '..XSX..'], cx - 3, top - 1, { X: P.overlay2, S: P.overlay0 }, 1)
  paint(cx - 1, top - 2, 1, P.snow) // the dish's lit rim
  if (Math.floor(t / 120) % 2 === 0) paint(cx + 1, top - 3, 1, P.red) // the feed's blink
  arcs(paint, cx + 1, top - 3, v, role, P.white)
}

/** Tabby: ears prick up and whiskers turn to radar, rings of signal sliding in along them. */
const radar: Effect = (paint, b, v, t, role) => {
  paint(b.x0 + 1, b.y0, 1, P.pink); paint(b.x1 - 1, b.y0, 1, P.pink) // the ears' tips light
  const y = b.y0 + 4
  for (const side of [-1, 1]) {
    const edge = side < 0 ? b.x0 - 1 : b.x1 + 2
    for (let ring = 0; ring < 3; ring++) {
      const flow = ((t * 0.012 + ring * 2) % 6)
      const d = role === 'land' ? 6 - flow : flow // closing in on the whiskers, or leaving them
      const s = v * (1 - d / 7)
      for (const dy of [-1, 0, 1]) paint(edge + side * d, y + dy, (dy ? s * 0.6 : s) * 1.3, P.white)
    }
  }
}

/** Tuxedo: an ear trumpet unfolds from the top of the head and notes drift into its bell. */
const trumpet: Effect = (paint, b, v, t, role) => {
  const cx = Math.round((b.x0 + b.x1) / 2), base = b.y0 - 1
  const lift = Math.round(2 * pop(v))
  stamp(paint, ['....OY', '...OYY', '.OOY..', 'OO....'], cx - 2, base - 3 - lift + 2, { O: P.peach, Y: P.yellow }, 1)
  for (let i = 0; i < 2; i++) { // notes rise to the bell for a message caught, leave it for one sent
    const along = role === 'land' ? 1 - ((t * 0.0014 + i * 0.5) % 1) : (t * 0.0014 + i * 0.5) % 1
    paint(cx + 5 + i * 2 + Math.sin(along * 6) * 1.2, base - 6 - lift - along * 5, v * (1 - along * 0.6), P.snow)
  }
}

/** Bun: ears stretch into rabbit-ear antennae with glowing tips and a haze of TV static between them. */
const antenna: Effect = (paint, b, v, t) => {
  const reach = Math.round(1 + 2 * pop(v))
  for (const x of [b.x0 + 1, b.x1 - 1]) {
    for (let i = 1; i <= reach; i++) paint(x, b.y0 - i, 1, P.overlay2)
    paint(x, b.y0 - reach - 1, 1, Math.floor(t / 150) % 2 ? P.red : P.yellow) // the tips blink in turn
  }
  for (let i = 0; i < 9; i++) { // static in the gap between the ears
    if (hash(i * 17 + Math.floor(t / 70)) % 3 === 0) paint(b.x0 + 3 + (i % 3), b.y0 - 1 - Math.floor(i / 3) + 1, v, hash(i + Math.floor(t / 70)) % 2 ? P.white : P.overlay2)
  }
}

const EFFECTS: Record<ReactionKind, Effect> = {
  codex: ring, claude: sparkles, agy: risingSparks, opencode: confetti,
  mochi: dish, tabby: radar, tuxedo: trumpet, bun: antenna,
}

/**
 * Paint every reaction over the finished scene. `owners` are the scene's hit targets (a worker's id finds its pixels through
 * the canvas's hit owners); `kindOf` says which reaction an id gets; `fixed` pins an id's box where its sprite is known to
 * stand (the root's, so marks drawn above her never move her gadget). Several packets in flight leave several reactions for
 * one worker: the strongest of each role wins. Hit owners are never changed, so hover stays exactly where it was.
 */
export function react(c: Canvas, owners: { id: string }[], reactions: Reaction[], kindOf: (id: string) => ReactionKind, fixed: Record<string, Box> = {}, stars: Record<string, { x: number; y: number }[]> = {}, night = 0, occluded?: (id: string, x: number, y: number) => boolean): void {
  if (!c.hitOwners || reactions.length === 0) return
  const best = new Map<string, Reaction>()
  for (const reaction of reactions) {
    const key = `${reaction.id}|${reaction.role}`
    if (!best.has(key) || best.get(key)!.v < reaction.v) best.set(key, reaction)
  }
  const boxes = new Map<number, Box>() // hit owner -> the pixels it owns
  const wanted = new Set([...best.values()].map(reaction => owners.findIndex(owner => owner.id === reaction.id) + 1).filter(Boolean))
  for (let y = 0; y < c.H; y++) for (let x = 0; x < c.W; x++) {
    const owner = c.hitOwners[y * c.W + x]!
    if (!wanted.has(owner)) continue
    const box = boxes.get(owner)
    if (box) { box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y) }
    else boxes.set(owner, { x0: x, x1: x, y0: y, y1: y })
  }
  const lit = (x: number, y: number, color: number, strength: number) => {
    if (x < 0 || x >= c.W || y < 0 || y >= c.H || strength <= 0) return
    const k = y * c.W + x
    c.px[k] = mix(c.px[k]!, mix(color, P.white, 0.45), Math.min(1, strength) * 0.9)
  }
  for (const reaction of best.values()) {
    const owner = owners.findIndex(item => item.id === reaction.id) + 1
    const scanned = boxes.get(owner)
    if (!scanned) continue
    const box = fixed[reaction.id] ?? scanned
    const kind = kindOf(reaction.id), accent = ACCENT[kind]
    const v = reaction.v * (reaction.role === 'send' ? SOFTER_SEND : 1)
    const paint: Paint = (x, y, strength, color) => { if (!occluded?.(reaction.id, Math.round(x), Math.round(y))) lit(Math.round(x), Math.round(y), color ?? accent, strength * (1 + NIGHT_GAIN * night)) }
    if (reaction.role === 'charge' && reaction.point) {
      const { x, y } = reaction.point
      // Light gathers at the source before release; nothing previews the flight path.
      paint(x, y, v, P.white)
      if (kind === 'agy') {
        const nodes = stars[reaction.id] ?? []
        const node = nodes[Math.floor(reaction.t / 300) % Math.max(1, nodes.length)]
        if (node) {
          const f = (reaction.t % 300) / 300
          paint(node.x + (x - node.x) * f, node.y + (y - node.y) * f, v, P.lavender)
        }
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) paint(x + dx, y + dy, v * .6 / (1 + dx * dx + dy * dy), P.lavender)
      } else if (kind === 'codex') {
        // A lock-on: four brackets close in on the emitter from the corners and snap shut as the charge peaks.
        const r = Math.round(4 - 3 * v)
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          paint(x + sx * r, y + sy * r, .9, P.teal)
          paint(x + sx * (r - 1), y + sy * r, .5, P.teal); paint(x + sx * r, y + sy * (r - 1), .5, P.teal)
        }
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) paint(x + dx, y + dy, v * .6, P.sky)
      } else if (kind === 'opencode') {
        // The wick catches: a flame licks up from the craft, taller and hotter as it builds, shedding a spark.
        const height = Math.round(1 + 3 * v), flick = Math.floor(reaction.t / 70) % 2
        for (let i = 1; i <= height; i++) paint(x + (i === height ? flick * 2 - 1 : 0) * (i > 1 ? 1 : 0), y - i, 1 - i / (height + 2), i === 1 ? P.yellow : i === height ? P.red : P.peach)
        paint(x + (hash(Math.floor(reaction.t / 90)) % 5) - 2, y - height - 1 - (Math.floor(reaction.t / 90) % 2), v * .8, P.yellow)
      } else if (kind === 'claude') {
        // A breath drawn in before the song: three motes spiral down onto the beak, faster as they close.
        for (let i = 0; i < 3; i++) {
          const a = reaction.t * .012 * (1 + v) + i * 2.1, r = 4.5 * (1 - v) + .8
          paint(x + r * 1.4 * Math.cos(a), y + r * Math.sin(a), .5 + .5 * v, i % 2 ? P.snow : P.pink)
        }
      }
      continue
    }
    // only the worker's own sprite glows (its box): not the escorts, trail and air painted under the same hit owner
    for (let y = Math.max(scanned.y0, box.y0); y <= Math.min(scanned.y1, box.y1); y++) for (let x = Math.max(scanned.x0, box.x0); x <= Math.min(scanned.x1, box.x1); x++) {
      if (c.hitOwners[y * c.W + x] === owner) c.px[y * c.W + x] = mix(c.px[y * c.W + x]!, mix(accent, P.white, 0.7), v * SPRITE_GLOW)
    }
    if (!reaction.style || ['mochi', 'tabby', 'tuxedo', 'bun'].includes(kind)) EFFECTS[kind](paint, box, v, reaction.t, reaction.role)
    if (reaction.role !== 'land' || !reaction.style || !reaction.point) continue
    const { x, y } = reaction.point
    const pixel = y * c.W + x
    if (reaction.style === 'packet') {
      // A square flash and a brief dark blink at the eye/core.
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) paint(x + dx, y + dy, v, P.white)
      if (reaction.t >= 180 && reaction.t < 300 && pixel >= 0 && pixel < c.px.length) c.px[pixel] = mix(c.px[pixel]!, P.ink, v * 0.9)
      // The packet unpacks: a square shockwave steps outward, drawn only at its corners and the middle of each side.
      const r = 2 + Math.floor(reaction.t / 110)
      if (r <= 6) for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        paint(x + sx * r * 1.4, y + sy * r * .8, (sx && sy ? 1 : .6) * (1 - r / 7), P.teal)
        if (sx && sy) { paint(x + sx * (r * 1.4 - 1), y + sy * r * .8, .5 * (1 - r / 7), P.teal); paint(x + sx * r * 1.4, y + sy * (r * .8 - 1), .5 * (1 - r / 7), P.teal) }
      }
    } else if (reaction.style === 'song') {
      for (const [dx, dy] of [[-2, -1], [-1, -2], [0, -1], [1, -2], [2, -1], [-1, 0], [1, 0]] as const) paint(x + dx, y + dy, v * 0.8, P.snow)
      // The song breaks over the listener: notes fan upward, each with its stem, swaying as they rise and fade.
      const rise = reaction.t / 130
      if (rise < 7) for (let i = 0; i < 5; i++) {
        const nx = x + (i - 2) * (1.2 + rise * .55) + Math.sin(rise * 1.3 + i * 2) * .8, ny = y - 1 - rise * (1 + (i % 2) * .35), s = 1 - rise / 7
        paint(nx, ny, s, i % 2 ? P.pink : P.snow); paint(nx + 1, ny - 1, s * .7, P.snow)
      }
    } else if (reaction.style === 'starfall') {
      // The sprite can name its stars; a root character has no star metadata, so use its nearest bright cell.
      let nearest: { x: number; y: number; d: number } | undefined
      for (const star of stars[reaction.id] ?? []) {
        const d = Math.abs(star.x - x) + Math.abs(star.y - (y - 2))
        if (!nearest || d < nearest.d) nearest = { ...star, d }
      }
      const flareY = Math.max(0, y - 2)
      if (!nearest) {
      for (let sy = box.y0; sy <= box.y1; sy++) for (let sx = box.x0; sx <= box.x1; sx++) {
        const i = sy * c.W + sx, color = c.px[i]!
        if (sx < 0 || sx >= c.W || sy < 0 || sy >= c.H || c.hitOwners[i] !== owner || sx === x && sy === y) continue
        if (((color >> 16) & 255) + ((color >> 8) & 255) + (color & 255) < 450) continue
        const d = Math.abs(sx - x) + Math.abs(sy - flareY)
        if (!nearest || d < nearest.d) nearest = { x: sx, y: sy, d }
      }
      }
      if (nearest) for (let step = 1; step < nearest.d; step++) paint(x + (nearest.x - x) * step / nearest.d, flareY + (nearest.y - flareY) * step / nearest.d, v * 0.6, P.lavender)
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const) paint(x + dx, flareY + dy, v, P.white)
      // A new star is struck: eight rays shoot out and draw back, the long ones on the axes, and the point keeps twinkling.
      const reach = reaction.t < 240 ? reaction.t / 60 : Math.max(0, 4 - (reaction.t - 240) / 110)
      for (let i = 1; i <= Math.round(reach); i++) {
        const s = (1 - i / (reach + 1)) * .9
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) paint(x + dx * i * 1.5, flareY + dy * i, s, i % 2 ? P.white : P.lavender)
        if (i <= reach / 2) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) paint(x + dx * i, flareY + dy * i, s * .7, P.lavender)
      }
    } else {
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1]] as const) paint(x + dx, y + dy, v * (dx || dy ? 0.9 : 1), P.yellow)
      // The coal bursts: sparks are thrown up and out and fall away under their own weight, cooling from yellow to red.
      const age = reaction.t / 1000
      if (age < .9) for (let i = 0; i < 7; i++) {
        const vx = (i - 3) * 5.5 + (hash(i * 7) % 3 - 1), vy = -9 - (hash(i * 13) % 6)
        paint(x + vx * age, y + vy * age + 22 * age * age, 1 - age / .9, age < .25 ? P.yellow : age < .55 ? P.peach : P.red)
      }
    }
  }
}
