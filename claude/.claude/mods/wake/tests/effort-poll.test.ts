import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { effortTick } from '../hooks/register'
import type { EffortLevels } from '../hooks/sources/efforts'

test('a slow or failed harness does not delay other effort meters or defer retries for six hours', async () => {
  const now = 100_000_000
  let state: { at: number; levels: EffortLevels } = { at: 0, levels: {
    claude: { sonnet: ['low', 'medium', 'high'] },
  } }
  let version = 1
  let release: () => void = () => {}
  const stalled = new Promise<void>(resolve => { release = resolve })
  let published: () => void = () => {}
  const codexPublished = new Promise<void>(resolve => { published = resolve })
  const calls: string[] = []
  const $ = {
    clock: { now: async () => now },
    state: {
      get: async () => ({ value: state, version }),
      set: async (_ref: unknown, value: typeof state, options: { ifVersion: number }) => {
        if (options.ifVersion !== version) return { isSet: false, version }
        state = value
        version++
        if (state.levels.codex) published()
        return { isSet: true, version }
      },
    },
    process: { run: async (args: string[]) => {
      const backend = args[3]!
      calls.push(backend)
      if (backend === 'agy') await stalled
      return { exitCode: backend === 'claude' ? 1 : 0, isStdoutTruncated: false,
        stdout: JSON.stringify({ models: [{ id: 'model', efforts: ['low', 'medium', 'high'] }] }) }
    } },
  } as unknown as EngineInterface
  const pending = effortTick($)
  await codexPublished
  expect(state.levels.codex?.model).toEqual(['low', 'medium', 'high'])
  expect(state.levels.agy).toBeUndefined()
  release()
  await pending
  expect(calls.sort()).toEqual(['agy', 'claude', 'codex', 'opencode'])
  expect(state.levels.claude?.sonnet).toEqual(['low', 'medium', 'high'])
  expect(state.levels.agy?.model).toEqual(['low', 'medium', 'high'])
  expect(state.levels.opencode?.model).toEqual(['low', 'medium', 'high'])
  expect(state.at + 6 * 60 * 60_000 - now).toBe(10 * 60_000)
  await effortTick($)
  expect(calls).toHaveLength(4)
})
