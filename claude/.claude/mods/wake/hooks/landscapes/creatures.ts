import type { WakePreset } from '../../types'

// Claude's workers (its subagents, and Bridge jobs on the Claude backend) are the winged things of each place, not one bird
// everywhere. They are drawn by a small generator rather than by hand, so every species grows through the four classes the
// same way and each is a handful of parameters:
//
//   city         pigeon      short round wings, a plump body, a fanned tail
//   harbor       gull        long narrow wings that bend, dark tips, a yellow beak
//   mountains    eagle       broad wings with spread finger feathers, a white head, a hooked beak
//   forest       owl         round soft wings, a big head with ear tufts and two yellow eyes
//   tundra       snowy owl   the owl, white and speckled
//   countryside  butterfly   four wing lobes that open and close, a thin body, two feelers
//   desert       dragonfly   a long slim body and two pairs of narrow glassy wings
//   beach        kite        a pink diamond on a string, its tail whipping
//
// Sprite keys are crew.ts's: a the family colour, W white, l light, d shadow, s yellow. Each species has two frames (wings
// up, wings down) and, like Codex's craft, grows from 5x3 to 19x6 with the class. To add or change one, edit its spec.

type Frames = readonly (readonly string[])[]
type Tier = 1 | 2 | 3 | 4
type Species = Record<Tier, Frames>

/** The room a creature may take (the sky slot's), which a test holds every species to. */
export const CREATURE_MAX = { w: 19, h: 7 }
/** Cells wide and rows tall of each class: every species uses the same ones. */
export const CREATURE_SIZE: Record<Tier, { w: number; h: number }> = { 1: { w: 5, h: 3 }, 2: { w: 9, h: 4 }, 3: { w: 13, h: 5 }, 4: { w: 19, h: 6 } }

/** A writable grid of sprite cells; later writes win, so a layer is drawn over the one beneath. */
class Grid {
  private readonly rows: string[][]
  constructor(readonly w: number, readonly h: number) { this.rows = Array.from({ length: h }, () => Array<string>(w).fill('.')) }
  set(x: number, y: number, ch: string) { if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.rows[y]![x] = ch }
  get(x: number, y: number) { return this.rows[y]?.[x] ?? '.' }
  /** The same cell at `x` and mirrored about the centre column. */
  pair(dx: number, y: number, ch: string) { const cx = this.w >> 1; this.set(cx - dx, y, ch); this.set(cx + dx, y, ch) }
  out(): string[] { return this.rows.map(r => r.join('')) }
}

type Bird = {
  /** Wing length as a share of the half width. */
  span: number
  /** Rows the tip is raised above the root with the wings up, and dropped below it with them down, at class 4 (smaller classes get less). */
  rise: number
  droop: number
  /** Wing thickness at the root, in rows at class 4; it tapers to one row at the tip. */
  root: number
  /** Feather ends: fingers spread like an eagle's, a dark tip like a gull's, or a plain edge. */
  tip: 'fingers' | 'dark' | 'plain'
  tail: 'fan' | 'fork' | 'short'
  head: 'round' | 'big'
  beak: 'short' | 'hook' | 'long'
  eyes: boolean
  /** The head's own colour (the eagle's is white). */
  crown?: string
}

