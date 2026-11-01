import type { EngineInterface } from 'claude-code'

/**
 * Which effort levels each model really offers, inferred from the native inventory (`model-guide models --json`),
 * never a fixed scale: Codex models run low..ultra, Claude low..max, an Antigravity Gemini only low..high (its level is
 * part of the model ID, so sibling IDs give the scale), and some OpenCode models a few levels or none known.
 */
export type EffortLevels = Record<string, Record<string, string[]>> // backend -> model id -> levels, weakest first

const ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const BACKENDS = ['codex', 'claude', 'agy', 'opencode'] as const

/** Strictly decode one backend's inventory; an unexpected shape yields nothing rather than a guess. */
export function readInventory(backend: string, stdout: string): Record<string, string[]> {
  const value: unknown = JSON.parse(stdout)
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { models?: unknown }).models)) return {}
  const out: Record<string, string[]> = {}
  const suffixed = new Map<string, string[]>() // agy: gemini-3.8-flash-high -> base gemini-3.8-flash, level high
  for (const row of (value as { models: unknown[] }).models) {
    if (typeof row !== 'object' || row === null) continue
    const { id, efforts } = row as { id?: unknown; efforts?: unknown }
    if (typeof id !== 'string' || !id) continue
    if (Array.isArray(efforts) && efforts.length && efforts.every(e => typeof e === 'string' && ORDER.includes(e))) {
      out[id] = [...(efforts as string[])].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
      continue
    }
    const match = /^(.*)-(minimal|low|medium|high|xhigh|max|ultra)$/.exec(id)
    if (backend === 'agy' && match) suffixed.set(match[1]!, [...(suffixed.get(match[1]!) ?? []), match[2]!])
  }
  for (const [base, levels] of suffixed) {
    const sorted = [...new Set(levels)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
    out[base] = sorted
    for (const level of sorted) out[`${base}-${level}`] = sorted
  }
  return out
}

/** Ask the inventory for each backend in use; a backend that fails keeps its last known levels. */
export async function scanEfforts($: EngineInterface, backends: readonly string[], previous: EffortLevels): Promise<EffortLevels> {
  const next: EffortLevels = { ...previous }
  for (const backend of backends.filter((b): b is (typeof BACKENDS)[number] => (BACKENDS as readonly string[]).includes(b))) {
    const result = await $.process.run(['model-guide', 'models', '--backend', backend, '--json'], { timeoutMs: 60_000 }).catch(() => undefined)
    if (result?.exitCode !== 0 || result.isStdoutTruncated) continue
    try {
      const levels = readInventory(backend, result.stdout)
      if (Object.keys(levels).length) next[backend] = levels
    } catch { /* malformed output: keep what we had */ }
  }
  return next
}

/** The levels for one job's model: exact ID, else the native alias family it belongs to (claude-opus-5-5 -> opus). */
export function levelsFor(all: EffortLevels, backend: string, model: string): string[] | undefined {
  const table = all[backend]
  if (!table || !model) return undefined
  if (table[model]) return table[model]
  const lower = model.toLowerCase()
  const alias = Object.keys(table).find(id => !id.includes('/') && /^[a-z]+$/.test(id) && lower.split(/[^a-z]+/).includes(id))
  return alias ? table[alias] : undefined
}

/** A meter on the model's own scale: one dot per level it offers, lit up to the chosen one. Unknown scale: undefined. */
export function effortDots(effort: string, levels: string[] | undefined): string | undefined {
  if (!levels?.length) return undefined
  const at = levels.indexOf(effort.toLowerCase())
  if (at < 0) return undefined
  return '●'.repeat(at + 1) + '○'.repeat(levels.length - at - 1)
}
