// bun dev/hero-rows.ts <out.json> <columns> <scene:start,...> <frames>: the inline rows under the README hero's scene, for
// each stop (a showcase scene and the loop frame it starts at) over `frames` frames: the stop's two workers as the band shows
// them, talking exactly when the showcase's scene has them talk (TALKS), and the quota rows. Drawn by docs/tools/readme_gifs.py.
import { LOGOS } from '../hooks/logos.ts'
import type { WakeChip } from '../types'
import { chip, crewRowsAt, message, quotaLines } from './inline-rows.ts'
import { TALKS, showcaseInput } from './showcase-input.ts'

const [out, columns, stops, frames] = [process.argv[2]!, Number(process.argv[3]), process.argv[4]!.split(',').map(s => s.split(':').map(Number) as [number, number]), Number(process.argv[5])]
const MS_PER_TICK = 50, NOW0 = 600_000
const WORK: Record<string, { title: string; model: string; levels: string[] }> = {
  codex: { title: 'Parser fix', model: 'gpt-6.1-sol', levels: ['low', 'medium', 'high', 'xhigh'] },
  claude: { title: 'Visual review', model: 'claude-opus-5-5', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  agy: { title: 'Docs sweep', model: 'gemini-4-pro', levels: ['low', 'medium', 'high'] },
  opencode: { title: 'Release notes', model: 'glm-5', levels: ['low', 'medium', 'high'] },
}

const crewAt = (scene: number, i: number): WakeChip[] => {
  const ms = i * MS_PER_TICK, now = NOW0 + ms
  return showcaseInput(scene, i).jobs.map((job, k) => {
    const id = job.hit!.id, work = WORK[job.kind!]!
    const peers = TALKS.flatMap(([from, to, at]) => ms < at || (from !== id && to !== id) ? [] : [from === id
      ? message(to === 'mochi' ? 'root' : to, true, now, ms - at, to === 'mochi' ? { messageState: 'observed' } : {})
      : message(from === 'mochi' ? 'root' : from, false, now, ms - at)])
    return chip(id, work.title, job.kind!, work.model, 'high', work.levels, now - 140_000 - k * 60_000, peers)
  })
}

await Bun.write(out, JSON.stringify({
  stops: stops.map(([scene, start]) => Array.from({ length: frames }, (_, k) => crewRowsAt(crewAt(scene, start + k), [], NOW0 + (start + k) * MS_PER_TICK, start + k, columns - 2))),
  quota: quotaLines(columns - 6), logos: LOGOS, textColumns: columns,
}))
console.log(out, stops.length, 'stops x', frames, 'frames')