function bird(spec: Bird, tier: Tier, flap: 0 | 1): string[] {
  const { w, h } = CREATURE_SIZE[tier]
  const g = new Grid(w, h)
  const cx = w >> 1, scale = tier / 4
  const wingRow = Math.max(1, Math.floor(h / 2) - (tier >= 3 ? 1 : 0)) // where the wings join the body
  const reach = Math.max(1, Math.round(spec.span * cx))
  const rise = Math.round(spec.rise * scale), droop = Math.round(spec.droop * scale)
  for (let k = 1; k <= reach; k++) {
    const t = k / reach
    const centre = wingRow + (flap === 0 ? -Math.round(rise * t) : Math.round(droop * t))
    const thick = Math.max(1, Math.round(spec.root * scale * (1 - t) + t))
    for (let r = 0; r < thick; r++) {
      const y = centre - (thick >> 1) + r
      const ch = r === 0 && thick > 1 ? 'l' : r === thick - 1 && thick > 1 && t > 0.3 ? 'd' : 'a'
      g.pair(k, y, ch)
    }
    if (k === reach && spec.tip === 'dark') for (let r = 0; r < thick; r++) g.pair(k, centre - (thick >> 1) + r, 'd')
    // feathers spread beyond the trailing edge: strokes hanging from the last columns, every other one, joined to the wing
    if (spec.tip === 'fingers' && k > reach - 5 && (reach - k) % 2 === 0) for (let f = 0; f < (tier >= 4 ? 2 : 1); f++) g.pair(k, centre - (thick >> 1) + thick + f, 'd')
  }
  // the body: a plump column under the wings with the head above it and the tail below
  const bodyRows = tier >= 3 ? 2 : 1, bodyHalf = tier >= 4 ? 2 : 1
  for (let r = 0; r <= bodyRows; r++) { // an egg: widest under the wings, tapering to the tail
    const half = Math.max(0, bodyHalf - r)
    for (let dx = -half; dx <= half; dx++) g.set(cx + dx, wingRow + r, dx === -half && half > 0 && tier >= 3 ? 'l' : 'a')
  }
  const headY = wingRow - 1
  const headHalf = spec.head === 'big' ? Math.max(1, bodyHalf) : spec.head === 'round' ? Math.max(0, bodyHalf - 1) : bodyHalf
  for (let dx = -headHalf; dx <= headHalf; dx++) g.set(cx + dx, headY, spec.crown ?? 'a')
  if (spec.head === 'big' && tier >= 2) g.pair(headHalf, headY - 1, 'd') // an owl's ear tufts
  if (spec.eyes && tier >= 2) { g.set(cx - Math.max(1, headHalf), headY, 's'); g.set(cx + Math.max(1, headHalf), headY, 's') }
  else if (tier >= 3) g.set(cx, headY, spec.crown ?? 'W')
  // the beak hangs at the centre of the face (an owl's is hidden between its eyes); a long one runs a row further
  if (!spec.eyes && tier >= 2) {
    g.set(cx, headY + 1, 's')
    if (spec.beak === 'long' && tier >= 3) g.set(cx, headY + 2, 's')
  }
  // the tail trails below the body
  const tailY = wingRow + bodyRows + 1
  if (tailY < h) {
    if (spec.tail === 'fan') for (let dx = -Math.min(bodyHalf + 1, 2); dx <= Math.min(bodyHalf + 1, 2); dx++) g.set(cx + dx, tailY, 'd')
    else if (spec.tail === 'fork') { g.set(cx - 1, tailY, 'd'); g.set(cx + 1, tailY, 'd') }
    else g.set(cx, tailY, 'd')
  }
  if (tier === 1) { // at the smallest class: two wing marks, a body and a tail, whatever the species
    const t1 = new Grid(w, h)
    t1.pair(2, flap === 0 ? 0 : 1, 'a'); t1.pair(1, 1, 'a'); t1.set(cx, 1, 'W'); t1.set(cx, 2, 'd')
    return t1.out()
  }
  return g.out()
}

const frames = (spec: Bird, tier: Tier): Frames => [bird(spec, tier, 0), bird(spec, tier, 1)]
const species = (make: (tier: Tier) => Frames): Species => ({ 1: make(1), 2: make(2), 3: make(3), 4: make(4) })

const PIGEON: Bird = { span: 0.85, rise: 2, droop: 2, root: 4, tip: 'plain', tail: 'fan', head: 'round', beak: 'short', eyes: false }
const GULL: Bird = { span: 1, rise: 3, droop: 2, root: 2, tip: 'dark', tail: 'short', head: 'round', beak: 'long', eyes: false }
const EAGLE: Bird = { span: 1, rise: 3, droop: 3, root: 4, tip: 'fingers', tail: 'fan', head: 'round', beak: 'hook', eyes: false, crown: 'W' }
const OWL: Bird = { span: 0.75, rise: 2, droop: 2, root: 4, tip: 'plain', tail: 'short', head: 'big', beak: 'short', eyes: true }

