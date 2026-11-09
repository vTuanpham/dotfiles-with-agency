// bun dev/opencode.ts [review-name] [--before old-review]: scenes, voice/strike timelines, silhouettes and optional before/after.
import { ALL_LANTERNS } from '../hooks/landscapes/lantern.ts'
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { canvas } from '../hooks/pixels.ts'
import { fly } from '../hooks/landscapes/crew.ts'
import type { Look } from '../hooks/landscapes/kit.ts'
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
    const frames = ALL_LANTERNS[preset][tier]
    ascii.push(`${preset} class ${tier} · beats 0..7`, ...frames[0]!.map((_, row) => frames.map(f => f[row]).join('  ')), '')
  }
  if (!process.argv.includes('--art')) for (const [time, hour] of [['day', 13], ['night', 22]] as const) {
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
            hit: { id: 'lantern', title: 'lantern', details: [] }, ...(struck ? { leaving: Math.max(1, ms), struck: true } : {}) }
          const px = scenePixels({ ...base, preset, hour, frame: 360 + ms / 100, jobs: [job], peerEdges: struck ? [] : [{ source: 'lantern', target: 'mochi', strength: 1, arriving: ms, lead: TURN_LEAD_MS, fresh: 2, preview: 'Festival message' }] })
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
const W = 23 * PLACES.length, H = 9
const rows = Array.from({ length: 8 }, (_, beat) => {
  const c = canvas(W, H)
  PLACES.forEach((place, i) => ALL_LANTERNS[place][4][beat]!.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') c.set(i * 23 + x + 2, y + 1, 0xffffff) })))
  return { name: `${PLACES.join(' | ')} · class 4 · beat ${beat}`, px: [...c.px] }
})
const out = `${import.meta.dir}/opencode-${review}-silhouettes`
await Bun.write(out + '.json', JSON.stringify({ w: W, h: H, rows }))
sheet(out + '.json', out + '.png')
console.log(out + '.png')
const paper = Array.from({ length: 8 }, (_, beat) => {
  const c = canvas(W, H)
  PLACES.forEach((place, i) => fly(c, { place, frame: 0, night: 0, effects: false } as Look,
    i * 23 + 11, 4, { kind: 'opencode', tier: 4, seed: 0, isStale: false, phase: beat * 1.5 }, 'opencode', false, () => [i * 23 + 11, 4], []))
  return { name: `${PLACES.join(' | ')} · class 4 · beat ${beat}`, px: [...c.px] }
})
await Bun.write(out + '-paper.json', JSON.stringify({ w: W, h: H, rows: paper }))
sheet(out + '-paper.json', out + '-paper.png')
sheet(out + '-paper.json', out + '-paper-native.png', true, '1')
const before = process.argv.indexOf('--before')
if (before !== -1) {
  const comparisons: { name: string; px: number[] }[] = []
  for (const place of ['countryside', 'tundra']) for (const time of ['day', 'night']) {
    const old = await Bun.file(`${import.meta.dir}/opencode-${process.argv[before + 1]}-${place}-${time}-beats.json`).json()
    const current = await Bun.file(`${import.meta.dir}/opencode-${review}-${place}-${time}-beats.json`).json()
    for (const beat of [1, 5]) for (const [label, data] of [['before', old], ['after', current]] as const) {
      comparisons.push({ name: `class 4 · ${place === 'countryside' ? 'country' : place} ${time === 'day' ? 'D' : 'N'} ${label} b${beat}`, px: data.rows[24 + beat].px })
    }
  }
  const comparison = `${import.meta.dir}/opencode-${review}-before-after`
  await Bun.write(comparison + '.json', JSON.stringify({ w: base.width, h: SCENE_H, rows: comparisons }))
  sheet(comparison + '.json', comparison + '.png', true)
  sheet(comparison + '.json', comparison + '-native.png', true, '1')
}
