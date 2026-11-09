// bun dev/opencode.ts [review-name]: all balloon beats, real day/night scenes, voice/strike timelines and bare silhouettes.
import { ALL_BALLOONS } from '../hooks/landscapes/balloon.ts'
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { canvas } from '../hooks/pixels.ts'
import { TURN_LEAD_MS } from '../hooks/crew-row.ts'
import { PLACES } from './places.ts'

const review = process.argv[2] ?? 'review'
const base: SceneInput = {
  width: 120, frame: 0, hour: 13, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, preset: 'city', seed: 12345,
  turns: Array.from({ length: 5 }, () => ({ kinds: ['read', 'edit'] })), live: null, mood: 'idle', jobs: [], agents: [], plan: null, effect: null,
}
const sheet = (data: string, out: string, film = false, scale = '2') => {
  const args = film ? ['codex-sheet.py', data, out, scale] : ['sheet.py', data, out]
  const result = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/' + args[0], ...args.slice(1)])
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
const ascii: string[] = []
for (const preset of PLACES) {
  for (const tier of [1, 2, 3, 4] as const) {
    const frames = ALL_BALLOONS[preset][tier]
    ascii.push(`${preset} class ${tier} · beats 0..7`, ...frames[0]!.map((_, row) => frames.map(f => f[row]).join('  ')), '')
  }
  for (const [time, hour] of [['day', 13], ['night', 22]] as const) {
    const rows = ([1, 2, 3, 4] as const).flatMap(tier => Array.from({ length: 8 }, (_, beat) => ({
      name: `${preset} ${time} · class ${tier} · beat ${beat}`,
      px: Array.from(scenePixels({ ...base, preset, hour, frame: 360 + beat * 2, jobs: [{ kind: 'opencode', tier, seed: 0, isStale: false, phase: 360 + beat * 1.5, pace: 0.8 }] })),
    })))
    const out = `${import.meta.dir}/opencode-${review}-${preset}-${time}`
    await Bun.write(out + '-beats.json', JSON.stringify({ w: base.width, h: SCENE_H, rows }))
    await Bun.write(out + '.json', JSON.stringify({ w: base.width, h: SCENE_H, rows: rows.filter((_, i) => i % 8 === 1 || i % 8 === 5) }))
    sheet(out + '.json', out + '.png')
    sheet(out + '-beats.json', out + '-beats.png', true)
    sheet(out + '-beats.json', out + '-native.png', true, '1')
    const moments = [0, 300, 850, 950, 1050, 1250, 1500, 2100, 2900]
    const timeline = moments.map(ms => ({
      name: `${preset} ${time} · send / struck · ${ms} ms`,
      px: (() => {
        const c = canvas(base.width * 2, SCENE_H)
        for (const [i, struck] of [false, true].entries()) {
          const job = { kind: 'opencode' as const, tier: 4 as const, seed: 0, isStale: false, phase: 360 + ms / 100, pace: 1,
            hit: { id: 'balloon', title: 'balloon', details: [] }, ...(struck ? { leaving: Math.max(1, ms), struck: true } : {}) }
          const px = scenePixels({ ...base, preset, hour, frame: 360 + ms / 100, jobs: [job], peerEdges: struck ? [] : [{ source: 'balloon', target: 'mochi', strength: 1, arriving: ms, lead: TURN_LEAD_MS, fresh: 2, preview: 'Festival message' }] })
          for (let y = 0; y < SCENE_H; y++) for (let x = 0; x < base.width; x++) c.set(i * base.width + x, y, px[y * base.width + x]!)
        }
        return [...c.px]
      })(),
    }))
    await Bun.write(out + '-behaviour.json', JSON.stringify({ w: base.width * 2, h: SCENE_H, rows: timeline }))
    sheet(out + '-behaviour.json', out + '-behaviour.png')
    console.log(out + '-native.png')
  }
}
await Bun.write(`${import.meta.dir}/opencode-${review}-ascii.txt`, ascii.join('\n'))
const W = 18 * PLACES.length, H = 11
const rows = Array.from({ length: 8 }, (_, beat) => {
  const c = canvas(W, H)
  PLACES.forEach((place, i) => ALL_BALLOONS[place][4][beat]!.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') c.set(i * 18 + x + 2, y + 1, 0xffffff) })))
  return { name: `${PLACES.join(' | ')} · class 4 · beat ${beat}`, px: [...c.px] }
})
const out = `${import.meta.dir}/opencode-${review}-silhouettes`
await Bun.write(out + '.json', JSON.stringify({ w: W, h: H, rows }))
sheet(out + '.json', out + '.png')
console.log(out + '.png')
