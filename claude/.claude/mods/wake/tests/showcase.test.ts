import { expect, test } from 'claude-code/testing'
import { SCENES, SHOWCASE_FRAMES, showcaseInput } from '../dev/showcase-input'
import { scenePixels } from '../hooks/scene'

test('README time and weather changes do not relocate stationary crews', { timeoutMs: 60_000 }, () => {
  for (const width of [180, 200]) for (let scene = 0; scene < SCENES.length; scene++) {
    let first: number[] | undefined
    for (let i = 0; i < SHOWCASE_FRAMES; i += 10) {
      const anchors: number[] = []
      scenePixels({ ...showcaseInput(scene, i, width), jobs: showcaseInput(scene, 40, width).jobs, frame: 37, peerEdges: [] }, anchors)
      first ??= anchors
      expect(anchors).toEqual(first)
    }
  }
})

for (let scene = 0; scene < SCENES.length; scene++) test(`every consecutive ${SCENES[scene]![0]} README frame keeps crews on their routes`, { timeoutMs: 60_000 }, () => {
  for (const width of [180, 200]) {
    let previous: number[] = []
    for (let i = 0; i < SHOWCASE_FRAMES; i++) {
      const anchors: number[] = [], input = showcaseInput(scene, i, width)
      scenePixels(input, anchors)
      expect(anchors).toHaveLength(input.jobs.length + input.agents.length)
      for (const [j, anchor] of anchors.entries()) {
        const old = previous[j]
        if (old === undefined) continue
        const distance = Math.abs(anchor % width - old % width) + Math.abs(Math.floor(anchor / width) - Math.floor(old / width))
        if (distance > 4) throw new Error(`${SCENES[scene]![0]}, width ${width}, frame ${i}: crew ${j} jumped ${distance} pixels`)
      }
      previous = anchors
    }
  }
})

test('time-lapse loops after its crews and effects have finished', () => {
  for (let scene = 0; scene < SCENES.length; scene++) {
    const start = showcaseInput(scene, 0), end = showcaseInput(scene, SHOWCASE_FRAMES - 1)
    expect(start.jobs).toHaveLength(0)
    expect(end.jobs).toHaveLength(0)
    expect(start.effect).toBe(null)
    expect(end.effect).toBe(null)
    expect(scenePixels(showcaseInput(scene, SHOWCASE_FRAMES))).toEqual(scenePixels(start))
  }
})
