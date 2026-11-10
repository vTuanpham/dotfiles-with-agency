import type { WakeMood, WakePreset, WakePulseKind, WakeSceneHit } from '../types'
import { lanes, placeFly, roamOf, stations } from './landscapes/crew'
import { CREW, NIGHT_GAIN, surfaceLights, windLayer } from './landscapes/fx'
import { designFor } from './landscapes/design'
import { type DayPhase, type Job, jobAccent, type Landscape, type Look, P, SCENE_H, type SceneEvent, type Season } from './landscapes/kit'
import { LANDSCAPES } from './landscapes'
import { type Canvas, canvas, hash, mix, sprite } from './pixels'
import { MAX_PACKETS, PACKET_RUN_MS, PACKET_STAGGER_MS, cells, packetWindow, truncate } from './crew-row'
import { type Reaction, type ReactionKind, react } from './reactions'
import { drawMeteor } from './meteor'
import { passages } from './exits'
import { CAT_COLUMNS, CHARACTERS, type CharacterId, MOCHI_ROWS, asCharacter } from './mochi'
import { drawLanterns, drawRainbow } from './flourishes'
import { messagePreview, messageStatus } from './peer-messages'

// The band's diorama. Every thing in it stands for something real:
//   buildings      turns of this session (taller: more tool calls; wider: more edits)
//   their windows  the turn's tool calls, coloured by kind (a red one failed)
//   the live one   the turn in progress, being built
//   street lamps   plan progress (lit steps done)
//   crew           bridge jobs and subagents, one family per harness, bigger with the model's class (amber: stale):
//                  Codex drones, airship, boats; agy sparks, comets, constellations; Claude sparrows, gulls, eagles;
//                  OpenCode paper lanterns, single shades to ribbon garlands
//   creatures      running subagents (Claude's family): the winged thing of the place (landscapes/creatures.ts)
//   Mochi          the mood: laptop while working, ! when something needs you,
//                  a cloud when a command failed, asleep while you're away
//   the sky        the real sun and moon (phase too) where you are
//   weather        the real weather where you are
//   fireworks      tests passed; a storm: a command failed; a shooting star: a bridge job finished;
//                  lanterns: the plan is complete; a rainbow: tests passed right after a failed turn
// The landscape (city, harbor, beach, ...) and the ambient events only set the mood.

const H = SCENE_H
export const SCENE_ROWS = H / 2
export const MIN_SCENE_ROWS = 6 // Compact bands trim upper sky while retaining the ground and character.

export type SceneTurn = { turn?: number; kinds: WakePulseKind[] }
export type SceneEffect = { kind: 'fireworks' | 'storm' | 'shoot' | 'lanterns' | 'rainbow'; age: number }
export const EFFECT_FRAMES: Record<SceneEffect['kind'], number> = { fireworks: 40, storm: 48, shoot: 40, lanterns: 64, rainbow: 56 }

export type SceneWeather = { cloud: number; rain: 0 | 1 | 2 | 3; snow: 0 | 1 | 2 | 3; fog: boolean; thunder: boolean; wind: number }

/** A running subagent as its place's creature: its id's seed (who it is: its lane and pace come from it) and its model's class. */
export type SceneAgent = { id?: string; seed: number; tier: 1 | 2 | 3 | 4; hit?: WakeSceneHit; leaving?: number; arriving?: number; struck?: boolean; pace?: number; settle?: number; phase?: number; route?: number }

export type SceneHitMap = { columns: number; rows: number; owners: number[]; targets: WakeSceneHit[] }
export type SceneSelection = { target: WakeSceneHit; x: number; y: number }

/** The popup stays inside the scene, opposite its selected object. */
export function sceneCardBounds(columns: number, rows: number, selected: { x: number; y: number; details: readonly string[] }) {
  if (columns < 3 || rows < 1) return null
  const width = Math.min(52, columns - 2)
  const height = Math.min(rows, 1 + Math.min(2, selected.details.length))
  return {
    left: selected.x < columns / 2 ? columns - width - 1 : 1,
    top: selected.y < rows / 2 ? rows - height : 0,
    width, height,
  }
}

export type ScenePointerMessage = { type: 'down' | 'move' | 'up' | 'enter' | 'leave'; x: number; y: number }

/** Strictly decode the Client message before using its cell coordinates. */
export function readScenePointer(value: unknown): ScenePointerMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  return ['down', 'move', 'up', 'enter', 'leave'].includes(data.type as string)
    && Number.isSafeInteger(data.x) && Number.isSafeInteger(data.y)
    ? { type: data.type as ScenePointerMessage['type'], x: data.x as number, y: data.y as number }
    : undefined
}

/** A cell is targetable only when its visible halves name at most one object. */
export function sceneHitAt(map: SceneHitMap | null, x: number, y: number): WakeSceneHit | undefined {
  if (!map || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= map.columns || y >= map.rows) return undefined
  const owner = map.owners[y * map.columns + x]!
  return owner > 0 ? map.targets[owner - 1] : undefined
}

const turnHit = (turn: SceneTurn, isLive: boolean): WakeSceneHit | undefined => turn.turn === undefined ? undefined : ({
  id: `turn:${turn.turn}`,
  title: `Turn ${turn.turn}${isLive ? ' · current' : ''}`,
  details: [
    `${turn.kinds.length} tool calls`,
    turn.kinds.length ? turn.kinds.join(' · ') : 'No tool calls recorded',
  ],
})

export type SceneInput = {
  width: number
  frame: number
  hour: number // local hours
  sun: { rise: number; set: number } // local hours
  moonPhase: number // 0 new .. 0.5 full .. 1 new
  season: Season
  snowy: boolean
  weather: SceneWeather | null
  preset: WakePreset
  seed: number // per place
  turns: SceneTurn[] // finished, oldest first
  live: SceneTurn | null
  mood: WakeMood
  jobs: Job[]
  /** A message in flight: who to whom, how fresh (strength), how many (count, as the crew rows' ─ ━ ═ weights) and whose colour it carries. */
  /** arriving: ms since the edge's newest message reached this view, only while its packets run; fresh: one packet each */
  peerEdges?: { source: string; target: string; strength: number; stamp?: string | number; preview?: string | null; messageState?: 'observed' | 'sent'; count?: number; family?: NonNullable<Job['kind']>; arriving?: number; turning?: number; /** ms the sender spends turning before the message leaves */ lead?: number; fresh?: number }[]
  messageTrails?: MessageTrails
  /** A message to (in) or from (out) the root is passing: Mochi shows an envelope. */
  mail?: 'in' | 'out'
  /** Who stands in Mochi's place (see mochi.ts); the default is Mochi herself. */
  character?: CharacterId
  agents: SceneAgent[] // running subagents
  plan: { done: number; total: number } | null
  effect: SceneEffect | null
  forceEvent?: string // previews: play this event now
  effects?: boolean // false: bare sprites and scenery, no wind, trails, lights or particles (for tests that compare pixels, and for a quiet terminal)
}

export { CAT_COLUMNS }

// Mochi and the characters one can pick in her place are drawn in mochi.ts; every one is CAT_COLUMNS x MOCHI_ROWS.
const UMBRELLA = ['..ppppp..', '.ppppppp.', 'pp.p.p.pp', '....h....', '....h....']

// ── sky ────────────────────────────────────────────────────────────────────

const NIGHT_TOP = 0x0b0b14
const NIGHT_LOW = 0x171726

/** The sky's top and horizon colours at `hour`, keyed to the real sunrise and sunset. */
function skyAt(hour: number, rise: number, set: number): [number, number] {
  const r = Math.max(3, Math.min(10, rise))
  const s = Math.max(Math.max(r + 4, 14), Math.min(22.5, set))
  const keys: [number, number, number][] = [
    [0, NIGHT_TOP, NIGHT_LOW],
    [r - 1.5, 0x10101e, 0x24243c],
    [r, 0x3a2d55, 0xb06f7a], // dawn
    [r + 1.5, 0x3d5f93, 0x8fb3dc], // morning
    [(r + s) / 2, 0x3b6db0, 0x9cc4ec], // noon
    [s - 1.2, 0x44558a, 0xd09a7a], // golden hour
    [s, 0x3b2a55, 0xc06a5e], // sunset
    [s + 1.5, 0x161628, 0x2c2c48],
    [24, NIGHT_TOP, NIGHT_LOW],
  ]
  const h = ((hour % 24) + 24) % 24
  const i = Math.max(1, keys.findIndex(([at]) => at > h))
  const [h0, t0, b0] = keys[i - 1]!
  const [h1, t1, b1] = keys[i]!
  const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0)
  return [mix(t0, t1, t), mix(b0, b1, t)]
}

function nightness(hour: number, rise: number, set: number): number {
  const h = ((hour % 24) + 24) % 24
  if (h >= rise + 1 && h <= set - 0.5) return 0
  if (h > rise - 1 && h < rise + 1) return (rise + 1 - h) / 2
  if (h > set - 0.5 && h < set + 1.5) return (h - (set - 0.5)) / 2
  return 1
}

