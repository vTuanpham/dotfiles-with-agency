// bun dev/agy.ts [review-name]: all agy beats in real scenes at 1x/2x/6x, plus bare silhouettes.
import { ALL_AGY } from '../hooks/landscapes/agy.ts'
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { canvas } from '../hooks/pixels.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { PLACES } from './places.ts'

const review = process.argv[2] ?? 'review'
const base: SceneInput = {
  width: 120, frame: 0, hour: 13, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, preset: 'city', seed: 12345,
  turns: Array.from({ length: 5 }, () => ({ kinds: ['read', 'edit'] })), live: null, mood: 'idle', jobs: [], agents: [], plan: null, effect: null,
}
const ascii: string[] = []
const render = (source: string, out: string, script: string, scale?: string) => {
  const r = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/' + script, source, out, ...(scale ? [scale] : [])])
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
}
for (const preset of PLACES) {
  for (const tier of [1, 2, 3, 4] as const) {
    const frames = ALL_AGY[preset][tier]
    ascii.push(`${preset} class ${tier} · beats 0..7`, ...frames[0]!.map((_, row) => frames.map(f => f[row]).join('  ')), '')
  }
  for (const [time, hour] of [['day', 13], ['night', 22]] as const) {
    const rows = ([1, 2, 3, 4] as const).flatMap(tier => Array.from({ length: 8 }, (_, beat) => ({
      name: `${preset} ${time} · class ${tier} · beat ${beat}`,
      px: Array.from(scenePixels({ ...base, preset, hour, frame: 360 + beat * 2, jobs: [{ kind: 'agy', tier, seed: 0, isStale: false, phase: 360 + beat * 1.5, pace: 0.8 }] })),
    })))
    const out = `${import.meta.dir}/agy-${review}-${preset}-${time}`
    await Bun.write(out + '.json', JSON.stringify({ w: base.width, h: SCENE_H, rows: rows.filter((_, i) => i % 8 === 1 || i % 8 === 5) }))
    await Bun.write(out + '-beats.json', JSON.stringify({ w: base.width, h: SCENE_H, rows }))
    render(out + '.json', out + '.png', 'sheet.py')
    render(out + '-beats.json', out + '-beats.png', 'codex-sheet.py')
    render(out + '-beats.json', out + '-native.png', 'codex-sheet.py', '1')
    console.log(out + '-native.png')
  }
}
await Bun.write(`${import.meta.dir}/agy-${review}-ascii.txt`, ascii.join('\n'))
const slot = 24, W = slot * PLACES.length, H = 9
const rows = Array.from({ length: 8 }, (_, beat) => {
  const c = canvas(W, H)
  PLACES.forEach((place, i) => ALL_AGY[place][4][beat]!.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') c.set(i * slot + x + 2, y + 1, 0xffffff)
  })))
  return { name: `${PLACES.join(' | ')} · beat ${beat}`, px: Array.from(c.px) }
})
const silhouettes = `${import.meta.dir}/agy-${review}-silhouettes.png`
await Bun.write(silhouettes + '.json', JSON.stringify({ w: W, h: H, rows }))
render(silhouettes + '.json', silhouettes, 'sheet.py')
console.log(silhouettes)

// Real send timelines also exercise a narrow lane and the half-turn core projection.
for (const width of [64, 120]) {
  const rows = PLACES.flatMap(preset => [0, 450, 900, 1050, 1200, 1500].map(ms => ({
    name: `${preset} · ${width}px · send ${ms}ms`,
    px: Array.from(scenePixels({ ...base, width, preset, hour: 22, frame: 360 + ms / 100,
      jobs: [{ kind: 'agy', tier: 4, seed: 0, isStale: false, phase: 360 + ms / 100, hit: { id: 'agy', title: 'Light', details: [] } }],
      peerEdges: [{ source: 'agy', target: 'mochi', family: 'agy', strength: 1, count: 1, arriving: ms, lead: 900, fresh: 1 }],
    })),
  })))
  const out = `${import.meta.dir}/agy-${review}-send-${width}`
  await Bun.write(out + '.json', JSON.stringify({ w: width, h: SCENE_H, rows }))
  render(out + '.json', out + '.png', 'sheet.py')
  render(out + '.json', out + '-native.png', 'codex-sheet.py', '1')
  console.log(out + '.png')
}
