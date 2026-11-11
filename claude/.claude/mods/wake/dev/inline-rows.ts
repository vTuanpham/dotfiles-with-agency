// The inline rows under the scene for the README renders (dock.ts, hero-rows.ts): demo workers and accounts through the real
// row builders, as JSON that docs/tools/readme_gifs.py draws (`crew_row`, `quota_segments`).
import { CLASS_GLYPH, crewLayout, harnessSpin, quotaRows, RootColumn, rootSpine, type RootLink } from '../hooks/crew-row.ts'
import type { WakeChip, WakeQuota } from '../types'

type Peers = NonNullable<WakeChip['peers']>
export const chip = (id: string, title: string, backend: string, model: string, effort: string, levels: string[], since: number, peers: Peers): WakeChip =>
  ({ id, name: id, title, backend, account: '01', model, effort, effortLevels: levels, running: true, isStale: false, since, lastEventAt: since, memoryBytes: 1.4e9, memoryCap: '4G', peers })
export const message = (target: string, outgoing: boolean, now: number, since: number, extra: object = {}) =>
  ({ target, count: 1, lastAt: now - since, observedAt: now - since, outgoing, fresh: 1, preview: 'x', ...extra })

const toRoot = (job: WakeChip, now: number): RootLink | undefined => {
  const peer = (job.peers ?? []).filter(p => p.target === 'root' && now >= p.lastAt).at(-1)
  if (peer) return { dir: peer.outgoing ? 'out' : 'in', family: job.backend, at: peer.lastAt, count: peer.count, observedAt: peer.observedAt, fresh: peer.fresh, description: [] }
  return { dir: 'tether', family: job.backend, at: now, count: 1, activeAt: job.lastEventAt, description: [] }
}

/** A native subagent's row: its own effort dots and age, no lanes. */
export type Native = { title: string; tier: 1 | 2 | 3 | 4; lit: number; total: number; age: string }

/** The crew rows, as the band lays them out at `rowWidth`, for frame `i` (the spinners' beat) at `now`; `column` eases the
 * root's graph from frame to frame as the band does (one per sequence of frames). */
export function crewRowsAt(jobs: WakeChip[], natives: Native[], now: number, i: number, rowWidth: number, column = new RootColumn()) {
  const layout = crewLayout(jobs, natives.map(n => n.title), now, rowWidth)
  const rows = layout.rows, box = column.next(layout.box, layout.snug, now)
  const links: (RootLink | undefined)[] = [
    ...natives.map(() => ({ dir: 'tether' as const, family: 'claude', at: now, count: 1, description: [] })),
    ...jobs.map(job => toRoot(job, now)),
  ]
  const spine = rootSpine(links, now)
  return {
    box,
    rows: [
      ...natives.map((n, k) => ({ kind: 'native', backend: 'claude', title: n.title, mark: CLASS_GLYPH[n.tier], glyph: '', spin: harnessSpin('claude', i), beat: 0, effort: { lit: n.lit, total: n.total }, after: ` ${n.age}`, gutter: [], cell: spine[k]! })),
      ...rows.map((row, k) => ({
        kind: 'bridge', backend: jobs[k]!.backend, title: row.title, mark: [...row.family][1] ?? '', glyph: row.glyph, spin: harnessSpin(jobs[k]!.backend, i), beat: row.beat,
        effort: row.effortSlot ? { lit: row.effortSlot.lit, total: row.effortSlot.total, before: row.effortSlot.before, size: row.effortSlot.size, after: row.effortSlot.after } : null,
        detail: row.detail, gutter: row.gutter, cell: spine[k + natives.length]!,
      })),
    ],
  }
}

// Synthetic reported windows exercise labels and remaining-allowance colours; plan names never determine their periods.
const quota = (cli: WakeQuota['cli'], account: string, plan: string, active: boolean, windows: Record<string, number>): WakeQuota =>
  ({ cli, account, plan, active, freshness: 'fresh', parts: Object.entries(windows).map(([label, pct]) => ({ label, pct, resets: null })) })
const ACCOUNTS = [
  quota('codex', '01', 'Pro', true, { w: 71 }), quota('codex', '02', 'Pro', false, { w: 34 }),
  quota('codex', '03', 'Plus', false, { h: 62, w: 88 }), quota('codex', '04', 'Plus', false, { h: 15, w: 41 }),
  quota('codex', '05', 'Free', false, { m: 57 }), quota('codex', '06', 'Free', false, { m: 8 }),
  quota('claude', '01', 'Max', true, { h: 88, w: 64 }), quota('claude', '02', 'Pro', false, { h: 45, w: 30 }),
  quota('agy', 'a1', '', true, { 'G.w': 98, '3p.w': 16 }), quota('agy', 'a2', '', false, { 'G.w': 100, '3p.w': 100 }),
  quota('opencode', '01', 'Go', true, { h: 72, w: 36 }),
]
/** The quota rows at `width` columns: each chunk's text, harness and windows. */
export const quotaLines = (width: number) => quotaRows(ACCOUNTS, width).map(line => line.map(chunk => ({
  text: chunk.text, cli: chunk.quotas[0]!.cli,
  parts: chunk.quotas[0]!.parts.map(p => ({ label: p.label, pct: p.pct === null ? null : Math.round(p.pct) })),
})))
