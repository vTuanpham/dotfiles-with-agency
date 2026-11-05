import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { jobLabel, makerOf, modelTier, quotaDetails, quotaGroups, scanQuotas } from '../hooks/sources/accounts'
import { readAccountSnapshot } from '../hooks/sources/account-observations'
import { engine, job, snapshot } from './status-world'
import { quotaLines, quotaText } from '../hooks/crew-row'

test('every job reads cli-agnostic: short model family + effort', () => {
  expect(jobLabel('agy', 'gemini-3.8-flash-high', '')).toEqual({ model: 'flash', effort: 'high' })
  expect(jobLabel('agy', 'claude-opus-5-5-medium', '')).toEqual({ model: 'opus', effort: 'medium' })
  expect(jobLabel('codex', 'gpt-6-luna', 'xhigh')).toEqual({ model: 'luna', effort: 'xhigh' })
  expect(jobLabel('claude', 'claude-sonnet-5-5', '')).toEqual({ model: 'sonnet', effort: '' })
  expect(jobLabel('claude', 'sonnet', 'high')).toEqual({ model: 'sonnet', effort: 'high' })
})

test('consecutive accounts with the same numbers fold into one group', () => {
  const base = { cli: 'codex' as const, plan: 'Plus', active: false, parts: [{ label: 'w', pct: 39, resets: null }] }
  const g = quotaGroups([{ ...base, account: '01' }, { ...base, account: '02', active: true }])
  expect(g.map(x => [x.accounts.join(' '), x.text])).toEqual([['01 02*', 'w39']])
})

test('quota numbers and errors come from the snapshot', async () => {
  const s = snapshot()
  s.quotas = [{ backend: 'agy', account: 'a1', plan: 'Pro', active: false, status: null,
    freshness: 'stale', windows: [{ label: 'Gh', remaining_percent: 42, resets: 'in 3 hours' }] }]
  const w = engine(s)
  const result = await scanQuotas(w.$)
  expect(result.quotas[0]).toMatchObject({ cli: 'agy', account: 'a1', freshness: 'stale', parts: [{ label: 'Gh', pct: 42, resets: 'in 3 hours' }] })
  expect(w.calls).toEqual([['agent-accounts', 'snapshot']])
})

test('account scans are independent of job and peer history', async () => {
  const scoped = snapshot()
  scoped.jobs = [job()]
  scoped.quotas = ['01', '02'].map(account => ({ backend: 'codex', account, plan: null,
    active: account === '01', status: null, freshness: 'unknown',
    windows: [{ label: 'w', remaining_percent: 42, resets: null }] }))
  const calls: string[][] = []
  const $ = { process: { run: async (args: readonly string[]) => {
    calls.push([...args])
    // Unscoped history contains an unrelated invalid record: it must never reach this decoder.
    const value = { ...scoped, jobs: [{}], peers: null, errors: [] }
    return { stdout: JSON.stringify(value), exitCode: 0, isStdoutTruncated: false }
  } } } as unknown as EngineInterface
  const { quotas } = await scanQuotas($)
  expect(calls).toEqual([['agent-accounts', 'snapshot']])
  expect(quotas.map(quota => [quota.account, quota.freshness, quota.parts[0]?.pct])).toEqual([
    ['01', 'unknown', 42], ['02', 'unknown', 42],
  ])
})

test('Claude allowance uses its own account, mark and windows without refreshing cswap', async () => {
  const s = snapshot()
  s.quotas = [{ backend: 'claude', account: '01', plan: null, active: true, status: null,
    freshness: 'stale', windows: [{ label: 'h', remaining_percent: 74, resets: null },
      { label: 'w', remaining_percent: 0, resets: null }] }]
  const w = engine(s)
  const { quotas } = await scanQuotas(w.$)
  expect(w.calls).toEqual([['agent-accounts', 'snapshot']])
  expect(quotas[0]).toMatchObject({ cli: 'claude', account: '01', active: true, freshness: 'stale' })
  expect(quotaText(quotas[0]!)).toContain('◆01*~ h74%')
  expect(quotaText(quotas[0]!)).toContain('w0%')
  expect(quotaGroups(quotas)[0]!.cli).toBe('claude')
})

test('OpenCode usage and failed refresh diagnostics remain visible with valid windows', async () => {
  const s = snapshot()
  s.quotas = [{ backend: 'opencode', account: 'workspace-a', plan: null, active: false,
    freshness: 'stale', status: null, source: 'native usage', observed_at: '2026-11-05T00:00:00Z',
    refresh_status: 'http_error', windows: [{ label: 'weekly', remaining_percent: 42, resets: null }] }]
  s.errors = ['opencode refresh failed']
  const $ = { process: { run: async () => ({ stdout: JSON.stringify(s), exitCode: 0, isStdoutTruncated: false }) } } as unknown as EngineInterface
  const result = await scanQuotas($)
  expect(result.errors).toEqual(['opencode refresh failed'])
  expect(quotaText(result.quotas[0]!)).toContain('42%')
  expect(quotaDetails(result.quotas[0]!, Date.parse('2026-11-05T00:01:00Z'))).toEqual(['weekly: 42% left', 'Updated 1m ago', 'Refresh unavailable'])
})

