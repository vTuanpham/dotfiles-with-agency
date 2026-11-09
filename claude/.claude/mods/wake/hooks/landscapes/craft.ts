import type { WakePreset } from '../../types'
import type { Tier } from './design'

// Codex is the mechanical crew, and each place gives its machines a body of its own: what a person would actually build and
// fly there: over the city a clockwork dragon (a generator, see `dragon` below: one design that grows from a small, slim whelp to a
// long plated one), a banner plane on the beach, paddle launches in the harbor and a generated machine for every other place. Four classes grow the same machine, each a rectangle inside
// CRAFT_MAX and larger than the one before. Sprite keys are crew.ts's: a body, W highlight, l light stripe, d shade or rope,
// s lamp, p bunting, h hull or wood, r red (a beacon, a tail fin), g glass, k grey metal. Each craft has two or more frames so its
// image moves over eight beats. What a craft stirs up, lights and trails is data in fx.ts, not drawn here.

type Frames = readonly (readonly string[])[]

/**
 * The room a sprite may take in the shared shallow sky: no craft is wider than `w` or taller than `h`.
 * Each class draws larger than the one before; inside these limits a craft has the cells its own shape needs. A test
 * holds every craft to this. Keep the silhouette clear, with at least three structural tones and one lit accent.
 */
export const CRAFT_MAX = { w: 19, h: 7 }

/**
 * City: the clockwork dragon, the city's festival dragon rebuilt by Codex out of metal. A small horned head with a glowing eye and
 * a jaw, a slim armoured body of plates three cells long (a light crest, a dark belly, seams between plates) with a gear tooth
 * along the spine, and a bladed tail. Thin and long, so it threads the towers without taking over the sky. It is one dragon at
 * four sizes: a bigger model is a longer dragon with a deeper wave, never a different picture. It undulates (eight frames to a wave, so the motion flows) while a pulse of light runs down
 * its plates from the tail to the head, and the tail blade flicks. Sprite keys are crew.ts's: l light, a body, d shade, W the lit
 * plate and the eye, k the horns and the spine's gear teeth.
 */
const DRAGON = {
  // class: grid, the head's size, the body's thickness in rows and the wave's amplitude in rows
  1: { w: 5, h: 3, head: 3, thick: 1, wave: 0 },
  2: { w: 9, h: 5, head: 3, thick: 2, wave: 0.9 },
  3: { w: 15, h: 6, head: 3, thick: 2, wave: 1.4 },
  4: { w: 19, h: 7, head: 3, thick: 2, wave: 1.8 },
} as const
const BEATS = 8

const dragonAt = (tier: Tier, beat: number, x: number) => (DRAGON[tier].h - 1) / 2 + DRAGON[tier].wave * Math.sin(x * 0.5 - beat * 2 * Math.PI / BEATS)

/** One thrust at each plate group's low stroke, on the very same eight-beat grid as the visible body. */
export const dragonCrests = (tier: Tier): readonly { beat: number; x: number; y: number }[] => {
  const { w, h, thick } = DRAGON[tier]
  if (tier === 1) return [{ beat: 0, x: w - 1, y: Math.min(h - 1, Math.round(dragonAt(tier, 0, w - 1)) + 1) }]
  return Array.from({ length: Math.ceil((w - 4) / 6) }, (_, i) => {
    const x = 4 + i * 6, beat = ((Math.round((x * 0.5 - Math.PI / 2) * BEATS / (2 * Math.PI)) % BEATS) + BEATS) % BEATS
    const y = Math.min(h - 1, Math.round(dragonAt(tier, beat, x) - (thick - 1) / 2) + thick - 1)
    return { beat, x, y }
  })
}

