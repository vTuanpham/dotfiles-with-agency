import type { EngineInterface } from 'claude-code'
import type { WakeQuota } from '../../types'

import { readAccountSnapshot } from './account-observations'
import type { QuotaWindow } from './account-observations'

function durationLabel(minutes: number | null | undefined): string | undefined {
  if (minutes == null) return undefined
  if (minutes === 300) return 'h'
  if (minutes === 10080) return 'w'
  if (minutes === 43200) return 'm'
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}min`
}

function compactLabel(w: QuotaWindow): string {
  const duration = durationLabel(w.window_minutes)
  if (!w.pool_id) return duration ?? w.label
  const suffix = w.source_window ? '-' + w.source_window.replaceAll('_', '-') : ''
  const pool = suffix && w.pool_id.length > suffix.length && w.pool_id.endsWith(suffix)
    ? w.pool_id.slice(0, -suffix.length) : w.pool_id
  return `${pool === 'gemini' ? 'G' : pool}.${duration ?? '?'}`
}

const windowIdentity = (w: QuotaWindow) => JSON.stringify([w.pool_id, w.source_window, w.window_minutes, w.label])

/** One display label for any bridge job: short model family + effort, whichever CLI it runs on. */
export function jobLabel(backend: string, model: string, effort: string): { model: string; effort: string } {
  if (backend === 'codex') return { model: model.replace(/^gpt-[\d.]+-/, ''), effort }
  if (backend === 'opencode') return { model: model.replace(/^.*\//, '').replace(/[:-]free$/, ''), effort } // the model, not its provider path
  const m = /^(.*?)(?:-(low|medium|high))?$/.exec(model)
  const family = ['argon', 'flash', 'opus', 'sonnet'].find(f => model.includes(f)) ?? (m?.[1] ?? model)
  return { model: family, effort: effort || (m?.[2] ?? '') }
}

/** Model class by family; unknown is mid. Trailing effort words never count. */
export type Tier = 1 | 2 | 3 | 4
const FAMILY: Record<string, Tier> = { luna: 1, terra: 2, sol: 3, astra: 4, haiku: 1, sonnet: 2, opus: 3, fable: 4, flash: 1, pro: 2, argon: 3 }
const CODEX_FAMILY = ['luna', 'terra', 'sol', 'astra']
// OpenCode serves any provider's models (ids like opencode/<m>, opencode-go/<m>, openrouter/<org>/<m>:free): read the size
// word first (':free' is no size), then a known family name, else mid
const OPEN_SIZE: Record<string, Tier> = {
  ultra: 3, max: 3, large: 3, pro: 3, '550b': 3, '405b': 3,
  super: 2, medium: 2, plus: 2,
  flash: 1, lightning: 1, mini: 1, nano: 1, lite: 1, small: 1,
}
export function modelTier(backend: string, model: string): Tier {
  if (backend === 'opencode' || /^(opencode(-go)?|openrouter)\//.test(model)) {
    const family = model.toLowerCase().split(/[^a-z]+/).find(n => ['luna', 'terra', 'sol', 'astra', 'haiku', 'sonnet', 'opus', 'fable'].includes(n))
    if (family) return FAMILY[family]!
    const size = model.toLowerCase().split(/[^a-z0-9]+/).find(n => Object.hasOwn(OPEN_SIZE, n))
    if (size) return OPEN_SIZE[size]!
  }
  const names = model.toLowerCase().split(/[^a-z]+/)
  const family = names.find(n => Object.hasOwn(FAMILY, n) && (backend !== 'codex' || CODEX_FAMILY.includes(n)))
  return family ? FAMILY[family]! : 2
}

/** Whose model a job runs, when that maker has a crew family of its own: a Claude model inside agy wears Claude's pink. */
export const makerOf = (model: string): 'claude' | undefined => (/\b(claude|fable|opus|sonnet|haiku)\b/.test(model.toLowerCase()) ? 'claude' : undefined)

/** Consecutive accounts of one CLI with the same numbers fold into one group, so four idle free accounts read once. */
export function quotaGroups(quotas: WakeQuota[]): { cli: WakeQuota['cli']; accounts: string[]; text: string; low: boolean; bad: boolean }[] {
  const out: ReturnType<typeof quotaGroups> = []
  for (const q of quotas) {
    const text = q.status ?? q.parts.map(p => `${p.label}${p.pct ?? '?'}`).join(' ')
    const name = q.account + (q.active ? '*' : '')
    const last = out.at(-1)
    if (last && last.cli === q.cli && last.text === text) last.accounts.push(name)
    else out.push({ cli: q.cli, accounts: [name], text, low: q.parts.some(p => p.pct !== null && p.pct < 20), bad: q.status !== undefined })
  }
  return out
}

/**
 * This session's own rate-limit windows, as the engine pushes them, applied to the active Claude account's row.
 * The session runs on the active login, so no process or lookup is needed; a window the row does not show is left alone.
 */
export function applyMeasured(quotas: WakeQuota[], measured: readonly { kind: string; percentUsed: number; resetsAt?: string }[], now: string): WakeQuota[] {
  const label: Record<string, string> = { five_hour: 'h', seven_day: 'w' }
  const windows = measured.filter(m => label[m.kind] !== undefined && Number.isFinite(m.percentUsed))
  if (!windows.length) return quotas
  return quotas.map(q => {
    if (q.cli !== 'claude' || !q.active || q.status !== undefined) return q
    const parts = q.parts.map(p => {
      const m = windows.find(w => label[w.kind] === p.label)
      return m ? { ...p, pct: Math.floor(Math.max(0, 100 - m.percentUsed)), resets: m.resetsAt ?? p.resets } : p
    })
    return JSON.stringify(parts) === JSON.stringify(q.parts) ? q : { ...q, parts, freshness: 'fresh' as const, observedAt: now }
  })
}

/** The account tool a shell command runs, if any: whatever it changes is not in the cached reading yet. */
export function accountToolBackend(command: string): WakeQuota['cli'] | undefined {
  const tool = /(?:^|[\s;&|(])(cswap|codex-auth|agy-auth)(?=\s|$)/.exec(command)?.[1]
  return tool === 'cswap' ? 'claude' : tool === 'codex-auth' ? 'codex' : tool === 'agy-auth' ? 'agy' : undefined
}

export async function scanQuotas($: EngineInterface): Promise<{ quotas: WakeQuota[]; errors: string[] }> {
  const result = await $.process.run(['agent-accounts', 'snapshot'], { timeoutMs: 30_000 }).catch(() => undefined)
  const snapshot = result?.exitCode === 0 && !result.isStdoutTruncated ? readAccountSnapshot(result.stdout) : undefined
  if (!snapshot) throw new Error('Account observations unavailable')
  const { quotas, errors } = snapshot
  const identities = new Map<string, Set<string>>()
  for (const q of quotas) for (const w of q.windows) {
    const key = `${q.backend}:${compactLabel(w)}`
    if (!identities.has(key)) identities.set(key, new Set())
    identities.get(key)!.add(windowIdentity(w))
  }
  return { errors, quotas: quotas.filter(q => ['codex', 'agy', 'claude', 'opencode'].includes(q.backend)
    && !(q.backend === 'opencode' && q.status === 'no Console workspace' && q.freshness === 'fresh' && !q.windows.length)).map(q => ({
    cli: q.backend as WakeQuota['cli'], account: q.account, plan: q.plan ?? '', active: q.active,
    parts: q.windows.map(w => {
      const compact = compactLabel(w)
      const duration = durationLabel(w.window_minutes)
      const period = duration && (({ h: 'five-hour', w: 'weekly', m: 'monthly' } as Record<string, string>)[duration] ?? duration)
      const label = identities.get(`${q.backend}:${compact}`)!.size > 1
        ? [w.pool_id ?? w.label, w.source_window, durationLabel(w.window_minutes)].filter(Boolean).join('/') : compact
      return { label, pct: w.remaining_percent, resets: w.resets,
        name: w.group ? `${q.backend === 'opencode' ? (w.pool_id ? 'Console budget' : 'OpenCode Go') : w.group}${period ? ` · ${period}` : ''}`
          : ({ h: 'Five-hour', w: 'Weekly', m: 'Monthly', '5h': 'Five-hour', '7d': 'Weekly', '30d': 'Monthly' } as Record<string, string>)[w.label] ?? w.label }
    }), status: q.status ?? undefined, freshness: q.freshness,
    observedAt: q.observed_at ?? undefined,
    refreshStatus: (q.last_refresh_status ?? q.refresh_status) && !['ok', 'not_requested'].includes((q.last_refresh_status ?? q.refresh_status)!)
      ? (q.last_refresh_status ?? q.refresh_status)! : undefined,
  })) }
}

/** Brief account-specific hover; the JSON snapshot keeps the full source metadata. */
export function quotaDetails(q: WakeQuota, now: number): string[] {
  const reset = (value: string) => {
    const at = Date.parse(value)
    if (!Number.isFinite(at)) return value
    const date = new Date(at)
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', ...(date.getMinutes() ? { minute: '2-digit' } : {}) })
  }
  const lines = q.parts.map(part => `${part.name ?? part.label}: ${part.pct === null ? 'unknown' : `${part.pct}% left`}${part.resets ? ` · reset ${reset(part.resets)}` : ''}`)
  if (q.status) lines.push(q.status)
  if (!lines.length) lines.push('Usage not reported')
  if (q.observedAt) {
    const at = Date.parse(q.observedAt)
    if (Number.isFinite(at)) {
      const minutes = Math.max(0, Math.floor((now - at) / 60_000))
      lines.push(`Updated ${minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`}`)
    }
  }
  if (q.refreshStatus) lines.push(q.refreshStatus === 'missing_auth' ? 'Sign-in needed' : 'Refresh unavailable')
  return lines
}
