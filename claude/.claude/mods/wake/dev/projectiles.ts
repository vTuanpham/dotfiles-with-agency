// bun dev/projectiles.ts [out.png]: what every crew design throws, large, on a night and a day sky. Each tile shows one
// projectile flying level to the right and one diving to the left, at two ticks of its flicker, drawn by the scene's renderer.
import { PROJECTILES, drawProjectile } from '../hooks/landscapes/projectiles'
import { P } from '../hooks/landscapes/kit'
import { canvas } from '../hooks/pixels'
import { PLACES } from './places'
import { families } from './review-scene'

const out = process.argv[2] ?? '/tmp/wake-projectiles.png'
const tile = 36, h = 20, w = tile * PLACES.length
const rows: { name: string; px: number[] }[] = []
for (const [sky, name] of [[P.crust, 'night'], [0x8fbfe8, 'day']] as const) for (const family of families) for (const tick of [0, 1]) {
  const c = canvas(w, h)
  c.rect(0, 0, w, h, sky)
  PLACES.forEach((place, i) => {
    const shot = PROJECTILES[family][place]
    if (!shot) return
    const x0 = i * tile
    const level = Array.from({ length: 16 }, (_, n) => 5 * w + x0 + 8 + n)
    const dive = Array.from({ length: 16 }, (_, n) => (9 + Math.floor(n / 2)) * w + x0 + 28 - n)
    for (const path of [level, dive]) drawProjectile(c, shot, path, path.length - 1, tick, { x: path[0]! % w, y: Math.floor(path[0]! / w) })
  })
  rows.push({ name: `${family} · ${name} · tick ${tick} · ${PLACES.join(' | ')}`, px: Array.from(c.px) })
}
await Bun.write(out + '.json', JSON.stringify({ w, h, rows }))
const result = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/sheet.py', out + '.json', out])
if (result.exitCode) throw new Error(result.stderr.toString())
console.log(out)
