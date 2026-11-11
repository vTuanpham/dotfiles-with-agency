import { hash } from '../pixels'

// How a crew member moves about its home, and how its real activity sets the pace of it.
//
// A gait is a smooth path in a unit square: `u` and `v` run -1..1 across and up the room the sprite has, so the same path
// serves any amount of free sky. Each family has its own:
//   codex     hovers, then goes: eases from one waypoint to the next, like a machine on a patrol route
//   claude    loops: a figure of eight, flapping and gliding, faster the smaller the bird
//   agy       orbits: a slow ellipse whose size breathes, like something with a pull on it
//   opencode  drifts: a wide lazy sway with a slow bob, wherever the wind takes a lantern garland
// `reach` is the room it has each way, in cells; a gait stretches in time to suit it.
// Time is `phase`, the worker's own clock in frames (ten a second at pace 1.0): a busy worker's clock runs faster, so its
// gait quickens and its wings beat faster, and a waiting one's slows to a hover. The path is a function of the phase alone,
// so the speed can change at any moment without the sprite jumping.

type Kind = 'codex' | 'agy' | 'claude' | 'opencode'

const ease = (t: number) => t * t * (3 - 2 * t)
const waypoint = (seed: number, k: number) => (hash(seed * 131 + k * 977) % 2001) / 1000 - 1
const leg = (seed: number, t: number, length: number) => {
  const k = Math.floor(t / length), f = ease(t / length - k)
  return waypoint(seed, k) * (1 - f) + waypoint(seed, k + 1) * f
}

/**
 * A patrol: each leg crosses the middle of the room to a point on the far side and eases to a stop there, so a body with a
 * front reverses only at the end of a long run, never mid-flight. Random waypoints reversed on two legs in three, and a
 * figure of eight every few seconds: a creature that spends half its life turning looks lost.
 */
const sweep = (seed: number, t: number, length: number) => {
  const end = (k: number) => (k & 1 ? 1 : -1) * (0.45 + 0.55 * (hash(seed * 131 + k * 977) % 1000) / 1000)
  const k = Math.floor(t / length), f = ease(t / length - k)
  return end(k) * (1 - f) + end(k + 1) * f
}

export function gait(kind: Kind, tier: number, seed: number, time: number, reach = 18): { u: number; v: number } {
  const s = seed * 5
  // the wider the room, the longer each sweep takes: crossing the whole sky is a leisurely passage, not a dash
  const t = time / Math.max(1, reach / 18)
  switch (kind) {
    case 'codex': {
      const slow = tier >= 4 ? 1.8 : tier === 3 ? 1.15 : 1 // the biggest craft changes course least often
      return { u: sweep(seed, t + s * 7, 95 * slow), v: leg(seed + 3, t, 55 * slow) }
    }
    case 'claude': {
      const quick = [0, 1.5, 1.2, 1, 0.85][tier] ?? 1
      return { u: sweep(seed, t + s * 7, 105 / quick), v: 0.45 * Math.sin(t * 0.05 * quick + s * 2) + 0.15 * Math.sin(t * 0.13 + s) }
    }
    case 'agy':
      return { u: Math.sin(t * 0.045 + s) * Math.cos(t * 0.011 + s), v: 0.8 * Math.cos(t * 0.045 + s) * (0.7 + 0.3 * Math.sin(t * 0.017)) }
    case 'opencode':
      return { u: 0.9 * Math.sin(t * 0.018 + s) + 0.1 * Math.sin(t * 0.05 + s), v: 0.6 * Math.sin(t * 0.03 + s * 3) }
  }
}

/** Gait frames that pass per scene frame: a calm worker's clock runs at 0.8, a busy one's at 1.8. */
export const clockRate = (pace: number) => 0.8 + 1.0 * Math.max(0, Math.min(1, pace))

/** The part of its room a worker uses: a calm one stays near home, a busy one ranges. */
export const roamShare = (pace: number) => 0.6 + 0.4 * Math.max(0, Math.min(1, pace))

/** Seconds of its own events over which a worker winds down from busy to calm. */
const BUSY_MS = 120_000

/**
 * How busy a worker is right now, 0..1, from what it really did: just after an event it is at 1, easing to a floor over two
 * minutes without one. A worker waiting on the root or a peer, a paused one and a stalled one are calm no matter when they
 * last spoke; one with no known event yet is at a steady middle.
 */
export function paceOf(job: { state?: string; isStale: boolean; waitingForRoot?: boolean; awaitingRoot?: boolean; waitingPeer?: unknown; lastEventAt?: number; activitySeenAt?: number }, now: number): number {
  if (job.isStale) return 0.12
  if (job.waitingForRoot || job.awaitingRoot || job.waitingPeer || /wait|pause|idle/.test(job.state ?? '')) return 0.1
  if (/retry/.test(job.state ?? '')) return 0.35
  const last = Math.max(job.activitySeenAt ?? 0, job.lastEventAt ?? 0)
  if (!last) return 0.45
  return Math.max(0.35, 1 - Math.max(0, now - last) / BUSY_MS) // a running worker is never idle
}

/**
 * How fast a worker's ROUTE runs while it has a message for, or from, the root (0..1). It does not fly backward to say it: at the
 * message it brakes to a hover (the wings go on beating), turns to face her, sends, turns back to its own course and only then
 * builds up speed again. It has MOMENTUM: it does not stop dead, it coasts forward while the turn winds it round (a speed that
 * eases down over the turn's own time, `back`), and after the send it gathers speed gently over one and a half turns
 * rather than snapping to cruise. `since` is ms since the message arrived in view, `window` how long it is held facing her.
 */
export function routeRate(since: number, window: number, back: number): number {
  const launch = back * 1.5
  if (since < 0 || since > window + launch) return 1
  if (since < back) return 1 - ease(since / back)
  if (since < window) return 0 // hovering, facing her, while it sends
  const t = (since - window) / launch
  return t * t * (3 - 2 * t) // gathering speed on its own course
}

/** Each worker's gait clock, advanced by real time at its own pace. Held by the scene's caller, one per view. */
export class PhaseClock {
  private readonly at = new Map<string, { t: number; phase: number }>()

  /** `rate` scales how fast it runs, 0..1: a worker that hovers (a clock at rate 0 stands still, and eases back in as the rate rises). */
  advance(id: string, pace: number, now: number, rate = 1): number {
    const before = this.at.get(id)
    // a pause (a hidden terminal, a long redraw) must not jump the sprite: at most half a second of motion is owed
    const owed = before ? Math.min(Math.max(0, now - before.t), 500) : 0
    const phase = (before?.phase ?? hash(id.length * 31 + id.charCodeAt(0)) % 1000) + (owed / 100) * clockRate(pace) * rate
    this.at.set(id, { t: now, phase })
    if (this.at.size > 256) for (const key of [...this.at.keys()].slice(0, 64)) this.at.delete(key)
    return phase
  }
}