function dragon(tier: Tier, beat: number): string[] {
  const { w, h, head, thick } = DRAGON[tier]
  const rows = Array.from({ length: h }, () => Array<string>(w).fill('.'))
  const set = (x: number, y: number, ch: string) => { x = Math.round(x); y = Math.round(y); if (ch !== '.' && x >= 0 && x < w && y >= 0 && y < h) rows[y]![x] = ch }
  const at = (x: number) => dragonAt(tier, beat, x)
  // the head: horns, a brow, an eye and a jaw
  const hy = Math.round(at(head - 0.5) - 1)
  const face = ['.kl', 'aWa', 'dda'] // small, so the length is in the body and the dragon never takes over the sky
  face.forEach((row, dy) => [...row].forEach((ch, dx) => set(dx, hy + dy, ch)))
  // the body: plates of three columns, seams between them, the pulse of light on one plate, and the tail tapering to a blade
  const plates = Math.ceil((w - head) / 3), lit = plates - 1 - (Math.floor(beat / 2) % plates)
  for (let x = head; x < w; x++) {
    const plate = Math.floor((x - head) / 3), seam = (x - head) % 3 === 2 && x < w - 1, tail = x >= w - 2
    const n = tail ? 1 : thick, top = Math.round(at(x) - (thick - 1) / 2) + (tail ? Math.floor((thick - 1) / 2) : 0)
    for (let r = 0; r < n; r++) set(x, top + r, seam ? 'd' : r === 0 ? (plate === lit ? 'W' : 'l') : r === n - 1 && n > 1 ? 'd' : 'a')
    if (!seam && !tail && tier >= 2 && (x - head) % 3 === 1) set(x, top - 1, 'k') // a gear tooth on the spine, one to a plate
  }
  set(w - 1, Math.round(at(w - 1)) + [1, 0, -1, 0][beat % 4]!, 'l') // the tail's blade sweeps up and down (a cycle of four: no two neighbouring frames match)
  return rows.map(r => r.join(''))
}
const dragonFrames = (tier: Tier): Frames => Array.from({ length: BEATS }, (_, beat) => dragon(tier, beat))
const CITY_CRAFT: Record<Tier, Frames> = { 1: dragonFrames(1), 2: dragonFrames(2), 3: dragonFrames(3), 4: dragonFrames(4) }

/** A letter grid shared by the machines' generators; lines keep spars, rigging and runners connected at every size. */
function metal(w: number, h: number) {
  const rows = Array.from({ length: h }, () => Array<string>(w).fill('.'))
  const dot = (x: number, y: number, ch: string) => {
    x = Math.round(x); y = Math.round(y)
    if (x >= 0 && x < w && y >= 0 && y < h) rows[y]![x] = ch
  }
  const line = (x0: number, y0: number, x1: number, y1: number, ch: string) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
    for (let i = 0; i <= n; i++) dot(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, ch)
  }
  return { dot, line, done: () => rows.map(r => r.join('')) }
}

/** A pulse belongs to a filled plate, not an extra floating light. */
const platePulse = (dot: (x: number, y: number, ch: string) => void, from: number, to: number, y: number, beat: number) =>
  dot(to - Math.floor(beat * (to - from + 1) / BEATS), y, 'W')

/** A machine's physical push point and strength come from the same pose as its plates. Kept alongside the generated frame. */
type MachineFrame = { rows: readonly string[]; push: { x: number; y: number; force: number }; lamp?: readonly [number, number] }
const heaveAt = (phase: number, x: number, lag: number) => Math.round(0.5 + 0.5 * Math.sin(phase - Math.max(0, x - 2) * lag))
/** A one-row swell travels along launches and sail hulls. Two-row plating stays joined through each bend. */
function heave(rows: readonly string[], phase: number, lag: number): string[] {
  const out = Array.from({ length: rows.length + 1 }, () => Array<string>(rows[0]!.length).fill('.'))
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return
    const dy = heaveAt(phase, x, lag), before = heaveAt(phase, Math.max(0, x - 1), lag)
    out[y + dy]![x] = ch
    if (x > 0 && row[x - 1] !== '.' && before !== dy) out[y + before]![x] = ch
  }))
  return out.map(row => row.join(''))
}

