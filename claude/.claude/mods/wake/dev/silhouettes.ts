// bun dev/silhouettes.ts: every class-4 Codex silhouette, side by side, with no palette, glow, escorts or air effects.
import { craftFrames } from '../hooks/landscapes/craft.ts'
import { canvas } from '../hooks/pixels.ts'
import { PLACES } from './places.ts'

const slot = 24, W = slot * PLACES.length, H = 9
const rows = Array.from({ length: 8 }, (_, beat) => {
  const c = canvas(W, H)
  PLACES.forEach((place, i) => {
    const art = craftFrames(place, 4)[beat]!, x0 = i * slot + 2, y0 = (H - art.length) >> 1
    art.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') c.set(x0 + x, y0 + y, 0xffffff) }))
  })
  return { name: `${PLACES.join(' | ')} · class 4 · beat ${beat}`, px: Array.from(c.px) }
})
const out = `${import.meta.dir}/codex-character-silhouettes.png`
await Bun.write(out + '.json', JSON.stringify({ w: W, h: H, rows }))
const r = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/sheet.py', out + '.json', out])
if (r.exitCode !== 0) throw new Error(r.stderr.toString())
console.log(out)
