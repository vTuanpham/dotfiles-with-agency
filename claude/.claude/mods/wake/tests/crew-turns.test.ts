import { expect, test } from 'claude-code/testing'
import { shape } from '../hooks/landscapes/crew'

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
