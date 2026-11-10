// bun dev/readme-tour.ts <out prefix>: class-4 close-ups using the review player's real clocks.
import { makeFrames, type Config } from './review-scene'
import { SCENE_H } from '../hooks/landscapes/kit'

const out = process.argv[2] ?? '/tmp/wake-tour', width = 120
const chapters: { title: string; caption: string; config: Partial<Config>; shots: [Config['mode'], number, number][] }[] = [
  { title: 'Codex · mechanical dragon', caption: 'City after dark · warp departure and arrival', config: { family: 'codex', place: 'city', hour: 22 }, shots: [['leave', 1000, 5800], ['arrive', 1000, 5000]] },
  { title: 'Claude · forest owl', caption: 'Forest by day · slow down, perch, take flight', config: { family: 'claude', place: 'forest', hour: 14 }, shots: [['rest', 2000, 13000]] },
  { title: 'AGY · scorpion constellation', caption: 'Desert after dark · gather light, send, receive', config: { family: 'agy', place: 'desert', hour: 22 }, shots: [['to', 1000, 7000], ['from', 2000, 5000]] },
  { title: 'OpenCode · sky lanterns', caption: 'Mountain night · a whole formation arrives and leaves', config: { family: 'opencode', place: 'mountains', hour: 22 }, shots: [['arrive', 1000, 5000], ['leave', 1000, 5800]] },
]
const frames: Uint32Array[] = [], clips: { title: string; caption: string; start: number; end: number }[] = []
const cuts: number[] = []
for (const chapter of chapters) {
  const start = frames.length
  for (const [mode, from, to] of chapter.shots) {
    cuts.push(frames.length)
    const timeline = makeFrames({ family: 'codex', place: 'city', hour: 22, ...chapter.config, tier: 4, width, mode })
    for (let ms = from; ms < to; ms += 100) {
      const frame = timeline[ms / 50]
      if (!frame || frame.length !== width * SCENE_H) throw new Error(`Invalid tour frame: ${chapter.title} at ${ms}`)
      frames.push(frame)
    }
  }
  clips.push({ title: chapter.title, caption: chapter.caption, start, end: frames.length })
}
const pixels = new Uint32Array(frames.length * width * SCENE_H)
frames.forEach((frame, i) => pixels.set(frame, i * width * SCENE_H))
await Bun.write(out + '.bin', pixels)
await Bun.write(out + '.json', JSON.stringify({ width, height: SCENE_H, frames: frames.length, delay: 100, clips, cuts }))