function drawSky(c: Canvas, look: Look, input: SceneInput, celestialOwner = 0) {
  const cloud = input.weather?.cloud ?? 0.2
  const grey = Math.min(0.55, Math.max(0, cloud - 0.5) * 1.1 + (input.weather && input.weather.rain + input.weather.snow > 0 ? 0.2 : 0))
  // overcast greys the sky: light by day, dark by night
  const top = mix(look.top, mix(0x8a90a8, P.surface1, look.night), grey)
  const low = mix(look.horizon, mix(0xa6adc8, P.surface0, look.night), grey)
  for (let y = 0; y < H; y++) {
    const row = mix(top, low, (y / (H - 1)) ** 1.4)
    for (let x = 0; x < c.W; x++) c.set(x, y, row)
  }
  const starsVisible = look.night * (1 - Math.min(1, cloud * 1.2))
  if (starsVisible > 0.05) {
    for (let x = 0; x < c.W; x++) {
      for (let y = 0; y < Math.round(H * 0.85); y++) { // down toward the horizon, fainter as the air thickens
        const h = hash(x * 131 + y * 7919 + input.seed)
        if (h % 37 !== 0) continue
        const tw = (h + Math.floor(look.frame / 5)) % 11
        c.glow(x, y, P.text, (tw === 0 ? 0.15 : tw === 1 ? 1 : 0.6) * starsVisible * (1 - y / (H * 0.95)))
      }
    }
  }
  // sun by day, moon (in its real phase) by night, behind thick cloud neither
  if (cloud < 0.85) {
    const { rise, set } = input.sun
    const day = look.isDay
    const len = day ? set - rise : 24 - (set - rise)
    const since = day ? input.hour - rise : (((input.hour - set) % 24) + 24) % 24
    const arc = Math.max(0, Math.min(1, since / len))
    const bx = Math.round(4 + arc * (c.W - 14))
    const by = Math.round(H * 0.55 - H * 0.5 * Math.sin(Math.PI * arc))
    const disc = ['.##.', '####', '####', '.##.']
    const veil = Math.max(0, cloud - 0.5) * 1.5
    if (day) {
      for (let dy = -2; dy < 6; dy++) for (let dx = -2; dx < 6; dx++) c.glow(bx + dx, by + dy, P.yellow, 0.08 * (1 - veil))
      const drawSun = () => sprite(c, bx, by, disc, { '#': mix(P.yellow, top, veil) })
      if (celestialOwner) c.withHit(celestialOwner, drawSun)
      else drawSun()
    } else {
      // lit fraction from the phase: waxing lights the right side first
      const phase = input.moonPhase
      const lit = (dx: number) => {
        const u = (dx + 0.5) / 4 // 0..1 across the disc
        if (phase < 0.5) return u > 1 - phase * 2
        return u < 1 - (phase - 0.5) * 2
      }
      const drawMoon = () => disc.forEach((line, dy) => {
        for (let dx = 0; dx < 4; dx++) {
          if (line[dx] !== '#') continue
          c.set(bx + dx, by + dy, lit(dx) ? mix(P.snow, top, veil) : mix(top, P.surface1, 0.35))
        }
      })
      if (celestialOwner) c.withHit(celestialOwner, drawMoon)
      else drawMoon()
    }
  }
  // clouds: count and greyness from the cloud cover, drifting with the wind
  // The clouds fill the whole sky, not only its top: high ones small and slow, low ones nearer, longer and quicker.
  const n = Math.round((c.W / 30) * (0.2 + cloud * 1.6) * 1.1)
  const speed = 0.03 + (input.weather?.wind ?? 8) * 0.004
  const tone = mix(mix(P.overlay1, P.surface1, grey), top, look.night * 0.65)
  for (let k = 0; k < n; k++) {
    const span = c.W + 40
    const cy = 1 + (hash(k * 7) % Math.round(H * 0.7))
    const altitude = cy / (H * 0.7) // 0 high .. 1 low
    const cx = Math.round((((hash(k + input.seed) % span) + look.frame * speed * (0.7 + altitude * 0.6) * (1 + (k % 3) * 0.3)) % span) - 20)
    const len = 6 + (hash(k * 13) % 10) + Math.round(altitude * 6)
    for (let i = 0; i < len; i++) {
      c.glow(cx + i, cy, tone, 0.35 + grey * 0.3)
      if (i > 1 && i < len - 2) c.glow(cx + i, cy - 1, tone, 0.25 + grey * 0.3)
      if (cloud > 0.6 && i > 2 && i < len - 3) c.glow(cx + i, cy + 1, tone, 0.2)
    }
  }
}

// ── shared ambient events ──────────────────────────────────────────────────
// (no paper lantern among them: lantern garlands are OpenCode's crew, and a crew sprite always stands for a real job)

const SHARED_EVENTS: SceneEvent[] = [
  {
    name: 'plane',
    frames: 160,
    weight: 3,
    draw(c, look, age, seed) {
      const dir = seed % 2 ? 1 : -1
      const t = age / 160
      const x = Math.round(dir > 0 ? t * (c.W + 10) - 5 : (1 - t) * (c.W + 10) - 5)
      const y = 1 + (seed % Math.round(H * 0.55)) // any altitude
      if (look.night > 0.4) {
        c.set(x, y, age % 8 < 4 ? P.red : P.surface2)
        c.set(x + 1, y, P.white)
      } else {
        c.set(x, y, P.overlay2)
        c.set(x + 1, y, P.overlay2)
        for (let k = 2; k < 14; k++) c.glow(x - dir * k, y, P.white, 0.3 * (1 - k / 14)) // contrail
      }
    },
  },
  {
    name: 'shooting stars',
    frames: 50,
    weight: 2,
    when: look => look.night > 0.7,
    draw(c, _look, age, seed) {
      for (let s = 0; s < 3; s++) {
        const a = age - s * 14
        if (a < 0 || a > 12) continue
        const x0 = (hash(seed + s) % Math.max(1, c.W - 20)) + a * 2
        const y0 = (hash(seed * 3 + s) % Math.round(H * 0.45)) + Math.floor(a / 3)
        for (let k = 0; k < 5; k++) c.glow(x0 - k * 2, y0 - Math.floor(k / 2), P.white, 1 - k / 5)
      }
    },
  },
  {
    name: 'ufo',
    frames: 120,
    weight: 0.25,
    when: look => look.night > 0.8,
    draw(c, _look, age, seed) {
      const x = Math.round(c.W * 0.2 + (seed % Math.max(1, Math.round(c.W * 0.5))) + Math.sin(age * 0.1) * 6)
      const y = 2 + (seed % Math.round(H * 0.4)) + Math.round(Math.sin(age * 0.07))
      sprite(c, x, y, ['..g..', 'sssss'], { g: P.teal, s: P.overlay2 })
      if (age > 30 && age < 90) for (let yy = y + 2; yy < H - 1; yy++) for (let k = -1; k <= 1; k++) c.glow(x + 2 + k, yy, P.green, 0.18)
    },
  },
  {
    name: 'meteor shower',
    frames: 100,
    weight: 0.5,
    when: look => look.night > 0.8,
    draw(c, _look, age, seed) {
      for (let s = 0; s < 8; s++) {
        const a = (age + s * 13) % 25
        const slot = hash(seed + s * 17 + Math.floor((age + s * 13) / 25))
        const x0 = slot % c.W, y0 = (slot >> 8) % Math.round(H * 0.45) // each streak at its own height
        for (let k = 0; k < 3; k++) c.glow(x0 + a - k, y0 + Math.floor(a / 4) - Math.floor(k / 2), P.yellow, 0.9 - k * 0.3)
      }
    },
  },
  {
    name: 'rainbow',
    frames: 260,
    weight: 4,
    when: look => look.isDay && look.wet,
    draw(c, _look, age) {
      const fade = Math.min(1, age / 30, (260 - age) / 30) * 0.4
      const bands = [P.red, P.peach, P.yellow, P.green, P.blue, P.mauve]
      const cx = c.W * 0.4
      for (let x = 0; x < c.W; x++) {
        bands.forEach((band, i) => {
          const r = c.W * 0.32 - i
          const dx = (x - cx) / r
          if (Math.abs(dx) > 1) return
          c.glow(x, Math.round(H - 2 - Math.sqrt(1 - dx * dx) * (H - 3)), band, fade)
        })
      }
    },
  },
  {
    name: 'flock',
    frames: 140,
    weight: 2,
    when: look => look.isDay && !look.wet,
    draw(c, _look, age, seed) {
      for (let b = 0; b < 7; b++) {
        const x = Math.round((age / 140) * (c.W + 30)) - 20 + Math.abs(b - 3) * 2
        const y = 2 + Math.abs(b - 3) + (seed % Math.round(H * 0.5)) // the flock at any altitude
        const up = (age + b) % 6 < 3
        c.set(x, y, P.surface2)
        c.set(x - 1, up ? y - 1 : y, P.surface2)
        c.set(x + 1, up ? y - 1 : y, P.surface2)
      }
    },
  },
]

const SLOT = 400 // frames: a chance of one event every 40 seconds

