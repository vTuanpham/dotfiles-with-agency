// What each crew design actually throws when it messages: the tug a rocket, the puffin a fish, the kite its ribbon. A family
// keeps its message style (its charge, its landing, its residue colour); the thing in flight belongs to the one design. A
// design with no entry (the fox, the city's stars, the paper boat and lanterns) sends its family's own song, star or coal.
import type { WakePreset } from '../../types'
import type { Canvas } from '../pixels'
import { P, type Job } from './kit'

/** One lit cell of a projectile: `back` cells behind the head along its flown path, `side` cells across its heading,
 *  `fall` rows straight down (things with weight), shown except on every `blink`th tick. `set` paints it solid. */
type Bit = { back: number; side?: number; fall?: number; ink: number; a?: number; blink?: number; set?: true }
export type Projectile = {
  /** The head cell's own colour. */
  head: number
  bits: readonly Bit[]
  /** Cells of fading light behind the head; 0 for a thing with no glow of its own. */
  tail?: number
  /** Rows it climbs straight up before pitching over towards its target. */
  rise?: number
  /** What its residue is made of, when not the family's light. */
  residue?: number
  rocket?: true
}

const bit = (back: number, side: number, ink: number, a = .8, more: Partial<Bit> = {}): Bit => ({ back, side, ink, a, ...more })
const pair = (back: number, side: number, ink: number, a = .8, more: Partial<Bit> = {}): Bit[] => [bit(back, side, ink, a, more), bit(back, -side, ink, a, more)]

