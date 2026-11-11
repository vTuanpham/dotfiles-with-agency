import type { WakeChip, WakeQuota } from '../types'
import { modelTier } from './sources/accounts'
import { span } from './util'
import { messagePreview } from './peer-messages'

const clean = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim()
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
/** Terminal cells for graphemes: combining marks are zero-width; emoji and East Asian wide characters take two. */
export function cells(s: string): number {
  let n = 0
  for (const { segment } of segments.segment(s)) {
    if (/^[\p{Mark}\u200b-\u200f\u2060\ufe00-\ufe0f]+$/u.test(segment)) continue
    const cp = segment.codePointAt(0)!
    n += /\p{Extended_Pictographic}|\p{Regional_Indicator}|\ufe0f|\u20e3/u.test(segment)
      || cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a || cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f || cp >= 0xac00 && cp <= 0xd7a3 || cp >= 0xf900 && cp <= 0xfaff || cp >= 0xfe10 && cp <= 0xfe19 || cp >= 0xfe30 && cp <= 0xfe6f || cp >= 0xff00 && cp <= 0xff60 || cp >= 0xffe0 && cp <= 0xffe6 || cp >= 0x20000 && cp <= 0x3fffd) ? 2 : 1
  }
  return n
}
export function truncate(text: string, width: number): string {
  const s = clean(text)
  if (width <= 0) return ''
  if (cells(s) <= width) return s
  let out = ''
  for (const { segment } of segments.segment(s)) {
    if (cells(out + segment) > width - 1) break
    out += segment
  }
  return out + '…'
}