/** The snowy owl is the owl in white with dark speckles: the same silhouette, so one drawing serves both. */
const speckle = (frames_: Frames): Frames => frames_.map(art => art.map((row, r) => [...row].map((cell, i) => (cell === 'a' ? ((i + r) % 5 === 0 ? 'd' : 'W') : cell)).join('')))

// the insects and the kite are not birds: their own small drawings of each class
/** A row drawn from its right half, centre first: index 0 is the centre column and the rest mirrors outward both ways. */
const sym = (half: string, w: number) => {
  const cx = w >> 1, out = Array<string>(w).fill('.')
  ;[...half].forEach((ch, i) => { if (ch !== '.') { out[cx + i] = ch; out[cx - i] = ch } })
  return out.join('')
}
/** A species drawn as half-rows: `open[tier]` and `shut[tier]` are the rows of its two frames, widths from CREATURE_SIZE. */
const mirrored = (open: Record<Tier, string[]>, shut: Record<Tier, string[]>): Species => species(tier => [open[tier], shut[tier]].map(rows => rows.map(half => sym(half, CREATURE_SIZE[tier].w))))

const BUTTERFLY = mirrored(
  { 1: ['.aa', 'Wa', 'd'], 2: ['.d', 'Waaaa', 'd.aaa', 'd..a'], 3: ['.d', 'Waaaall', 'daaaaa', 'daaa', 'd..aa'], 4: ['.d', 'Waaaaaaall', 'daaaaaaaa', 'daaaaaa', 'd..aaaa', 'd...aa'] },
  { 1: ['', 'Waa', 'd'], 2: ['', 'Waa', 'daa', 'd'], 3: ['', 'Wd', 'daaa', 'daa', 'd'], 4: ['', 'Wd', 'daaaa', 'daaaa', 'daa', 'd'] },
)
const DRAGONFLY = mirrored(
  { 1: ['s.W', 'dW', 'a'], 2: ['s.WWW', 'dWW', 'a', 'a'], 3: ['s.WWWWW', 'dWWW', 'a', 'a', 'a'], 4: ['s.WWWWWWW', 'dWWWWW', 'aa', 'a', 'a', 'a'] },
  { 1: ['', 'dWW', 'a'], 2: ['s', 'dWWWW', 'a', 'a'], 3: ['s', 'dWWWWW', 'aWWW', 'a', 'a'], 4: ['s', 'dWWWWWWWW', 'aWWWWW', 'a', 'a', 'a'] },
)
/** The beach's creature is a kite, flown from the sand: the string to the ground is the beach aura's (aura.ts). */
const KITE: Species = {
  1: [['..a..', '.aWa.', '..d..'], ['..a..', '.aWa.', '.d...']],
  2: [[sym('a', 9), sym('Wa', 9), sym('a', 9), '....d....'], [sym('a', 9), sym('Wa', 9), sym('a', 9), '...d.....']],
  3: [[sym('l', 13), sym('Wa', 13), sym('Waa', 13), sym('aa', 13), '......d.a....'], [sym('l', 13), sym('Wa', 13), sym('Waa', 13), sym('aa', 13), '....a.d......']],
  4: [
    [sym('l', 19), sym('Wa', 19), sym('Waa', 19), sym('Waaa', 19), sym('aa', 19), '.........d.a.......'],
    [sym('l', 19), sym('Wa', 19), sym('Waa', 19), sym('Waaa', 19), sym('aa', 19), '.......a.d.........'],
  ],
}

export const ALL_CREATURES: Record<WakePreset, Species> = {
  city: species(t => frames(PIGEON, t)),
  harbor: species(t => frames(GULL, t)),
  beach: KITE,
  mountains: species(t => frames(EAGLE, t)),
  countryside: BUTTERFLY,
  forest: species(t => frames(OWL, t)),
  desert: DRAGONFLY,
  tundra: species(t => speckle(frames(OWL, t))),
}

/** The creature a Claude worker of this class is in this place. */
export const creatureFrames = (place: WakePreset | undefined, tier: Tier): Frames | undefined => (place ? ALL_CREATURES[place]?.[tier] : undefined)