function playingEvent(look: Look, events: SceneEvent[], force?: string): { event: SceneEvent; age: number; seed: number } | null {
  if (force) {
    const event = events.find(e => e.name === force)
    return event ? { event, age: look.frame % event.frames, seed: look.seed } : null
  }
  const slot = Math.floor(look.frame / SLOT)
  const h = hash(look.seed ^ Math.imul(slot, 7919))
  if (h % 100 >= 55) return null
  const pool = events.filter(e => !e.when || e.when(look))
  const total = pool.reduce((sum, e) => sum + e.weight, 0)
  if (total === 0) return null
  let pick = ((h >>> 8) % 10_000) / 10_000 * total
  const event = pool.find(e => (pick -= e.weight) < 0) ?? pool[0]!
  const delay = event.frames < SLOT ? (h >>> 4) % (SLOT - event.frames) : 0
  const age = (look.frame % SLOT) - delay
  return age >= 0 && age < event.frames ? { event, age, seed: h } : null
}

// ── weather and session effects ────────────────────────────────────────────

function drawWeather(c: Canvas, look: Look, w: SceneWeather, ground: number) {
  const slant = w.wind > 30 ? 2 : w.wind > 15 ? 1 : 0
  if (w.rain > 0) {
    const every = [0, 31, 19, 12][w.rain]!
    for (let x = -10; x < c.W; x++) {
      for (let y = 0; y < ground + 1; y++) {
        const fall = (((y - look.frame * 2) % 48) + 48) % 48
        if (hash(x * 31 + fall * 17) % every !== 0) continue
        c.glow(x + Math.floor((y * slant) / 3), y, P.blue, 0.45)
        if (y + 1 <= ground) c.glow(x + Math.floor(((y + 1) * slant) / 3), y + 1, P.blue, 0.25)
      }
    }
    if (w.rain >= 2) for (let x = 0; x < c.W; x++) if (hash(x + look.frame * 3) % 19 === 0) c.glow(x, ground, P.sky, 0.5) // splashes
  }
  if (w.snow > 0) {
    const every = [0, 29, 17, 9][w.snow]!
    for (let x = 0; x < c.W; x++) {
      for (let y = 0; y < ground + 1; y++) {
        const fall = (((y - Math.floor(look.frame / 3)) % 36) + 36) % 36
        if (hash(x * 53 + fall * 29) % every !== 0) continue
        c.glow(x + Math.round(Math.sin((look.frame + x * 7) * 0.08) + (slant * y) / 6), y, P.white, 0.85)
      }
    }
  }
  if (w.fog) {
    for (let y = 0; y < H; y++) {
      const base = 0.15 + (y / H) * 0.45
      for (let x = 0; x < c.W; x++) c.glow(x, y, P.overlay2, base * (0.75 + 0.25 * Math.sin((x + look.frame * 0.3) * 0.12 + y)))
    }
  }
  if (w.thunder) {
    const cycle = look.frame % 170
    if (cycle === 3 || cycle === 4 || cycle === 9) {
      for (let y = 0; y < H; y++) for (let x = 0; x < c.W; x++) c.glow(x, y, P.white, 0.15)
      let x = hash(Math.floor(look.frame / 170) + look.seed) % c.W
      for (let y = 0; y < ground; y++) {
        c.set(x, y, P.yellow)
        x += hash(y + look.frame) % 3 === 0 ? -1 : 1
      }
    }
  }
}

/** How each country celebrates a pass: the shell colours, how far the embers fall, whether the burst echoes off a ridge or mirrors in water. */
const FIREWORK_STYLE: Record<WakePreset, { inks: number[]; fall: number; echo?: boolean; mirror?: boolean }> = {
  city: { inks: [P.yellow, P.pink, P.mauve, P.green, P.sky, P.peach], fall: 3 },
  harbor: { inks: [P.white, P.sky, P.yellow, P.peach, P.red], fall: 3, mirror: true },
  beach: { inks: [P.pink, P.teal, P.yellow, P.peach, P.white], fall: 3, mirror: true },
  mountains: { inks: [P.white, P.lavender, P.sky, P.blue], fall: 3, echo: true },
  countryside: { inks: [P.yellow, P.peach, P.green, P.pink], fall: 3 },
  forest: { inks: [P.yellow, P.peach, P.red, P.green], fall: 1.5 }, // slow embers, drifting like sparks from a campfire
  desert: { inks: [P.yellow, P.peach, P.red, P.white], fall: 2 },
  tundra: { inks: [P.green, P.teal, P.sky, P.mauve, P.white], fall: 4 }, // cold light that hangs, then sinks like the aurora
}

/** What a failed command does to the weather: rain, or a sandstorm or blizzard where that is the local storm. */
export const STORM: Partial<Record<WakePreset, 'sand' | 'snow'>> = { desert: 'sand', tundra: 'snow' }

function drawEffect(c: Canvas, look: Look, fx: SceneEffect, ground: number, right: number, preset: WakePreset) {
  if (fx.kind === 'fireworks') {
    const { inks: sparks, fall, echo, mirror } = FIREWORK_STYLE[preset]
    for (let b = 0; b < 4; b++) {
      const age = fx.age - b * 7
      if (age < 0 || age > 20) continue
      const seed = hash(b * 101 + 7)
      const cx = Math.round(right * (0.15 + 0.23 * b) + (seed % 9))
      const cy = 2 + (seed % Math.round(H * 0.3)) // shells burst at different heights
      const color = sparks[(seed + b) % sparks.length]!
      if (age < 5) {
        c.set(cx, ground - 1 - age * 2, P.white)
        c.glow(cx, ground - age * 2, P.yellow, 0.5)
        continue
      }
      const r = Math.min(5, age - 4)
      const fade = age > 13 ? (age - 13) / 8 : 0
      const sink = age > 10 ? Math.floor((age - 10) / fall) : 0
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2
        const x = cx + Math.round(Math.cos(ang) * r * 1.4), y = cy + Math.round(Math.sin(ang) * r * 0.8) + sink
        c.glow(x, y, a % 2 ? color : P.white, 1 - fade)
        if (mirror) c.glow(x, Math.min(H - 1, ground + 1 + Math.floor(Math.max(0, ground - y) / 2)), color, 0.35 * (1 - fade)) // its reflection in the water
        if (echo && r > 2) c.glow(cx + Math.round(Math.cos(ang) * (r - 2) * 1.4), cy + Math.round(Math.sin(ang) * (r - 2) * 0.8) + sink, color, 0.45 * (1 - fade)) // the ridge answers
      }
      if (age < 8) c.glow(cx, cy, P.white, 0.9)
    }
  } else if (fx.kind === 'storm') {
    const local = STORM[preset]
    drawWeather(c, look, { cloud: 1, rain: local ? 0 : 3, snow: local === 'snow' ? 3 : 0, fog: false, thunder: false, wind: local === 'snow' ? 40 : 25 }, ground)
    if (local === 'sand') for (let y = 0; y < ground + 1; y++) for (let x = 0; x < c.W; x++) { // a wall of sand blown across, thickest low down
      const run = (x + look.frame * 3 + y * 5) % 23
      if (hash(x * 7 + y * 131 + Math.floor((x + look.frame * 3) / 23)) % 3 === 0 && run < 9) c.glow(x, y, P.sand, 0.25 + 0.4 * (y / ground))
    }
    if ([3, 4, 14, 30].includes(fx.age) && local === 'snow') for (let y = 0; y < H; y++) for (let x = 0; x < c.W; x++) c.glow(x, y, P.white, 0.3) // the whiteout pulses
    else if ([3, 4, 14, 30].includes(fx.age)) {
      for (let y = 0; y < H; y++) for (let x = 0; x < c.W; x++) c.glow(x, y, P.white, 0.18)
      let x = Math.round(right * (0.3 + 0.3 * ((fx.age % 5) / 5)))
      for (let y = 0; y < ground; y++) {
        c.set(x, y, P.yellow)
        c.glow(x - 1, y, P.yellow, 0.3)
        x += hash(y + fx.age) % 3 === 0 ? -1 : 1
      }
    }
  } else if (fx.kind === 'lanterns') {
    drawLanterns(c, fx.age / EFFECT_FRAMES.lanterns, ground, right)
  } else if (fx.kind === 'rainbow') {
    drawRainbow(c, fx.age / EFFECT_FRAMES.rainbow, ground, right)
  } else if (preset === 'tundra') {
    // a finished job lights the aurora: a green ribbon sweeps across the sky and fades
    const t = fx.age / EFFECT_FRAMES.shoot
    const head = t * (c.W + 24) - 12
    for (let x = 0; x < c.W; x++) {
      const behind = head - x
      if (behind < 0 || behind > 24) continue
      const y = 4 + Math.round(1.6 * Math.sin(x * 0.3 + fx.age * 0.4)) + Math.round(2 * Math.sin(x * 0.04))
      const strength = (1 - behind / 24) * (1 - Math.max(0, t - 0.7) / 0.3)
      c.glow(x, y, P.green, 0.9 * strength)
      c.glow(x, y + 1, P.teal, 0.55 * strength)
      c.glow(x, y + 2, P.sky, 0.25 * strength)
    }
  } else {
    drawMeteor(c, fx.age / EFFECT_FRAMES.shoot, preset === 'desert' ? P.peach : P.sky, ground)
  }
}

