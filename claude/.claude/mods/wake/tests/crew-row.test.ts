import { expect, test } from 'claude-code/testing'
import { PACKET_RUN_MS, cells, crewLayout, crewJobs, crewPage, crewRows, messageFade, quotaLines, quotaRows, quotaText, STATE_GLYPHS, stateOf } from '../hooks/crew-row'
import type { WakeChip } from '../types'

const base: WakeChip = { name: 'worker', title: 'Inspect 長い👩‍💻 worker title', backend: 'codex', account: '01', model: 'gpt-6.1-terra', effort: 'high', running: true, isStale: false, since: 0, lastEventAt: 10_000, memoryBytes: 512 * 1024 ** 2, memoryCap: '1G' }

test('bounded crew pages cover every worker and clamp a stale page after workers leave', () => {
  for (const total of [2, 10, 100]) for (const room of [2, 3, 5]) {
    if (total <= room) { expect(crewPage(total, room, 0)).toBeNull(); continue }
    const first = crewPage(total, room, 0)!
    const members = Array.from({ length: first.pages }, (_, page) => crewPage(total, room, page)!)
      .flatMap(({ start, end }) => Array.from({ length: end - start }, (_, i) => start + i))
    expect(members).toEqual(Array.from({ length: total }, (_, i) => i))
    expect(crewPage(total, room, 999)!.page).toBe(first.pages - 1)
  }
  expect(crewPage(100, 1, 0)).toBeNull()
})

test('peer trace pulses briefly, then fades and reports only actual previews', () => {
  const jobs: WakeChip[] = [
    { ...base, id: 'a', name: 'Alice', peers: [{ target: 'b', count: 1, lastAt: 10_000, observedAt: 10_000, outgoing: true, preview: 'Reviewing tests' }] },
    { ...base, id: 'b', name: 'Bob' },
  ]
  const trace = (now: number) => crewRows(jobs, now, 120)[0]!.gutter[0]!
  expect(trace(10_000).description).toEqual(['Alice → Bob', 'Reviewing tests'])
  expect(trace(10_400).strength).toBeGreaterThan(trace(10_000).strength)
  expect(trace(20_000).strength).toBeGreaterThan(trace(300_000).strength)
  expect(trace(300_000).strength).toBeGreaterThan(trace(800_000).strength)
  expect(crewRows(jobs, 9_999, 120)[0]!.gutter).toHaveLength(0)
  expect(crewRows(jobs, 910_001, 120)[0]!.gutter).toHaveLength(0)
  jobs[0]!.peers![0]!.preview = null
  expect(trace(10_000).description).toContain('Preview withheld by Bridge')
  jobs[0]!.peers![0]!.preview = undefined
  expect(trace(10_000).description).toContain('Message preview unavailable')
})

test('a completed peer remains an inline graph endpoint until its recorded exchange expires', () => {
  const now = 100_000
  const jobs: WakeChip[] = [
    { ...base, id: 'owner/live', title: 'Live worker', peers: [
      { target: 'owner/done', count: 16, lastAt: now, outgoing: true },
    ] },
    { ...base, id: 'owner/done', title: 'Completed worker', running: false, awaitingRoot: false },
    { ...base, id: 'owner/unrelated', running: false, awaitingRoot: false },
  ]
  const visible = crewJobs(jobs, now)
  expect(visible.map(job => job.id)).toEqual(['owner/live', 'owner/done'])
  const rows = crewLayout(visible, [], now, 190, false).rows
  expect(rows[0]!.gutter[0]!.text).toContain('═┐')
  expect(rows[1]!.gutter[0]!.text).toContain('←┘')
  expect(rows.every(row => !row.columns.includes('peers'))).toBe(true)
  expect(crewJobs(jobs, now + 900_001).map(job => job.id)).toEqual(['owner/live'])
})

