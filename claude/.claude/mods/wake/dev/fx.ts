// bun dev/fx.ts <place> [out.png] [pace] [wind] [hour]: the four families at work in one landscape, every 0.8 s of their own clock, with
// the wind blowing: soft trails along their paths, wind gusts and what the place carries, booster jets, data packets, feathers, sparks and flames.
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { clockRate } from '../hooks/landscapes/gait.ts'

const place = (process.argv[2] ?? 'city') as SceneInput['preset']
const out = process.argv[3] ?? `${import.meta.dir}/fx-${place}.png`
const pace = Number(process.argv[4] ?? 1), wind = Number(process.argv[5] ?? 22), hour = Number(process.argv[6] ?? 21)
const W = 120
const base: SceneInput = {
  width: W, frame: 0, hour, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind }, preset: place, seed: 12345,
  turns: Array.from({ length: 5 }, () => ({ kinds: ['read', 'edit'] as any })), live: null, mood: 'idle', jobs: [], agents: [], plan: null, effect: null,
}
const kinds = ['codex', 'claude', 'agy', 'opencode'] as const
const rows = [0, 1, 2, 3, 4, 5].map(step => {
  const phase = 300 + step * 8 * clockRate(pace)
  const jobs = kinds.map((kind, i) => ({ isStale: false, seed: 5 + i * 3, kind, tier: (kind === 'codex' || i % 2 ? 3 : 4) as 3 | 4, pace, phase, hit: { id: kind, title: kind, details: [] } }))
  return { name: `${place} · pace ${pace} · wind ${wind} km/h · hour ${hour} · +${step * 0.8} s`, px: Array.from(scenePixels({ ...base, frame: 300 + step * 8, jobs })) }
})
await Bun.write(out + '.json', JSON.stringify({ w: W, h: SCENE_H, rows }))
const r = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/sheet.py', out + '.json', out])
if (r.exitCode !== 0) console.error(r.stderr.toString())
else console.log(out)