// ── Mochi ──────────────────────────────────────────────────────────────────

function drawMochi(c: Canvas, look: Look, input: SceneInput, ground: number, catX: number, jump: number) {
  const fx = input.effect
  const blink = input.mood !== 'sleep' && look.frame % 61 < 2
  const character = CHARACTERS[asCharacter(input.character)]
  const rows = input.mood === 'work' || look.frame % 24 < 12 ? character.up : character.down
  const top = ground - MOCHI_ROWS - jump
  const eye = input.mood === 'sleep' || blink ? P.overlay0 : character.ink.E!
  sprite(c, catX, top, rows, { ...character.ink, E: eye })
  if (look.snowy && input.weather && input.weather.snow > 0) c.set(catX + 3, top + 2, P.white) // a snowflake on her head
  if (input.mood === 'work') {
    const lx = catX - 4
    for (let k = 0; k < 4; k++) c.set(lx + k, ground, P.overlay0)
    for (let y = ground - 3; y < ground; y++) c.set(lx, y, P.overlay0)
    for (let k = 1; k < 4; k++) c.glow(lx + k, ground - 1, P.teal, look.frame % 6 < 3 ? 0.35 : 0.2)
    c.glow(catX + 1, top + 4, P.teal, 0.25)
  }
  const raining = (input.weather?.rain ?? 0) > 0 || (fx?.kind === 'storm' && !STORM[input.preset])
  if (raining && input.mood !== 'sleep') sprite(c, catX, top - 3, UMBRELLA, { p: P.pink, h: P.overlay1 })
  if (input.mood === 'sleep') {
    for (let k = 0; k < 2; k++) {
      const z = (Math.floor(look.frame / 4) + k * 5) % 10
      c.glow(catX + 8 + Math.floor(z / 4), top - 1 - Math.floor(z / 2), P.white, 0.9 - z / 10)
    }
  }
  if (input.mail) {
    // an envelope hops over her head: it drops in for a worker's message, lifts away for the root's
    const t = (look.frame % 8) / 8, hop = Math.round(Math.sin(t * Math.PI) * 2)
    const slide = input.mail === 'in' ? Math.round((1 - t) * 2) : Math.round(t * 2)
    sprite(c, catX + 1, Math.max(0, top - 6 + slide - hop), ['EEEE', 'ELLE', 'EEEE'], { E: P.snow, L: input.mail === 'in' ? P.green : P.peach })
  }
  if (input.mood === 'alert' && look.frame % 8 < 5) {
    c.set(catX + 4, top - 4, P.yellow)
    c.set(catX + 4, top - 3, P.yellow)
    c.set(catX + 4, top - 1, P.yellow)
  }
  if (input.mood === 'sad' && !raining) {
    for (let x = catX; x < catX + 8; x++) {
      c.set(x, top - 3, P.overlay0)
      if (x > catX && x < catX + 7) c.set(x, top - 4, P.overlay0)
    }
    for (let k = 0; k < 4; k++) c.glow(catX + 1 + k * 2, top - 2 + ((look.frame + k) % 2), P.blue, 0.9)
  }
  if (input.mood === 'happy' && !jump) {
    const sparks = [P.yellow, P.pink, P.mauve]
    for (let k = 0; k < 3; k++) if ((look.frame + k * 3) % 9 < 3) c.glow(catX - 1 + k * 5, top - 1 - (k % 2), sparks[k]!, 0.9)
  }
}

// ── the whole scene ────────────────────────────────────────────────────────

/** The part of the day from the real sunrise and sunset. */
export function phaseOf(hour: number, rise: number, set: number): DayPhase {
  const h = ((hour % 24) + 24) % 24
  if (h >= rise - 0.75 && h < rise + 0.75) return 'dawn'
  if (h >= rise + 0.75 && h < 11) return 'morning'
  if (h >= 11 && h < 14) return 'noon'
  if (h >= 14 && h < set - 1) return 'afternoon'
  if (h >= set - 1 && h < set + 0.75) return 'dusk'
  return 'night'
}

/** Each phase's share of a ~50 min window around the hour: a cross-fade at every boundary. */
function phaseBlend(hour: number, rise: number, set: number): Record<DayPhase, number> {
  const blend: Record<DayPhase, number> = { dawn: 0, morning: 0, noon: 0, afternoon: 0, dusk: 0, night: 0 }
  const samples = 9
  for (let i = 0; i < samples; i++) blend[phaseOf(hour + ((i / (samples - 1)) - 0.5) * 0.85, rise, set)] += 1 / samples
  return blend
}

export function lookOf(input: SceneInput): Look {
  const [top, horizon] = skyAt(input.hour, input.sun.rise, input.sun.set)
  const w = input.weather
  return {
    W: input.width,
    H,
    frame: input.frame,
    hour: input.hour,
    night: nightness(input.hour, input.sun.rise, input.sun.set),
    isDay: input.hour >= input.sun.rise && input.hour < input.sun.set,
    phase: phaseOf(input.hour, input.sun.rise, input.sun.set),
    blend: phaseBlend(input.hour, input.sun.rise, input.sun.set),
    top,
    horizon,
    season: input.season,
    snowy: input.snowy,
    wet: (w?.rain ?? 0) + (w?.snow ?? 0) > 0,
    wind: w?.wind ?? 8,
    seed: input.seed,
    working: input.mood === 'work',
    effects: input.effects,
  }
}

/**
 * The scene's pixels, row-major, `width` x SCENE_H, as 0xRRGGBB.
 * Flights cross atmospheric effects; bodies and solid foreground occlude their historical residue.
 */
export function scenePixels(input: SceneInput, crewAnchors: number[] = [], hitMap?: SceneHitMap, messagePoints?: Map<string, Anchor>): Uint32Array {
  input.messageTrails?.begin(input)
  return drawScene(input, crewAnchors, hitMap, messagePoints)
}

