// bun dev/passages.ts <place> [tier=2] [out.png] [hour=14]: the four families in one landscape, arriving, working and leaving.
// One sheet row per moment, the families side by side (codex, claude, agy, opencode), so a passage can be read frame by frame
// and judged for whether it is seen at all. Arrivals count up from 0 and exits count up from 0 (an arrival plays an exit backwards).
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { ARRIVE_MS, EXIT_MS } from '../hooks/exits.ts'

const place = (process.argv[2] ?? 'city') as SceneInput['preset']
const tier = Number(process.argv[3] ?? 2) as 1 | 2 | 3 | 4
const out = process.argv[4] ?? `${import.meta.dir}/passages-${place}.png`
const hour = Number(process.argv[5] ?? 14)
const families = ['codex', 'claude', 'agy', 'opencode'] as const
const W = 64
const moments: [string, { arriving?: number; leaving?: number }][] = [
  ...[0, 700, 1500, 2250, 2450, 2650, 2900, 3150].map(ms => [`arriving ${ms} of ${ARRIVE_MS} ms`, { arriving: Math.max(1, ms) }] as [string, { arriving?: number }]),
  ['working', {}],
  ...[100, 300, 550, 1400, 2400, 2900].map(ms => [`leaving ${ms} of ${EXIT_MS} ms`, { leaving: Math.max(1, ms) }] as [string, { leaving?: number }]),
]
const base: SceneInput = {
  width: W, frame: 37, hour, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 },
  preset: place, seed: 12345, turns: [], live: null, mood: 'idle', plan: null, effect: null, agents: [], jobs: [],
}
const rows = moments.map(([name, phase], i) => {
  const px = new Array<number>(W * families.length * SCENE_H)
  families.forEach((kind, f) => {
    const job = { isStale: false, seed: 6, kind, tier, hit: { id: 'j', title: 'j', details: [] }, ...phase, ...(process.env.STRUCK ? { struck: true } : {}) } // STRUCK=1: its exit is an interrupt
    const one = scenePixels({ ...base, frame: 37 + i * 3, jobs: [job] })
    for (let y = 0; y < SCENE_H; y++) for (let x = 0; x < W; x++) px[y * W * families.length + f * W + x] = one[y * W + x]!
  })
  return { name: `${place} class ${tier} · ${name}`, px }
})
await Bun.write(out + '.json', JSON.stringify({ w: W * families.length, h: SCENE_H, rows }))
const r = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/sheet.py', out + '.json', out])
if (r.exitCode !== 0) console.error(r.stderr.toString())
else console.log(out)
