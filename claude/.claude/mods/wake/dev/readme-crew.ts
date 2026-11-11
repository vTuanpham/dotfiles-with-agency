// bun dev/readme-crew.ts [out prefix] [frames]: the crew sheets for the README, as raw little-endian uint32 0xRRGGBB, cell-major,
// `width` x SCENE_H per frame: `<prefix>-cast.bin` (8 places x 4 families, class 4, 72 wide), `<prefix>-sequence.bin` (a worker
// with a message for the root, in four families, 110 wide), `<prefix>-conversations.bin` (two workers and Mochi messaging one
// another, four pairings, 120 wide) and `<prefix>-strike.bin` (an interrupted worker struck down, in four families and places,
// 64 wide). docs/tools/readme_gifs.py turns them into GIFs.
import { MessageTrails, scenePixels, type SceneInput } from '../hooks/scene.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { EXIT_MS } from '../hooks/exits.ts'
import { PhaseClock, routeRate } from '../hooks/landscapes/gait.ts'
import { TURN_LEAD_MS, packetWindow } from '../hooks/crew-row.ts'
import { SHOWCASE_FRAMES, passageAt } from './showcase-input'

const prefix = process.argv[2] ?? `${import.meta.dir}/readme-crew`
const FRAMES = Number(process.argv[3] ?? 144)
const STEP = 1
const MS_PER_FRAME = STEP * 50 // the band redraws at 20 frames a second

const base = (width: number, preset: SceneInput['preset'], hour = 14): SceneInput => ({
  width, frame: 0, hour, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 },
  preset, seed: 12345, turns: [], live: null, mood: 'work', plan: null, effect: null, agents: [], jobs: [],
})
const places = ['city', 'harbor', 'beach', 'mountains', 'countryside', 'forest', 'desert', 'tundra'] as const
const families = ['codex', 'claude', 'agy', 'opencode'] as const

// the cast: every family at work in every place, so the moving structure, the effects and the escorts show
{
  const W = 72
  const data = new Uint32Array(places.length * families.length * SHOWCASE_FRAMES * W * SCENE_H)
  let at = 0
  for (const place of places) for (const kind of families) {
    for (let i = 0; i < SHOWCASE_FRAMES; i++) {
      const job = { isStale: false, seed: 6, kind, tier: 4 as const, pace: 0.8, hit: { id: 'j', title: 'j', details: [] } }
      const hour = (14 + 24 * i / SHOWCASE_FRAMES) % 24
      const ms = i * MS_PER_FRAME, duration = SHOWCASE_FRAMES * MS_PER_FRAME
      const jobs = ms < 450 || ms >= duration - 450 ? [] : [{ ...job, ...passageAt(ms, duration) }]
      data.set(scenePixels({ ...base(W, place, hour), frame: 37 + i * STEP, jobs }), at)
      at += W * SCENE_H
    }
  }
  await Bun.write(`${prefix}-cast.bin`, data)
}

// the sequence: a worker flying along has a message for the root. It brakes to a hover, turns to face her, sends (the call, the
// packet), Mochi catches it, and it turns back to its own course and builds up speed again. The real clocks, stepped as the band does.
{
  const W = 110, place = 'city' as const
  const window = packetWindow(1) + TURN_LEAD_MS, startMs = -1500
  const data = new Uint32Array(families.length * FRAMES * W * SCENE_H)
  let at = 0
  for (const kind of families) {
    const phase = new PhaseClock(), route = new PhaseClock(), messageTrails = new MessageTrails()
    let now = 1_000_000 + startMs, i = 0
    for (let ms = startMs; i < FRAMES; ms += 50, now += 50) {
      const rate = routeRate(ms, window, TURN_LEAD_MS), p = phase.advance('j', 0.85, now), r = route.advance('j', 0.85, now, rate)
      if (ms < startMs + i * MS_PER_FRAME) continue
      const since = ms >= 0 && ms <= window + TURN_LEAD_MS ? ms : undefined
      const job = { isStale: false, seed: 11, kind, tier: 4 as const, pace: 0.85, phase: p, route: r, hit: { id: 'j', title: 'j', details: [] } }
      const peerEdges = ms < 0 ? [] : [{ source: 'j', target: 'mochi', strength: 0.9, preview: 'x', count: 1, family: kind, arriving: since, fresh: 1, lead: TURN_LEAD_MS }]
      data.set(scenePixels({ ...base(W, place), frame: Math.round(p), jobs: [job], peerEdges, messageTrails }), at)
      at += W * SCENE_H
      i++
    }
  }
  await Bun.write(`${prefix}-sequence.bin`, data)
}