function drawScene(input: SceneInput, crewAnchors: number[], hitMap: SceneHitMap | undefined, messagePoints?: Map<string, Anchor>): Uint32Array {
  // (a scene with a message landing needs the hit owners even when nobody asked for the map: the reactions find sprites by them)
  const exiting = [...input.jobs, ...input.agents].some(job => job.leaving !== undefined || job.arriving !== undefined)
  const localHits = hitMap ?? (input.peerEdges?.length || exiting ? { columns: input.width, rows: SCENE_ROWS, owners: [], targets: [] } : undefined)
  const reactions: Reaction[] = []
  const c = canvas(input.width, H, localHits !== undefined)
  const look = lookOf(input)
  look.crewStarTargets = new Set((input.peerEdges ?? []).filter(edge => edge.arriving !== undefined && CREW[edge.family ?? input.jobs.find(job => job.hit?.id === (edge.source === 'mochi' ? edge.target : edge.source))?.kind ?? 'codex'].message === 'starfall').flatMap(edge => [edge.source, edge.target]))
  look.hitTargets = localHits?.targets
  look.place = input.preset
  const registerHit = (target: WakeSceneHit | undefined) => {
    if (!target || !localHits) return 0
    localHits.targets.push(target)
    return localHits.targets.length
  }
  const jobs = input.jobs.map(job => ({ ...job, hitOwner: registerHit(job.hit) || undefined }))
  const agents = input.agents.map(agent => ({
    isStale: false, seed: agent.seed, tier: agent.tier, kind: 'claude' as const, pace: agent.pace, settle: agent.settle, phase: agent.phase, route: agent.route, lane: undefined as Job['lane'], talk: undefined as Job['talk'],
    hit: agent.hit, hitOwner: registerHit(agent.hit) || undefined,
  }))
  const skyOwner = registerHit({ id: 'sky', title: 'Sky', details: [look.isDay ? 'Daytime' : 'Nighttime', input.weather ? `Cloud cover: ${Math.round(input.weather.cloud * 100)}%` : 'Weather unavailable'] })
  const sceneryOwner = registerHit({ id: 'scenery', title: `${input.preset} landscape`, details: ['Scene setting'] })
  const foregroundOwner = registerHit({ id: 'foreground', title: `${input.preset} landscape`, details: ['Scene setting'] })
  const celestialOwner = (input.weather?.cloud ?? 0) < 0.85 ? registerHit({ id: look.isDay ? 'sun' : 'moon', title: look.isDay ? 'Sun' : 'Moon', details: [look.isDay ? 'Daytime' : `Lunar cycle: ${Math.round(input.moonPhase * 100)}%`] }) : 0
  const trails = new Set<number>() // hit owners of message trails
  let skyPixels: Uint32Array | undefined
  let sceneryPixels: Uint32Array | undefined
  const finish = () => {
    if (hitMap) {
      hitMap.columns = c.W
      hitMap.rows = SCENE_ROWS
      hitMap.owners = Array.from({ length: c.W * SCENE_ROWS }, (_, i) => {
        const row = Math.floor(i / c.W), x = i % c.W
        let top = c.hitOwners![(2 * row) * c.W + x]!
        let bottom = c.hitOwners![(2 * row + 1) * c.W + x]!
        // a trail is background: it shares a cell with anything real and loses it
        if (trails.has(top) && bottom && !trails.has(bottom)) top = 0
        if (trails.has(bottom) && top && !trails.has(top)) bottom = 0
        if (top || bottom) return top === bottom ? top : top === 0 ? bottom : bottom === 0 ? top : 0
        const a = (2 * row) * c.W + x, b = (2 * row + 1) * c.W + x
        if (skyPixels && c.px[a] === skyPixels[a] && c.px[b] === skyPixels[b]) return skyOwner
        if (skyPixels && sceneryPixels && (sceneryPixels[a] !== skyPixels[a] || sceneryPixels[b] !== skyPixels[b]) && c.px[a] === sceneryPixels[a] && c.px[b] === sceneryPixels[b]) return sceneryOwner
        return 0
      })
    }
    return c.px
  }
  const land: Landscape = LANDSCAPES[input.preset]
  const ground = land.ground
  const catX = c.W - CAT_COLUMNS - 1
  const right = catX - 5 // left of the laptop
  const planOwner = registerHit({
    id: 'plan-lamps', title: input.plan ? 'Plan progress' : 'Night lamps',
    details: [input.plan ? `${input.plan.done} of ${input.plan.total} steps complete` : 'Lamps light at night when no plan is active'],
  })
  const mochiOwner = registerHit({ id: 'mochi', title: CHARACTERS[asCharacter(input.character)].label, details: [`Session mood: ${input.mood}`] })

  drawSky(c, look, input, celestialOwner)
  const skyBeforeBackdrop = c.px.slice()
  if (localHits) skyPixels = skyBeforeBackdrop
  land.backdrop(c, look)
  // Aurora and other translucent night effects are not surfaces. Sample the same terrain in daylight for its solid contour.
  const terrain = look.night > 0 ? canvas(c.W, c.H) : undefined
  if (terrain) land.backdrop(terrain, { ...look, night: 0, isDay: true, phase: 'noon', blend: { dawn: 0, morning: 0, noon: 1, afternoon: 0, dusk: 0, night: 0 } })
  const solid = (x: number, y: number) => terrain ? terrain.get(x, y) !== 0 : c.px[y * c.W + x] !== skyBeforeBackdrop[y * c.W + x]
  const terrainPerches: { x: number; y: number }[] = []
  for (let x = 2; x < right - 2; x++) {
    let y = 1
    while (y < ground && !solid(x, y)) y++
    if (y < ground && solid(x - 1, y) && solid(x + 1, y)) terrainPerches.push({ x, y: y - 1 })
  }
  land.floor(c, look)
  if (localHits) sceneryPixels = c.px.slice()

  look.crewZones = []
  look.crewMessagePoints = {}
  look.crewBoxes = {}
  const far = (job: { kind?: Job['kind'] }) => designFor(job.kind ?? 'codex', input.preset).depth === 'far'
  const hasFar = jobs.some(far)
  if (hasFar || (input.peerEdges ?? []).some(edge => (edge.turning ?? edge.arriving) !== undefined && edge.source !== 'mochi' && edge.target !== 'mochi')) {
    look.crewDeferred = []
    look.crewPaths = {}
  }
  look.crewGround = ground
  look.crewLights = []
  look.crewSurface = { ground: { y: ground, x0: 0, x1: right }, ...(land.water === undefined || look.snowy && land.waterFreezes ? {} : { water: { y: land.water, spans: [{ x0: land.waterStart ?? 0, x1: right }] } }), perches: land.groundPerches ? Array.from({ length: right }, (_, x) => ({ x, y: ground - 1 })) : terrainPerches }
  look.crewAnchors = crewAnchors
  look.crewAnchorsFrom = crewAnchors.length
  const catZone = { x: catX - 4, y: 0, w: CAT_COLUMNS + 4, h: H }
  look.crewZones.push(catZone)
  look.crewSpriteZones = [catZone]
  look.crewHard = [catZone] // what no flyer may cross: Mochi and her laptop (the rest of the crew is a soft boundary, see placeFly)
  if (input.mood === 'work') {
    const laptop = { x: catX - 4, y: ground - 3, w: 4, h: 4 }
    look.crewZones.push(laptop)
    look.crewSpriteZones.push(laptop)
    look.crewHard.push(laptop)
  }
  if ((input.weather?.cloud ?? 0) < 0.85) {
    const { rise, set } = input.sun
    const len = look.isDay ? set - rise : 24 - (set - rise)
    const since = look.isDay ? input.hour - rise : (((input.hour - set) % 24) + 24) % 24
    const arc = Math.max(0, Math.min(1, since / len))
    const x = Math.round(4 + arc * (c.W - 14)), y = Math.round(H * 0.55 - H * 0.5 * Math.sin(Math.PI * arc))
    const top = y & ~1
    look.crewZones.push({ x, y: top, w: 4, h: y + 4 - top + (y % 2) })
  }


  // Turn buildings and their furniture reserve their painted pixels for the crew. Filler (the backdrop between and behind
  // them) does not: flyers pass in front of it, otherwise a dense skyline like the city's leaves no sky to move in.
  const reference = canvas(c.W, c.H)
  const referenceLook = { ...look, frame: 0, crewZones: [] }
  const beforeStructures = reference.px.slice()
  const structures = (target: Canvas, state: Look, tag = false, filler = true) => {
    let edge = right
    const place = (kinds: WakePulseKind[], index: number, isLive: boolean) => {
      const { width, height } = land.size(kinds, index, state)
      const x0 = edge - width
      if (x0 + width < 0) return false
      const turn = isLive ? input.live : input.turns[index]
      const owner = tag && turn ? registerHit(turnHit(turn, isLive)) : 0
      const draw = () => land.building(target, state, { kinds, index, x0, width, height, isLive })
      if (owner) target.withHit(owner, draw)
      else draw()
      const gap = land.gap(index, state)
      if (gap > 0 && filler) land.filler(target, state, x0 - gap, x0)
      edge = x0 - gap
      return true
    }
    if (input.live) place(input.live.kinds, input.turns.length, true)
    for (let i = input.turns.length - 1; i >= 0; i--) if (!place(input.turns[i]!.kinds, i, false)) break
    if (edge > 0 && filler) land.filler(target, state, 0, edge)
  }
  structures(c, look, true)
  structures(reference, referenceLook, false, false)
  look.crewZones.push(...referenceLook.crewZones)

  // `sway` widens each reserved run by the pixels an animated figure moves (the reference is drawn at frame 0), so a
  // palm frond mid-sway is still never painted over, while the crew's lanes stay fixed from frame to frame.
  const reserveChanges = (before: Uint32Array, sway = 0) => {
    for (let y = 0; y < H; y++) {
      let start = -1
      for (let x = 0; x <= right; x++) {
        const changed = x < right && reference.px[y * c.W + x] !== before[y * c.W + x]
        if (changed && start < 0) start = x
        if (!changed && start >= 0) {
          look.crewZones!.push({ x: start - sway, y: y & ~1, w: x - start + 2 * sway, h: 2 })
          start = -1
        }
      }
    }
  }
  reserveChanges(beforeStructures)

  // lamps: plan progress
  const lamps = Math.max(0, Math.floor((right - 4) / 9))
  for (let i = 0; i < lamps; i++) {
    const x = 4 + i * 9
    const on = input.plan ? i < Math.round((lamps * input.plan.done) / input.plan.total) : look.night > 0.5
    const color = input.plan ? P.yellow : mix(P.yellow, P.mantle, 0.35)
    const drawLamp = () => {
      c.set(x, ground - 1, P.surface1)
      c.set(x, ground - 2, on ? color : P.surface2)
      if (on) for (const [dx, t] of [[-1, 0.25], [0, 0.4], [1, 0.25]] as const) c.glow(x + dx, ground, color, t)
    }
    if (planOwner) c.withHit(planOwner, drawLamp)
    else drawLamp()
    const lampTop = (ground - 2) & ~1
    look.crewZones.push({ x: x - 1, y: lampTop, w: 3, h: ground + 2 - lampTop })
  }

  // Foreground figures reserve their visible pixels before the crew picks lanes.
  const beforeForeground = reference.px.slice()
  if (foregroundOwner) c.withHit(foregroundOwner, () => land.foreground(c, look, right))
  else land.foreground(c, look, right)
  land.foreground(reference, referenceLook, right)
  const foregroundStart = look.crewZones.length
  reserveChanges(beforeForeground, 2)
  look.crewSurfaceObstacles = look.crewZones.slice(foregroundStart)
  const surfaces = new Uint8Array(c.W * c.H)
  for (let y = 0; y < c.H; y++) for (let x = 0; x < c.W; x++) surfaces[y * c.W + x] = y >= ground || solid(x, y) || reference.get(x, y) !== 0 ? 1 : 0
  look.crewSurfaceAt = (x, below) => {
    if (x < 0 || x >= c.W) return undefined
    for (let y = Math.max(0, Math.ceil(below)); y < c.H; y++) if (surfaces[y * c.W + x]) return y
    return undefined
  }
  // The reference is painted from the actual structures and foreground at their stable pose.
  for (let x = 2; !land.groundPerches && x < right - 2; x++) {
    let y = 1
    while (y < ground && !reference.get(x, y)) y++
    if (y < ground && reference.get(x - 1, y) && reference.get(x + 1, y)) look.crewSurface.perches.push({ x, y: y - 1 })
  }
  const playing = playingEvent(look, [...land.events, ...SHARED_EVENTS], input.forceEvent)
  const eventOwner = playing ? registerHit({ id: `event:${playing.event.name}`, title: playing.event.name, details: ['Ambient scene event'] }) : 0
  if (playing) {
    const draw = () => playing.event.draw(c, look, playing.age, playing.seed)
    if (eventOwner) c.withHit(eventOwner, draw)
    else draw()
  }

  // Subagents and jobs share the same exclusion zones, and the same sky: each roams its share of what is free.
  look.crewRoam = roamOf([...jobs, ...agents], right)
  look.crewCount = jobs.length + agents.length
  for (const [member, lane] of lanes([...jobs, ...agents], right)) member.lane = lane // each flyer owns a stretch of the whole sky
  const targets = new Map<Job, string>()
  for (const edge of input.peerEdges ?? []) {
    const elapsed = edge.turning ?? edge.arriving
    if (elapsed === undefined) continue
    const done = elapsed - (packetWindow(edge.fresh ?? 1) + (edge.lead ?? 0))
    for (const [id, other, sending] of [[edge.source, edge.target, true], [edge.target, edge.source, false]] as const) {
      if (id === 'mochi') continue
      const worker: Job | undefined = [...jobs, ...agents].find(job => job.hit?.id === id)
      // The song recipient rises as the notes reach it, including direct scene callers without band activity data.
      if (worker && !sending && CREW[edge.family ?? worker.kind ?? 'codex'].message === 'song' && edge.arriving !== undefined) {
        const since = edge.arriving - (edge.lead ?? 0) - PACKET_RUN_MS * 0.65
        worker.lift = Math.max(worker.lift ?? 0, Math.max(0, 1 - Math.abs(since - 120) / 400))
      }
      if (worker && (!worker.talk || elapsed < worker.talk.ms)) {
        worker.talk = { ms: elapsed, sending, targetX: other === 'mochi' ? catX + 4 : undefined, ...(done >= 0 ? { over: done } : {}) }
        targets.set(worker, other)
      }
    }
  }
  // Keep the real scenery under arriving and leaving sprites, including the textured harbor water.
  windLayer(c, look)
  let passageBackground = exiting || hasFar ? c.px.slice() : undefined
  const sceneryOwners = hasFar ? c.hitOwners?.slice() : undefined
  const coming = [...input.jobs.map(job => ({ ...job, kind: job.kind ?? 'codex' as const })), ...input.agents.map(agent => ({ ...agent, kind: 'claude' as const }))]
    .flatMap(job => job.hit && (job.arriving ?? job.leaving) !== undefined
      ? [{ id: job.hit.id, kind: job.kind, place: input.preset, seed: job.seed, age: job.arriving ?? job.leaving!, arriving: job.arriving !== undefined, struck: job.struck }] : [])
  land.jobs(c, look, jobs, right)
  for (const [bird, j] of stations(agents, 5)) {
    if (j >= 5) continue
    // A bird keeps a home perch in the sky (its own slot of five) and circles it: placeFly drifts it a few pixels either way
    // and bobs it, so it glides in place instead of crossing the whole band and jumping around whatever it meets.
    const x = Math.round(8 + ((j + 0.5) * (right - 16)) / 5)
    const y = 3 + (j % 3)
    placeFly(c, look, x, y, bird, right)
  }
  if (look.crewDeferred) {
    for (const [worker, target] of targets) {
      if (!worker.talk || target === 'mochi') continue
      const atMessage = (id: string) => {
        const point = look.crewMessagePoints![id], path = look.crewPaths?.[id]
        return point && (path ? point.x + path(worker.talk!.ms / 1000)[0] - path(0)[0] : point.x)
      }
      worker.talk.targetX = atMessage(target)
      worker.talk.sourceX = worker.hit ? atMessage(worker.hit.id) : undefined
    }
    for (const entry of look.crewDeferred) if (far(entry.job)) entry.draw()
    if (localHits && coming.some(far)) passages(c, localHits.targets, coming.filter(far), passageBackground, look.crewBoxes, look.crewMessagePoints)
    // Distant bodies, bloom and passages sit behind the same solid scenery, including city rooftops.
    if (hasFar) {
      for (let i = 0; i < surfaces.length; i++) if (surfaces[i]) {
        c.px[i] = passageBackground![i]!
        if (c.hitOwners && sceneryOwners) c.hitOwners[i] = sceneryOwners[i]!
      }
      if (exiting) passageBackground = c.px.slice()
    }
    for (const entry of look.crewDeferred) if (!far(entry.job)) entry.draw()
  }
  const songLanding = (input.peerEdges ?? []).some(edge => {
    if (edge.target !== 'mochi' || edge.arriving === undefined) return false
    const family = edge.family ?? input.jobs.find(job => job.hit?.id === edge.source)?.kind ?? (input.agents.some(agent => agent.hit?.id === edge.source) ? 'claude' : 'codex')
    const since = edge.arriving - (edge.lead ?? 0) - PACKET_RUN_MS * 0.65
    return CREW[family].message === 'song' && since > -80 && since < 320
  })
  const rootJump = songLanding || input.effect?.kind === 'fireworks' && input.effect.age < 28 && look.frame % 6 < 3 ? 1 : 0
  const rootPoint = { x: catX + 4, y: ground - MOCHI_ROWS - rootJump + 5 }
  if (messagePoints) {
    for (const [id, point] of Object.entries(look.crewMessagePoints ?? {})) messagePoints.set(id, point)
    messagePoints.set('mochi', rootPoint)
  }
  if (input.weather) {
    const weather = input.weather
    const weatherOwner = registerHit({ id: 'weather', title: 'Weather', details: [`Cloud cover: ${Math.round(weather.cloud * 100)}%`, weather.thunder ? 'Thunderstorm' : weather.snow ? 'Snow' : weather.rain ? 'Rain' : weather.fog ? 'Fog' : 'No precipitation shown'] })
    if (weatherOwner) c.withHit(weatherOwner, () => drawWeather(c, look, weather, ground))
    else drawWeather(c, look, weather, ground)
  }
  if (input.effect) drawEffect(c, look, input.effect, ground, right, input.preset)
  if (localHits && coming.length) passages(c, localHits.targets, coming.filter(job => !far(job)), passageBackground, look.crewBoxes, look.crewMessagePoints, look.crewLights, look.crewSurfaceAt)
  surfaceLights(c, look, look.crewLights)
  if (mochiOwner) c.withHit(mochiOwner, () => drawMochi(c, look, input, ground, catX, rootJump))
  else drawMochi(c, look, input, ground, catX, rootJump)
  // Atmospheric effects are behind messages; bodies still occlude the quiet residue.
  if (input.peerEdges?.length) {
    const ends = new Map(Object.entries(look.crewMessagePoints ?? {}))
    ends.set('mochi', rootPoint)
    drawTrails(c, input, ends, reactions, look.night, target => {
      const owner = registerHit(target)
      if (owner) trails.add(owner)
      return owner
    }, Object.values(look.crewBoxes ?? {}).concat({ x0: catX, x1: catX + 8, y0: ground - MOCHI_ROWS - rootJump, y1: ground - 1 - rootJump }), foregroundOwner)
  }
  // the crew reacts to the messages that just left or landed (each harness its own way: see reactions.ts)
  const kindOf = (id: string): ReactionKind => id === 'mochi' ? asCharacter(input.character) : input.jobs.find(job => job.hit?.id === id)?.kind ?? (input.agents.some(agent => agent.hit?.id === id) ? 'claude' : 'codex')
  // the root's gadget stands on her body, wherever the marks above her happen to be
  const rootBox = { x0: catX, x1: catX + 8, y0: ground - MOCHI_ROWS - rootJump, y1: ground - 1 - rootJump }
  const distantIds = new Set(jobs.filter(far).flatMap(job => job.hit ? [job.hit.id] : []))
  if (localHits) react(c, localHits.targets, reactions, kindOf, { ...look.crewBoxes, mochi: rootBox }, look.crewMessageStars, look.night, (id, x, y) => distantIds.has(id) && !!surfaces[y * c.W + x])
  return finish()
}

