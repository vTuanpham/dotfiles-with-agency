type PeerMessage = { messageId?: string }
type PeerJob = { id: string; owner: string; peers: PeerMessage[] }

/** The most a preview shows anywhere (a hover card, a row): a message can be a whole report, and a card must never grow to fill the screen. */
export const PREVIEW_MAX = 120

/** Null is an intentionally omitted source preview; absent means no matching message metadata. A long preview is cut to one short line, with an ellipsis. */
export const messagePreview = (preview: string | null | undefined): string => {
  if (preview === null) return 'Preview withheld by Bridge'
  const text = (preview ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return 'Message preview unavailable'
  return text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX - 1).trimEnd()}…`
}

/** Describe the observed stage; Bridge does not issue reader acknowledgements. */
export const messageStatus = (state: 'observed' | 'sent' | undefined): string =>
  state === 'observed' ? 'Worker report published' : state === 'sent' ? 'Message sent by Bridge' : 'Message recorded by Bridge'

/** Tracks observed message IDs per owned job so first-scan history never pulses. */
export class PeerMessageTracker {
  private scope = ''
  private readonly seen = new Map<string, Set<string>>()

  reset() {
    this.scope = ''
    this.seen.clear()
  }

  observe(scope: string, jobs: readonly PeerJob[]): Set<string> {
    if (scope !== this.scope) {
      this.scope = scope
      this.seen.clear()
    }

    const active = new Set<string>()
    const visible = new Map<string, Set<string>>()
    const fresh = new Set<string>()
    for (const job of jobs) {
      const key = JSON.stringify([job.owner, job.id])
      active.add(key)
      visible.set(key, new Set(job.peers.flatMap(peer => peer.messageId ? [peer.messageId] : [])))
      let previous = this.seen.get(key)
      const hasBaseline = previous !== undefined
      if (!previous) {
        previous = new Set()
        this.seen.set(key, previous)
      }
      for (const peer of job.peers) {
        const id = peer.messageId
        if (!id) continue
        if (hasBaseline && !previous.has(id)) fresh.add(JSON.stringify([job.owner, job.id, id]))
        previous.add(id)
      }
    }
    for (const key of this.seen.keys()) if (!active.has(key)) this.seen.delete(key)
    let size = [...this.seen.values()].reduce((sum, ids) => sum + ids.size, 0)
    for (const [key, ids] of this.seen) for (const id of ids) {
      if (size <= 1000) break
      if (visible.get(key)?.has(id)) continue
      ids.delete(id)
      size--
    }
    return fresh
  }
}
