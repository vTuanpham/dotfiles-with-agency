// bun dev/showcase.ts [out.bin] [frames] [width]: scene-major raw uint32 0xRRGGBB for docs/tools/readme_gifs.py.
import { MessageTrails, scenePixels } from '../hooks/scene'
import { SCENE_H } from '../hooks/landscapes/kit'
import { SCENES, showcaseInput } from './showcase-input'

const out = process.argv[2] ?? `${import.meta.dir}/showcase.bin`
const frames = Number(process.argv[3] ?? 48), width = Number(process.argv[4] ?? 180)
const data = new Uint32Array(SCENES.length * frames * width * SCENE_H)
let at = 0
for (let index = 0; index < SCENES.length; index++) {
  const messageTrails = new MessageTrails()
  for (let i = 0; i < frames; i++) {
    data.set(scenePixels({ ...showcaseInput(index, i, width, frames), messageTrails }), at)
    at += width * SCENE_H
  }
}
await Bun.write(out, data)
console.log(out, SCENES.length, 'scenes x', frames, 'frames')
