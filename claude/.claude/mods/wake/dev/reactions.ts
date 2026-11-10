// bun dev/reactions.ts [out.png] [day|night]: charge, release and landing, at readable pixel scale.
import { canvas, sprite, mix } from '../hooks/pixels'
import { CHARACTERS, CHARACTER_IDS } from '../hooks/mochi'
import { react, type Reaction } from '../hooks/reactions'
import { fly } from '../hooks/landscapes/crew'
import { CREW } from '../hooks/landscapes/fx'
import { P, type Look } from '../hooks/landscapes/kit'
import { families } from './review-scene'

const out = process.argv[2] ?? '/tmp/wake-reactions.png', night = process.argv[3] === 'day' ? 0 : 1
const kinds = [...families, ...CHARACTER_IDS], slot = 32, h = 26, w = slot * kinds.length
const rows: { name: string; px: number[] }[] = []
for (const role of ['charge', 'send', 'land'] as const) for (const t of role === 'charge' ? [150, 450, 850] : [0, 100, 250, 450, 700]) {
  const c = canvas(w, h, true), background = mix(P.blue, P.ink, night * .9)
  c.px.fill(background)
  kinds.forEach((kind, i) => {
    const cx = i * slot + 15
    const look = { place: 'city', frame: t / 50, night, top: background, wind: 0, effects: false, crewGround: h - 1, crewBoxes: {}, crewMessagePoints: {} } as Look
    c.withHit(i + 1, () => {
      if (kind in CHARACTERS) {
        const character = CHARACTERS[kind as keyof typeof CHARACTERS]
        sprite(c, cx - 5, 14, character.up, character.ink)
        look.crewBoxes![kind] = { x0: cx - 5, x1: cx + 4, y0: 14, y1: 21 }
        look.crewMessagePoints![kind] = { x: cx, y: 14 }
      } else fly(c, look, cx, 16, { kind: kind as typeof families[number], tier: 2, seed: 2, isStale: false, hit: { id: kind, title: kind, details: [] } }, kind as typeof families[number], false, () => [cx, 16], [])
    })
    const style = kind in CREW ? CREW[kind as typeof families[number]].message : 'packet'
    const reaction: Reaction = { id: kind, role, t, v: role === 'charge' ? (t / 900) ** 2 : Math.exp(-t / 420), style, point: look.crewMessagePoints![kind], direction: { x: 1, y: 0 } }
    react(c, kinds.map(id => ({ id })), [reaction], () => kind, look.crewBoxes, {}, night)
  })
  rows.push({ name: `${role} ${t}ms · ${kinds.join(' | ')}`, px: Array.from(c.px) })
}
await Bun.write(out + '.json', JSON.stringify({ w, h, rows }))
const result = Bun.spawnSync(['uv', 'run', '-q', '--with', 'pillow', 'python', import.meta.dir + '/sheet.py', out + '.json', out])
if (result.exitCode) throw new Error(result.stderr.toString())
console.log(out)
