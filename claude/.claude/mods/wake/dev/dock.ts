// bun dev/dock.ts [out.bin] [frames] [width]: the README's beach dock scene over `frames` animation frames (raw
// uint32 0xRRGGBB, width x SCENE_H each) plus out.json: per frame, where each thing the legend names is (its bounding box in
// cells, read from the scene's own hover map) and the crew rows under the scene as the real builders draw them while two
// workers message each other and the root.
import { arcCells, sceneFrame, scenePixels, type SceneInput } from '../hooks/scene.ts'
import { SCENE_H } from '../hooks/landscapes/kit.ts'
import { CLASS_GLYPH, cells, crewRows, harnessSpin, packetWindow, quotaRows, rootSpine, type RootLink } from '../hooks/crew-row.ts'
import { LOGOS } from '../hooks/logos.ts'
import type { WakeChip, WakeQuota } from '../types'

const out = process.argv[2] ?? `${import.meta.dir}/dock.bin`
const FRAMES = Number(process.argv[3] ?? 48)
const STEP = 3
const MS_PER_TICK = 50 // the scene redraws at 20 frames a second
const LOOP_MS = FRAMES * STEP * MS_PER_TICK
const W = Number(process.argv[4] ?? 117) // x12 = 1404 px, the width of the 156-column status line at 9 px a cell
const TEXT_COLUMNS = Math.round(W * 12 / 9)
const H = SCENE_H
const K = ['read', 'read', 'read', 'search', 'edit', 'run', 'test', 'read', 'edit', 'agent', 'web', 'edit'] as const
const turns = Array.from({ length: 16 }, (_, i) => ({ turn: i + 1, kinds: K.slice(0, 2 + ((i * 7) % 11)).concat(i % 5 === 2 ? ['fail'] : []) as any }))
const state: SceneInput = {
  width: W, frame: 0, hour: 17.0, sun: { rise: 5.9, set: 17.5 }, moonPhase: 0.3, season: 'summer', snowy: false,
  weather: { cloud: 0.2, rain: 0, snow: 0, fog: false, thunder: false, wind: 8 },
  preset: 'beach', seed: 12345, turns, live: { turn: 17, kinds: ['read', 'read', 'edit', 'test', 'edit'] }, mood: 'work',
  jobs: [
    { isStale: false, seed: 3, tier: 2, kind: 'codex', lift: 0, hit: { id: 'parser', title: 'parser', details: [] } },
    { isStale: false, seed: 8, tier: 3, kind: 'agy', lift: 0, hit: { id: 'review', title: 'review', details: [] } },
  ],
  agents: [{ seed: 1, tier: 2, hit: { id: 'explore', title: 'Explore', details: [] } }], plan: { done: 3, total: 5 }, effect: null,
}

// ── the conversation: parser messages review every 2.4 s, and review reports to the root once a loop (at 3.6 s) ─────────────────
const ROOT_AT = 3_600
const msAt = (i: number) => i * STEP * MS_PER_TICK
const sinceParser = (ms: number) => ms % 2_400
const sinceRoot = (ms: number) => (ms - ROOT_AT + LOOP_MS) % LOOP_MS
const talking = (i: number): Partial<SceneInput> => {
  const ms = msAt(i)
  return {
    peerEdges: [
      { source: 'parser', target: 'review', strength: 0.9, preview: 'x', count: 1, family: 'codex', arriving: sinceParser(ms), fresh: 1 },
      { source: 'review', target: 'mochi', strength: 0.8, preview: 'x', count: 1, family: 'agy', messageState: 'observed', arriving: sinceRoot(ms) <= packetWindow(1) ? sinceRoot(ms) : undefined, fresh: 1 },
      { source: 'mochi', target: 'parser', strength: 0.4, preview: 'working for the root', count: 1, family: 'codex' },
    ],
  }
}

// ── the crew rows come from the real builders, with demo workers and accounts ────────────────────────────────────────────────────
const NOW0 = 600_000
const chip = (id: string, title: string, backend: string, model: string, effort: string, levels: string[], since: number, peers: NonNullable<WakeChip['peers']>): WakeChip =>
  ({ id, name: id, title, backend, account: '01', model, effort, effortLevels: levels, running: true, isStale: false, since, lastEventAt: since, memoryBytes: 1.4e9, memoryCap: '4G', peers })