test('account errors stay local and only a confirmed unmetered workspace is hidden', async () => {
  const s = snapshot()
  const base = { backend: 'codex', plan: null, active: false, status: null, freshness: 'fresh' as const,
    windows: [{ label: 'w', remaining_percent: 50, resets: null }] }
  s.quotas = [{ ...base, account: '01', last_refresh_status: 'ok' }, { ...base, account: '02', last_refresh_status: 'http_error', last_refresh_at: '2026-11-05T00:00:00Z' },
    { ...base, backend: 'opencode', account: 'location', status: 'no Console workspace', windows: [] },
    { ...base, backend: 'opencode', account: 'unknown', freshness: 'unknown', status: 'no Console workspace', windows: [] }]
  s.errors = ['codex refresh failed']
  const $ = { process: { run: async () => ({ stdout: JSON.stringify(s), exitCode: 0, isStdoutTruncated: false }) } } as unknown as EngineInterface
  const { quotas } = await scanQuotas($)
  expect(quotas.map(q => q.account)).toEqual(['01', '02', 'unknown'])
  expect(quotaDetails(quotas[0]!, 0)).toEqual(['Weekly: 50% left'])
  expect(quotaDetails(quotas[1]!, 0)).toEqual(['Weekly: 50% left', 'Refresh unavailable'])
  expect(quotaLines(quotas.slice(0, 2), 120)).toHaveLength(1)
  expect(quotaLines(quotas.slice(0, 2), 120)[0]).toContain('02')
})

test('an elapsed Claude window stays visibly unknown beside its valid weekly reading', async () => {
  const s = snapshot()
  s.quotas = [{ backend: 'claude', account: '01', plan: null, active: true, status: null,
    freshness: 'stale', windows: [{ label: 'h', remaining_percent: null, resets: '2026-10-26T00:00:00Z' },
      { label: 'w', remaining_percent: 20, resets: null }] }]
  const { quotas } = await scanQuotas(engine(s).$)
  expect(quotas[0]?.parts[0]?.pct).toBeNull()
  expect(quotaText(quotas[0]!)).toContain('◆01*~ h? w20%')
  expect(quotaGroups(quotas)[0]).toMatchObject({ text: 'h? w20', low: false })
  const zero = { ...quotas[0]!, account: '02', active: false,
    parts: [{ label: 'h', pct: 0, resets: null }, { label: 'w', pct: 20, resets: null }] }
  const text = quotaLines([{ ...quotas[0]!, active: false }, zero], 120).join(' ')
  expect(text).toContain('◆01~ h?')
  expect(text).toContain('◆02~ h0%')
})

test('nullable quota windows still reject out-of-range, coerced and non-finite values', () => {
  const s = snapshot()
  s.quotas = [{ backend: 'claude', account: '01', plan: null, active: false, status: null,
    freshness: 'stale', windows: [{ label: 'h', remaining_percent: null, resets: null }] }]
  const source = JSON.stringify({ ...s, errors: [] })
  for (const remaining of ['-1', '101', 'true', '"20"', '0.5', 'Infinity', 'NaN']) {
    expect(readAccountSnapshot(source.replace('"remaining_percent":null', `"remaining_percent":${remaining}`))).toBeUndefined()
  }
})

test('compact durations come from native minutes and retain full source labels', async () => {
  const s = snapshot()
  s.quotas = [{ backend: 'codex', account: '01', plan: 'unrecognized plan', active: true, status: null,
    freshness: 'fresh', source: 'native account cache', windows: [
      { label: '7d', remaining_percent: 40, resets: null, window_minutes: 10080, source_window: 'primary' },
      { label: '30d', remaining_percent: 70, resets: null, window_minutes: 43200, source_window: 'secondary' },
      { label: 'custom', remaining_percent: 80, resets: null, window_minutes: 240 },
      { label: 'unmeasured', remaining_percent: null, resets: null, window_minutes: null },
    ] }]
  const { quotas: rows } = await scanQuotas(engine(s).$)
  expect(rows[0]?.parts.map(p => p.label)).toEqual(['w', 'm', '4h', 'unmeasured'])
  expect(quotaDetails(rows[0]!, 0).join(' ')).not.toContain('10080 minutes')
  expect(quotaDetails(rows[0]!, 0).join(' ')).not.toContain('native account cache')
})

