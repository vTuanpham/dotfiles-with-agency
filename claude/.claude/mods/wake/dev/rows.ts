// bun dev/rows.ts [width]: the inline crew rows over time, as text, for nested crew and message cases.
// Shows each row's state mark brightness (beat), peer lanes and root gutter with their packet flow per moment,
// so motion can be checked to start only on real arrivals and stop afterwards.
import { crewRows, rootSpine, type RootLink } from '../hooks/crew-row.ts'
import type { WakeChip } from '../types'
const W = Number(process.argv[2] ?? 120)
const job = (id: string, backend: string, extra: Partial<WakeChip> = {}): WakeChip =>
  ({ id, name: id, title: `${id} task`, backend, account: '01', model: 'gpt-6.1-sol', effort: 'high', running: true, isStale: false, since: 0, lastEventAt: 0, ...extra })
const msg = (target: string, outgoing: boolean, observedAt?: number, fresh = 1) =>
  ({ target, count: fresh, lastAt: 0, outgoing, observedAt, fresh })
const cases: [string, WakeChip[]][] = [
  ['chain a→b→c (a at t=0, b at t=600), root→c at t=0, b acted at t=0', [
    job('a', 'codex', { peers: [msg('b', true, 0)] }),
    job('b', 'agy', { activitySeenAt: 0, peers: [msg('a', false, 0), msg('c', true, 600)] }),
    job('c', 'opencode', { peers: [msg('b', false, 600), msg('root', false, 0)] }),
  ]],
  ['burst: three messages a→d at once across b and c', [
    job('a', 'codex', { peers: [msg('d', true, 0, 3)] }), job('b', 'agy'), job('c', 'claude'), job('d', 'opencode', { peers: [msg('a', false, 0, 3)] }),
  ]],
  ['history only: old messages, nothing arrived in view', [
    job('a', 'codex', { peers: [msg('b', true)] }), job('b', 'agy', { peers: [msg('a', false), msg('root', true)] }),
  ]],
]
const bar = (v: number) => ' ▁▂▃▄▅▆▇█'[Math.round(Math.max(0, Math.min(1, v)) * 8)]
for (const [name, jobs] of cases) {
  console.log(`\n== ${name}`)
  for (const t of [0, 300, 700, 1100, 1500, 2200, 10_000]) {
    const rows = crewRows(jobs, t, W)
    const links: (RootLink | undefined)[] = jobs.map(j => {
      const m = (j.peers ?? []).find(p => p.target === 'root')
      return m ? { dir: m.outgoing ? 'out' : 'in', family: j.backend, at: 0, count: m.count, observedAt: m.observedAt, fresh: m.fresh, description: [] } : { dir: 'tether', family: j.backend, at: 0, count: 1, description: [] }
    })
    const spine = rootSpine(links, t)
    console.log(`t=${String(t).padStart(5)}ms ` + rows.map((r, i) =>
      `${jobs[i]!.id}[mark${bar(r.beat)} lanes${r.gutter.map(g => g.text.trim() ? bar(g.flow) : '·').join('')} root${spine[i]!.spine}${bar(spine[i]!.flow)}${spine[i]!.arriving !== undefined ? '→' : ' '}]`).join(' '))
  }
}