/** Each shot leaves a fading record of the cells it crossed, above atmospheric effects. */
/** How each place's machine dresses the head of its packet, as [colour, strength]: lights to either side, a wake behind, a
 *  cross of light, or a tinted core. One row per place, so a new look is data, not another branch. The harbor's is a rocket. */
const PACKET_HEAD: Partial<Record<SceneInput['preset'], { side?: [number, number]; wake?: [number, number]; cross?: [number, number]; core?: [number, number] }>> = {
  city: { side: [P.teal, .55], wake: [P.teal, .8] }, // a neon dart
  desert: { side: [P.peach, .55], wake: [P.peach, .8] }, // a sunlit dart
  beach: { cross: [P.teal, .65] }, // the saucer's pulse
  forest: { side: [P.sky, .75] }, // the probe's scan line
  mountains: { core: [P.yellow, .85] }, // a signal lamp
  tundra: { core: [P.red, .85] }, // the beacon's flare
  countryside: { side: [P.sky, .6], wake: [P.white, .5] }, // a droplet off the spray boom
}

function drawTrails(c: Canvas, input: SceneInput, ends: Map<string, Anchor>, reactions: Reaction[], night: number, registerHit: (target: WakeSceneHit | undefined) => number, bodies: { x0: number; x1: number; y0: number; y1: number }[], foregroundOwner: number) {
  const titleOf = (id: string) => id === 'mochi' ? 'root' : [...input.jobs, ...input.agents].find(job => job.hit?.id === id)?.hit?.title ?? id
  const trails = input.messageTrails ?? new MessageTrails()
  for (const edge of input.peerEdges ?? []) {
    const from = ends.get(edge.source), to = ends.get(edge.target)
    if (!from || !to || edge.source === edge.target) continue
    const pair = [...`${edge.source}>${edge.target}`].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7)
    const lane = pair & 1
    const workerId = edge.source === 'mochi' ? edge.target : edge.source
    const family = edge.family ?? input.jobs.find(job => job.hit?.id === workerId)?.kind ?? (input.agents.some(agent => agent.hit?.id === workerId) ? 'claude' : 'codex')
    const style = CREW[family].message
    const missile = family === 'codex' && input.preset === 'harbor' && edge.source !== 'mochi'
    let owner: number | undefined
    if (edge.arriving !== undefined && edge.arriving < (edge.lead ?? 0)) {
      const t = Math.max(0, edge.arriving / (edge.lead ?? 1))
      reactions.push({ id: edge.source, role: 'charge', v: t * t, t: edge.arriving, style, point: from })
    }
    for (let packet = 0; packet < trails.count(edge); packet++) {
      const path = trails.path(edge, () => {
        const launch = missile ? { x: from.x, y: Math.max(1, from.y - 8) } : from
        const route = arcCells(launch, to, c.W, H, lane)
        if (missile) route.unshift(...Array.from({ length: from.y - launch.y }, (_, i) => (from.y - i) * c.W + from.x))
        // The wave belongs to the flight's geometry, so its residue occupies exactly the same cells.
        return route.map((cell, i) => {
          const wave = style === 'song' || style === 'ember' ? Math.round(Math.sin(i * (style === 'song' ? .5 : .7)) * Math.sin(Math.PI * i / Math.max(1, route.length - 1))) : 0
          return Math.max(0, Math.min(H - 1, Math.floor(cell / c.W) + wave)) * c.W + cell % c.W
        })
      }, packet)
      if (!path) continue
      const length = path.length
      if (length < 3) continue
      const rootMessage = edge.source === 'mochi' || edge.target === 'mochi'
      const worker = titleOf(edge.source === 'mochi' ? edge.target : edge.source)
      owner ??= registerHit({
        id: `peer:${edge.source}:${edge.target}`,
        title: rootMessage ? edge.source === 'mochi' ? `Root → ${worker}` : `${worker} → root` : `${titleOf(edge.source)} → ${titleOf(edge.target)}`,
        details: [
          ...(edge.messageState ? [messageStatus(edge.messageState)] : []),
          messagePreview(edge.preview),
        ],
      })
      // After delivery, embers fade along the recorded flight path while the crew moves on.
      const accent = style === 'ember' ? P.peach : missile ? P.overlay2 : jobAccent({ kind: family } as Job, P.teal) // a rocket leaves smoke, not light
      const tail = Math.max(2.5, Math.min(6, length * 0.125)) // cells over which the light fades to a third (a short, quick fade)
      const ember = 0.14 * Math.min(1, Math.max(0, edge.strength - 0.04) / 0.65)
      const light = new Float32Array(length) // how bright each cell of the trail is just now, 0..1
      let landing = 0
      const flightAge = edge.arriving === undefined ? -1 : edge.arriving - (edge.lead ?? 0) - packet * PACKET_STAGGER_MS
      if (flightAge >= 0 && flightAge <= PACKET_RUN_MS + 500) {
        const t = flightAge
        const head = (t / PACKET_RUN_MS) * (length + 4 * tail) // the head runs on past the end so the tail finishes crossing
        trails.visit(edge, packet, Math.min(length - 1, Math.floor(head)))
        // the sender pulses as the comet leaves; the receiver as its head reaches the end
        reactions.push({ id: edge.source, role: 'send', v: Math.exp(-t / 320), t, style, point: from })
        const landsAt = (PACKET_RUN_MS * (length - 1)) / (length + 4 * tail)
        const age = t - landsAt
        if (age >= 0) {
          const end = path[length - 1]!
          reactions.push({ id: edge.target, role: 'land', v: style === 'starfall' && age < 500 ? 1 : Math.exp(-age / 420), t: age, style, point: { x: end % c.W, y: Math.floor(end / c.W) } })
        }
        for (let at = 0; at < length; at++) if (at <= head && t <= PACKET_RUN_MS) {
          const distance = Math.floor(head) - at
          const glow = style === 'packet' ? distance === 0 ? 1 : distance <= 4 ? 0.78 - distance * 0.1 : 0 : style === 'song' ? distance === 0 || distance === 4 || distance === 8 ? 1 : 0 : style === 'ember' ? distance === 0 ? 1 : distance <= 4 ? 0.75 - distance * 0.14 : 0 : distance === 0 ? 1 : distance <= 6 ? 0.85 - distance * 0.12 : 0
          light[at] = Math.max(light[at]!, glow)
        }
        if (head > length - 1) landing = Math.max(landing, Math.exp(-(head - (length - 1)) / tail))
      }
      const visited = trails.visit(edge, packet)
      const paint = () => path.forEach((i, k) => {
        const x = i % c.W, glow = light[k]!
        const y = Math.floor(i / c.W)
        if (foregroundOwner && c.hitOwners?.[i] === foregroundOwner) return
        if (!glow && (k > visited || bodies.some(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1))) return
        const base = c.get(x, y)
        const ink = glow === 1 ? style === 'ember' ? P.yellow : P.white : style === 'ember' ? Math.floor((edge.arriving ?? 0) / 150) % 2 ? P.red : P.peach : style === 'starfall' ? P.lavender : accent
        const color = mix(base, ink, Math.min(1, Math.max(k % 3 === 0 ? ember : 0, glow * (1 + NIGHT_GAIN * night))))
        if (color !== base) c.set(x, y, color)
        if (glow === 1 && style === 'ember') {
          // A live coal: a white-hot heart in its flame, and sparks that drop away behind it and go out.
          const tick = Math.floor((edge.arriving ?? 0) / 90)
          c.set(x, y, mix(P.yellow, P.white, .6))
          for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) c.glow(x + ox, y + oy, P.yellow, .55)
          for (const [n, drop] of [[3, 1], [5, 2], [8, 3]] as const) if (k >= n && (tick + n) % 3) {
            const cell = path[k - n]!
            c.glow(cell % c.W, Math.floor(cell / c.W) + drop, drop === 1 ? P.yellow : drop === 2 ? P.peach : P.red, .8 - drop * .18)
          }
        }
        if (glow === 1 && style === 'packet') {
          const previous = path[Math.max(0, k - 1)]!, dx = Math.sign(x - previous % c.W), dy = Math.sign(y - Math.floor(previous / c.W))
          if (missile) {
            // A rocket: red nose, white body, a flickering flame and a column of smoke that billows along the cells it has flown.
            const back = (n: number) => { const cell = path[Math.max(0, k - n)]!; return [cell % c.W, Math.floor(cell / c.W)] as const }
            const tick = Math.floor((edge.arriving ?? 0) / 80)
            for (let n = Math.min(k, 13); n >= 5; n--) {
              const [sx, sy] = back(n), puff = (n + tick) % 3 - 1
              c.glow(sx, sy, P.overlay2, .6 - n * .035)
              c.glow(sx + (dy ? puff : 0), sy + (dy ? 0 : puff), P.overlay1, .34 - n * .02)
            }
            if (k < 7) for (const ox of [-3, -2, -1, 1, 2, 3]) c.glow(from.x + ox, from.y + (Math.abs(ox) > 1 ? 0 : -1), Math.abs(ox) > 1 ? P.overlay2 : P.yellow, (1 - k / 7) * (Math.abs(ox) > 2 ? .4 : .8)) // the launch: a flash on deck, smoke rolling out to both sides
            const [fx, fy] = back(3), [gx, gy] = back(4), [bx, by] = back(2), [wx, wy] = back(1)
            if (k >= 4) c.glow(gx, gy, tick % 2 ? P.peach : P.red, .8)
            if (k >= 3) c.glow(fx, fy, P.yellow, 1)
            if (k >= 2) c.set(bx, by, P.snow)
            if (k >= 1) c.set(wx, wy, P.white)
            c.set(x, y, P.red)
          } else {
            const head = PACKET_HEAD[input.preset]
            if (head?.side) for (const sign of [-1, 1]) c.glow(x - dy * sign, y + dx * sign, ...head.side)
            if (head?.wake) c.glow(x - dx, y - dy, ...head.wake)
            if (head?.cross) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) c.glow(x + ox, y + oy, ...head.cross)
            if (head?.core) c.glow(x, y, ...head.core)
          }
        }
        // a soft halo round the bright part, so the comet has body rather than being a one-pixel dash
        if (glow > 0.2) for (const [dx, dy] of (style === 'song' ? [[1, -1], [1, -2], [0, 1]] as const : style === 'packet' ? [] : [[0, -1], [0, 1]] as const)) {
          const hx = x + dx
          const hy = y + dy
          if (hx >= 0 && hx < c.W && hy >= 0 && hy < H) c.set(hx, hy, mix(c.get(hx, hy), style === 'song' && dy === 1 ? P.pink : ink, Math.min(1, glow * (style === 'song' ? 1 : 0.25 + NIGHT_GAIN * night))))
        }
      })
      const splash = () => {
        if (landing < 0.05) return
        const end = path[length - 1]!, x = end % c.W, y = Math.floor(end / c.W)
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const sx = x + dx, sy = y + dy
          if (sx >= 0 && sx < c.W && sy >= 0 && sy < H) c.set(sx, sy, mix(c.get(sx, sy), mix(accent, P.white, 0.5), landing * 0.35))
        }
      }
      if (owner) c.withHit(owner, () => { paint(); splash() })
      else { paint(); splash() }
    }
  }
}