// the conversations: two workers and Mochi pass messages round, A to B, B to Mochi, Mochi to A, on a loop. Each family throws its
// own projectile and catches in its own way; to another family a message turns into the receiver's own at the top of its arc,
// and between kin a second strand braids round it. One loop is played first, so the recorded one starts with its residue.
const CONVERSATIONS = [
  ['codex', 'claude', 'city', 22], ['opencode', 'codex', 'harbor', 20.5], ['agy', 'opencode', 'desert', 21], ['claude', 'claude', 'mountains', 21.5],
] as const
{
  const W = 120, LOOP = FRAMES * MS_PER_FRAME, window = packetWindow(1) + TURN_LEAD_MS
  const talks = [['a', 'b', 0], ['b', 'mochi', LOOP / 3], ['mochi', 'a', 2 * LOOP / 3]] as const
  const data = new Uint32Array(CONVERSATIONS.length * FRAMES * W * SCENE_H)
  let at = 0
  for (const [first, second, place, hour] of CONVERSATIONS) {
    const phase = new PhaseClock(), route = new PhaseClock(), messageTrails = new MessageTrails()
    for (let ms = -LOOP; ms < LOOP; ms += MS_PER_FRAME) {
      const now = 2_000_000 + ms, loop = ms + LOOP
      const edges = talks.map(([source, target, offset]) => {
        const since = (loop - offset + 2 * LOOP) % LOOP, cycle = Math.floor((loop - offset) / LOOP)
        return { source, target, stamp: String(cycle), strength: 0.9, preview: 'x', count: 1, fresh: 1, lead: source === 'mochi' ? 0 : TURN_LEAD_MS, ...(since <= window + TURN_LEAD_MS ? { arriving: since } : {}) }
      })
      // a sender brakes, turns to its listener, sends and turns back; anyone else keeps to its course
      const rateOf = (id: string) => Math.min(1, ...edges.filter(edge => edge.source === id && edge.arriving !== undefined).map(edge => routeRate(edge.arriving!, window, TURN_LEAD_MS)))
      const jobs = ([['a', first, 11], ['b', second, 29]] as const).map(([id, kind, seed]) => ({
        isStale: false, seed, kind, tier: 4 as const, pace: 0.85, hit: { id, title: id, details: [] },
        phase: phase.advance(id, 0.85, now), route: route.advance(id, 0.85, now, rateOf(id)),
      }))
      const frame = scenePixels({ ...base(W, place, hour), frame: 37 + Math.floor(loop / MS_PER_FRAME), jobs, peerEdges: edges, messageTrails })
      if (ms >= 0) { data.set(frame, at); at += W * SCENE_H }
    }
  }
  await Bun.write(`${prefix}-conversations.bin`, data)
}

// the strike: a worker whose turn is interrupted is struck down, in its own family's way
{
  const W = 64
  const tiles = [['codex', 'city'], ['claude', 'mountains'], ['agy', 'desert'], ['opencode', 'tundra']] as const
  const before = Math.ceil(1200 / MS_PER_FRAME), strike = Math.ceil(EXIT_MS / MS_PER_FRAME)
  const data = new Uint32Array(tiles.length * FRAMES * W * SCENE_H)
  let at = 0
  for (const [kind, place] of tiles) {
    for (let i = 0; i < FRAMES; i++) {
      const gone = i >= before + strike
      const phase = i < before ? {} : { leaving: (i - before) * MS_PER_FRAME + 1, struck: true }
      const job = { isStale: false, seed: 6, kind, tier: 4 as const, pace: 0.8, hit: { id: 'j', title: 'j', details: [] }, ...phase }
      data.set(scenePixels({ ...base(W, place), frame: 37 + i * STEP, jobs: gone ? [] : [job] }), at)
      at += W * SCENE_H
    }
  }
  await Bun.write(`${prefix}-strike.bin`, data)
}
console.log(prefix, 'ok')
