// bun dev/cast.ts [place|all] [out.png]: the whole cast of one landscape (or every landscape), drawn large for design review.
// Each row is a place by day and night: every family at every class (codex, claude, agy, opencode × 1..4), two frames apart so
// the animation shows. Sprites are drawn by the same `fly` the scene uses, on a plain sky, so this shows the form and its aura
// but not the placement (the scene sheets, `crew.ts` and `passages.ts`, show that).
import { fly } from '../hooks/landscapes/crew.ts'
import { type Look, type Job, P } from '../hooks/landscapes/kit.ts'
import { canvas, mix } from '../hooks/pixels.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { PLACES } from './places.ts'

const want = process.argv[2] ?? 'all'
const out = process.argv[3] ?? `${import.meta.dir}/cast-${want}.png`
const places = want === 'all' ? PLACES : [want as (typeof PLACES)[number]]
const kinds = ['codex', 'claude', 'agy', 'opencode'] as const
const SLOT = 23, W = SLOT * 16, H = 16
const rows: { name: string; px: number[] }[] = []
for (const place of places) for (const [time, night] of [['day', 0], ['night', 1]] as const) for (const frame of [0, 12]) {
  const c = canvas(W, H)
  const top = mix(P.blue, P.ink, night * 0.9), horizon = mix(P.sky, P.base, night * 0.85)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) c.set(x, y, mix(top, horizon, y / H))
  const ground = H - 2
  for (let x = 0; x < W; x++) for (let y = ground; y < H; y++) c.set(x, y, mix(P.surface1, P.ink, night * 0.5))
  const look = { W, H, frame, night, isDay: !night, place, top, horizon, crewGround: ground, crewZones: [], crewSpriteZones: [] } as unknown as Look
  kinds.forEach((kind, k) => ([1, 2, 3, 4] as const).forEach((tier, t) => {
    const job: Job = { kind, tier, seed: 3 + k, isStale: false }
    fly(c, look, (k * 4 + t) * SLOT + (SLOT >> 1), 7, job, kind)
  }))
  rows.push({ name: `${place} ${time} · frame ${frame} · codex | claude | agy | opencode, classes 1-4 each`, px: Array.from(c.px) })
}
await Bun.write(out + '.json', JSON.stringify({ w: W, h: H, rows }))
const r = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/sheet.py', out + '.json', out])
if (r.exitCode !== 0) console.error(r.stderr.toString())
else console.log(out)
void SCENE_H
