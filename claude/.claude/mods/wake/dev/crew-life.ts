// bun dev/crew-life.ts [out prefix] [frames]: the two crew-life sheets for the README, as raw little-endian uint32 0xRRGGBB, cell-major,
// `width` x SCENE_H per frame: `<prefix>-characters.bin` (4 characters x frames, 34 wide) and `<prefix>-passages.bin`
// (8 places x 4 families x frames, 64 wide). docs/tools/readme_gifs.py turns them into GIFs.
import { scenePixels, type SceneInput } from '../hooks/scene.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { ARRIVE_MS, EXIT_MS } from '../hooks/exits.ts'
import { CHARACTER_IDS } from '../hooks/mochi.ts'

const prefix = process.argv[2] ?? `${import.meta.dir}/crew`
const FRAMES = Number(process.argv[3] ?? 48)
const STEP = 3
const MS_PER_FRAME = STEP * 50 // the band redraws at 20 frames a second

const base = (width: number, preset: SceneInput['preset']): SceneInput => ({
  width, frame: 0, hour: 14, sun: { rise: 6, set: 18 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 },
  preset, seed: 12345, turns: [], live: null, mood: 'idle', plan: null, effect: null, agents: [], jobs: [],
})

// the characters: a worker keeps messaging the root, so each character's gadget pops out to catch it again and again
{
  const W = 34
  const data = new Uint32Array(CHARACTER_IDS.length * FRAMES * W * SCENE_H)
  let at = 0
  for (const character of CHARACTER_IDS) {
    for (let i = 0; i < FRAMES; i++) {
      const arriving = (i * MS_PER_FRAME + 400) % 2400
      const worker = { isStale: false, seed: 3, kind: 'opencode' as const, tier: 2 as const, hit: { id: 'w', title: 'w', details: [] } }
      data.set(scenePixels({ ...base(W, 'countryside'), character, frame: 37 + i * STEP, jobs: [worker], peerEdges: [{ source: 'w', target: 'mochi', strength: 0.9, preview: 'x', count: 1, family: 'opencode', arriving, fresh: 1 }] }), at)
      at += W * SCENE_H
    }
  }
  await Bun.write(`${prefix}-characters.bin`, data)
}

// the passages: each family in each place arrives, works for a moment, then leaves, in a loop
{
  const W = 64
  const places = ['city', 'harbor', 'beach', 'mountains', 'countryside', 'forest', 'desert', 'tundra'] as const
  const families = ['codex', 'claude', 'agy', 'opencode'] as const
  const arrive = Math.ceil(ARRIVE_MS / MS_PER_FRAME), leave = Math.ceil(EXIT_MS / MS_PER_FRAME), hold = FRAMES - arrive - leave
  const data = new Uint32Array(places.length * families.length * FRAMES * W * SCENE_H)
  let at = 0
  for (const place of places) for (const kind of families) {
    for (let i = 0; i < FRAMES; i++) {
      const phase = i < arrive ? { arriving: i * MS_PER_FRAME } : i < arrive + hold ? {} : { leaving: (i - arrive - hold) * MS_PER_FRAME }
      const job = { isStale: false, seed: 6, kind, tier: 2 as const, hit: { id: 'j', title: 'j', details: [] }, ...phase }
      data.set(scenePixels({ ...base(W, place), frame: 37 + i * STEP, jobs: [job] }), at)
      at += W * SCENE_H
    }
  }
  await Bun.write(`${prefix}-passages.bin`, data)
}
console.log(prefix, 'ok')