test('a packet crosses the lane once per arriving message, sender to recipient, then the lane rests', () => {
  // seen at t=0: `fresh` messages arrived together
  const peers = (fresh: number, observedAt: number | undefined) => [{ target: 'd', count: 6, lastAt: 0, outgoing: true, observedAt, fresh }]
  const jobs = (fresh: number, observedAt: number | undefined = 0): WakeChip[] => ['a', 'b', 'c', 'd'].map((id, i) => ({ ...base, id, name: id.toUpperCase(), peers: i === 0 ? peers(fresh, observedAt) : [] }))
  const unseen = (): WakeChip[] => ['a', 'b', 'c', 'd'].map((id, i) => ({ ...base, id, name: id.toUpperCase(), peers: i === 0 ? peers(1, undefined) : [] }))
  const flows = (now: number, list = jobs(1)) => crewRows(list, now, 120).map(row => row.gutter[0]!.flow)
  // the single message's packet visits the rows in order a, b, c, d
  const heads = [0, 300, 600, 900, 1_200].map(t => flows(t).indexOf(Math.max(...flows(t))))
  expect(heads.every((row, i) => i === 0 || row >= heads[i - 1]!)).toBe(true)
  expect(new Set(heads).size).toBeGreaterThan(2)
  // ...and then nothing moves: no loop, however recent the conversation still is
  for (const t of [PACKET_RUN_MS + 50, 5_000, 60_000, 600_000]) expect(Math.max(...flows(t))).toBe(0)
  // three messages arriving together send three packets a beat apart, so motion lasts longer
  const moving = (list: WakeChip[]) => Array.from({ length: 60 }, (_, k) => k * 50).filter(t => Math.max(...flows(t, list)) > 0).length
  expect(moving(jobs(3))).toBeGreaterThan(moving(jobs(1)))
  // history this view never saw arrive does not move at all, nor does a lane that only waits on a peer
  expect(Array.from({ length: 30 }, (_, k) => Math.max(...flows(k * 100, unseen()))).every(flow => flow === 0)).toBe(true)
  for (const flow of flows(400, jobs(5))) expect(flow).toBeLessThanOrEqual(1)
})

test('root markers appear only for recorded messages and distinguish Bridge observation from delivery', () => {
  const now = 100_000
  const plain = crewRows([{ ...base, id: 'owner/job' }], now, 120)[0]!
  expect(plain.gutter).toEqual([])
  expect(plain.columns).not.toContain('peers')

  const job = {
    ...base,
    id: 'owner/job',
    peers: [
      { target: 'root', count: 1, lastAt: now, observedAt: now, outgoing: true, messageId: 'out', messageState: 'observed' as const, preview: null },
      { target: 'root', count: 1, lastAt: now, observedAt: now, outgoing: false, messageId: 'in', messageState: 'sent' as const, preview: 'Review this result' },
    ],
  }
  const rows = crewRows([job], now, 120)
  expect(rows[0]!.gutter.map(mark => mark.text)).toEqual(['↗r ', '↙r '])
  expect(rows[0]!.columns).not.toContain('peers')
  expect(rows[0]!.gutter[0]!.description).toEqual([
    'Worker → root', 'Worker report published', 'Preview withheld by Bridge',
  ])
  expect(rows[0]!.gutter[1]!.description).toEqual([
    'Root → worker', 'Message sent by Bridge', 'Review this result',
  ])
  expect(rows[0]!.gutter[0]!.strength).toBe(0.65)
  expect(crewRows([job], now + 400, 120)[0]!.gutter[0]!.strength).toBeGreaterThan(0.65)
  expect(crewRows([job], now + 300_001, 120)[0]!.gutter.every(mark => mark.dim)).toBe(true)
  expect(crewRows([job], now + 300_001, 120)[0]!.gutter[0]!.strength)
    .toBeGreaterThan(crewRows([job], now + 800_000, 120)[0]!.gutter[0]!.strength)
  for (let width = 7; width <= 160; width++) {
    const row = crewRows([job], now, width)[0]!
    const line = row.title + (row.family ? ` ${row.family} ${row.glyph}` : '') + row.detail + row.gutter.map(mark => mark.text).join('')
    expect(cells(line) + Number(Boolean(row.family))).toBeLessThanOrEqual(width)
    expect(row.gutter).toHaveLength(width >= 15 ? 2 : 0)
  }
  expect(crewRows([job], now + 900_001, 120)[0]!.gutter).toEqual([])
})

test('state glyphs distinguish waits, pause, retry, answer, stall and completion', () => {
  const states = ['running', 'waiting_for_heavy', 'paused', 'retrying', 'blocked_on_question']
  expect(states.map(state => STATE_GLYPHS[state])).toEqual(['●', '⌁', '=', '↻', '?'])
  expect(stateOf({ ...base, isStale: true })).toBe('stalled')
  expect(stateOf({ ...base, running: false, awaitingRoot: true })).toBe('done')
  expect(STATE_GLYPHS.stalled).toBe('!')
  expect(STATE_GLYPHS.done).toBe('✓')
})