export const PROJECTILES: Record<NonNullable<Job['kind']>, Partial<Record<WakePreset, Projectile>>> = {
  codex: {
    // The dragon spits a bolt: a white core between neon rails, crackling to alternate sides behind it.
    city: { head: P.white, tail: 3, bits: [...pair(0, 1, P.teal, .6), bit(1, 0, P.teal, .9), bit(2, 1, P.sky, .8, { blink: 2 }), bit(3, -1, P.sky, .7, { blink: 2 }), bit(5, 1, P.teal, .5, { blink: 3 })] },
    // The tug launches straight up, then pitches over, trailing smoke.
    harbor: { head: P.red, bits: [], rise: 8, residue: P.overlay2, rocket: true },
    // The saucer sends a hollow ring of light, flying edge on.
    beach: { head: P.white, bits: [...pair(0, 1, P.teal, .9), ...pair(1, 2, P.teal, .8), ...pair(2, 2, P.sky, .7), ...pair(3, 1, P.sky, .6), bit(4, 0, P.teal, .5)] },
    // The airship signals by lamp: dash, dot, dash, with dark between.
    mountains: { head: P.yellow, bits: [bit(1, 0, P.yellow, 1, { set: true }), bit(3, 0, P.yellow, .9), bit(5, 0, P.yellow, .8), bit(6, 0, P.yellow, .8), bit(7, 0, P.yellow, .7)] },
    // The crop drone lets a line of droplets go; each falls further the longer it has been loose.
    countryside: { head: P.white, bits: [bit(1, 0, P.sky, .9), bit(2, 0, P.sky, .8, { fall: 1 }), bit(4, 0, P.sky, .7, { fall: 2 }), bit(6, 0, P.white, .5, { fall: 3, blink: 2 }), bit(8, 0, P.sky, .35, { fall: 4, blink: 2 })] },
    // The probe sweeps a scan bar across its heading, with an echo of the last sweep behind.
    forest: { head: P.white, bits: [...pair(0, 1, P.sky, .9), ...pair(0, 2, P.sky, .6), ...pair(0, 3, P.sky, .3), ...pair(3, 1, P.sky, .35), ...pair(3, 2, P.sky, .2)] },
    // The speeder's dart rides low and fast, kicking sand off its tail.
    desert: { head: P.white, tail: 2, bits: [...pair(0, 1, P.peach, .55), bit(1, 0, P.peach, .9), bit(3, 0, P.sand, .7, { fall: 1, blink: 2 }), bit(5, 0, P.sand, .5, { fall: 1, blink: 3 }), bit(8, 0, P.sand, .35, { fall: 2, blink: 2 })] },
    // The snowcat fires a flare: it climbs, burns red and sheds glitter that sinks through the cold air.
    tundra: { head: P.white, rise: 5, residue: P.red, bits: [bit(0, 1, P.red, .9), bit(0, -1, P.red, .9), bit(1, 0, P.red, 1, { set: true }), bit(2, 0, P.peach, .8), bit(3, 0, P.white, .7, { fall: 1, blink: 2 }), bit(5, 0, P.red, .6, { fall: 2, blink: 3 }), bit(8, 0, P.white, .4, { fall: 3, blink: 2 })] },
  },
  claude: {
    // The bat calls in sonar: three arcs, each wider and fainter than the one ahead of it.
    city: { head: P.white, bits: [bit(3, 0, P.snow, .8), ...pair(3, 1, P.snow, .7), bit(6, 0, P.pink, .55), ...pair(6, 1, P.pink, .5), ...pair(6, 2, P.pink, .4), ...pair(5, 3, P.pink, .3)] },
    // The crab blows bubbles: hollow, wobbling upward off the line of flight.
    harbor: { head: P.snow, bits: [...pair(0, 1, P.sky, .5), bit(2, 0, P.sky, .7, { fall: -1 }), bit(3, 0, P.snow, .8, { fall: -2 }), bit(4, 0, P.sky, .7, { fall: -1 }), bit(3, 0, P.sky, .5, { fall: -3, blink: 3 }), bit(7, 0, P.snow, .5, { fall: -3, blink: 2 }), bit(9, 0, P.sky, .35, { fall: -4, blink: 2 })] },
    // The flamingo lets a feather go: a curved pink quill, with down drifting off it.
    beach: { head: P.white, bits: [bit(1, 0, P.pink, 1, { set: true }), bit(2, 1, P.pink, .9), bit(3, 1, P.flamingo, .8), bit(4, 0, P.flamingo, .6), bit(6, 0, P.pink, .45, { fall: 1, blink: 2 }), bit(9, 0, P.flamingo, .3, { fall: 2, blink: 3 })] },
    // The eagle's cry: sharp chevrons, one behind another.
    mountains: { head: P.white, bits: [...pair(1, 1, P.snow, .9), ...pair(2, 2, P.snow, .6), bit(4, 0, P.peach, .8), ...pair(5, 1, P.peach, .6), ...pair(6, 2, P.peach, .35)] },
    // The butterfly shakes loose pollen that flutters from side to side as it goes.
    countryside: { head: P.yellow, bits: [bit(1, 1, P.yellow, .9, { blink: 2 }), bit(2, -1, P.pink, .8, { blink: 3 }), bit(3, 1, P.yellow, .7, { blink: 2 }), bit(5, -1, P.yellow, .6, { blink: 2 }), bit(6, 2, P.pink, .45, { blink: 3 }), bit(8, -2, P.yellow, .35, { blink: 2 })] },
    // The owl hoots twice: two soft hollow rings.
    forest: { head: P.snow, bits: [...pair(1, 1, P.snow, .8), bit(2, 0, P.snow, .8), bit(5, 0, P.peach, .6), ...pair(6, 1, P.peach, .55), bit(7, 0, P.peach, .5)] },
    // The puffin throws a fish: silver flank, forked tail, a drop of water off it.
    tundra: { head: P.white, bits: [bit(1, 0, P.sky, 1, { set: true }), ...pair(1, 1, P.sky, .85), bit(2, 0, P.sapphire, 1, { set: true }), ...pair(2, 1, P.sky, .7), bit(3, 0, P.sapphire, .9), ...pair(4, 1, P.sapphire, .9), bit(6, 0, P.sky, .45, { fall: 1, blink: 2 })] },
  },
  agy: {
    // A binary: two stars circling each other down the line.
    harbor: { head: P.white, tail: 4, bits: [bit(1, 1, P.white, .9, { blink: 2 }), bit(2, -1, P.lavender, .9, { blink: 2 }), bit(3, 1, P.lavender, .5, { blink: 2 }), bit(4, -1, P.lavender, .4, { blink: 2 })] },
    // A comet with a fanned tail.
    beach: { head: P.white, tail: 5, bits: [...pair(2, 1, P.lavender, .6), ...pair(4, 1, P.lavender, .45), ...pair(5, 2, P.mauve, .35), ...pair(7, 2, P.mauve, .22)] },
    // A slow four-pointed star.
    mountains: { head: P.white, tail: 2, bits: [...pair(0, 1, P.white, .8), ...pair(0, 2, P.lavender, .45), bit(1, 0, P.white, .9), bit(2, 0, P.lavender, .6)] },
    // Three pearls on a string.
    countryside: { head: P.white, bits: [bit(1, 0, P.lavender, .35), bit(2, 0, P.lavender, .35), bit(3, 0, P.white, 1, { set: true }), bit(4, 0, P.lavender, .3), bit(5, 0, P.lavender, .3), bit(6, 0, P.snow, .9)] },
    // A wisp that winks between the trunks.
    forest: { head: P.green, tail: 2, bits: [bit(0, 1, P.green, .5, { blink: 2 }), bit(0, -1, P.green, .5, { blink: 3 }), bit(3, 1, P.yellow, .6, { blink: 2 }), bit(6, -1, P.green, .45, { blink: 3 })] },
    // A meteor burning up: white, then gold, then red.
    desert: { head: P.white, bits: [...pair(0, 1, P.yellow, .6), bit(1, 0, P.yellow, 1, { set: true }), bit(2, 0, P.yellow, .9), bit(3, 0, P.peach, .8), bit(4, 0, P.peach, .65), bit(5, 0, P.red, .5), bit(6, 0, P.red, .35), bit(4, 1, P.peach, .4, { blink: 2 }), bit(6, -1, P.red, .3, { blink: 2 })] },
    // A ribbon of aurora: green over teal over violet, rippling.
    tundra: { head: P.white, bits: [...[1, 2, 3, 4, 5, 6].flatMap(n => [bit(n, n % 2 ? -1 : -2, P.green, .8 - n * .09), bit(n, n % 2 ? 0 : -1, P.teal, .75 - n * .09), bit(n, n % 2 ? 1 : 0, P.mauve, .6 - n * .08)])] },
  },
  opencode: {
    // The crane sends a paper dart: a white fold with a shaded wing.
    city: { head: P.white, residue: P.snow, bits: [bit(1, 0, P.white, 1, { set: true }), ...pair(1, 1, P.snow, .9), bit(2, 0, P.snow, 1, { set: true }), ...pair(2, 2, P.overlay2, .7), bit(3, 0, P.overlay2, .6)] },
    // The kite lets a ribbon tail go: bows of red and gold, snapping from side to side.
    beach: { head: P.red, residue: P.red, bits: [bit(1, 0, P.red, 1, { set: true }), bit(2, 1, P.yellow, .9), bit(3, 0, P.red, .8), bit(4, -1, P.yellow, .8), bit(5, 0, P.red, .7), bit(6, 1, P.yellow, .6), bit(7, 0, P.red, .5), bit(8, -1, P.yellow, .4)] },
    // The carp streamer sheds a scale-bright ripple in its own colours.
    countryside: { head: P.white, residue: P.red, bits: [bit(1, 0, P.red, 1, { set: true }), ...pair(1, 1, P.peach, .7), bit(2, 0, P.white, .9), bit(3, 0, P.red, .9), ...pair(3, 1, P.peach, .5), bit(4, 0, P.white, .7), bit(5, 0, P.red, .6), ...pair(6, 1, P.red, .4)] },
    // The carpet shakes out gold dust that sifts down behind it.
    desert: { head: P.yellow, residue: P.yellow, bits: [bit(1, 0, P.yellow, .9), bit(2, 0, P.sand, .9, { fall: 1, blink: 2 }), bit(3, 0, P.yellow, .8, { blink: 2 }), bit(4, 0, P.yellow, .7, { fall: 2, blink: 3 }), bit(6, 0, P.sand, .6, { fall: 1, blink: 2 }), bit(7, 0, P.yellow, .45, { fall: 3, blink: 2 }), bit(9, 0, P.sand, .3, { fall: 4, blink: 3 })] },
    // The paper star throws a point of gold that twinkles: a cross, then a saltire.
    tundra: { head: P.white, residue: P.yellow, bits: [...pair(0, 1, P.yellow, .9, { blink: 2 }), bit(1, 0, P.yellow, .9, { blink: 2 }), ...pair(1, 1, P.peach, .6, { blink: 3 }), bit(3, 0, P.yellow, .5), bit(5, 0, P.peach, .3)] },
  },
}