const message = (target: string, outgoing: boolean, now: number, since: number, extra: object = {}) =>
  ({ target, count: 1, lastAt: now - since, observedAt: now - since, outgoing, fresh: 1, preview: 'x', ...extra })
const crewAt = (ms: number): WakeChip[] => {
  const now = NOW0 + ms
  return [
    chip('parser', 'Parser fix', 'codex', 'gpt-6.1-sol', 'high', ['low', 'medium', 'high', 'xhigh'], now - 190_000, [message('review', true, now, sinceParser(ms))]),
    chip('review', 'Visual review', 'agy', 'claude-opus-5-5', 'high', ['low', 'medium', 'high'], now - 130_000, [message('parser', false, now, sinceParser(ms)), message('root', true, now, sinceRoot(ms), { messageState: 'observed' })]),
  ]
}
const toRoot = (job: WakeChip, now: number): RootLink | undefined => {
  const peer = (job.peers ?? []).find(p => p.target === 'root' && now >= p.lastAt)
  if (peer) return { dir: peer.outgoing ? 'out' : 'in', family: job.backend, at: peer.lastAt, count: peer.count, observedAt: peer.observedAt, fresh: peer.fresh, description: [] }
  return { dir: 'tether', family: job.backend, at: now, count: 1, activeAt: job.lastEventAt, description: [] }
}
// the same geometry as the band's rows: the graph's column leans right, and the rows end at it
const rowWidth = TEXT_COLUMNS - 2
const rowBoxOf = (jobs: WakeChip[], now: number) => {
  const natural = Math.max(
    ...crewRows(jobs, now, rowWidth - 7).map(row => 9 + cells(row.title) + cells(row.detail) + 8),
    5 + cells('Explore') + 24,
  )
  return rowWidth >= 80 ? Math.min(rowWidth, Math.max(Math.round(rowWidth * 0.58), natural + 3) + 4) : rowWidth
}
const rowBox = rowBoxOf(crewAt(0), NOW0)
const rowsAt = (i: number) => {
  const ms = msAt(i), now = NOW0 + ms
  const jobs = crewAt(ms)
  const links: (RootLink | undefined)[] = [
    { dir: 'tether', family: 'claude', at: now, count: 1, description: [] }, // the native subagent
    ...jobs.map(job => toRoot(job, now)),
  ]
  const spine = rootSpine(links, now)
  const rows = crewRows(jobs, now, rowBox - 7)
  return [
    { kind: 'native', backend: 'claude', title: 'Explore', mark: CLASS_GLYPH[1], glyph: '', spin: harnessSpin('claude', i), beat: 0, effort: { lit: 2, total: 3 }, after: ' 1m', gutter: [], cell: spine[0]! },
    ...rows.map((row, k) => ({
      kind: 'bridge', backend: jobs[k]!.backend, title: row.title, mark: [...row.family][1] ?? '', glyph: row.glyph, spin: harnessSpin(jobs[k]!.backend, i), beat: row.beat,
      effort: row.effortSlot ? { lit: row.effortSlot.lit, total: row.effortSlot.total, before: row.effortSlot.before, size: row.effortSlot.size, after: row.effortSlot.after } : null,
      detail: row.detail, gutter: row.gutter.slice(0, row.rootAt ?? row.gutter.length), cell: spine[k + 1]!,
    })),
  ]
}
const quota = (cli: WakeQuota['cli'], account: string, active: boolean, h: number, w: number): WakeQuota =>
  ({ cli, account, plan: '', active, freshness: 'fresh', parts: [{ label: 'h', pct: h, resets: null }, { label: 'w', pct: w, resets: null }] })
const accounts = [
  quota('codex', '01', true, 71, 90), quota('codex', '02', false, 34, 77), quota('codex', '03', false, 62, 88),
  quota('agy', 'a1', true, 99, 98), quota('agy', 'a2', false, 100, 100), quota('claude', 'c1', true, 88, 64),
]
const quotaLine = quotaRows(accounts, TEXT_COLUMNS - 6).flat().map(chunk => ({ text: chunk.text, cli: chunk.quotas[0]!.cli, percents: chunk.quotas[0]!.parts.map(p => p.pct) }))