test('every width fits terminal cells even with wide text, emoji, links and multiline reasons', () => {
  expect(cells('a長👩‍💻e\u0301')).toBe(6)
  const job = { ...base, isStale: true, reason: 'silence\n長い command', peers: [{ target: 'root/reviewer', count: 12, lastAt: 1, outgoing: true }] }
  for (let width = 0; width <= 180; width++) {
    const row = crewRows([job], 1_000_000, width)[0]!
    const line = row.title + (row.family ? ` ${row.family} ${row.glyph}` : '') + row.detail
    expect(cells(line) + Number(Boolean(row.family))).toBeLessThanOrEqual(width)
    expect(line.includes('\n')).toBe(false)
  }
})

test('known memory, freshness, effort and directed weighted peers render without fabricated values', () => {
  const row = crewRows([{ ...base, peers: [{ target: 'owner/reviewer', count: 3, lastAt: 9_000, outgoing: true }, { target: 'owner/other', count: 2, lastAt: 8_000, outgoing: false }] }], 20_000, 120)[0]!
  expect(row.family + ' ' + row.glyph).toBe('◈◑ ●')
  // effort without a known scale stays the plain word; with the model's levels it is a meter on that scale
  expect(row.detail).toContain('high')
  const scaled = (effortLevels: string[], effort = 'high') => crewRows([{ ...base, effort, effortLevels }], 20_000, 120)[0]!
  expect(scaled(['low', 'medium', 'high']).detail).toContain('●●●') // a model that tops out at high is full at high
  expect(scaled(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).detail).toContain('●●●○○○')
  expect(scaled(['low', 'medium', 'high']).effortSlot).toMatchObject({ lit: 3, total: 3 })
  expect(scaled(['low', 'high', 'max'], 'medium').detail).toContain('medium') // not on its scale: never forced onto it
  expect(row.detail).toContain('▰▰▱▱')
  expect(crewRows([{ ...base, memoryBytes: 512, memoryCap: '1024' }], 20_000, 120)[0]!.detail).toContain('▰▰▱▱')
  expect(row.detail).toContain('↗reviewer:3')
  expect(row.detail).toContain('↙other:2')
  expect(crewRows([{ ...base, lastEventAt: undefined, memoryBytes: null }], 20_000, 120)[0]!.detail).toContain('?')
  expect(quotaText({ cli: 'codex', account: '01', plan: '', active: true, parts: [{ label: 'w', pct: 50, resets: null }] })).toBe('◈01* w50%▰▰▱▱')
  expect(quotaText({ cli: 'codex', account: '01', plan: '', active: true, freshness: 'unknown', parts: [{ label: 'w', pct: 50, resets: null }] })).toBe('◈01*~ w50%▰▰▱▱')
})

test('dead accounts fold into one range, and the stale mark only follows numbers', () => {
  const dead = (account: string, status: string) => ({ cli: 'codex' as const, account, plan: '', active: false, parts: [], status })
  const live = { cli: 'codex' as const, account: '01', plan: '', active: true, freshness: 'stale' as const, parts: [{ label: 'w', pct: 50, resets: null }] }
  const lines = quotaLines([live, dead('02', 'signed out'), dead('03', 'expired'), dead('04', 'expired'), dead('05', 'expired'), dead('06', 'expired')], 200)
  expect(lines).toEqual(['◈01*~ w50%▰▰▱▱  ◈02 signed out  ◈03–06 ✕ expired'])
  expect(quotaText(dead('03', 'expired'))).toBe('◈03 expired')
})

test('quota rows keep reset text attached to its account mark', () => {
  const quota = { cli: 'agy' as const, account: 'a1', plan: '', active: true, parts: [{ label: 'Cw', pct: 25, resets: 'in 2 hours' }] }
  const rows = quotaRows([quota], 80)
  expect(rows).toEqual([[{ text: '✦a1* Cw25%▰▱▱▱', quotas: [quota] }]])
  expect(rows[0]![0]!.quotas[0]!.parts[0]!.resets).toBe('in 2 hours')
  expect(quotaLines([quota], 80)).toEqual(['✦a1* Cw25%▰▱▱▱'])
})

test('quota rows reserve two cells per harness image at every width', () => {
  const quotas = ['01', '02', '03'].map(account => ({ cli: 'codex' as const, account, plan: '', active: false, parts: [{ label: 'w', pct: 50, resets: null }] }))
  for (let width = 1; width <= 80; width++)
    for (const row of quotaRows(quotas, width))
      expect(cells(row.map(chunk => chunk.text).join('  ')) + row.length).toBeLessThanOrEqual(width)
})

