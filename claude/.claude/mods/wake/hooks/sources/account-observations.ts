/** Decode the independent account reader's wire contract once. */
import { rfc3339 } from './wire'
export type QuotaWindow = {
  label: string; remaining_percent: number | null; resets: string | null
  group?: string; limit?: string; window_minutes?: number | null; source_window?: string | null; pool_id?: string | null; scope_kind?: string | null
}
export type Quota = {
  backend: string; account: string; plan: string | null; active: boolean; status: string | null
  freshness: 'fresh' | 'stale' | 'unknown'; source?: string | null; observed_at?: string | null
  refresh_status?: string | null; last_refresh_status?: string | null; last_refresh_at?: string | null; windows: QuotaWindow[]
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => typeof v === 'string' && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v)
const nullable = (v: unknown) => v === null || text(v)
const optionalText = (v: unknown) => v === undefined || nullable(v)

export function validQuota(q: unknown): q is Quota {
  return object(q) && text(q.backend) && text(q.account) && nullable(q.plan) && nullable(q.status)
    && optionalText(q.source) && (q.observed_at === undefined || q.observed_at === null || rfc3339(q.observed_at)) && optionalText(q.refresh_status)
    && optionalText(q.last_refresh_status) && (q.last_refresh_at === undefined || q.last_refresh_at === null || rfc3339(q.last_refresh_at))
    && ['fresh', 'stale', 'unknown'].includes(q.freshness as string) && typeof q.active === 'boolean'
    && Array.isArray(q.windows) && q.windows.every(w => object(w) && text(w.label)
      && (w.remaining_percent === null || Number.isSafeInteger(w.remaining_percent)
        && (w.remaining_percent as number) >= 0 && (w.remaining_percent as number) <= 100) && nullable(w.resets)
      && (w.group === undefined || text(w.group)) && (w.limit === undefined || text(w.limit))
      && optionalText(w.source_window) && optionalText(w.pool_id) && optionalText(w.scope_kind)
      && (w.window_minutes === undefined || w.window_minutes === null
        || Number.isSafeInteger(w.window_minutes) && (w.window_minutes as number) > 0))
}

export function readAccountSnapshot(source: string): { quotas: Quota[]; errors: string[] } | undefined {
  try {
    const value: unknown = JSON.parse(source)
    if (!object(value) || value.schema_version !== 1 || !Array.isArray(value.quotas)
      || !value.quotas.every(validQuota) || !Array.isArray(value.errors) || !value.errors.every(text)
      || !rfc3339(value.generated_at)) return undefined
    return { quotas: value.quotas, errors: value.errors as string[] }
  } catch { return undefined }
}
