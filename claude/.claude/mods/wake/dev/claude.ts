// bun dev/claude.ts [review-name]: all Claude classes/poses in real day/night scenes, plus bare silhouettes.
import { ALL_CREATURES, CREATURE_BEATS } from '../hooks/landscapes/creatures.ts'
import { ALL_CRAFT } from '../hooks/landscapes/craft.ts'
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { canvas } from '../hooks/pixels.ts'
import { PLACES } from './places.ts'
import { TURN_LEAD_MS } from '../hooks/crew-row.ts'
import { clockRate } from '../hooks/landscapes/gait.ts'

const review = process.argv[2] ?? 'review'
const base: SceneInput = {
  width: 120, frame: 0, hour: 13, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, preset: 'city', seed: 12345,
  turns: Array.from({ length: 5 }, () => ({ kinds: ['read', 'edit'] })), live: null, mood: 'idle', jobs: [], agents: [], plan: null, effect: null,
}
function sheet(source: string, out: string, scale: 1 | 4 | 6 = 6) {
  const command = scale === 6 ? ['sheet.py', source, out] : ['codex-sheet.py', source, out, String(scale)]
  const result = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/' + command[0], ...command.slice(1)])
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
const ascii: string[] = []
for (const preset of PLACES) {
  for (const tier of [1, 2, 3, 4] as const) {
    const frames = ALL_CREATURES[preset][tier]
    ascii.push(`${preset} class ${tier} · beats 0..${CREATURE_BEATS - 1}`, ...frames[0]!.map((_, row) => frames.map(f => f[row]).join('  ')), '')
  }
  if (!process.argv.includes('--art') && !process.argv.includes('--behavior')) for (const [time, hour] of [['day', 13], ['night', 22]] as const) {
    const rows = ([1, 2, 3, 4] as const).flatMap(tier => Array.from({ length: CREATURE_BEATS }, (_, beat) => ({
      name: `${preset} ${time} · class ${tier} · beat ${beat}`,
      px: Array.from(scenePixels({ ...base, preset, hour, frame: 360 + beat * 2, jobs: [{ kind: 'claude', tier, seed: 0, isStale: false, phase: 360 + beat * 1.5, pace: 0.8 }] })),
    })))
    const out = `${import.meta.dir}/claude-${review}-${preset}-${time}.png`
    await Bun.write(out + '.json', JSON.stringify({ w: base.width, h: SCENE_H, rows: rows.filter((_, i) => i % CREATURE_BEATS === 1 || i % CREATURE_BEATS === 7) }))
    await Bun.write(out.replace('.png', '-beats.json'), JSON.stringify({ w: base.width, h: SCENE_H, rows }))
    sheet(out + '.json', out)
    sheet(out.replace('.png', '-beats.json'), out.replace('.png', '-native.png'), 1)
    console.log(out)
  }
  if (!process.argv.includes('--art')) {
    const moments = [
      ...[0, 450, 900, 1050, 1250].map(ms => ({ name: `call ${ms}ms`, talk: { ms, sending: true } })),
      ...[100, 900, 1900].map(ms => ({ name: `arrive ${ms}ms`, arriving: ms })),
      ...[100, 900, 1900, 2900].map(ms => ({ name: `leave ${ms}ms`, leaving: ms })),
      ...[100, 400, 900, 1900, 2900].map(ms => ({ name: `struck ${ms}ms`, leaving: ms, struck: true })),
    ]
    const rows = ([['day', 13], ['dusk', 18], ['night', 22]] as const).flatMap(([time, hour]) => moments.map(({ name, ...state }) => ({
      name: `${hour}h ${name.replace(/call|arrive|leave|struck/g, word => word[0]!).replace('ms', '')}`,
      px: Array.from(scenePixels({ ...base, preset, width: 64, hour, frame: 360 + ('talk' in state ? state.talk.ms / 100 : 0),
        jobs: [{ kind: 'claude', tier: 4, seed: 0, isStale: false, phase: 'talk' in state ? 60 + state.talk.ms / 100 * clockRate(0.8) : 360, pace: 0.8, hit: { id: 'claude-review', title: 'Claude', details: [] }, ...state }],
        peerEdges: 'talk' in state ? [{ source: 'claude-review', target: 'mochi', family: 'claude', strength: 1, count: 1, preview: 'Message for root', arriving: state.talk.ms, lead: TURN_LEAD_MS, fresh: 1 }] : undefined,
      })),
    })))
    const out = `${import.meta.dir}/claude-${review}-${preset}-behavior.png`
    await Bun.write(out + '.json', JSON.stringify({ w: 64, h: SCENE_H, rows }))
    sheet(out + '.json', out, 4)
    sheet(out + '.json', out.replace('.png', '-native.png'), 1)
  }
}
await Bun.write(`${import.meta.dir}/claude-${review}-ascii.txt`, ascii.join('\n'))

const W = 24 * PLACES.length, H = 9
for (const silhouettes of [true, false]) {
  const rows = Array.from({ length: CREATURE_BEATS }, (_, beat) => {
    const c = canvas(W, H)
    PLACES.forEach((place, i) => {
      const art = ALL_CREATURES[place][4][beat]!
      const inks: Record<string, number> = { a: 0xf5c2e7, l: 0xf8dcec, d: 0x916f94, s: 0xf9e2af, W: 0xfdf0f6 }
      art.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') c.set(i * 24 + 2 + x, 1 + y, silhouettes ? 0xffffff : inks[ch]!) }))
    })
    return { name: `${PLACES.join(' | ')} · class 4 · beat ${beat}`, px: Array.from(c.px) }
  })
  const out = `${import.meta.dir}/claude-${review}-${silhouettes ? 'silhouettes' : 'plumage'}.png`
  await Bun.write(out + '.json', JSON.stringify({ w: W, h: H, rows }))
  sheet(out + '.json', out)
  console.log(out)
}

// Direct size/detail comparison with the reference dragon, without scenery or effects.
const comparison = PLACES.map(place => {
  const c = canvas(72, 10)
  for (const [art, left, color] of [[ALL_CREATURES[place][4][0]!, 2, 0xf5c2e7], [ALL_CREATURES[place][1][0]!, 27, 0xf5c2e7], [ALL_CRAFT.city[4][0]!, 45, 0x94e2d5]] as const) {
    art.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') c.set(left + x, y + 1, color) }))
  }
  return { name: `${place}: class 4 / class 1 / dragon`, px: Array.from(c.px) }
})
const comparisonOut = `${import.meta.dir}/claude-${review}-dragon.png`
await Bun.write(comparisonOut + '.json', JSON.stringify({ w: 72, h: 10, rows: comparison }))
sheet(comparisonOut + '.json', comparisonOut)
