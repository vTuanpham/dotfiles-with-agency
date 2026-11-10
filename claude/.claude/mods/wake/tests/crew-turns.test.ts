import { expect, test } from 'claude-code/testing'
import { shape } from '../hooks/landscapes/crew'
import { DESIGNS } from '../hooks/landscapes/design'
import { turnPose as craft } from '../hooks/landscapes/craft'
import { turnPose as creatures } from '../hooks/landscapes/creatures'
import { turnPose as lantern } from '../hooks/landscapes/lantern'

test('every supplied turn pose is selected for its design', () => {
  for (const [kind, poses] of [['codex', craft], ['claude', creatures], ['opencode', lantern]] as const) {
    for (const place of Object.keys(DESIGNS[kind]) as (keyof typeof DESIGNS[typeof kind])[]) {
      expect(DESIGNS[kind][place].turn === 'pose', `${kind} ${place}`).toBe(!!poses[place])
    }
  }
})

test('a pose turn holds its hand-drawn midpoint and resumes mirrored flight', () => {
  const flight = ['aa...', '.ag..', '..aaa'], pose = ['..s..', '.aaa.', '..a..']
  for (const mirror of [1, -1] as const) {
    expect(shape(flight, mirror, 0.5, 'pose', pose)).toEqual(pose)
    expect(shape(flight, mirror, 0.2, 'pose', pose)).toEqual(shape(flight, mirror, 0.2, 'bank'))
    expect(shape(flight, mirror, 0.8, 'pose', pose)).toEqual(shape(flight, mirror, 0.8, 'bank'))
    expect(shape(flight, mirror, 1, 'pose', pose)).toEqual(mirror === 1 ? flight : flight.map(row => [...row].reverse().join('')))
  }
})

test('a missing turn pose falls back to the bank at every point', () => {
  const flight = ['aa...', '.ag..', '..aaa']
  for (const mirror of [1, -1] as const) for (const roll of [0, 0.2, 0.5, 0.8, 1]) expect(shape(flight, mirror, roll, 'pose')).toEqual(shape(flight, mirror, roll, 'bank'))
})