/** Beach: the tug stays low while a two-row banner carries a full travelling wave, including on the smallest plane. */
function bannerPlane(tier: Tier, beat: number): MachineFrame {
  const w = [0, 9, 12, 16, 19][tier]!, body = [0, 4, 5, 7, 8][tier]!, phase = beat * Math.PI / 4
  const { dot, line, done } = metal(w, 5)
  line(1, 2, body - 1, 2, 'a'); line(0, 3, body - 1, 3, 'a')
  line(1, 4, body - 2, 4, 'd')
  line(2, 1, Math.max(2, body - 2), 1, 'l')
  dot(3, 1, 'k'); dot(0, 2, 'l'); dot(1, 2, 'W'); dot(2, 2, 'g'); dot(body - 1, 1, 'l')
  line(0, 3, 0, 3 + Math.round(Math.sin(phase)), 'l')
  platePulse(dot, 2, body - 2, 3, beat)
  dot(body - 1, 3, 'k')
  dot(Math.max(2, body - 2), 1, beat % 4 === 0 ? 'r' : 'l')
  line(body, 3, body + 1, 3, 'd')
  for (let x = body + 1; x < w; x++) {
    const y = 2 + Math.round(Math.sin(phase - (x - body - 1) * 0.75))
    dot(x, y, 'l'); dot(x, y + 1, 'a')
  }
  // The engine and wing pitch with each thrust; the fabric's wave starts at its tow point and runs aft.
  const rows = heave(done(), phase, 0.18), x = body - 1
  const tip = Math.max(2, body - 2)
  return { rows, lamp: [tip, 1 + heaveAt(phase, tip, 0.18)], push: { x, y: 3 + heaveAt(phase, x, 0.18), force: 0.3 + 0.7 * Math.max(0, Math.cos(phase)) } }
}

/** Mountains: the canopy breathes up from its downturned tips; a single hinged harness swings the eyed rider beneath it. */
function ridgeGlider(tier: Tier, beat: number): MachineFrame {
  const w = 3 + tier * 4, h = [0, 5, 6, 6, 7][tier]!, centre = w >> 1, phase = beat * Math.PI / 4
  const { dot, line, done } = metal(w, h), rider = centre + Math.round(Math.sin(phase)), body = h - 2 - (Math.sin(phase - 0.8) > 0.7 ? 1 : 0)
  const top = (x: number) => Math.round((tier === 1 ? 1 : 2) * (Math.abs(x - centre) / centre) ** 2 + 0.55 - 0.55 * Math.sin(phase - x * 0.45))
  for (let x = 0; x < w; x++) {
    dot(x, top(x), 'l'); dot(x, top(x) + 1, 'a')
  }
  line(centre, top(centre) + 1, centre, body - 1, 'd')
  line(centre, body - 1, rider, body - 1, 'd')
  line(rider - 1, body, rider + 1, body, 'a'); line(rider - 1, body + 1, rider + 1, body + 1, 'd')
  dot(centre, top(centre), 'k')
  const lit = w - 2 - Math.floor(beat * (w - 2) / BEATS)
  dot(lit, top(lit) + 1, 'W')
  dot(rider - 1, body, 'W'); dot(rider, body, 'g'); dot(rider + 1, body, 'k')
  return { rows: done(), push: { x: rider + 1, y: body + 1, force: 0.2 + 0.8 * Math.max(0, Math.cos(phase - 0.8)) } }
}

/** Countryside: open air between two staggered wings and the fuselage; the outboard ailerons flex on alternate half-strokes. */
function cropDuster(tier: Tier, beat: number): MachineFrame {
  const w = 3 + tier * 4, h = tier === 1 ? 5 : 7, base = tier === 1 ? 2 : 3
  const wing = Math.max(4, Math.floor(w * 0.62)), phase = beat * Math.PI / 4
  const { dot, line, done } = metal(w, h)
  const body = (x: number) => base + Math.round(0.55 * Math.sin(phase - Math.max(0, x - 2) * 0.18))
  const upper = (x: number) => tier === 1 ? Math.round(0.5 + 0.5 * Math.sin(phase)) : 1 - Math.round(Math.sin(phase) * (x - 3) / (wing - 3))
  const lower = (x: number) => tier === 1 ? 4 - Math.round(0.5 + 0.5 * Math.sin(phase)) : 5 + Math.round(Math.sin(phase + 0.4) * (x - 3) / (wing - 2))
  for (let x = 0; x < w; x++) {
    line(x, body(Math.max(0, x - 1)), x, body(x), x === w - 1 ? 'l' : 'a')
    if (x < w - 2) dot(x, body(x) + 1, 'd')
  }
  for (let x = 3; x <= wing; x++) line(x, upper(Math.max(3, x - 1)), x, upper(x), 'l')
  for (let x = 3; x <= Math.min(w - 1, wing + 1); x++) line(x, lower(Math.max(3, x - 1)), x, lower(x), 'l')
  for (const x of [3, wing]) line(x, upper(x), x, lower(x), 'k')
  dot(0, body(0) - 1, 'l'); dot(1, body(0) - 1, 'W'); dot(2, body(0) - 1, 'g')
  dot(w - 2, body(w - 2) - 1, 'a')
  const lit = w - 3 - Math.floor(beat * (w - 5) / BEATS)
  dot(lit, body(lit), 'W'); dot(wing, upper(wing), beat % 4 === 0 ? 'r' : 'l')
  return { rows: done(), lamp: [wing, upper(wing)], push: { x: 0, y: body(0), force: 0.25 + 0.75 * Math.abs(Math.cos(phase)) } }
}

