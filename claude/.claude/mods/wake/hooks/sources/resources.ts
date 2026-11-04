import type { EngineInterface } from 'claude-code'
import type { WakeResource } from '../../types'

/** Tag only a direct allocator invocation; don't change shell state or wrap the native Bash tool. */
export function resourceCommand(command: string, agentId: string, owner: string): string {
  const direct = /^(\s*)((?:\/[A-Za-z0-9_.-]+)*\/agent-resources|agent-resources)([ \t]+run)(?=\s|$)/
  if (!direct.test(command)) return command
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
  return command.replace(direct, (_match, space: string, program: string, run: string) =>
    `${space}AGENT_RESOURCES_OWNER=${quote(owner)} AGENT_RESOURCES_AGENT_ID=${quote(agentId)} ${program}${run}`)
}

export async function resourceOwner($: EngineInterface): Promise<string> {
  return (await $.env.get('AGENT_RESOURCES_OWNER')) ?? `claude:${await $.session.id()}`
}

export function readResources(raw: string, owner: string): WakeResource[] {
  const value: unknown = JSON.parse(raw)
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  const label = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 400 && !/[\x00-\x20\x7f]/.test(v)
  const command = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 400 && !/[\/\x00-\x1f\x7f]/.test(v)
  if (!object(value) || value.schema_version !== 1 || !Array.isArray(value.requests)
    || value.requests.length > 1000) throw new Error('Invalid resource observations')
  return value.requests.flatMap(row => {
    if (!object(row) || row.owner !== owner || !label(row.id) || !count(row.need_bytes) || row.need_bytes === 0
      || typeof row.state !== 'string' || !['running', 'queued', 'cancelling'].includes(row.state)
      || typeof row.running !== 'boolean' || !command(row.command)
      || row.state === 'running' && !row.running || row.state === 'queued' && row.running
      || row.agent_id !== null && !label(row.agent_id)
      || row.reason !== null && (typeof row.reason !== 'string' || row.reason.length > 4000)
      || !count(row.queue_length)
      || row.queue_position !== null && (!count(row.queue_position) || row.queue_position === 0
        || row.queue_position > row.queue_length)) throw new Error('Invalid resource request')
    return row.agent_id === null ? [] : [{ id: row.id, agentId: row.agent_id as string,
      command: row.command, state: row.state as WakeResource['state'], running: row.running, needBytes: row.need_bytes,
      position: row.queue_position as number | null, queueLength: row.queue_length, reason: row.reason as string | null }]
  })
}

export async function scanResources($: EngineInterface): Promise<WakeResource[]> {
  const owner = await resourceOwner($)
  const result = await $.process.run(['agent-resources', 'list', '--json', '--owner', owner], { timeoutMs: 5_000 })
  if (result.exitCode !== 0 || result.isStdoutTruncated) throw new Error('Resource observations unavailable')
  return readResources(result.stdout, owner)
}

const memory = (bytes: number) => bytes >= 1024 ** 3 ? `${Number((bytes / 1024 ** 3).toFixed(1))}G`
  : bytes >= 1024 ** 2 ? `${Number((bytes / 1024 ** 2).toFixed(1))}M`
  : bytes >= 1024 ? `${Number((bytes / 1024).toFixed(1))}K` : `${bytes}B`

/** These are local-command reservations, never native-agent RAM or an enforced cap. */
export function resourceDetail(requests: WakeResource[] | null, agentId: string): { text: string; lines: string[] } | undefined {
  if (requests === null) return { text: ' r?', lines: ['Resource observations unavailable'] }
  const mine = requests.filter(row => row.agentId === agentId)
  if (!mine.length) return undefined
  const running = mine.filter(row => row.running)
  const waiting = mine.filter(row => row.state === 'queued')
  const admitted = running.reduce((sum, row) => sum + row.needBytes, 0)
  const queued = waiting.reduce((sum, row) => sum + row.needBytes, 0)
  return {
    text: admitted ? ` r${memory(admitted)}${waiting.length ? `⌁${waiting.length}` : ''}`
      : queued ? ` ⌁${memory(queued)}` : ' ×',
    lines: [
      'Declared local-command memory reservations; not total agent RAM or a memory cap',
      ...mine.map(row => `${row.command} · ${memory(row.needBytes)} · ${row.state}${row.position ? ` · queue ${row.position}/${row.queueLength}` : ''}${row.reason ? ` · ${row.reason}` : ''}`),
    ],
  }
}
