import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { readResources, resourceCommand, resourceDetail, resourceOwner, scanResources } from '../hooks/sources/resources'

const owner = 'claude:root-a'
const request = (changes: Record<string, unknown> = {}) => ({ id: 'request-a', owner, agent_id: 'worker-a',
  command: 'pytest', state: 'queued', running: false, need_bytes: 3 * 1024 ** 3,
  queue_position: 2, queue_length: 3, reason: 'waiting for admission', ...changes })
const snapshot = (requests: Record<string, unknown>[]) => JSON.stringify({ schema_version: 1, requests })

test('resource observations preserve agent identity and real queue state without inventing RAM', () => {
  const rows = readResources(snapshot([request(), request({ id: 'untagged', agent_id: null })]), owner)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ agentId: 'worker-a', command: 'pytest', state: 'queued', running: false,
    needBytes: 3 * 1024 ** 3, position: 2, queueLength: 3 })
  expect(readResources(snapshot([request({ command: 'python test runner' })]), owner)[0]?.command)
    .toBe('python test runner')
  const queued = resourceDetail(rows, 'worker-a')!
  expect(queued.text).toBe(' ⌁3G')
  expect(queued.lines.join(' ')).toContain('pytest')
  expect(queued.lines.join(' ')).toContain('queue 2/3')
  expect(queued.lines.join(' ')).toContain('not total agent RAM or a memory cap')
  expect(resourceDetail(rows, 'another-worker')).toBeUndefined()
  const active = readResources(snapshot([request({ state: 'running', running: true, queue_position: null })]), owner)
  expect(resourceDetail(active, 'worker-a')?.text).toBe(' r3G')
  const stopping = readResources(snapshot([request({ state: 'cancelling', running: true, queue_position: null })]), owner)
  expect(resourceDetail(stopping, 'worker-a')?.text).toBe(' r3G')
  expect(resourceDetail([...active, ...rows], 'worker-a')?.text).toBe(' r3G⌁1')
  expect(resourceDetail(null, 'worker-a')?.text).toBe(' r?')
})

test('foreign owners, malformed numbers and unsupported resource schemas fail closed', () => {
  for (const change of [{ owner: 'claude:other-root' }, { need_bytes: '3G' }, { need_bytes: Infinity },
    { need_bytes: -1 }, { agent_id: '' }, { state: 'invented' }, { running: 'yes' }, { command: '' },
    { command: 'dir/tool' }, { command: 'bad\nname' }, { state: 'queued', running: true },
    { state: 'running', running: false }, { queue_position: 4 }]) {
    expect(() => readResources(snapshot([request(change)]), owner)).toThrow()
  }
  expect(() => readResources('{"schema_version":2,"requests":[]}', owner)).toThrow()
})

test('native attribution changes only a direct allocator invocation and safely quotes identities', () => {
  expect(resourceCommand('agent-resources run --mem 3G -- python task.py', 'worker-a', owner))
    .toBe("AGENT_RESOURCES_OWNER='claude:root-a' AGENT_RESOURCES_AGENT_ID='worker-a' agent-resources run --mem 3G -- python task.py")
  expect(resourceCommand('/home/u/.local/bin/agent-resources run --mem 1G -- task', 'a', owner))
    .toContain("AGENT_RESOURCES_AGENT_ID='a' /home/u/.local/bin/agent-resources run")
  expect(resourceCommand('agent-resources run --mem 1G -- task', "a'$(false)", owner))
    .toContain("AGENT_RESOURCES_AGENT_ID='a'\\''$(false)'")
  for (const command of ['echo agent-resources run', 'cd /repo && agent-resources run --mem 1G -- task',
    'agent-resources list', 'agent-resources\nrun', 'agent-resources-helper run']) {
    expect(resourceCommand(command, 'a', owner)).toBe(command)
  }
})

test('resource scans filter the exact root and preserve an explicitly inherited controller', async () => {
  const calls: string[][] = []
  const $ = {
    env: { get: async () => undefined }, session: { id: async () => 'root-a' },
    process: { run: async (args: string[]) => {
      calls.push(args)
      return { stdout: snapshot([request()]), exitCode: 0, isStdoutTruncated: false }
    } },
  } as unknown as EngineInterface
  expect((await scanResources($))[0]?.agentId).toBe('worker-a')
  expect(calls).toEqual([['agent-resources', 'list', '--json', '--owner', owner]])
  const inherited = { ...$, env: { get: async () => 'codex:controller' } } as unknown as EngineInterface
  expect(await resourceOwner(inherited)).toBe('codex:controller')
})
