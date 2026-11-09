// bun dev/dragon.ts [review-name]: city dragon low strokes and a real message to Mochi, by day/night at 1x and enlarged.
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { clockRate } from '../hooks/landscapes/gait.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'

const review = process.argv[2] ?? 'review'
const base: SceneInput = {
  width: 160, frame: 360, hour: 13, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, preset: 'city', seed: 12345,
  turns: Array.from({ length: 5 }, () => ({ kinds: ['read', 'edit'] })), live: null, mood: 'idle', jobs: [], agents: [], plan: null, effect: null,
}
for (const [time, hour] of [['day', 13], ['night', 22]] as const) {
  const rows = ([1, 4] as const).flatMap(tier => [0, 150, 300, 450, 600, 900, 1050, 1200, 1350, 1500].map(ms => ({
    name: `${time} class ${tier} send ${ms} ms`,
    px: Array.from(scenePixels({ ...base, hour, frame: 360 + ms / 100,
      jobs: [{ kind: 'codex', tier, seed: 0, isStale: false, pace: 0.8, phase: 360 + ms / 100 * clockRate(0.8), hit: { id: 'dragon', title: 'Dragon', details: [] } }],
      peerEdges: [{ source: 'dragon', target: 'mochi', family: 'codex', strength: 1, count: 1, preview: 'Message for root', arriving: ms, fresh: 1 }],
    })),
  })))
  const out = `${import.meta.dir}/dragon-${review}-${time}.png`
  await Bun.write(out + '.json', JSON.stringify({ w: base.width, h: SCENE_H, rows }))
  for (const [script, target, scale] of [['sheet.py', out, '6'], ['codex-sheet.py', out.replace('.png', '-native.png'), '1']] as const) {
    const r = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/' + script, out + '.json', target, scale])
    if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  }
  console.log(out)
  const puffs = Array.from({ length: 16 }, (_, half) => ({
    name: `${time} class 4 · wave beat ${half / 2}`,
    px: Array.from(scenePixels({ ...base, hour, frame: 360 + half * 0.75 / clockRate(0.8),
      jobs: [{ kind: 'codex', tier: 4, seed: 0, isStale: false, pace: 0.8, phase: 360 + half * 0.75 }],
    })),
  }))
  const puffOut = `${import.meta.dir}/dragon-${review}-puffs-${time}.png`
  await Bun.write(puffOut + '.json', JSON.stringify({ w: base.width, h: SCENE_H, rows: puffs }))
  for (const [script, target, scale] of [['sheet.py', puffOut, '6'], ['codex-sheet.py', puffOut.replace('.png', '-native.png'), '1']] as const) {
    const r = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/' + script, puffOut + '.json', target, scale])
    if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  }
  console.log(puffOut)
}
