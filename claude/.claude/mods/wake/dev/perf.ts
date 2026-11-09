// bun dev/perf.ts [frames]: milliseconds per painted scene frame, per landscape and crew size.
// The scene repaints 20 times a second, so a frame must stay far under 50 ms; compare before and after a change to the
// crew, the passages or a landscape. Prints the median and the slowest frame of each case (a median hides a stall).
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { PLACES } from './places.ts'

const frames = Number(process.argv[2] ?? 120)
const kinds = ['codex', 'agy', 'claude', 'opencode'] as const
const crew = (n: number, passage?: 'arriving' | 'leaving', age = 900) => Array.from({ length: n }, (_, i) => ({
  isStale: false, seed: 11 + i * 7, kind: kinds[i % 4]!, tier: ((i % 4) + 1) as 1 | 2 | 3 | 4,
  ...(passage && i === 0 ? { [passage]: age } : {}), hit: { id: `job-${i}`, title: `job-${i}`, details: [] },
}))
const base: SceneInput = {
  width: 160, frame: 0, hour: 13, sun: { rise: 5.9, set: 17.5 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, preset: 'city', seed: 12345,
  turns: Array.from({ length: 9 }, () => ({ kinds: ['read', 'edit', 'test'] as any })), live: { kinds: ['read', 'edit'] as any },
  mood: 'work', jobs: [], agents: [], plan: { done: 2, total: 5 }, effect: null,
}
const rows: string[] = []
for (const preset of PLACES) for (const [label, jobs] of [['no crew', []], ['4 crew', crew(4)], ['8 crew', crew(8)], ['4 crew, one arriving', crew(4, 'arriving')], ['4 crew, one leaving', crew(4, 'leaving')]] as const) {
  const times: number[] = []
  for (let f = 0; f < frames; f++) {
    const t = performance.now()
    scenePixels({ ...base, preset, jobs: jobs as any, frame: f })
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  rows.push(`${preset.padEnd(12)} ${label.padEnd(22)} median ${times[times.length >> 1]!.toFixed(2).padStart(6)} ms   worst ${times.at(-1)!.toFixed(2).padStart(6)} ms`)
}
console.log(rows.join('\n'))
