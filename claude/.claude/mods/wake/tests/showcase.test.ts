import { expect, test } from 'claude-code/testing'
import { SCENES, showcaseInput } from '../dev/showcase-input'
import { scenePixels } from '../hooks/scene'

test('README time and weather changes do not relocate stationary crews', { timeoutMs: 60_000 }, () => {
  for (const width of [180, 200]) for (let scene = 0; scene < SCENES.length; scene++) {
    let first: number[] | undefined
    for (let i = 0; i < 48; i++) {
      const anchors: number[] = []
      scenePixels({ ...showcaseInput(scene, i, width, 48), frame: 37, peerEdges: [] }, anchors)
      first ??= anchors
      expect(anchors).toEqual(first)
    }
  }
})

test('every consecutive README frame keeps crews on their routes', { timeoutMs: 60_000 }, () => {
  for (const width of [180, 200]) for (let scene = 0; scene < SCENES.length; scene++) {
    let previous: number[] = []
    for (let i = 0; i < 48; i++) {
      const anchors: number[] = [], input = showcaseInput(scene, i, width, 48)
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
