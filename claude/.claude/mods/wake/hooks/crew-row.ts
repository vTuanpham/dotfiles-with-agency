import type { WakeChip, WakeQuota } from '../types'
import { modelTier } from './sources/accounts'
import { span } from './util'

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
  waiting_for_root: '✓', idle: '○', retired: '○', stalled: '!', done: '✓',
}
export function stateOf(job: WakeChip): string {
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
const MARK: Record<string, string> = { codex: '◈', agy: '✦', claude: '◆', opencode: '○' }
/** Model class as a circle that fills with size (quarter to full), so a bigger model reads as more. */
export const CLASS_GLYPH = ['◔', '◑', '◕', '◉'] as const
/** Reasoning effort as a five-step signal meter: lit steps rise, unlit steps are dots; full means max or ultra. */

export type CrewColumn = 'effort' | 'elapsed' | 'reason' | 'memory' | 'peers'
const RECENT_PEER_MS = 900_000 // a conversation older than the stall window is history, not a link
const ROOT_GUTTER_WIDTH = cells('↗r ')
/** How present a message still is, 1 just after it to ~0 when its 15 minutes are up: a slow ease-out, so it melts away rather than vanishing. */
export const messageFade = (age: number) => 0.04 + 0.7 * (1 - Math.min(1, age / RECENT_PEER_MS)) ** 1.6
export type CrewRow = { title: string; family: string; state: string; glyph: string; /** 0..1, how far a working job's mark has brightened this beat */ beat: number; detail: string; effortSlot?: { lit: number; total: number; size: number; label: string; before: string; after: string }; rootAt?: number; columns: CrewColumn[]; gutter: { text: string; color: number; dim: boolean; strength: number; flow: number; description: string[] }[] }
/** One packet's trip from sender to recipient; each further new message follows a beat behind. */
export const PACKET_RUN_MS = 1_400
export const PACKET_STAGGER_MS = 350
export const MAX_PACKETS = 5
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

/** Separate lanes keep simultaneous edges legible; connected lanes share a colour. */
function peerLanes(jobs: WakeChip[], now: number, width: number, reservedGutter = 0): { link: Link; color: number }[] {
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
  const capacity = width < 60 ? 0 : Math.max(0, Math.floor((width - reserved - minimumTitle - reservedGutter) / 3))
  const lanes: { link: Link; color: number }[] = []
  for (const [color, group] of groups.entries()) {
    group.sort((a, b) => a.source - b.source || a.target - b.target || Number(a.wait) - Number(b.wait))
    if (lanes.length + group.length <= capacity) lanes.push(...group.map(link => ({ link, color })))
  }
  return lanes
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
  const availableRootDirections = [true, false].filter(outgoing => jobs.some(job =>
    (job.peers ?? []).some(peer => peer.target === 'root' && peer.outgoing === outgoing
      && now >= peer.lastAt && now - peer.lastAt <= RECENT_PEER_MS)))
  // Keep the directed root endpoint only when the fixed worker mark plus at
  // least one title cell can fit beside its three-cell gutter lane.
  const rootDirections = width >= 7 + availableRootDirections.length * ROOT_GUTTER_WIDTH
    ? availableRootDirections
    : []
  const lanes = peerLanes(jobs, now, width, rootDirections.length * ROOT_GUTTER_WIDTH)
  const gutterWidth = lanes.length * 3 + rootDirections.length * ROOT_GUTTER_WIDTH
  const shown = new Set(lanes.filter(lane => !lane.link.wait).map(({ link }) => `${link.source}:${link.target}`))
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
  if (width < 7) return jobs.map(job => ({ title: truncate(job.title || job.name, width), family: '', state: stateOf(job), glyph: '', beat: 0, detail: '', columns: [], gutter: [] }))
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
    const effortSlot = slot < 0 || !dots ? undefined : {
      lit: dots.lit, total: dots.total, size: selected[slot]![1],
      label: `${job.effort} · ${dots.lit} of ${dots.total} levels this model offers (${job.effortLevels!.join(', ')})`,
      before: selected.slice(0, slot).map(cellText).join(''), after: selected.slice(slot + 1).map(cellText).join(''),
    }
    const peerGutter = lanes.map(({ link, color }) => {
      const top = Math.min(link.source, link.target), bottom = Math.max(link.source, link.target)
      let text = '   '
      if (index >= top && index <= bottom) {
        const branch = index === link.source ? (link.wait ? '┄' : link.count >= 5 ? '═' : link.count >= 2 ? '━' : '─') : index === link.target ? '←' : ' '
        const packet = index > top && index < bottom && !link.wait && packetFlow(link, index, now) > 0.65 // the packet's head, mid-lane
        const vertical = index === top ? '┐' : index === bottom ? '┘' : packet ? '●' : link.wait ? '┆' : link.count >= 5 ? '║' : link.count >= 2 ? '┃' : '│'
        text = branch + vertical + ' '
      }
      const age = Math.max(0, now - link.at)
      const pulseAge = link.observedAt === undefined || now < link.observedAt ? Infinity : now - link.observedAt
      const strength = link.wait ? 1 : pulseAge < 2_000 ? 0.65 + 0.35 * (Math.floor(pulseAge / 400) % 2) : messageFade(age)
      const description = [
        `${jobs[link.source]!.name} → ${jobs[link.target]!.name}`,
        link.wait ? 'Waiting for peer' : link.preview ? link.preview : 'Message preview unavailable',
      ]
      return { text, color, dim: !link.wait && age > 300_000, strength, flow: text.trim() ? packetFlow(link, index, now) : 0, description }
    })
    const rootGutter = rootDirections.map(outgoing => {
      const message = [...(job.peers ?? [])]
        .filter(peer => peer.target === 'root' && peer.outgoing === outgoing
          && now >= peer.lastAt && now - peer.lastAt <= RECENT_PEER_MS)
        .sort((a, b) => b.lastAt - a.lastAt)[0]
      if (!message)
        return { text: '   ', color: 3, dim: true, strength: 0.25, flow: 0, description: [] }
      const age = Math.max(0, now - message.lastAt)
      const pulseAge = message.observedAt === undefined || now < message.observedAt
        ? Infinity
        : now - message.observedAt
      const strength = pulseAge < 2_000
        ? 0.65 + 0.35 * (Math.floor(pulseAge / 400) % 2)
        : messageFade(age)
      return {
        text: pad(outgoing ? '↗r ' : '↙r ', ROOT_GUTTER_WIDTH),
        color: 3,
        dim: age > 300_000,
        strength,
        // lights once as a message arrives in this view, fading over its packets' trip; then still
        flow: pulseAge <= packetWindow(message.fresh ?? 1) ? 1 - pulseAge / packetWindow(message.fresh ?? 1) : 0,
        description: [
          outgoing ? 'Worker → root' : 'Root → worker',
          message.messageState === 'observed'
            ? 'Observed by Bridge; root read state unknown'
            : message.messageState === 'sent'
              ? 'Bridge sent; worker read state unknown'
              : 'Bridge message state unavailable',
          message.preview ?? 'Message preview unavailable',
        ],
      }
    })
    const gutter = [...peerGutter, ...rootGutter]
    const rootAt = peerGutter.length // from here on the gutter is the root slot, drawn at the row's right edge
    return {
      title: pad(truncate(job.title || job.name, titleWidth), titleWidth),
      family: `${MARK[job.backend] ?? '◇'}${CLASS_GLYPH[modelTier(job.backend, job.model) - 1] ?? CLASS_GLYPH[1]}`,
      state, glyph: STATE_GLYPHS[state] ?? '?', beat: state === 'running' ? activityFlash(job.activitySeenAt, now) : 0, detail, effortSlot, columns: selected.map(([name]) => name), gutter, rootAt,
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
  return `${quotaMark(quota)}${name}${quota.active ? '*' : ''}${stale} ${quota.status ?? (quota.parts.length ? quota.parts.map(p => `${p.label}${Math.round(p.pct)}%${bar(p.pct / 100)}`).join(' ') : '?')}`
}

/** Neighbouring accounts of one CLI in the same dead state read once: '◈03–06 ✕ expired', not four times. */
export type QuotaChunk = { text: string; quotas: WakeQuota[] }

function foldDead(quotas: WakeQuota[]): QuotaChunk[] {
  const parts: QuotaChunk[] = []
  for (let i = 0; i < quotas.length; i++) {
    const quota = quotas[i]!
    let j = i
    // neighbours that read the same fold into one: a dead state, or the same numbers on idle accounts (never the active one)
    const same = (other: WakeQuota | undefined) => other?.cli === quota.cli && other.status === quota.status
      && (quota.status !== undefined || (!quota.active && !other.active && other.freshness === quota.freshness
        && JSON.stringify(other.parts.map(p => [p.label, Math.round(p.pct)])) === JSON.stringify(quota.parts.map(p => [p.label, Math.round(p.pct)]))))
    while (same(quotas[j + 1])) j++
    if (j === i) { parts.push({ text: quotaText(quota), quotas: [quota] }); continue }
    const group = quotas.slice(i, j + 1)
    const names = group.map(q => q.account)
    parts.push({ text: quota.status ? `${quotaMark(quota)}${names[0]}–${names.at(-1)} ✕ ${quota.status}` : quotaText(quota, `${names[0]}–${names.at(-1)}`), quotas: group })
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
