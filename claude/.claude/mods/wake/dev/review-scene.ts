import { MessageTrails, scenePixels, type SceneInput } from '../hooks/scene'
import { PhaseClock, routeRate } from '../hooks/landscapes/gait'
import { type Job } from '../hooks/landscapes/kit'
import { packetWindow, TURN_LEAD_MS } from '../hooks/crew-row'
import { ARRIVE_MS, EXIT_MS } from '../hooks/exits'

export const families = ['codex', 'claude', 'agy', 'opencode'] as const
export type Family = typeof families[number]
export const actions = { cruise: 'Cruise & turns', to: 'Worker → root', from: 'Root → worker', peer: 'Worker → worker', translate: 'Worker → another family', burst: 'Three messages', arrive: 'Arrival', leave: 'Completion / exit', strike: 'Interrupted exit', rest: 'Work → rest → work', crowd: 'Four families together', depth: 'Distant crew & skyline', overcast: 'Overcast · idle → working' }
export type Config = { place: SceneInput['preset']; family: Family; tier: 1 | 2 | 3 | 4; hour: number; width: number; mode: keyof typeof actions }
export const base = (config: Config, frame = 0): SceneInput => ({ width: config.width, preset: config.place, frame, hour: config.hour, sun: { rise: 6, set: 18 }, moonPhase: .3, season: 'summer', snowy: false, seed: 12345, weather: { cloud: .2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, turns: [{ kinds: ['read', 'edit', 'test'] }, { kinds: ['read', 'run'] }], live: null, mood: 'work', agents: [], jobs: [], plan: null, effect: null })
export const body = (config: Config, id = 'worker', kind = config.family, seed = 11): Job => ({ kind, seed, tier: config.tier, isStale: false, pace: .85, hit: { id, title: id, details: [] } })

/** Browser playback and contact sheets step the same clocks, including every intervening frame. */
export function makeFrames(config: Config) {
  const frames: Uint32Array[] = [], phase = new PhaseClock(), route = new PhaseClock(), trails = new MessageTrails()
  let settle = 0
  for (let ms = 0; ms <= 16000; ms += 50) {
    const since = ms - 2000, message = ['to', 'from', 'peer', 'translate', 'burst'].includes(config.mode), fresh = config.mode === 'burst' ? 3 : 1
    const window = TURN_LEAD_MS + packetWindow(fresh)
    const pace = config.mode === 'rest' && ms >= 3500 && ms < 10000 ? .1 : .85
    settle = Math.max(0, Math.min(1, settle + (pace <= .15 ? 1 : -1) * 50 / 1200))
    let jobs = [body(config)]
    if (config.mode === 'peer') jobs.push(body(config, 'receiver', config.family, 27))
    if (config.mode === 'translate') jobs.push(body(config, 'receiver', families[(families.indexOf(config.family) + 1) % families.length], 27))
    if (config.mode === 'crowd') jobs = families.map((kind, i) => body(config, `worker-${i}`, kind, 11 + i * 6))
    jobs = jobs.map(job => ({ ...job, pace, settle, phase: phase.advance(job.hit!.id, pace, 1_000_000 + ms), route: route.advance(job.hit!.id, pace, 1_000_000 + ms, message ? routeRate(since, window, TURN_LEAD_MS) : 1) }))
    if (config.mode === 'arrive') jobs = ms < 1000 ? [] : jobs.map(j => ({ ...j, ...(ms < 1000 + ARRIVE_MS ? { arriving: Math.max(1, ms - 1000) } : {}) }))
    if (config.mode === 'leave' || config.mode === 'strike') jobs = ms >= 2500 + EXIT_MS ? [] : jobs.map(j => ({ ...j, ...(ms >= 2500 ? { leaving: Math.max(1, ms - 2500), struck: config.mode === 'strike' } : {}) }))
    const source = config.mode === 'from' ? 'mochi' : 'worker', target = config.mode === 'from' ? 'worker' : config.mode === 'peer' || config.mode === 'translate' ? 'receiver' : 'mochi'
    const peerEdges: SceneInput['peerEdges'] = message && since >= 0 ? [{ source, target, stamp: 'review-message', family: config.family, preview: 'Review message', count: fresh, fresh, lead: TURN_LEAD_MS, strength: Math.max(.04, .9 - Math.max(0, since - window) / 18000), ...(since <= window + TURN_LEAD_MS ? { arriving: since } : {}) }] : []
    const scene = base(config, Math.floor(ms / 50))
    if (config.mode === 'overcast') {
      scene.weather = { ...scene.weather!, cloud: .95 }
      scene.mood = ms < 4000 ? 'idle' : 'work'
      scene.live = ms < 4000 ? null : { kinds: ['read', 'edit', 'run'] }
    }
    if (config.mode === 'depth') scene.turns = Array.from({ length: 9 }, (_, i) => ({ kinds: Array.from({ length: 10 + i * 4 }, () => 'read' as const) }))
    frames.push(scenePixels({ ...scene, jobs, peerEdges, messageTrails: trails }))
  }
  return frames
}
