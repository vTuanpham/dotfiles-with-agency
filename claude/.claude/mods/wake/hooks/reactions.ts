// How a crew member reacts to a message: the sender pulses as the comet leaves, the receiver as it lands. Pure pixels.
//
// Workers each react in their harness's way; the root (whoever stands in Mochi's place) catches or sends the signal with a
// little gadget that pops out of its head, a different one for each character. To change or add a reaction: write one
// `Effect` below and list it in EFFECTS under its kind. The scene knows nothing about the individual effects: it only
// reports who sent or received and how strongly (see `Reaction`), and `react` paints.
import type { WakePreset } from '../types'
import type { CharacterId } from './mochi'
import { P } from './landscapes/kit'
import { type Emitter, emit } from './landscapes/particles'
import { type Canvas, hash, mix } from './pixels'

export type ReactionKind = 'codex' | 'claude' | 'agy' | 'opencode' | CharacterId

/** One worker reacting: `v` is its strength now (1 at the moment, fading to 0), `t` the ms since the message arrived in view. */
export type Reaction = { id: string; role: 'send' | 'land'; v: number; t: number }

export type Box = { x0: number; y0: number; x1: number; y1: number }
/** Light one pixel toward the effect's colour (or `color`) by `strength`, 0..1. Out of bounds is ignored. */
type Paint = (x: number, y: number, strength: number, color?: number) => void
/** `v` is the strength now (already quieter for a sender), `t` ms since the message arrived, `role` which end of it this is. */
type Effect = (paint: Paint, box: Box, v: number, t: number, role: Reaction['role'], place?: WakePreset) => void

