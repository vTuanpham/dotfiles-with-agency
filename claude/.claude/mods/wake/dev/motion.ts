// bun dev/motion.ts [out.png] [width]: crew motion and message traffic over time, in nested crew scenarios.
// Each sheet row is one moment: flyers patrol, workers hop on real events, and packets cross wires only as messages arrive.
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { PACKET_RUN_MS } from '../hooks/crew-row.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
const out = process.argv[2] ?? `${import.meta.dir}/motion.png`
const W = Number(process.argv[3] ?? 160)
const job = (id: string, seed: number, kind: 'codex' | 'agy' | 'claude' | 'opencode', tier: 1 | 2 | 3 | 4, lift = 0) =>
  ({ isStale: false, seed, kind, tier, lift, hit: { id, title: id, details: [] } })
const base: SceneInput = {
  width: W, frame: 0, hour: 13, sun: { rise: 5.9, set: 17.5 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 }, preset: 'city', seed: 12345,
  turns: Array.from({ length: 9 }, () => ({ kinds: ['read', 'edit', 'test'] as any })), live: { kinds: ['read', 'edit'] as any },
  mood: 'work', jobs: [], agents: [], plan: { done: 2, total: 5 }, effect: null,
}
// A message from `source` to `target`, `ms` after it arrived in view (`undefined`: older history, never animated).
const edge = (source: string, target: string, ms: number | undefined, fresh = 1, family: 'codex' | 'agy' | 'claude' | 'opencode' = 'codex') =>
  ({ source, target, strength: ms === undefined ? 0.3 : 0.9, preview: 'x', count: fresh, family, arriving: ms, fresh })
type Case = [string, (t: number) => Partial<SceneInput>]
const longSession = Array.from({ length: 23 }, (_, i) => ({ kinds: (['read', 'edit', 'test', 'run', 'search', 'edit', 'web'] as const).slice(0, 2 + (i * 5) % 6) as any }))
const cases: Case[] = [
  ['long session: 23 turns, one Sol job (class 3)', () => ({ turns: longSession, jobs: [job('a', 3, 'codex', 3)] })],
  ['solo: one codex job + one subagent, quiet', () => ({ jobs: [job('a', 3, 'codex', 2)], agents: [{ seed: 1, tier: 2 }] })],
  ['chain a→b→c, b just acted, root→c arriving', t => ({
    jobs: [job('a', 3, 'codex', 2), job('b', 8, 'agy', 3, t < 1200 ? Math.exp(-t / 1200) : 0), job('c', 13, 'opencode', 1)],
    peerEdges: [edge('a', 'b', t, 1, 'codex'), edge('b', 'c', t - 600 >= 0 ? t - 600 : undefined, 1, 'agy'), edge('mochi', 'c', t, 1)],
  })],
  ['burst: three messages a→b at once', t => ({
    jobs: [job('a', 3, 'codex', 3), job('b', 21, 'claude', 2)],
    peerEdges: [edge('a', 'b', t, 3, 'codex')],
  })],
  ['crowded: 5 jobs + 3 subagents, history only', () => ({
    jobs: [job('a', 3, 'codex', 4), job('b', 8, 'agy', 2), job('c', 13, 'opencode', 1), job('d', 21, 'claude', 3), job('e', 34, 'codex', 1)],
    agents: [{ seed: 1, tier: 1 }, { seed: 2, tier: 2 }, { seed: 5, tier: 3 }],
    peerEdges: [edge('a', 'b', undefined), edge('c', 'mochi', undefined)],
  })],
]
const rows: { name: string; px: number[] }[] = []
for (const [name, at] of cases) for (const t of [0, 400, 800, 1200, 1600, 2400]) {
  // 20 frames a second: time and frame advance together, so patrol and packets share a clock
  rows.push({ name: `${name} · t=${t}ms`, px: Array.from(scenePixels({ ...base, ...at(t), frame: 300 + Math.round(t / 50) })) })
}
await Bun.write(out + '.json', JSON.stringify({ w: W, h: SCENE_H, rows }))
const r = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/sheet.py', out + '.json', out])
if (r.exitCode !== 0) console.error(r.stderr.toString())
else console.log(out, `(packet run ${PACKET_RUN_MS} ms)`)
