// bun dev/codex.ts [review-name]: real scenes, every Codex class and beat by day/night, plus an ASCII contact sheet.
import { ALL_CRAFT } from '../hooks/landscapes/craft.ts'
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { PLACES } from './places.ts'

const review = process.argv[2] ?? 'review'
const base: SceneInput = {
  width: 120, frame: 0, hour: 13, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, preset: 'city', seed: 12345,
  turns: Array.from({ length: 5 }, () => ({ kinds: ['read', 'edit'] })), live: null, mood: 'idle', jobs: [], agents: [], plan: null, effect: null,
}
const ascii: string[] = []
for (const preset of PLACES) {
  if (preset !== 'city') {
    const large = ALL_CRAFT[preset][4][0]!, small = ALL_CRAFT[preset][1][0]!, dragon = ALL_CRAFT.city[4][0]!
    const comparison = [`${preset}: class 4           class 1     dragon class 4`, ...dragon.map((row, y) => (large[y] ?? '').padEnd(22) + (small[y] ?? '').padEnd(12) + row)]
    console.log(comparison.join('\n'))
    ascii.push(...comparison, '')
  }
  for (const tier of [1, 2, 3, 4] as const) {
    const frames = ALL_CRAFT[preset][tier]
    ascii.push(`${preset} class ${tier} · beats 0..7`, ...frames[0]!.map((_, row) => frames.map(f => f[row]).join('  ')), '')
  }
  for (const [time, hour] of [['day', 13], ['night', 22]] as const) {
    const rows = ([1, 2, 3, 4] as const).flatMap(tier => Array.from({ length: 8 }, (_, beat) => ({
      name: `${preset} ${time} · class ${tier} · beat ${beat}`,
      px: Array.from(scenePixels({ ...base, preset, hour, frame: 360 + beat * 2, jobs: [{ kind: 'codex', tier, seed: 0, isStale: false, phase: 360 + beat * 1.5, pace: 0.8 }] })),
    })))
    const out = `${import.meta.dir}/codex-${review}-${preset}-${time}.png`
    await Bun.write(out + '.json', JSON.stringify({ w: base.width, h: SCENE_H, rows: rows.filter((_, i) => i % 8 === 1 || i % 8 === 5) }))
    await Bun.write(out.replace('.png', '-beats.json'), JSON.stringify({ w: base.width, h: SCENE_H, rows }))
    const r = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/sheet.py', out + '.json', out])
    if (r.exitCode !== 0) throw new Error(r.stderr.toString())
    const film = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/codex-sheet.py', out.replace('.png', '-beats.json'), out.replace('.png', '-beats.png')])
    if (film.exitCode !== 0) throw new Error(film.stderr.toString())
    const native = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/codex-sheet.py', out.replace('.png', '-beats.json'), out.replace('.png', '-native.png'), '1'])
    if (native.exitCode !== 0) throw new Error(native.stderr.toString())
    console.log(out)
  }
}
await Bun.write(`${import.meta.dir}/codex-${review}-ascii.txt`, ascii.join('\n'))