/** Forest: a visibly foreshortening two-row rotor lens, one thin mast and a round pod on a long forked boom. */
function autogyro(tier: Tier, beat: number): MachineFrame {
  const w = 3 + tier * 4, cabin = Math.max(3, Math.floor(w * 0.42)), hub = Math.floor(cabin * 0.7), phase = beat * Math.PI / 4
  const { dot, line, done } = metal(w, 7)
  const radius = Math.max(1, Math.round((2 + tier) * (0.3 + 0.7 * Math.abs(Math.cos(phase)))))
  const left = Math.max(0, hub - radius), right = Math.min(w - 1, hub + radius)
  const rotor = (x: number) => 1 + Math.round((x - hub) / (radius + 1) * Math.sin(phase))
  for (let x = left; x <= right; x++) { dot(x, rotor(x), 'l'); dot(x, rotor(x) + 1, 'a') }
  const body = (x: number) => 4 + heaveAt(phase, x, 0.14)
  line(hub, rotor(hub), hub, body(hub), 'k')
  for (let x = 0; x < w; x++) {
    line(x, body(Math.max(0, x - 1)), x, body(x), x > cabin && (x - cabin) % 3 === 0 ? 'd' : x > cabin ? 'l' : 'a') // a plated boom behind the pod
    if (x >= 1 && x < w - 2) dot(x, body(x) + 1, x <= cabin ? 'd' : 'a') // two rows deep all the way along, not a bare stick
    if (x >= 1 && x <= cabin) dot(x, body(x) + 2, 'd') // the pod's belly
  }
  dot(1, body(1), 'W'); dot(2, body(1), 'g')
  dot(w - 2, body(w - 2) - 1, 'l'); dot(w - 2, body(w - 2) + 1, 'l')
  dot(Math.sin(phase) < 0 ? left : right, rotor(Math.sin(phase) < 0 ? left : right), 'd')
  const lit = w - 3 - Math.floor(beat * (w - 5) / BEATS)
  dot(lit, body(lit), 'W')
  return { rows: done(), push: { x: hub, y: rotor(hub) + 1, force: 0.3 + 0.7 * Math.abs(Math.cos(phase)) } }
}

/** Desert: a filled lateen sail that swells sideways and leans at the apex; the low two-row hull keeps its prow eye. */
function sandYacht(tier: Tier, beat: number): MachineFrame {
  const w = 3 + tier * 4, mast = Math.floor(w * 0.62), phase = beat * Math.PI / 4
  const { dot, line, done } = metal(w, 6)
  const foot = Math.max(1, mast - 2 * tier - 1)
  for (let x = foot; x <= mast; x++) {
    const top = Math.max(0, Math.min(3, Math.round(3 * (mast - x) / (mast - foot) + 0.7 * Math.sin(phase - (mast - x) * 0.6))))
    line(x, top, x, 3, 'a'); dot(x, top, 'l')
  }
  line(0, 4, w - 2, 4, 'a'); line(1, 5, w - 3, 5, 'd')
  dot(0, 3, 'l'); dot(0, 4, 'l'); dot(1, 3, 'W'); dot(2, 3, 'g'); dot(w - 2, 3, 'l'); dot(w - 3, 5, 'k')
  platePulse(dot, 3, w - 3, 4, beat)
  const x = w - 3
  return { rows: heave(done(), phase, 0.25), push: { x, y: 5 + heaveAt(phase, x, 0.25), force: 0.2 + 0.8 * Math.max(0, Math.sin(phase - Math.max(0, x - 2) * 0.25)) } }
}