type Anchor = { x: number; y: number }

/** Each projectile owns its route from launch; visited cells are its fixed residue. */
export class MessageTrails {
  private scope = ''
  private paths = new Map<string, Map<number, { path: number[]; visited: number }>>()

  reset() { this.scope = ''; this.paths.clear() }

  count(edge: NonNullable<SceneInput['peerEdges']>[number]): number {
    return Math.min(MAX_PACKETS, Math.max(1, edge.fresh ?? 1, this.paths.get(JSON.stringify([edge.source, edge.target, edge.stamp]))?.size ?? 0))
  }

  begin(input: SceneInput) {
    const scope = `${input.width}:${input.preset}:${input.seed}`
    if (scope !== this.scope) { this.paths.clear(); this.scope = scope }
    const present = new Set((input.peerEdges ?? []).map(edge => JSON.stringify([edge.source, edge.target, edge.stamp])))
    for (const key of this.paths.keys()) if (!present.has(key)) this.paths.delete(key)
  }

  path(edge: NonNullable<SceneInput['peerEdges']>[number], draw: () => number[], packet = 0): number[] | undefined {
    const key = JSON.stringify([edge.source, edge.target, edge.stamp])
    let packets = this.paths.get(key)
    const flying = edge.arriving !== undefined && edge.arriving >= (edge.lead ?? 0) + packet * PACKET_STAGGER_MS
      && edge.arriving <= (edge.lead ?? 0) + packetWindow(edge.fresh ?? 1)
    if (flying && !packets?.has(packet)) {
      if (!packets) this.paths.set(key, packets = new Map())
      packets.set(packet, { path: draw(), visited: -1 })
    }
    return packets?.get(packet)?.path
  }

