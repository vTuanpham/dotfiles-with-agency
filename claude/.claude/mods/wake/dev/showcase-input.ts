// Shared by the README renderer and its continuity checks.
import { EFFECT_FRAMES, type SceneInput } from '../hooks/scene'

const STEP = 3
const MS_PER_TICK = 50 // the band redraws at 20 frames a second
const K = ['read', 'read', 'read', 'search', 'edit', 'run', 'test', 'read', 'edit', 'agent', 'web', 'edit'] as const
const turns: SceneInput['turns'] = Array.from({ length: 16 }, (_, i) => ({ kinds: [...K.slice(0, 2 + ((i * 7) % 11)), ...(i % 5 === 2 ? ['fail' as const] : [])] }))
const crew = (id: string, seed: number, kind: 'codex' | 'agy' | 'claude' | 'opencode', tier: 1 | 2 | 3 | 4) =>
  ({ isStale: false, seed, kind, tier, lift: 0, hit: { id, title: id, details: [] } })
// Three separate flights in the 7.2 s loop, each retaining its own launch geometry.
const talking = (i: number): Partial<SceneInput> => {
  const ms = (i * STEP * MS_PER_TICK) % 2400
  return { peerEdges: [{ source: 'a', target: 'b', stamp: String(Math.floor(i * STEP * MS_PER_TICK / 2400)), strength: 0.9, preview: 'x', count: 1, family: 'codex', arriving: ms, fresh: 1 }] }
}
const clear = { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 } as const
const base: SceneInput = {
  width: 180, frame: 0, hour: 22, sun: { rise: 5.9, set: 17.5 }, moonPhase: 0.3, season: 'summer', snowy: false, weather: clear,
  preset: 'city', seed: 12345, turns, live: { kinds: ['read', 'read', 'edit', 'test', 'edit'] }, mood: 'work',
  jobs: [crew('a', 3, 'codex', 4), crew('b', 8, 'agy', 4), crew('c', 13, 'opencode', 3)], agents: [{ seed: 1, tier: 4 }], plan: { done: 2, total: 5 }, effect: null,
}
const calm = { live: null, agents: [], mood: 'idle' as const }
const fx = (kind: NonNullable<SceneInput['effect']>['kind']) => ({ kind, age: 0 })

// [label, state]; an effect's age follows the frame so it plays through
export const SCENES: [string, Partial<SceneInput>][] = [
  ['City · working · turns become buildings', {}],
  ['Harbor · needs input · Codex boats and agy crew', { preset: 'harbor', hour: 19.8, mood: 'alert', agents: [], live: null }],
  ['Beach · working · machines, flamingos and constellations', { preset: 'beach', hour: 13 }],
  ['Mountains · tests passed · fireworks', { ...calm, preset: 'mountains', hour: 20.2, mood: 'happy', effect: fx('fireworks') }],
  ['Countryside · tests pass after a failure · rainbow', { ...calm, preset: 'countryside', hour: 14, mood: 'happy', plan: { done: 3, total: 5 }, effect: fx('rainbow') }],
  ['Forest · rain · command failed', { ...calm, preset: 'forest', hour: 15, mood: 'sad', weather: { ...clear, cloud: 0.9, rain: 2, wind: 18 }, effect: fx('storm') }],
  ['Desert · dusk · a finished job leaves a shooting star', { ...calm, preset: 'desert', hour: 18.6, effect: fx('shoot') }],
  ['Tundra · winter night · sleeping', { ...calm, preset: 'tundra', hour: 2, mood: 'sleep', season: 'winter', snowy: true, moonPhase: 0.5, weather: { ...clear, cloud: 0.4, snow: 2, wind: 5 }, jobs: [] }],
]

export function showcaseInput(index: number, i: number, width = 180, frames = 48): SceneInput {
  const state = SCENES[index]![1]
  const talks = index < 3 && (state.jobs ?? base.jobs).length > 1 // where workers are busy, two of them message each other
  const effect = state.effect ? { ...state.effect, age: (i * STEP) % EFFECT_FRAMES[state.effect.kind] } : null
  const hour = ((state.hour ?? base.hour) + 24 * i / frames) % 24
  const weather = state.weather ?? base.weather!
  const swell = Math.sin(Math.PI * i / frames) ** 2
  return { ...base, ...state, ...(talks ? talking(i) : {}), width, effect, hour,
    weather: { ...weather, cloud: Math.min(1, weather.cloud + .5 * swell), rain: Math.round(weather.rain * (.35 + .65 * swell)) as typeof weather.rain, snow: Math.round(weather.snow * (.35 + .65 * swell)) as typeof weather.snow }, frame: 37 + i * STEP }
}