/** Draws `shot` with its head on `path[k]`. `tick` advances its flicker; `from` is where it was launched. It paints only cells
 *  `open` allows: a message flies behind the foreground, so nothing of it lands on a quay or a rooftop in front. */
export function drawProjectile(canvas: Canvas, shot: Projectile, path: readonly number[], k: number, tick: number, from: { x: number; y: number }, open: (x: number, y: number) => boolean = () => true): void {
  const c = {
    W: canvas.W, H: canvas.H,
    set: (x: number, y: number, ink: number) => { if (open(Math.round(x), Math.round(y))) canvas.set(x, y, ink) },
    glow: (x: number, y: number, ink: number, a: number) => { if (open(Math.round(x), Math.round(y))) canvas.glow(x, y, ink, a) },
  }
  const at = (n: number) => { const cell = path[Math.max(0, k - n)]!; return [cell % c.W, Math.floor(cell / c.W)] as const }
  const [x, y] = at(0), [px, py] = at(1), dx = Math.sign(x - px), dy = Math.sign(y - py)
  if (shot.rocket) {
    // Red nose, white body and fins, a flame that gutters and throws sparks, and smoke that swells and lifts as it ages.
    for (let n = Math.min(k, 18); n >= 5; n--) {
      const [sx, sy] = at(n), puff = (n + tick) % 3 - 1, swell = Math.floor((n - 5) / 4), lift = Math.floor((n - 5) / 5)
      c.glow(sx, sy - lift, P.overlay2, .6 - n * .028)
      for (const side of swell ? [-swell, swell] : []) c.glow(sx - dy * side + (dy ? puff : 0), sy - lift + (dx || 1) * side + (dy ? 0 : puff), P.overlay1, .32 - n * .014)
    }
    if (k < 8) for (const ox of [-4, -3, -2, -1, 1, 2, 3, 4]) c.glow(from.x + ox, from.y + (Math.abs(ox) > 1 ? 0 : -1) - (Math.abs(ox) > 3 && k > 3 ? 1 : 0), Math.abs(ox) > 1 ? P.overlay2 : P.yellow, (1 - k / 8) * (Math.abs(ox) > 2 ? .45 : .9)) // the launch: a flash on deck, smoke rolling out to both sides
    const turn = shot.rise ?? 0, since = k - turn // a ring of vapour where it pitches over and goes supersonic
    if (turn && since >= 0 && since < 4) {
      const [ox, oy] = at(since)
      for (let a = 0; a < 8; a++) c.glow(Math.round(ox + Math.cos(a * Math.PI / 4) * (since + 1) * 1.4), Math.round(oy + Math.sin(a * Math.PI / 4) * (since + 1) * .8), P.white, .7 - since * .15)
    }
    if (k >= 6 && tick % 3 === 0) c.glow(...at(5), P.yellow, .9) // the flame licks long on every third tick
    if (k >= 5) for (let s = 0; s < 2; s++) { const [fx, fy] = at(4 + s); c.glow(fx + ((tick + s) % 3 - 1), fy + 1 + (tick + s * 2) % 3, s ? P.peach : P.yellow, .75) } // sparks dropping out of it
    if (k >= 4) c.glow(...at(4), tick % 2 ? P.peach : P.red, .9)
    if (k >= 3) c.set(...at(3), P.yellow)
    if (k >= 2) { const [fx, fy] = at(2); c.set(fx, fy, P.snow); c.glow(fx - dy, fy + (dx || 1), P.red, .85); c.glow(fx + dy, fy - (dx || 1), P.red, .85) } // the fins
    if (k >= 1) c.set(...at(1), P.white)
  }
  for (const b of shot.bits) {
    if (k < b.back || b.blink && (tick + b.back) % b.blink === 0) continue
    const [bx, by] = at(b.back), side = b.side ?? 0
    // Across a level heading, "side" is up and down; across a climb or a dive it leans with the path.
    const tx = bx - dy * side, ty = by + (dx || 1) * side + (b.fall ?? 0)
    if (tx < 0 || tx >= c.W || ty < 0 || ty >= c.H) continue
    if (b.set) c.set(tx, ty, b.ink)
    else c.glow(tx, ty, b.ink, b.a ?? .8)
  }
  c.set(x, y, shot.head)
}