test('native AGY pools have compact distinct labels and full names for hover', async () => {
  const s = snapshot()
  s.quotas = [{ backend: 'agy', account: 'a1', plan: null, active: false, status: null,
    freshness: 'fresh', windows: [
      { label: 'gemini-weekly', remaining_percent: 40, resets: null, window_minutes: 10080,
        source_window: 'weekly', pool_id: 'gemini-weekly', group: 'Gemini Models', limit: 'Weekly Limit Remaining' },
      { label: '3p-weekly', remaining_percent: 70, resets: null, window_minutes: 10080,
        source_window: 'weekly', pool_id: '3p-weekly', group: 'Claude and GPT models', limit: 'Weekly Limit Remaining',
        scope_kind: 'model membership unknown' },
    ] }]
  const { quotas: rows } = await scanQuotas(engine(s).$)
  expect(rows[0]?.parts.map(p => p.label)).toEqual(['G.w', '3p.w'])
  expect(quotaDetails(rows[0]!, 0).join(' ')).not.toContain('model membership unknown')
  expect(quotaGroups(rows)[0]?.text).toBe('G.w40 3p.w70')
})

test('colliding compact pool names expand across accounts instead of merging identities', async () => {
  const s = snapshot()
  s.quotas = ['gemini-weekly', 'G-weekly'].map((pool, i) => ({ backend: 'agy', account: `a${i + 1}`,
    plan: null, active: false, status: null, freshness: 'fresh', windows: [
      { label: pool, remaining_percent: 40, resets: null, window_minutes: 10080,
        source_window: 'weekly', pool_id: pool },
    ] }))
  const { quotas: rows } = await scanQuotas(engine(s).$)
  expect(rows[0]?.parts[0]?.label).toContain('gemini-weekly')
  expect(rows[1]?.parts[0]?.label).toContain('G-weekly')
  expect(rows[0]?.parts[0]?.label === rows[1]?.parts[0]?.label).toBe(false)
  expect(quotaGroups(rows).length).toBe(2)
})

test('display metadata rejects invalid durations and terminal controls', () => {
  for (const minutes of [-1, 0, 0.5, true, '10080']) {
    const s = snapshot()
    const q = { backend: 'codex', account: '01', plan: null, active: true, status: null,
      freshness: 'fresh', windows: [{ label: 'w', remaining_percent: 20, resets: null, window_minutes: minutes }] }
    expect(readAccountSnapshot(JSON.stringify({ ...s, quotas: [q], errors: [] }))).toBeUndefined()
  }
  const s = snapshot()
  const q = { backend: 'agy', account: 'a1', plan: null, active: false, status: null,
    freshness: 'fresh', windows: [{ label: 'w', remaining_percent: 20, resets: null, pool_id: 'pool\x1b[31m' }] }
  expect(readAccountSnapshot(JSON.stringify({ ...s, quotas: [q], errors: [] }))).toBeUndefined()
})

test('modelTier reads the family, not the version or the effort', () => {
  expect(['gpt-6-luna', 'gpt-6.1-terra', 'gpt-7-sol', 'gpt-6-astra', 'gpt-6-mini'].map(m => modelTier('codex', m))).toEqual([1, 2, 3, 4, 2])
  expect(['claude-haiku-5', 'claude-sonnet-5-5-high', 'opus', 'claude-fable-5', 'gemini-3-flash', 'gemini-3-pro-low', 'argon-high', '', 'mystery'].map(m => modelTier('agy', m))).toEqual([1, 2, 3, 4, 1, 2, 3, 2, 2])
  expect(['claude-opus-5-5-medium', 'claude-sonnet-5', 'gemini-4-argon', 'gemini-3-flash'].map(makerOf)).toEqual(['claude', 'claude', undefined, undefined]) // Claude inside agy wears its pink
})

test('modelTier reads an OpenCode model by its size word; free never counts, unknown is mid', () => {
  const ids = ['opencode/nemotron-3-ultra-free', 'opencode/glm-5.3-flash-free', 'openrouter/google/gemma-4-31b-it:free', 'openrouter/meta-llama/llama-4-405b-instruct', 'opencode-go/qwen4-coder-plus', 'opencode/mistral-small-4', 'opencode/claude-opus-5', 'opencode-go/minimax-m3']
  expect(ids.map(m => modelTier('opencode', m))).toEqual([3, 1, 2, 3, 2, 1, 3, 2])
  expect(['opencode/nemotron-3-super', 'opencode/nemotron-3-super-free', 'openrouter/x/nemotron-3-super:free'].map(m => modelTier('opencode', m))).toEqual([2, 2, 2])
  expect(modelTier('opencode', 'openrouter/vendor/claude-fable-pro')).toBe(4)
  expect(modelTier('agy', 'openrouter/x/kimi-k3-pro')).toBe(3) // the id alone marks it, whichever backend
  expect(jobLabel('opencode', 'openrouter/google/gemma-4-31b-it:free', '')).toEqual({ model: 'gemma-4-31b-it', effort: '' })
})