/** The colour each reaction is drawn in: a harness's trail colour, a character's coat. */
const ACCENT: Record<ReactionKind, number> = {
  codex: P.teal, claude: P.pink, agy: P.mauve, opencode: P.green,
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

// The four workers' reactions are particle bursts (landscapes/particles.ts), one description each: it is played forward for a
// message that LEAVES (the particles fly out) and in reverse for one that LANDS (they gather in). To change one, edit its specs.
const UP = -Math.PI / 2, TAU = Math.PI * 2
const RAINBOW = [P.pink, P.yellow, P.teal, P.mauve, P.green, P.peach, P.red, P.blue]

const DOWN = Math.PI / 2
type Reaction2 = { send: Emitter[]; land: Emitter[] }

/**
 * Each crew's own send and its own receive. A send throws something out of the worker; a receive gathers something into it
 * (`reverse`) and then lets it land (`delay`, played forward), so the two are different pictures, not one run backwards.
 *   Codex     send: data packets fired up a column and a pulse   receive: a lock-on closing in, then a radar ping and a blip
 *   Claude    send: a fan of feathers and stars                  receive: stars gather, then a few feathers settle
 *   agy       send: a comet, sparks spiralling up from a flare   receive: the spiral collapses into a starburst
 *   OpenCode  send: a confetti cannon                            receive: a pop of colour, then confetti raining down
 */
export const BURSTS: Record<'codex' | 'claude' | 'agy' | 'opencode', Reaction2> = {
  codex: {
    send: [
      { count: 6, life: 0.8, burst: true, speed: [9, 13], angle: [UP - 0.04, UP + 0.04], colors: [P.white, P.teal], alpha: 1, envelope: 'fade', streak: 4 },
      { count: 26, life: 0.9, burst: true, spawn: { ring: 2 }, speed: [4, 6], angle: [0, TAU], drag: 1.2, colors: [P.teal, P.white], alpha: 0.95, envelope: 'fade' },
    ],
    land: [
      { count: 22, life: 0.8, burst: true, reverse: true, spawn: { ring: 7 }, speed: [0, 0], angle: [0, TAU], colors: [P.teal, P.white], alpha: 0.95, envelope: 'pulse' },
      { count: 9, life: 0.55, burst: true, delay: 0.75, speed: [5, 8], angle: [0, TAU], drag: 1.2, colors: [P.teal, P.white], alpha: 1, envelope: 'fade', streak: 3 },
      { count: 4, life: 0.6, burst: true, delay: 0.75, speed: [0, 0], angle: [0, TAU], colors: [P.white], alpha: 1, envelope: 'pulse', size: 2 },
    ],
  },
  claude: {
    send: [
      { count: 12, life: 1.3, burst: true, spawn: { w: 2 }, speed: [4, 9], angle: [UP - 1.0, UP + 1.0], gravity: 3.5, drag: 0.6, swirl: 0.7, colors: [P.pink, P.white], alpha: 0.95, envelope: 'fade' },
      { count: 8, life: 1.2, burst: true, spawn: { w: 5, h: 3 }, speed: [0, 0.5], angle: [0, TAU], colors: [P.white, P.pink], alpha: 1, envelope: 'twinkle', size: 2 },
    ],
    land: [
      { count: 10, life: 0.9, burst: true, reverse: true, spawn: { ring: 6 }, speed: [0, 0], angle: [0, TAU], colors: [P.white, P.pink], alpha: 1, envelope: 'twinkle', size: 2 },
      { count: 8, life: 1.4, burst: true, delay: 0.8, spawn: { w: 3 }, speed: [0, 1.2], angle: [DOWN - 0.7, DOWN + 0.7], gravity: 2, swirl: 1.1, colors: [P.pink, P.white], alpha: 0.9, envelope: 'fade' },
    ],
  },
  agy: {
    send: [
      { count: 22, life: 1.3, burst: true, spawn: { ring: 1 }, speed: [3, 7], angle: [UP - 1.4, UP + 1.4], drag: 1.1, swirl: 2.2, colors: [P.white, P.mauve], alpha: 1, envelope: 'twinkle', size: 2 },
      { count: 5, life: 0.5, burst: true, speed: [0, 0], angle: [0, TAU], colors: [P.white], alpha: 1, envelope: 'pulse', size: 2 },
    ],
    land: [
      { count: 22, life: 0.9, burst: true, reverse: true, spawn: { ring: 1 }, speed: [4, 8], angle: [0, TAU], drag: 1.1, swirl: 2.4, colors: [P.white, P.mauve], alpha: 1, envelope: 'twinkle', size: 2 },
      { count: 12, life: 0.6, burst: true, delay: 0.85, speed: [6, 9], angle: [0, TAU], drag: 1.5, colors: [P.white, P.mauve], alpha: 1, envelope: 'fade', streak: 3, size: 2 },
    ],
  },
  opencode: {
    send: [
      { count: 22, life: 1.5, burst: true, spawn: { w: 2 }, speed: [6, 12], angle: [UP - 1.1, UP + 1.1], gravity: 14, drag: 0.35, swirl: 0.6, colors: RAINBOW, alpha: 1, envelope: 'fade' },
    ],
    land: [
      { count: 16, life: 0.7, burst: true, spawn: { ring: 1 }, speed: [5, 8], angle: [0, TAU], drag: 1.5, colors: RAINBOW, alpha: 0.95, envelope: 'fade' },
      { count: 20, life: 1.6, burst: true, delay: 0.25, spawn: { w: 8, h: 1 }, speed: [0.5, 2], angle: [DOWN - 0.4, DOWN + 0.4], gravity: 6, swirl: 0.9, colors: RAINBOW, alpha: 1, envelope: 'fade' },
    ],
  },
}

/**
 * What the place adds to any reaction, in its own colours: paper scraps in the city, spray at the harbor, bubbles on the beach, snow on
 * the mountains and in the tundra, petals in the fields, leaves in the forest, sand in the desert.
 */
export const SCENE: Record<WakePreset, Emitter> = {
  city: { count: 6, life: 1.2, burst: true, speed: [1, 3], angle: [UP - 1, UP + 1], gravity: 4, swirl: 0.8, colors: [P.overlay2, P.white], alpha: 0.7, envelope: 'fade' },
  harbor: { count: 8, life: 0.9, burst: true, spawn: { w: 3 }, speed: [2, 5], angle: [UP - 0.9, UP + 0.9], gravity: 12, colors: [P.white, P.sky], alpha: 0.8, envelope: 'fade' },
  beach: { count: 7, life: 1.4, burst: true, spawn: { w: 3 }, speed: [0.5, 1.5], angle: [UP - 0.7, UP + 0.7], gravity: -1.5, swirl: 0.8, colors: [P.white, P.sky], alpha: 0.8, envelope: 'pulse' },
  mountains: { count: 8, life: 1.5, burst: true, spawn: { w: 3 }, speed: [0.5, 2], angle: [0, TAU], gravity: 1.5, swirl: 0.6, colors: [P.snow, P.white], alpha: 0.8, envelope: 'twinkle' },
  countryside: { count: 7, life: 1.8, burst: true, spawn: { w: 3 }, speed: [0.5, 2], angle: [UP - 1, UP + 1], gravity: 1.5, swirl: 1.4, colors: [P.pink, P.yellow], alpha: 0.85, envelope: 'fade' },
  forest: { count: 7, life: 1.8, burst: true, spawn: { w: 3 }, speed: [0.5, 2], angle: [UP - 1, UP + 1], gravity: 2, swirl: 1.5, colors: [P.green, P.teal, P.yellow], alpha: 0.85, envelope: 'fade' },
  desert: { count: 9, life: 1.1, burst: true, spawn: { w: 3 }, speed: [1, 4], angle: [UP - 1.2, UP + 0.3], gravity: 6, colors: [P.sand, P.peach], alpha: 0.8, envelope: 'fade' },
  tundra: { count: 9, life: 1.6, burst: true, spawn: { w: 3 }, speed: [0.5, 2], angle: [0, TAU], gravity: 1.2, swirl: 0.9, colors: [P.white, P.snow], alpha: 0.85, envelope: 'twinkle' },
}

/** A worker's reaction: its own send or its own receive, and the place's accent. */
const worker = (kind: keyof typeof BURSTS): Effect => (paint, b, v, t, role, place) => {
  const glow = { glow: (x: number, y: number, color: number, alpha: number) => paint(x, y, alpha, color) }
  const cx = (b.x0 + b.x1) / 2, cy = role === 'send' ? b.y0 : (b.y0 + b.y1) / 2
  const specs = [...BURSTS[kind][role], ...(place ? [{ ...SCENE[place], delay: role === 'land' ? 0.5 : 0 }] : [])]
  specs.forEach((spec, i) => emit(glow, spec, { at: () => [cx, cy], t: t / 1000, seed: i + 1, strength: Math.min(1, v * 1.6), wind: 0 }))
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
  codex: worker('codex'), claude: worker('claude'), agy: worker('agy'), opencode: worker('opencode'),
  mochi: dish, tabby: radar, tuxedo: trumpet, bun: antenna,
}

/**
 * Paint every reaction over the finished scene. `owners` are the scene's hit targets (a worker's id finds its pixels through
 * the canvas's hit owners); `kindOf` says which reaction an id gets; `fixed` pins an id's box where its sprite is known to
 * stand (the root's, so marks drawn above her never move her gadget). Several packets in flight leave several reactions for
 * one worker: the strongest of each role wins. Hit owners are never changed, so hover stays exactly where it was.
 */
export function react(c: Canvas, owners: { id: string }[], reactions: Reaction[], kindOf: (id: string) => ReactionKind, fixed: Record<string, Box> = {}, place?: WakePreset): void {
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
    for (let y = scanned.y0; y <= scanned.y1; y++) for (let x = scanned.x0; x <= scanned.x1; x++) {
      if (c.hitOwners[y * c.W + x] === owner) c.px[y * c.W + x] = mix(c.px[y * c.W + x]!, mix(accent, P.white, 0.7), v * SPRITE_GLOW)
    }
    EFFECTS[kind]((x, y, strength, color) => lit(Math.round(x), Math.round(y), color ?? accent, strength), box, v, reaction.t, reaction.role, place)
  }
}