test('a wide terminal never truncates a title beside empty space, and a stale peer is not a link', () => {
  const title = 'Pairwise decision-model ranking research'
  const row = crewRows([{ ...base, title, peers: [{ target: 'owner/gone', count: 1, lastAt: 1, outgoing: true }] }], 2_000_000, 190)[0]!
  expect(row.title.trim()).toBe(title)
  expect(row.detail).not.toContain('gone')
  const recent = crewRows([{ ...base, peers: [{ target: 'owner/live', count: 1, lastAt: 1_990_000, outgoing: true }] }], 2_000_000, 190)[0]!
  expect(recent.detail).toContain('↗live')
  expect(recent.detail).not.toContain('↗live:1')
})

test('mixed workers share fixed columns and shrink names first at every width', () => {
  const jobs = [base, { ...base, name: 'research', title: 'Pairwise research', model: 'gpt-6-sol' }, { ...base, name: 'status', title: 'Unified status', backend: 'agy', model: 'claude-fable' }]
  for (const width of [24, 36, 60, 90, 140]) {
    const rows = crewRows(jobs, 20_000, width)
    expect(rows.map(row => row.family)).toEqual(['◈◑', '◈◕', '✦◉'])
    expect(rows.every(row => JSON.stringify(row.columns) === JSON.stringify(rows[0]!.columns))).toBe(true)
    expect(rows.every(row => cells(row.title) === cells(rows[0]!.title))).toBe(true)
    expect(rows.every(row => cells(row.title + ' ' + row.family + ' ' + row.glyph + row.detail) + 1 <= width)).toBe(true)
  }
})

test('peer lanes fit every width, preserve groups, direction, weight and freshness', () => {
  const now = 2_000_000
  const jobs: WakeChip[] = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `owner/${i}`, name: `${i}`, title: `Worker ${i}` }))
  jobs[0]!.peers = [{ target: 'owner/1', outgoing: true, count: 1, lastAt: now - 10 }, { target: 'owner/2', outgoing: true, count: 3, lastAt: now - 10 }]
  jobs[1]!.waitingPeer = { target: 'owner/2', declaredAt: now - 10 }
  jobs[3]!.peers = [{ target: 'owner/4', outgoing: true, count: 5, lastAt: now - 301_000 }]
  for (let width = 0; width <= 200; width++) {
    const rows = crewRows(jobs, now, width)
    for (const row of rows) {
      const line = row.title + (row.family ? ` ${row.family} ${row.glyph}` : '') + row.detail + row.gutter.map(s => s.text).join('')
      expect(cells(line) + Number(Boolean(row.family))).toBeLessThanOrEqual(width)
      expect(row.gutter.every(s => cells(s.text) === 3)).toBe(true)
    }
    expect(rows.every(row => row.gutter.length === rows[0]!.gutter.length)).toBe(true)
  }
  const rows = crewRows(jobs, now, 140)
  expect(rows[0]!.detail.length).toBeLessThan(80)
  expect(rows[0]!.gutter.map(s => s.text).join('')).toContain('─┐')
  expect(rows[0]!.gutter.map(s => s.text).join('')).toContain('━┐')
  expect(rows[1]!.gutter.map(s => s.text).join('')).toContain('←┘')
  expect(rows[3]!.gutter.map(s => s.text).join('')).toContain('═┐')
  expect(rows[3]!.gutter.at(-1)!.dim).toBe(true)
  expect(rows[0]!.gutter[0]!.color).toBe(rows[0]!.gutter[1]!.color)
  expect(rows[0]!.gutter[0]!.color).not.toBe(rows[0]!.gutter[2]!.color)
  const narrow = crewRows(jobs, now, 40)
  expect(narrow[0]!.gutter).toHaveLength(0)
  expect(narrow[0]!.columns).toContain('peers')
  expect(narrow[0]!.detail).toContain('↗1')
  jobs[3]!.peers![0]!.lastAt = now - 900_001
  expect(crewRows(jobs, now, 140)[3]!.gutter).toHaveLength(2)
})

test('a declared wait alone does not invent a communication graph', () => {
  const jobs: WakeChip[] = [{ ...base, id: 'a', waitingPeer: { target: 'b', declaredAt: 10_000 } }, { ...base, id: 'b' }]
  expect(crewRows(jobs, 10_100, 120).every(row => row.gutter.length === 0 && !row.columns.includes('peers'))).toBe(true)
})

