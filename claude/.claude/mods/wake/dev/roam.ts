// bun dev/roam.ts [place] [width]: how far each family roams in a landscape, calm (pace .1) against busy (pace 1), over two
// minutes of the worker's own clock. Prints the range travelled across and up, and the largest step between two paints (a
// step above a cell or two is a jump the eye reads as teleporting). One worker alone, so the room is as large as it gets.
import { sceneFrame, type SceneInput } from '../hooks/scene.ts'
import { clockRate } from '../hooks/landscapes/gait.ts'

const place = (process.argv[2] ?? 'city') as SceneInput['preset']
const W = Number(process.argv[3] ?? 160)
const base: SceneInput = {
  width: W, frame: 0, hour: 13, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, preset: place, seed: 12345,
  turns: Array.from({ length: 6 }, () => ({ kinds: ['read', 'edit'] as any })), live: null, mood: 'idle', jobs: [], agents: [], plan: null, effect: null,
}
const rows: string[] = []
for (const kind of ['codex', 'claude', 'agy', 'opencode'] as const) for (const tier of [1, 2, 3, 4] as const) for (const pace of [0.1, 1]) {
  let phase = 0
  const at: [number, number][] = []
  for (let step = 0; step < 2400; step++) { // 20 paints a second for two minutes
    phase += 0.5 * clockRate(pace)
    const { hits } = sceneFrame({ ...base, frame: step / 2, jobs: [{ isStale: false, seed: 7, kind, tier, pace, phase, hit: { id: 'j', title: 'j', details: [] } }] })
    const owner = hits.targets.findIndex(t => t.id === 'j') + 1
    let sx = 0, sy = 0, n = 0
    hits.owners.forEach((o, i) => { if (o === owner) { sx += i % hits.columns; sy += Math.floor(i / hits.columns); n++ } })
    if (n) at.push([sx / n, sy / n])
  }
  const xs = at.map(p => p[0]), ys = at.map(p => p[1])
  const jump = Math.max(...at.slice(1).map((p, i) => Math.hypot(p[0] - at[i]![0], (p[1] - at[i]![1]) / 2)))
  rows.push(`${place} ${kind.padEnd(8)} class ${tier} pace ${pace}: across ${(Math.max(...xs) - Math.min(...xs)).toFixed(1).padStart(5)}  up ${(Math.max(...ys) - Math.min(...ys)).toFixed(1).padStart(4)} rows(hit cells)  biggest step ${jump.toFixed(1)}`)
}
console.log(rows.join('\n'))