/**
 * Tundra: a plated bush plane. A solid two-row fuselage (light spine, dark belly, seams between plates) with the dragon's eye
 * up front, a high wing that flexes tip-down and tip-up like a bird's, and two curled skis that kick against each other on sprung
 * struts as it works through the air.
 */
function skiPlane(tier: Tier, beat: number): MachineFrame {
  const w = 3 + tier * 4, wing = Math.max(4, Math.floor(w * 0.62)), phase = beat * Math.PI / 4
  const { dot, line, done } = metal(w, 7)
  const pitch = Math.round(0.5 + 0.5 * Math.sin(phase - 1)), top = 1 + pitch // the fuselage rocks a row with each thrust
  for (let x = 0; x < w - 2; x++) { dot(x, top, (x - 3) % 3 === 2 ? 'd' : 'l'); dot(x, top + 1, 'a') } // plates and seams
  dot(0, top, 'l'); dot(0, top + 1, 'd'); dot(1, top, 'W'); dot(2, top, 'g') // nose and eye
  dot(w - 3, top - 1, 'a'); dot(w - 3, top - 2, 'l'); dot(w - 2, top, 'a'); dot(w - 1, top, 'l'); dot(w - 2, top + 1, 'd') // tail fin and tailplane
  const flex = Math.sin(phase) * (0.7 + 0.15 * tier) // the wing's tip rises and sinks; its root stays put
  const wingY = (x: number) => top - 1 - Math.round(flex * (x - 3) / Math.max(1, wing - 3))
  for (let x = 3; x <= wing; x++) { dot(x, wingY(x), 'l'); dot(x, wingY(x) + 1, x === 3 || x === wing ? 'k' : 'a') }
  for (const x of [3, Math.max(4, wing - 2)]) line(x, wingY(x) + 1, x, top, 'k') // struts
  const lit = w - 3 - Math.floor(beat * (w - 5) / BEATS)
  dot(lit, top + 1, 'W')
  dot(wing, wingY(wing), beat % 4 === 0 ? 'r' : 'l')
  dot(0, top + 2 - (beat % 2), 'l') // the prop flicks above and below the nose
  // two skis: bright, curled at the toe, one kicking down as the other lifts, joined to the belly by struts
  let push = { x: 2, y: -1, force: 0 } // (the first ski drawn sets it: the push point is always a painted cell)
  for (const [i, from] of (w >= 11 ? [2, Math.floor(w * 0.62)] : [1]).entries()) { // the smallest plane has the one ski
    const to = Math.min(w - 2, from + 1 + tier)
    const ski = top + 3 + Math.round(Math.sin(phase + i * Math.PI) * 0.6), kick = Math.max(0, Math.sin(phase + i * Math.PI))
    line(from + 1, top + 1, from + 1, ski, 'k'); line(Math.min(to, from + 3), top + 1, Math.min(to, from + 3), ski, 'k')
    for (let x = from; x <= to; x++) dot(x, ski, x === from ? 'W' : 'l')
    dot(from - 1, ski, 'l'); dot(from - 1, ski - 1, 'l') // the toe curls up
    if (ski >= push.y) push = { x: to, y: ski, force: 0.25 + 0.75 * kick }
  }
  return { rows: done(), lamp: [wing, wingY(wing)], push }
}