test('an off-page endpoint uses a directed mark instead of a misleading connector', () => {
  const source: WakeChip = { ...base, id: 'a', peers: [{ target: 'b', count: 1, lastAt: 10_000, outgoing: true }] }
  const [row] = crewRows([source], 10_100, 120)
  expect(row!.gutter).toHaveLength(0)
  expect(row!.detail).toContain('↗b')
})

test('hidden peers retain direction at narrow widths and all rows fit', () => {
  const now = 20_000
  const plain: WakeChip[] = [0, 1].map(i => ({ ...base, id: `owner/${i}`, name: `${i}` }))
  const linked = plain.map(job => ({ ...job }))
  linked[0]!.peers = [{ target: 'owner/1', outgoing: true, count: 1, lastAt: now }]
  linked[1]!.peers = [{ target: 'owner/0', outgoing: false, count: 1, lastAt: now }]
  for (const extra of [[], [2, 3, 4].map(i => ({ ...base, id: `owner/${i}`, name: `${i}`, isStale: i === 4, reason: 'silent' }))]) {
    for (let width = 40; width <= 100; width++) {
      const rows = crewRows([...linked, ...extra], now, width)
      expect(rows.every(row => cells(row.title + ` ${row.family} ${row.glyph}` + row.detail + row.gutter.map(s => s.text).join('')) + 1 <= width)).toBe(true)
      if (rows[0]!.columns.includes('peers')) {
        expect(rows[0]!.detail).toContain('↗')
        expect(rows[1]!.detail).toContain('↙')
      }
      if (rows[0]!.gutter.length) {
        expect(rows[0]!.gutter[0]!.text).toContain('─')
        expect(rows[1]!.gutter[0]!.text).toContain('←')
      }
    }
  }
})

test('opposite directions use separate lanes and freshness boundaries are exact', () => {
  const now = 2_000_000
  const jobs: WakeChip[] = [
    { ...base, id: 'owner/a', peers: [{ target: 'owner/b', outgoing: true, count: 2, lastAt: now - 300_000 }] },
    { ...base, id: 'owner/b', peers: [{ target: 'owner/a', outgoing: true, count: 5, lastAt: now - 900_000 }] },
  ]
  const rows = crewRows(jobs, now, 90)
  expect(rows[0]!.gutter.map(s => s.text)).toEqual(['━┐ ', '←┐ '])
  expect(rows[1]!.gutter.map(s => s.text)).toEqual(['←┘ ', '═┘ '])
  expect(rows[0]!.gutter.map(s => s.dim)).toEqual([false, true])
  expect(crewRows(jobs, now + 1, 90)[0]!.gutter).toHaveLength(1)
})

test('idle accounts with the same numbers fold into one range, and the active one stays alone', () => {
  const quota = (account: string, pct: number, active = false) => ({ cli: 'codex' as const, account, plan: '', active, parts: [{ label: 'w', pct, resets: null }], freshness: 'fresh' as const })
  const lines = quotaLines([quota('01', 98, true), quota('02', 0), quota('03', 0), quota('04', 0), quota('05', 51)], 200)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain('02–04 w0%')
  expect(lines[0]).toContain('01* w98%')
  expect(lines[0]).not.toContain('03 ')
})

test('a message melts away over its fifteen minutes instead of stopping at a floor', () => {
  const strengths = [0, 150_000, 450_000, 800_000, 899_000].map(age => messageFade(age))
  expect(strengths.every((s, i) => i === 0 || s < strengths[i - 1]!)).toBe(true)
  expect(strengths[0]).toBeGreaterThan(0.6)
  expect(strengths.at(-1)).toBeLessThan(0.1)
})

test('two short rows keep their peer lane: the box hugs the rows, the rows are not laid out again at its width', () => {
  const jobs: WakeChip[] = [
    { ...base, id: 'a', name: 'Parser', title: 'Parser fix', peers: [{ target: 'b', count: 1, lastAt: 10_000, observedAt: 10_000, outgoing: true, preview: 'x' }] },
    { ...base, id: 'b', name: 'Review', title: 'Visual review', peers: [{ target: 'a', count: 1, lastAt: 10_000, outgoing: false, preview: 'x' }] },
  ]
  const { box, rows } = crewLayout(jobs, ['Explore'], 10_500, 148, false)
  expect(box).toBeLessThan(67) // hugged: narrower than the 60 cells a layout needs to draw lanes
  expect(rows[0]!.gutter.slice(0, rows[0]!.rootAt)[0]!.text.trim()).not.toBe('')
  expect(rows.every(row => !row.columns.includes('peers'))).toBe(true) // no ↗name text standing in for the lane
})