// ── where each thing the legend names is: its hover owner's cells, a box per group of cells within 2 columns of each other ──────
type Box = { x: number; y: number; w: number; h: number }
function boxes(hits: ReturnType<typeof sceneFrame>['hits'], id: string, gap = 2): Box[] {
  const owner = hits.targets.findIndex(target => target.id === id) + 1
  const points: [number, number][] = []
  hits.owners.forEach((o, i) => { if (owner && o === owner) points.push([i % hits.columns, Math.floor(i / hits.columns) * 2]) })
  points.sort((p, q) => p[0] - q[0])
  const groups: [number, number][][] = []
  for (const point of points) {
    const last = groups[groups.length - 1]
    if (last && point[0] - last[last.length - 1]![0] <= gap) last.push(point)
    else groups.push([point])
  }
  return groups.map(g => {
    const xs = g.map(p => p[0]), ys = g.map(p => p[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 2 }
  })
}
/** One box per group of changed pixels whose columns lie within 2 of each other: the lit lamps, found by removing the plan. */
function changed(a: Uint32Array, b: Uint32Array): Box[] {
  const hit: [number, number][] = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) hit.push([i % W, (i / W) | 0])
  hit.sort((p, q) => p[0] - q[0])
  const groups: [number, number][][] = []
  for (const point of hit) {
    const last = groups[groups.length - 1]
    if (last && point[0] - last[last.length - 1]![0] <= 2) last.push(point)
    else groups.push([point])
  }
  return groups.map(g => {
    const xs = g.map(p => p[0]), ys = g.map(p => p[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 }
  })
}
/** The comet between the two workers while a message flies (its head, run at the trail's own pace), else the middle of the arc. */
function trailMark(hits: ReturnType<typeof sceneFrame>['hits'], arriving: number): Box | null {
  const [from] = boxes(hits, IDS.codex!), to = boxes(hits, IDS.agy!, 6)[0]
  if (!from || !to) return null
  const arc = arcCells({ x: from.x + (from.w >> 1), y: Math.max(0, (from.y & ~1) - 1) }, { x: to.x + (to.w >> 1), y: Math.max(0, (to.y & ~1) - 1) }, W, H, 0)
  const tail = Math.max(5, Math.min(12, arc.length * 0.25)) // the trail's own fade length, as drawTrails has it
  const head = arriving <= packetWindow(1) ? Math.min(arc.length - 1, Math.floor((arriving / 1_400) * (arc.length + 4 * tail))) : arc.length >> 1
  const at = arc[head]
  return at === undefined ? null : { x: (at % W) - 1, y: Math.floor(at / W) - 1, w: 3, h: 3 }
}
const IDS: Record<string, string> = { codex: 'parser', agy: 'review', claude: 'explore', live: 'turn:17', mochi: 'mochi', lamps: 'plan-lamps' }

// start where the subagent's bird stays on screen for the whole loop, so its callout never blinks out
const seen = (frame: number) => boxes(sceneFrame({ ...state, frame }).hits, IDS.claude!).length > 0
let start = 0
while (start < 600 && !Array.from({ length: FRAMES }, (_, i) => start + i * STEP).every(seen)) start++

const pixels = new Uint32Array(FRAMES * W * H)
const anchors: Record<string, Box[]>[] = []
const rows: ReturnType<typeof rowsAt>[] = []
for (let i = 0; i < FRAMES; i++) {
  const at = { ...state, frame: start + i * STEP }
  const talk = { ...at, ...talking(i) }
  pixels.set(scenePixels(talk), i * W * H)
  rows.push(rowsAt(i))
  const hits = sceneFrame(at).hits
  const trail = trailMark(hits, sinceParser(msAt(i)))
  anchors.push({
    ...Object.fromEntries(Object.entries(IDS).map(([name, id]) => [name, boxes(hits, id, name === 'agy' ? 6 : 2)])),
    lamps: changed(scenePixels(at), scenePixels({ ...at, plan: null })), // lit lamps are the steps done; without a plan they only light at night
    trail: trail ? [trail] : [],
  })
}
await Bun.write(out, pixels)
await Bun.write(out.replace(/\.bin$/, '.json'), JSON.stringify({
  w: W, h: H, frames: FRAMES, anchors, rows, rowBox, textColumns: TEXT_COLUMNS, quota: quotaLine, logos: LOGOS,
}))
console.log(out, FRAMES, 'frames', W, 'x', H)