/** Harbor: a turning paddle wheel dips below the launch's stern; its spokes are geometry, not extra particles. */
function paddleLaunch(tier: Tier, beat: number): MachineFrame {
  const w = 3 + tier * 4, cabin = Math.min(5, 2 + tier), wheel = w - 3, radius = tier === 1 ? 1 : 2, phase = beat * Math.PI / 4
  const { dot, line, done } = metal(w, 6)
  line(2, 0, cabin, 0, 'l'); line(1, 1, cabin, 1, 'a')
  line(0, 2, w - 2, 2, 'a'); line(1, 3, wheel - radius - 1, 3, 'd')
  dot(0, 1, 'l'); dot(1, 1, 'W'); dot(2, 1, 'g'); dot(cabin, 0, 'k')
  for (let dy = -radius; dy <= radius; dy++) {
    const half = Math.floor(Math.sqrt(radius * radius - dy * dy))
    line(wheel - half, 3 + dy, wheel + half, 3 + dy, dy === -radius ? 'l' : 'a')
  }
  for (let spoke = 0; spoke < 3; spoke++) {
    const angle = phase + spoke * Math.PI * 2 / 3
    line(wheel, 3, wheel + Math.cos(angle) * radius, 3 + Math.sin(angle) * radius, 'k')
  }
  dot(wheel, 3, 'l'); dot(wheel + Math.round(Math.cos(phase) * radius), 3 + Math.round(Math.sin(phase) * radius), 'l')
  platePulse(dot, 2, Math.max(2, wheel - radius - 1), 2, beat)
  return { rows: heave(done(), phase, 0.3), push: { x: wheel, y: 3 + radius + heaveAt(phase, wheel, 0.3), force: 0.4 + 0.6 * Math.abs(Math.cos(phase * 1.5)) } }
}

const machineFrames = (build: (tier: Tier, beat: number) => MachineFrame): Record<Tier, readonly MachineFrame[]> => {
  const frames = (tier: Tier) => Array.from({ length: BEATS }, (_, beat) => build(tier, beat))
  return { 1: frames(1), 2: frames(2), 3: frames(3), 4: frames(4) }
}

const MACHINES = {
  harbor: machineFrames(paddleLaunch),
  beach: machineFrames(bannerPlane),
  mountains: machineFrames(ridgeGlider),
  countryside: machineFrames(cropDuster),
  forest: machineFrames(autogyro),
  desert: machineFrames(sandYacht),
  tundra: machineFrames(skiPlane),
}
const pictures = (classes: Record<Tier, readonly MachineFrame[]>): Record<Tier, Frames> => ({
  1: classes[1].map(f => f.rows), 2: classes[2].map(f => f.rows), 3: classes[3].map(f => f.rows), 4: classes[4].map(f => f.rows),
})
const CRAFT: Record<WakePreset, Record<Tier, Frames>> = {
  city: CITY_CRAFT, harbor: pictures(MACHINES.harbor), beach: pictures(MACHINES.beach), mountains: pictures(MACHINES.mountains),
  countryside: pictures(MACHINES.countryside), forest: pictures(MACHINES.forest), desert: pictures(MACHINES.desert), tundra: pictures(MACHINES.tundra),
}

/** The real push point of this pose, before mirroring. Wash lands below it; thrust starts one cell outside it. */
export const craftPush = (place: Exclude<WakePreset, 'city'>, tier: Tier, beat: number) => MACHINES[place][tier][((beat % BEATS) + BEATS) % BEATS]!.push
/** Aeroplane navigation lamps travel with their flexing wings. */
export const craftLamp = (place: Exclude<WakePreset, 'city'>, tier: Tier, beat: number) => MACHINES[place][tier][((beat % BEATS) + BEATS) % BEATS]!.lamp

/** The machine built for this place and class; the city dragon is the default outside a landscape. */
export const craftFrames = (place: WakePreset | undefined, tier: Tier): Frames => CRAFT[place ?? 'city'][tier]

/** A mouth/prow on the actual frame: the dragon's jaw uses its wave; every other face has an eye immediately before glass. */
export function craftNose(place: WakePreset, tier: Tier, beat: number): readonly [number, number] {
  beat = ((beat % BEATS) + BEATS) % BEATS
  if (place === 'city') return [0, Math.max(0, Math.min(DRAGON[tier].h - 1, Math.round(dragonAt(tier, beat, DRAGON[tier].head - 0.5) - 1) + 2))]
  const art = CRAFT[place][tier][beat]!
  for (const [y, row] of art.entries()) {
    const eye = row.indexOf('Wg')
    if (eye >= 0) return [eye, y]
  }
  throw new Error(`Missing Codex face: ${place} class ${tier} beat ${beat}`)
}

/** Every design, for the rectangle, growth and animation checks. */
export const ALL_CRAFT = CRAFT