export const STATE_GLYPHS: Record<string, string> = {
  running: '●', waiting_for_heavy: '⌁', paused: '=', retrying: '↻', blocked_on_question: '?',
  waiting_for_root: '✓', idle: '○', retired: '○', stalled: '!', done: '✓', unavailable: '?',
}
export function stateOf(job: WakeChip): string {
  if (job.observationUnavailable) return 'unavailable'
  if (job.isStale) return 'stalled'
  if (job.state === 'blocked_on_question') return job.state
  if (job.awaitingRoot && (!job.running || job.waitingForRoot)) return 'done'
  return job.state ?? (job.running ? 'running' : 'idle')
}
const bar = (fraction: number) => {
  const n = Math.round(Math.max(0, Math.min(1, fraction)) * 4)
  return '▰'.repeat(n) + '▱'.repeat(4 - n)
}
function memoryFraction(job: WakeChip): number | undefined {
  const match = /^([0-9]+(?:\.[0-9]+)?)([KMGT]?)$/.exec(job.memoryCap ?? '')
  if (!match || job.memoryBytes == null) return undefined
  const cap = Number(match[1]) * 1024 ** (match[2] ? 'KMGT'.indexOf(match[2]) + 1 : 0)
  return cap > 0 ? job.memoryBytes / cap : undefined
}
const bytesText = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GiB` : `${Math.round(n / 1024 ** 2)} MiB`)
/** The memory card: what is used against the cap the worker was admitted with, or why there is no number. */
function memoryLines(job: WakeChip, fraction: number | undefined): string[] {
  if (fraction === undefined || job.memoryBytes == null) {
    return ['Memory use is not reported for this worker', job.memoryCap ? `Admitted with a ${job.memoryCap} cap` : 'No memory cap is known (a Claude subagent has none of its own)']
  }
  return [`${bytesText(job.memoryBytes)} of the ${job.memoryCap} cap · ${Math.round(fraction * 100)}%`, '▰ fills as the worker nears the cap it was admitted with']
}
const MARK: Record<string, string> = { codex: '◈', agy: '✦', claude: '◆', opencode: '○' }
/** Model class as a circle that fills with size (quarter to full), so a bigger model reads as more. */
export const CLASS_GLYPH = ['◔', '◑', '◕', '◉'] as const
/** A running worker's own spinner, one motion per harness like Claude's diamond: Codex orbits, agy twinkles, OpenCode's lantern rises and falls. */
export const HARNESS_SPIN: Record<string, string> = { codex: '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', agy: '✦✧⋆·⋆✧', claude: '◆◇◈◇', opencode: '⠠⠐⠈⠁⠈⠐' }
export const harnessSpin = (backend: string, frame: number) => { const set = [...(HARNESS_SPIN[backend] ?? HARNESS_SPIN.codex!)]; return set[frame % set.length]! }
/** Reasoning effort as a five-step signal meter: lit steps rise, unlit steps are dots; full means max or ultra. */

export type CrewColumn = 'effort' | 'elapsed' | 'reason' | 'memory' | 'peers'
const RECENT_PEER_MS = 900_000 // a conversation older than the stall window is history, not a link
/** How present a message still is, 1 just after it to ~0 when its 15 minutes are up: a slow ease-out, so it melts away rather than vanishing. */
export const messageFade = (age: number) => 0.04 + 0.7 * (1 - Math.min(1, age / RECENT_PEER_MS)) ** 1.6
/** One column of a row's detail: its text, and the card a pointer opens over it (every metric explains itself). */
export type CrewPart = { column: CrewColumn; text: string; hover?: { title: string; lines: string[] } }

export type CrewRow = { title: string; family: string; state: string; glyph: string; /** 0..1, how far a working job's mark has brightened this beat */ beat: number; detail: string; /** the same detail, column by column */ parts: CrewPart[]; effortSlot?: { lit: number; total: number; size: number; label: string; before: string; after: string }; columns: CrewColumn[]; gutter: { text: string; color: number; dim: boolean; strength: number; flow: number; description: string[] }[] }
/** One packet's trip from sender to recipient; each further new message follows a beat behind. */
export const PACKET_RUN_MS = 1_400
export const PACKET_STAGGER_MS = 350
export const MAX_PACKETS = 5
/** A worker with a message for the root turns to face her first (a turn takes this long, crew.ts) and only then sends it: the packet and the roar leave after it. */
export const TURN_LEAD_MS = 900
/** Keep a message's heading decision available while its gait approaches the next reversal. */
export const TURN_HOLD_MS = 900_000
/** How long the packets for `fresh` new messages take to arrive, after which nothing moves. */
export const packetWindow = (fresh: number) => PACKET_RUN_MS + PACKET_STAGGER_MS * (Math.min(MAX_PACKETS, Math.max(1, fresh)) - 1)
/** A worker's state mark lights when this view sees it do something, then settles: real activity, never a metronome. */
export const activityFlash = (seenAt: number | undefined, now: number) =>
  seenAt === undefined || now < seenAt ? 0 : Math.exp(-(now - seenAt) / 1_200) * (now - seenAt < 4_000 ? 1 : 0)

/**
 * How brightly a message packet lights one cell of a lane right now (0..1). Motion means a message just arrived here:
 * from when this view first saw it (`observedAt`), one packet per new message (`fresh`) runs once from the sender's row
 * to the recipient's, then the lane rests. Nothing loops, and a lane that only waits on a peer stays still.
 */
export function packetFlow(link: { source: number; target: number; observedAt?: number; fresh?: number; wait: boolean }, row: number, now: number): number {
  const top = Math.min(link.source, link.target), bottom = Math.max(link.source, link.target)
  if (row < top || row > bottom || link.wait || link.observedAt === undefined) return 0
  const since = now - link.observedAt
  if (since < 0 || since > packetWindow(link.fresh ?? 1)) return 0
  const length = bottom - top + 1, along = link.source <= link.target ? row - top : bottom - row
  let flow = 0
  for (let k = 0; k < Math.min(MAX_PACKETS, Math.max(1, link.fresh ?? 1)); k++) {
    const t = since - k * PACKET_STAGGER_MS
    if (t >= 0 && t <= PACKET_RUN_MS) flow = Math.max(flow, 1 - Math.abs(along - ((t / PACKET_RUN_MS) * (length + 1) - 0.5)))
  }
  return Math.max(0, flow)
}

const pad = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - cells(s)))

type Link = { source: number; target: number; count: number; at: number; wait: boolean; preview?: string | null; kind?: string; observedAt?: number; fresh?: number }

/** A wire in the lanes: the messages one worker sent to several (fan-out) or several sent to one (fan-in), drawn as one
 * vertical with a branch at each endpoint, in its `track` (0 nearest the rows), spanning rows `top`..`bottom`. */
type Net = { links: Link[]; track: number; color: number; top: number; bottom: number }

/**
 * Routes the peer messages as few, short, uncrossed wires (a small channel router):
 *   1. messages sharing a sender, or sharing a receiver, merge into one wire, a trunk with a branch per endpoint;
 *   2. wires are packed into tracks by the left-edge rule, shortest first: each takes the nearest track it does not overlap
 *      (two wires that never share a row share a column), so the shortest sit nearest the text and wires nest, and an arrow
 *      running in to its row only crosses a wire it genuinely interleaves with.
 * Tracks the width cannot hold leave their messages to the text marks.
 */
function peerNets(jobs: WakeChip[], now: number, width: number): Net[] {
  const lanes = peerLanes(jobs, now, width)
  const nets: Link[][] = []
  for (const { link } of lanes) { // a wire is a pure fan-out or a pure fan-in: never one that could read as a message nobody sent
    const net = nets.find(n => n.every(other => other.source === link.source) || n.every(other => other.target === link.target))
    if (net && !net.some(other => other.source === link.target || other.target === link.source)) net.push(link)
    else nets.push([link])
  }
  const spans = nets.map((links, color) => {
    const rows = links.flatMap(l => [l.source, l.target])
    return { links, color, top: Math.min(...rows), bottom: Math.max(...rows), track: -1 }
  }).sort((a, b) => (a.bottom - a.top) - (b.bottom - b.top) || a.top - b.top)
  const capacity = lanes.length // never more tracks than the lanes the width allowed
  /** Left-edge packing in `order`: each wire takes the nearest track it does not overlap. */
  const pack = (order: typeof spans): Net[] => {
    const placed: Net[] = []
    for (const net of order) {
      let track = 0
      while (placed.some(other => other.track === track && !(net.bottom < other.top || other.bottom < net.top))) track++
      if (track < capacity) placed.push({ ...net, track })
    }
    return placed
  }
  /** What a packing costs to read: a wire left out, an arrow that cannot reach its row (blocked by another wire's end
   * there), a crossing, and each track's width. Ends that meet the same way (two arrivals) join and cost nothing. */
  const cost = (placed: Net[]) => {
    let total = (spans.length - placed.length) * 100 + (placed.length ? Math.max(...placed.map(n => n.track)) + 1 : 0) * 3
    for (const net of placed) for (const link of net.links) for (const [row, arrives] of [[link.source, false], [link.target, true]] as const) {
      for (const near of placed) {
        if (near.track >= net.track || row < near.top || row > near.bottom) continue
        const end = near.links.find(l => l.source === row || l.target === row)
        total += !end ? 2 : (end.target === row) === arrives ? 0 : 10
      }
    }
    return total
  }
  if (spans.length <= 1 || spans.length > 6) return pack(spans)
  // few enough wires to try every order (6! = 720 packings at most): keep the one that reads best, ties to shortest-first
  let best = pack(spans), bestCost = cost(best)
  const permute = (rest: typeof spans, order: typeof spans) => {
    if (!rest.length) { const placed = pack(order), c = cost(placed); if (c < bestCost) { best = placed; bestCost = c }; return }
    rest.forEach((net, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...order, net]))
  }
  permute(spans, [])
  return best
}

/** Separate lanes keep simultaneous edges legible; connected lanes share a colour. */
function peerLanes(jobs: WakeChip[], now: number, width: number): { link: Link; color: number }[] {
  const indices = new Map(jobs.flatMap((job, i) => job.id ? [[job.id, i] as const] : []))
  const links: Link[] = []
  jobs.forEach((job, source) => {
    for (const peer of job.peers ?? []) {
      const target = indices.get(peer.target)
      if (!peer.outgoing || target === undefined || target === source || now < peer.lastAt || now - peer.lastAt > RECENT_PEER_MS) continue
      links.push({ source, target, count: peer.count, at: peer.lastAt, wait: false, preview: peer.preview, kind: peer.kind, observedAt: peer.observedAt, fresh: peer.fresh })
    }
  })
  const groups: Link[][] = []
  for (const link of links) {
    const touching = groups.filter(group => group.some(edge => [edge.source, edge.target].some(i => i === link.source || i === link.target)))
    const group = [link, ...touching.flat()]
    for (const old of touching) groups.splice(groups.indexOf(old), 1)
    groups.push(group)
  }
  groups.sort((a, b) => Math.min(...a.flatMap(e => [e.source, e.target])) - Math.min(...b.flatMap(e => [e.source, e.target])))
  const minimumTitle = Math.min(24, Math.max(6, Math.floor(width * 0.35)))
  let reserved = 6
  const sizes = [...(jobs.some(job => ['stalled', 'blocked_on_question'].includes(stateOf(job)) && job.reason) ? [width < 60 ? 8 : 16] : []), 5, 5, 5]
  for (const size of sizes) {
    if (width - reserved - size - 1 < minimumTitle) break
    reserved += size + 1
  }
  const capacity = width < 60 ? 0 : Math.max(0, Math.floor((width - reserved - minimumTitle) / 3))
  const lanes: { link: Link; color: number }[] = []
  for (const [color, group] of groups.entries()) {
    group.sort((a, b) => a.source - b.source || a.target - b.target || Number(a.wait) - Number(b.wait))
    if (lanes.length + group.length <= capacity) lanes.push(...group.map(link => ({ link, color })))
  }
  // the shortest lanes nearest the rows: lanes nest, and an arrow running in to its row seldom has to cross another
  const span = ({ link }: { link: Link }) => Math.abs(link.source - link.target)
  return lanes.map((lane, order) => ({ lane, order })).sort((a, b) => span(a.lane) - span(b.lane) || a.order - b.order).map(({ lane }) => lane)
}

/** Cells between the longest crew row and the root's graph while a message to or from the root is on its way: room for its
 * beads to march. At rest the graph stands snug against the rows, ROOT_SNUG cells out (see RootColumn). */
export const ROOT_GAP = 8, ROOT_SNUG = 2

/**
 * How wide the worker rows are, which is where the root's graph stands: one shared column hugging the longest row (words,
 * metrics and peer lanes), `gap` cells past its words. A band under 80 cells keeps it at the right edge.
 * `rows` are the Bridge rows laid out at the full width; `agentNames` the native subagents'.
 */
export function crewBox(rows: CrewRow[], agentNames: string[], rowWidth: number, gap = ROOT_GAP): number {
  const words = Math.max(0, ...rows.map(row => 9 + cells(row.title) + cells(row.detail) + 8), ...agentNames.map(name => 5 + cells(name) + 24))
  const lanes = Math.max(0, ...rows.map(row => 9 + cells(row.title) + cells(row.detail) + row.gutter.reduce((sum, segment) => sum + cells(segment.text), 0) + 8))
  // Peer lanes stand in the gap first and push the graph out only past it (keeping a few cells for the beads).
  return rowWidth >= 80 ? Math.min(rowWidth, Math.max(words + gap, lanes + 3)) : rowWidth
}

/** Whether a message to or from the root is on its way just now (its packets running), so its beads want room to march. */
export const rootInFlight = (jobs: WakeChip[], now: number): boolean => jobs.some(job => (job.peers ?? []).some(peer =>
  peer.target === 'root' && peer.observedAt !== undefined && now >= peer.observedAt && now - peer.observedAt <= packetWindow(peer.fresh ?? 1) + TURN_LEAD_MS))

/**
 * The crew rows and the box they stand in: `box` while a root message is on its way (room for its beads), `snug` at rest, the
 * graph close to the rows' last metric. The rows are laid out once at the band's full width and the box hugs what they need;
 * they are never laid out again at the hugged width, because a narrow width switches the peer lanes off (under 60 cells) and
 * a pair of workers messaging each other would lose its lane for a text mark. A paged subset passes its own jobs.
 */
export function crewLayout(jobs: WakeChip[], agentNames: string[], now: number, rowWidth: number): { box: number; snug: number; rows: CrewRow[] } {
  const rows = crewRows(jobs, now, rowWidth - 7) // less the spinner (3) and the root graph's cell (4)
  const snug = crewBox(rows, agentNames, rowWidth, ROOT_SNUG)
  return { box: rootInFlight(jobs, now) ? crewBox(rows, agentNames, rowWidth) : snug, snug, rows }
}

/**
 * Where the root's graph stands from one draw to the next: it eases a cell at a time between the snug column at rest and the
 * roomy one a message wants, so it spaces out as a message sets off and draws back in after, and never jumps. It never
 * stands nearer than what the rows need (`snug`), so a lane that appears takes its room at once.
 */
export class RootColumn {
  private at?: number
  private seen = 0
  next(target: number, snug: number, now: number): number {
    const steps = Math.max(1, Math.round((now - this.seen) / 60)) // a cell every 60 ms
    this.at = this.at === undefined ? target : this.at < target ? Math.min(target, this.at + steps) : Math.max(target, this.at - steps)
    this.seen = now
    this.at = Math.max(this.at, snug)
    return this.at
  }
}

/** Keep both known endpoints of a recent exchange, even after one worker finishes. */
export function crewJobs(jobs: WakeChip[], now: number): WakeChip[] {
  const known = new Set(jobs.flatMap(job => job.id ? [job.id] : []))
  const linked = new Set<string>()
  for (const job of jobs) for (const peer of job.peers ?? []) {
    if (job.id && peer.target !== 'root' && known.has(peer.target)
      && now >= peer.lastAt && now - peer.lastAt <= RECENT_PEER_MS) {
      linked.add(job.id)
      linked.add(peer.target)
    }
  }
  return jobs.filter(job => job.running || job.awaitingRoot || job.id !== undefined && linked.has(job.id))
}

export function crewPage(total: number, room: number, requested: number): { page: number; pages: number; start: number; end: number } | null {
  if (total <= room || room < 2) return null
  const pageSize = room - 1
  const pages = Math.ceil(total / pageSize)
  const page = Math.max(0, Math.min(Math.floor(requested), pages - 1))
  return { page, pages, start: page * pageSize, end: Math.min(total, (page + 1) * pageSize) }
}

/** Choose one column set for the whole crew; names absorb width changes first. */
export function crewRows(jobs: WakeChip[], now: number, width: number): CrewRow[] {
  width = Math.max(0, Math.floor(width))
  // Messages to and from the root take no room here: the root's graph at the row's right edge shows them (rootSpine), so a
  // worker reporting in never narrows the rows and springs them back fifteen minutes later.
  const nets = peerNets(jobs, now, width)
  const tracks = nets.length ? Math.max(...nets.map(net => net.track)) + 1 : 0
  const gutterWidth = tracks * 3
  const shown = new Set(nets.flatMap(net => net.links).filter(link => !link.wait).map(link => `${link.source}:${link.target}`))
  const hasHiddenPeers = jobs.some((job, index) => (job.peers ?? []).some(p => {
    if (p.target === 'root') return false // Root has its own directed gutter, not a worker-name column.
    const other = jobs.findIndex(j => j.id === p.target)
    return now >= p.lastAt && now - p.lastAt <= RECENT_PEER_MS && !shown.has(p.outgoing ? `${index}:${other}` : `${other}:${index}`)
  }))
  const hasReason = jobs.some(job => ['stalled', 'blocked_on_question'].includes(stateOf(job)) && job.reason)
  const candidates: [CrewColumn, number][] = [
    ...(hasReason ? [['reason', width < 60 ? 8 : 16] as [CrewColumn, number]] : []),
    ['effort', 6], ['elapsed', 5],
    ['memory', 5],
  ]
  // A two-cell harness image, class and state fit once there are seven cells.
  if (width < 7) return jobs.map(job => ({ title: truncate(job.title || job.name, width), family: '', state: stateOf(job), glyph: '', beat: 0, detail: '', parts: [], columns: [], gutter: [] }))
  let used = 7 // space + two-cell harness image and its cell of air + class circle + space + state
  const minimumTitle = Math.min(24, Math.max(6, Math.floor(width * 0.35)))
  const selected: [CrewColumn, number][] = []
  // A directed peer mark remains legible at narrow widths before optional metrics.
  const peerWidth = Math.min(width >= 90 ? 24 : 12, width - gutterWidth - used - minimumTitle - 1)
  if (hasHiddenPeers && peerWidth >= 3) {
    selected.push(['peers', peerWidth])
    used += peerWidth + 1
  }
  for (const candidate of candidates) {
    if (width - gutterWidth - used - candidate[1] - 1 < minimumTitle) break
    selected.push(candidate)
    used += candidate[1] + 1
  }
  // Names take what they need (up to 56 cells) so a wide terminal never truncates a title beside empty space.
  const wanted = Math.max(...jobs.map(job => cells(clean(job.title || job.name))), 1)
  const titleWidth = Math.min(wanted, 56, width - gutterWidth - used)
  return jobs.map((job, index) => {
    const state = stateOf(job)
    const memory = memoryFraction(job)
    const age = job.lastEventAt === undefined ? undefined : Math.max(0, now - job.lastEventAt)
    const peerMarks = [...(job.peers ?? [])].filter(p => {
      if (p.target === 'root') return false
      const other = jobs.findIndex(j => j.id === p.target)
      return now >= p.lastAt && now - p.lastAt <= RECENT_PEER_MS && !shown.has(p.outgoing ? `${index}:${other}` : `${other}:${index}`)
    }).sort((a, b) => b.lastAt - a.lastAt)
      .map(p => `${p.outgoing ? '↗' : '↙'}${clean(p.target.split('/').at(-1) ?? '')}${p.count > 1 ? ':' + p.count : ''}`)
    const peers = peerMarks.join(',')
    // effort on the model's own scale (a Gemini topping out at high fills at high); the bare word when the scale is unknown
    const dots = job.effortLevels?.length && job.effortLevels.includes(job.effort.toLowerCase())
      ? { lit: job.effortLevels.indexOf(job.effort.toLowerCase()) + 1, total: job.effortLevels.length } : undefined
    const values: Record<CrewColumn, string> = {
      effort: dots ? '●'.repeat(dots.lit) + '○'.repeat(dots.total - dots.lit) : job.effort || '?',
      elapsed: age === undefined ? '?' : span(age),
      reason: state === 'stalled' || state === 'blocked_on_question' ? job.reason ?? '' : '',
      memory: memory === undefined ? '?' : '▣' + bar(memory),
      peers,
    }
    const detail = selected.map(([name, size]) => ' ' + pad(truncate(values[name], size), size)).join('')
    // Where the effort meter sits in the detail, so the renderer can colour its lit dots
    const slot = selected.findIndex(([name]) => name === 'effort')
    const cellText = ([name, size]: [CrewColumn, number]) => ' ' + pad(truncate(values[name], size), size)
    // what each metric means, in the card a pointer opens over it (the effort card is drawn from `effortSlot` below)
    const hovers: Partial<Record<CrewColumn, NonNullable<CrewPart['hover']>>> = {
      elapsed: { title: 'Last event', lines: [age === undefined ? 'No event seen from this worker yet' : `${span(age)} since this worker last did something`, 'A long silence marks it stalled'] },
      memory: { title: 'Memory', lines: memoryLines(job, memory) },
      ...(values.reason ? { reason: { title: state === 'stalled' ? 'Why it is marked stalled' : 'Why it is waiting', lines: [values.reason] } } : {}),
    }
    const parts: CrewPart[] = selected.map(column => ({ column: column[0], text: cellText(column), hover: hovers[column[0]] }))
    const effortSlot = slot < 0 || !dots ? undefined : {
      lit: dots.lit, total: dots.total, size: selected[slot]![1],
      label: `${job.effort} · ${dots.lit} of ${dots.total} levels this model offers (${job.effortLevels!.join(', ')})`,
      before: selected.slice(0, slot).map(cellText).join(''), after: selected.slice(slot + 1).map(cellText).join(''),
    }
    // Each track's wire at this row: a branch where a message leaves (─, heavier with more messages) or arrives (←), the
    // trunk with its corners (┐ ┘), a tee where a branch leaves it mid-way (┤), and a packet's head (●) running down it.
    const strengthOf = (link: Link) => {
      const pulseAge = link.observedAt === undefined || now < link.observedAt ? Infinity : now - link.observedAt
      return link.wait ? 1 : pulseAge < 2_000 ? 0.65 + 0.35 * (Math.floor(pulseAge / 400) % 2) : messageFade(Math.max(0, now - link.at))
    }
    const describe = (link: Link) => [
      `${jobs[link.source]!.name} → ${jobs[link.target]!.name}`,
      link.wait ? 'Waiting for peer' : messagePreview(link.preview, { kind: link.kind, count: link.count, ago: Math.max(0, now - link.at) }),
    ]
    const ends = new Map<number, 'source' | 'target'>() // this row's end of each track's wire, if it has one
    const peerGutter = Array.from({ length: tracks }, (_, track) => {
      const net = nets.find(n => n.track === track && index >= n.top && index <= n.bottom)
      if (!net) return { text: '   ', color: 0, dim: false, strength: 0, flow: 0, description: [] as string[] }
      const here = net.links.filter(l => l.source === index || l.target === index)
      const covering = net.links.filter(l => index >= Math.min(l.source, l.target) && index <= Math.max(l.source, l.target))
      const sends = here.some(l => l.source === index), count = Math.max(...net.links.map(l => l.count))
      const wait = net.links.every(l => l.wait)
      const flow = Math.max(0, ...covering.map(l => packetFlow(l, index, now)))
      const branch = sends ? (wait ? '┄' : here.reduce((n, l) => n + l.count, 0) >= 5 ? '═' : here.reduce((n, l) => n + l.count, 0) >= 2 ? '━' : '─') : here.length ? '←' : ' '
      const vertical = index === net.top ? '┐' : index === net.bottom ? '┘' : here.length ? '┤'
        : flow > 0.65 && !wait ? '●' : wait ? '┆' : count >= 5 ? '║' : count >= 2 ? '┃' : '│'
      if (here.length) ends.set(track, sends ? 'source' : 'target')
      const latest = [...(here.length ? here : covering)].sort((a, b) => b.at - a.at)
      return {
        text: branch + vertical + ' ', color: net.color, dim: latest.every(l => !l.wait && now - l.at > 300_000),
        strength: Math.max(...latest.map(strengthOf)), flow, description: latest.flatMap(describe),
      }
    })
    // An end of a wire further out runs in to the row's own text: across the free cells of the tracks nearer the row (through
    // any wire passing here), so the arrowhead lands right after the row's last metric rather than hanging in its own column.
    ends.forEach((end, lane) => {
      const target = end === 'target'
      if (lane === 0) return
      const own = peerGutter[lane]!, line = own.text[0] === '←' ? '─' : own.text[0]!
      let head = target
      let reached = false
      for (let near = 0; near < lane; near++) {
        const cell = peerGutter[near]!.text
        if (!cell.trim()) peerGutter[near] = { ...own, text: (head ? '←' : line) + line + line }
        else if (cell[0] === ' ' && cell[2] === ' ') peerGutter[near] = { ...peerGutter[near]!, text: (head ? '←' : line) + cell[1] + line } // through a passing lane
        else if ((cell[0] === '←') === target && cell[2] === ' ') { // another lane ending here the same way: the two join
          peerGutter[near] = { ...peerGutter[near]!, text: cell[0] + (cell[1] === '┐' ? '┬' : cell[1] === '┘' ? '┴' : '┼') + line }
          head = false
        } else continue // another lane's own end the other way: this run stops short of it
        head = false
        reached = true
      }
      if (reached) peerGutter[lane] = { ...own, text: line + own.text.slice(1) }
    })
    return {
      title: pad(truncate(job.title || job.name, titleWidth), titleWidth),
      family: `${MARK[job.backend] ?? '◇'}${CLASS_GLYPH[modelTier(job.backend, job.model) - 1] ?? CLASS_GLYPH[1]}`,
      state, glyph: STATE_GLYPHS[state] ?? '?', beat: state === 'running' ? activityFlash(job.activitySeenAt, now) : 0, detail, parts, effortSlot, columns: selected.map(([name]) => name), gutter: peerGutter,
    }
  })
}

/** A worker's tie to the root: it messaged it (out), the root messaged it (in), or it simply works for it (tether). */
export type RootLink = { dir: 'out' | 'in' | 'tether'; family: string; at: number; count: number; observedAt?: number; fresh?: number; description: string[]; /** a tether's real pulse: when the worker last did anything */ activeAt?: number }
export type RootCell = { branch: string; spine: string; arrow: string; family: string; strength: number; flow: number; description: string[]; dir?: RootLink['dir']; /** ms since the worker's last event, for a tether */ idle?: number; /** ms since this row's message arrived in view, while its packets still run */ arriving?: number }

/**
 * The root's graph, drawn in the right edge of the crew rows (native subagents and Bridge jobs alike, in display order):
 * a node `◉` on the first row, a spine `│` running down to the last row that has a tie, and a branch `─┤`/`─┘` on every
 * row that does, with an arrow for which way its last message went (↑ to the root, ↓ from it). A packet runs the spine
 * between the row and the root, like a peer lane's; a tie fades over the message's 15 minutes instead of vanishing.
 */
/** Ms since a row's message arrived in this view, while its packets are still on the way; otherwise undefined. */
function arrivingFor(link: RootLink | undefined, now: number): number | undefined {
  if (!link || link.dir === 'tether' || link.observedAt === undefined) return undefined
  const since = now - link.observedAt
  return since >= 0 && since <= packetWindow(link.fresh ?? 1) ? since : undefined
}

export function rootSpine(links: (RootLink | undefined)[], now: number): RootCell[] {
  const last = links.findLastIndex(link => link !== undefined)
  return links.map((link, row) => {
    // a tether is as present as the worker is busy: bright and quick just after its last event, fading over minutes of silence
    const idle = link?.dir === 'tether' && link.activeAt !== undefined ? Math.max(0, now - link.activeAt) : undefined
    const strength = !link ? 0 : link.dir === 'tether' ? (idle === undefined ? 0.5 : 0.15 + 0.6 * Math.exp(-idle / 180_000)) : (link.observedAt !== undefined && now >= link.observedAt && now - link.observedAt < 2_000) ? 1 : messageFade(Math.max(0, now - link.at))
    // Only real messages move, once, as they arrive; a tether is a standing relationship and stays still.
    let flow = 0
    links.forEach((other, from) => {
      if (!other || from < row || other.dir === 'tether') return
      flow = Math.max(flow, packetFlow({ source: other.dir === 'out' ? from : 0, target: other.dir === 'out' ? 0 : from, observedAt: other.observedAt, fresh: other.fresh, wait: false }, row, now))
    })
    const arrow = !link ? ' ' : link.dir === 'out' ? '↑' : link.dir === 'in' ? '↓' : '·'
    if (row === 0) return { branch: link ? '─' : ' ', spine: '◉', arrow: link ? arrow : ' ', family: link?.family ?? '', strength: link ? strength : 1, flow, description: link?.description ?? ['Root', 'The session: workers message it here'], dir: link?.dir, arriving: arrivingFor(link, now) }
    if (row > last) return { branch: ' ', spine: ' ', arrow: ' ', family: '', strength: 0, flow: 0, description: [] }
    return { branch: link ? '─' : ' ', spine: row === last ? '┘' : link ? '┤' : '│', arrow, family: link?.family ?? '', strength: link ? strength : 0.6, flow, description: link?.description ?? [], dir: link?.dir, idle, arriving: arrivingFor(link, now) }
  })
}

export const quotaMark = (quota: WakeQuota) => MARK[quota.cli]!

export function quotaText(quota: WakeQuota, name = quota.account): string {
  // The stale-cache '~' only means something beside numbers; a dead account has none to be stale.
  const stale = !quota.status && quota.freshness && quota.freshness !== 'fresh' ? '~' : ''
  return `${quotaMark(quota)}${name}${quota.active ? '*' : ''}${stale} ${quota.status ?? (quota.parts.length ? quota.parts.map(p => p.pct === null ? `${p.label}?` : `${p.label}${Math.round(p.pct)}%${bar(p.pct / 100)}`).join(' ') : '?')}`
}

/** Neighbouring accounts of one CLI in the same dead state read once: '◈03–06 ✕ expired', not four times. */
export type QuotaChunk = { text: string; quotas: WakeQuota[] }

function foldDead(quotas: WakeQuota[]): QuotaChunk[] {
  const parts: QuotaChunk[] = []
  for (let i = 0; i < quotas.length; i++) {
    const quota = quotas[i]!
    let j = i
    // neighbours that read the same fold into one: a dead state, or the same numbers on idle accounts (never the active one).
    // When each was read does not matter: a window at its numbers stays there until it resets, and a stale one shows '~'.
    const same = (other: WakeQuota | undefined) => other?.cli === quota.cli && other.status === quota.status
      && other.refreshStatus === quota.refreshStatus
      && (quota.status !== undefined || (!quota.active && !other.active
        && JSON.stringify(other.parts.map(p => [p.label, p.pct === null ? null : Math.round(p.pct)])) === JSON.stringify(quota.parts.map(p => [p.label, p.pct === null ? null : Math.round(p.pct)]))))
    while (same(quotas[j + 1])) j++
    if (j === i) { parts.push({ text: quotaText(quota), quotas: [quota] }); continue }
    const group = quotas.slice(i, j + 1)
    const names = group.map(q => q.account)
    const shown = group.find(q => q.freshness !== 'fresh') ?? quota // one stale reading marks the range
    parts.push({ text: quota.status ? `${quotaMark(quota)}${names[0]}–${names.at(-1)} ✕ ${quota.status}` : quotaText(shown, `${names[0]}–${names.at(-1)}`), quotas: group })
    i = j
  }
  return parts
}

/** Keep each account together where possible, wrapping at the available terminal width. */
export function quotaRows(quotas: WakeQuota[], width: number): QuotaChunk[][] {
  const lines: QuotaChunk[][] = []
  for (const chunk of foldDead(quotas)) {
    const part = { ...chunk, text: truncate(chunk.text, width - 1) }
    const last = lines.at(-1)
    if (last && cells(last.map(p => p.text).join('  ')) + last.length + 3 + cells(part.text) <= width) last.push(part)
    else if (part.text) lines.push([part])
  }
  return lines
}

export function quotaLines(quotas: WakeQuota[], width: number): string[] {
  return quotaRows(quotas, width).map(line => line.map(chunk => chunk.text).join('  '))
}
