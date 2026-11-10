// bun dev/review-sheet.ts <place> <mode> [out.png] [width=120] [hour=22] [tier=3]
import { families, makeFrames, type Config } from './review-scene'
import { SCENE_H } from '../hooks/landscapes/kit'
const config: Config = { place: (process.argv[2] ?? 'city') as Config['place'], mode: (process.argv[3] ?? 'to') as Config['mode'], family: 'codex', tier: Number(process.argv[7] ?? 3) as Config['tier'], width: Number(process.argv[5] ?? 120), hour: Number(process.argv[6] ?? 22) }
const out = process.argv[4] ?? `/tmp/wake-${config.place}-${config.mode}.png`
const times = config.mode === 'rest' ? [3000, 4000, 4500, 6000, 10000, 10500, 11000, 12000] : config.mode === 'arrive' ? [1000, 1300, 1700, 2100, 2500, 2900, 3300, 4000] : config.mode === 'leave' || config.mode === 'strike' ? [2500, 2900, 3300, 3700, 4100, 4500, 5000, 5700] : [1500, 2350, 2750, 2900, 3150, 3450, 3800, 4200, 5000, 6500]
const timelines = families.map(family => makeFrames({ ...config, family }))
const rows = times.map(time => {
  const px = new Uint32Array(config.width * families.length * SCENE_H)
  timelines.forEach((frames, f) => {
    const one = frames[time / 50]!
    for (let y = 0; y < SCENE_H; y++) px.set(one.subarray(y * config.width, (y + 1) * config.width), y * config.width * families.length + f * config.width)
  })
  return { name: `${config.place} / ${config.mode} / ${time} ms · Codex | Claude | AGY | OpenCode`, px: Array.from(px) }
})
await Bun.write(out + '.json', JSON.stringify({ w: config.width * families.length, h: SCENE_H, rows }))
const result = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/sheet.py', out + '.json', out])
if (result.exitCode) throw new Error(result.stderr.toString())
console.log(out)