  visit(edge: NonNullable<SceneInput['peerEdges']>[number], packet: number, head = -1): number {
    const flight = this.paths.get(JSON.stringify([edge.source, edge.target, edge.stamp]))?.get(packet)
    if (!flight) return -1
    flight.visited = Math.max(flight.visited, head)
    return flight.visited
  }
}

/** The cells (row-major indexes) of a soft arc from `a` to `b` that rises above both ends, higher the further apart they are;
 * `lane` lifts it a little more so arcs between different pairs do not lie on top of each other. Pure geometry: it depends on
 * the two ends alone. */
export function arcCells(a: Anchor, b: Anchor, width: number, height: number, lane = 0): number[] {
  const rise = Math.min(4, 1 + Math.abs(b.x - a.x) * 0.07) + lane * 2 // how far the arc's crown stands above the higher end: a hop, not a bridge
  const cx = (a.x + b.x) / 2
  const cy = Math.max(Math.min(a.y, b.y) - 2 * rise, 2 - (a.y + b.y) / 2) // a quadratic's crown is half its control lift; never leave the sky
  const steps = Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) + 2 * rise) * 2)
  const cells: number[] = []
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, u = 1 - t
    const x = Math.round(u * u * a.x + 2 * u * t * cx + t * t * b.x), y = Math.round(u * u * a.y + 2 * u * t * cy + t * t * b.y)
    if (x < 0 || x >= width || y < 0 || y >= height) continue
    const i = y * width + x
    if (cells.at(-1) !== i) cells.push(i)
  }
  return cells
}

/** A circuit trace uses horizontal and vertical segments, including when its ends share a column. */
export function circuitCells(a: Anchor, b: Anchor, width: number, height: number): number[] {
  const cells: number[] = []
  let x = a.x, y = a.y
  const add = () => { if (x >= 0 && x < width && y >= 0 && y < height) cells.push(y * width + x) }
  const line = (axis: 'x' | 'y', end: number) => {
    while ((axis === 'x' ? x : y) !== end) { if (axis === 'x') x += Math.sign(end - x); else y += Math.sign(end - y); add() }
  }
  add()
  const sky = Math.max(1, Math.min(a.y, b.y) - 3)
  line('y', sky); line('x', b.x); line('y', b.y)
  return cells
}

/** What is playing now, for the legend. */
export function eventName(input: SceneInput): string | undefined {
  const look = lookOf(input)
  return playingEvent(look, [...LANDSCAPES[input.preset].events, ...SHARED_EVENTS], input.forceEvent)?.event.name
}

/** The scene as a Raster's cells (one half block per cell, top pixel fg, bottom bg) and its
 * floor: the bottom row's most common colour, so a passing car doesn't change it. */
export function sceneFrame(input: SceneInput, selected: SceneSelection | null = null, rows = SCENE_ROWS): { cells: string; floor: number; hits: SceneHitMap } {
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > SCENE_ROWS) throw new Error('Invalid scene row count')
  const hits: SceneHitMap = { columns: input.width, rows: SCENE_ROWS, owners: [], targets: [] }
  const px = scenePixels(input, [], hits)
  const W = input.width
  const skip = SCENE_ROWS - rows
  hits.rows = rows
  hits.owners = hits.owners.slice(skip * W)
  const words = new Uint32Array(W * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < W; x++) {
      const at = (r * W + x) * 3
      words[at] = 0x2580 // ▀
      words[at + 1] = px[2 * (r + skip) * W + x]!
      words[at + 2] = px[(2 * (r + skip) + 1) * W + x]!
    }
  }
  const counts = new Map<number, number>()
  let floor = px[(H - 1) * W]!
  for (let x = 0; x < W; x++) {
    const color = px[(H - 1) * W + x]!
    const n = (counts.get(color) ?? 0) + 1
    counts.set(color, n)
    if (n > (counts.get(floor) ?? 0)) floor = color
  }
  if (selected) {
    const bounds = sceneCardBounds(W, rows, { ...selected, details: selected.target.details })
    if (bounds) {
      const inner = Math.max(0, bounds.width - 2)
      const hint = '/wake detail'
      // shortcut: Raster accepts width-1 BMP glyphs only; /wake detail keeps full Unicode until the API supports wide cells.
      const printable = (text: string, width: number) => truncate(Array.from(text.normalize('NFC'))
        .filter(char => cells(char) !== 0)
        .map(char => char.codePointAt(0)! <= 0xffff && cells(char) === 1
          && !/[\p{Cc}\p{Cf}\p{Cs}\p{Cn}\p{Zl}\p{Zp}]/u.test(char) ? char : '?').join(''), width)
      const title = printable(selected.target.title, Math.max(0, inner - hint.length - 1))
      const lines = [title.padEnd(Math.max(0, inner - hint.length)) + hint,
        ...selected.target.details.slice(0, 2).map(line => printable(line, inner))]
      for (let y = 0; y < bounds.height; y++) {
        const text = (lines[y] ?? '').padEnd(inner)
        for (let x = 0; x < bounds.width; x++) {
          const at = ((bounds.top + y) * W + bounds.left + x) * 3
          words[at] = x === 0 || x === bounds.width - 1 ? 0x20 : text.charCodeAt(x - 1)
          words[at + 1] = y === 0 ? 0xcdd6f4 : 0xa6adc8
          words[at + 2] = 0x11111b
        }
      }
    }
  }
  return { cells: bytesToBase64(new Uint8Array(words.buffer)), floor, hits }
}

export const sceneCells = (input: SceneInput) => sceneFrame(input).cells

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_PAIRS = Array.from({ length: 4096 }, (_, n) => B64[n >> 6]! + B64[n & 63]!) // 12 bits -> 2 chars

/** Base64 of a frame: 12 bytes a cell, so always whole 3-byte groups and no padding. */
function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    parts.push(B64_PAIRS[n >> 12]!, B64_PAIRS[n & 4095]!)
  }
  return parts.join('')
}
