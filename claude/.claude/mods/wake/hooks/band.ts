import type { WakeChip, WakeMood, WakeNativeMessage, WakePulse, WakeStep, WakeSurroundings, WakeTally, WakeWeather } from '../types'
import { PACKET_RUN_MS, TURN_HOLD_MS, TURN_LEAD_MS, activityFlash, messageFade, packetWindow } from './crew-row'
import type { Season } from './landscapes/kit'
import { seedOf } from './pixels'
import { PhaseClock, paceOf, routeRate } from './landscapes/gait'
import { ARRIVE_MS, EXIT_MS } from './exits'
import type { CharacterId } from './mochi'
import type { SceneEffect, SceneInput, SceneTurn, SceneWeather } from './scene'
import { modelTier } from './sources/accounts'
import { skyOf } from './sources/weather'
import { messagePreview, messageStatus } from './peer-messages'

// From the session's state and the surroundings to what the scene draws. Pure.

/** The state the scene reads, gathered by the hooks module (which owns $.state). */
export type BandState = {
  here: WakeSurroundings | null
  tally: WakeTally
  turnStartedAt: number | null
  pulse: WakePulse[]
  plan: WakeStep[]
  mood: WakeMood
  /** Which character stands in Mochi's place (`/wake mochi`). */
  character?: CharacterId
  chips: WakeChip[]
  /** The latest messages between the main conversation and its native subagents (the engine's `session.send`). */
  messages?: WakeNativeMessage[]
  subagents: { id: string; name?: string; description: string; type: string; model?: string; tier: 1 | 2 | 3 | 4; since: number; leftAt?: number; interrupted?: boolean }[]
}

const SYNODIC_DAYS = 29.530588853
const NEW_MOON_2000 = Date.UTC(2000, 0, 6, 18, 14)

/** 0 new .. 0.5 full .. 1 new. */
export const moonPhase = (now: number) => ((((now - NEW_MOON_2000) / 86_400_000 / SYNODIC_DAYS) % 1) + 1) % 1

/** Local hours at the place: from the forecast's UTC offset, else the machine's clock. */
export function localHour(now: number, weather: WakeWeather | null): number {
  if (weather) return ((((now / 1000 + weather.utcOffsetSeconds) / 3600) % 24) + 24) % 24
  const d = new Date(now)
  return d.getHours() + d.getMinutes() / 60
}

/** The season at a latitude in a month (0-11); the tropics stay in summer. */
export function seasonAt(lat: number, month: number): Season {
  if (Math.abs(lat) < 23.5) return 'summer'
  const north: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter']
  const s = north[month]!
  if (lat >= 0) return s
  return ({ winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' } as const)[s]
}

export function sceneWeather(w: WakeWeather): SceneWeather {
  const sky = skyOf(w.code, w.isDay)
  return { cloud: Math.max(0, Math.min(1, w.cloud / 100)), rain: sky.rain, snow: sky.snow, fog: sky.fog, thunder: sky.thunder, wind: w.wind }
}

/** Turns as structures: finished ones, and the one in progress while a turn runs. */
function turnsOf(beats: { kind: SceneTurn['kinds'][number]; turn: number }[], current: number, live: boolean) {
  const byTurn = new Map<number, SceneTurn>()
  for (const beat of beats) {
    const turn = byTurn.get(beat.turn) ?? { kinds: [] }
    turn.kinds.push(beat.kind)
    byTurn.set(beat.turn, turn)
  }
  const numbers = [...byTurn.keys()].sort((a, b) => a - b)
  const finished = numbers.filter(n => !(live && n === current)).map(turn => ({ ...byTurn.get(turn)!, turn }))
  return { turns: finished, live: live ? { ...(byTurn.get(current) ?? { kinds: [] }), turn: current } : null }
}

/** Which way a message to or from the root is passing Mochi right now (Bridge just observed it), if one is. */
function mailAt(chips: WakeChip[], now: number): 'in' | 'out' | undefined {
  for (const job of chips) for (const peer of job.peers ?? []) {
    if (peer.target === 'root' && peer.observedAt !== undefined && now >= peer.observedAt && now - peer.observedAt < 2_000) return peer.outgoing ? 'in' : 'out'
  }
  return undefined
}

/**
 * How high each worker hops right now, from real events only: it just did something (its activity flash), its message
 * is leaving (the sender hops as the packet sets off), or one is landing on it (the recipient hops as it arrives).
 */
export function crewLifts(chips: WakeChip[], now: number): Map<string, number> {
  const lifts = new Map<string, number>()
  const raise = (id: string | undefined, amount: number) => { if (id && amount > 0) lifts.set(id, Math.max(lifts.get(id) ?? 0, Math.min(1, amount))) }
  for (const job of chips) {
    if (!job.running) continue
    raise(job.id, activityFlash(job.activitySeenAt, now))
    for (const peer of job.peers ?? []) {
      if (peer.observedAt === undefined || now < peer.observedAt) continue
      const sender = peer.outgoing ? job.id : peer.target === 'root' ? undefined : peer.target
      const recipient = peer.outgoing ? (peer.target === 'root' ? undefined : peer.target) : job.id
      const t = now - peer.observedAt - (sender ? TURN_LEAD_MS : 0)
      if (t < 0 || t > packetWindow(peer.fresh ?? 1) + 500) continue
      raise(sender, t < 500 ? 1 - t / 500 : 0)
      const landing = t - PACKET_RUN_MS
      raise(recipient, landing > -150 && landing < 500 ? 1 - Math.abs(landing - 100) / 400 : 0)
    }
  }
  return lifts
}

/**
 * Both passages run on Wake's own clock: from the moment this view saw the worker stop or start, never from Bridge's
 * timestamps, which are already seconds old by the time a scan reads them (a passage measured from them is over before
 * it begins). A worker already running when Wake looked has no `arrivedAt`, so it never replays its arrival.
 */
const sinceIn = (at: number | undefined, now: number, length: number) => at !== undefined && now >= at && now - at < length ? now - at : undefined

/** A worker this view has never seen still gets its passage if it started or stopped within a scan or two of now. */
const SEEN_LATE_MS = 20_000

/**
 * The passage stamps for a worker in this scan: `old` is the same worker's chip from the scan before (absent when new to
 * this view). A start or a resume is a worker found running that was not; a stop is one found stopped that was running.
 */
export function passageStamps(old: Pick<WakeChip, 'running' | 'waitingForRoot' | 'state' | 'arrivedAt' | 'leftAt'> | undefined, job: { running: boolean; waitingForRoot?: boolean; state?: string; startedAt?: number; finishedAt?: number }, now: number): Pick<WakeChip, 'arrivedAt' | 'leftAt'> {
  const recent = (at: number | undefined) => at !== undefined && now >= at && now - at < SEEN_LATE_MS
  if (isWorking(job)) return { arrivedAt: old ? (isWorking(old) ? old.arrivedAt : now) : recent(job.startedAt) ? now : undefined }
  return { leftAt: old ? (isWorking(old) ? now : old.leftAt) : recent(job.finishedAt) ? now : undefined }
}

/**
 * Whether a worker is at work, which is what is on the scene: running, and not parked waiting for the root. A worker that has
 * finished its report is DONE even while its runner stays alive for a reply (a Bridge job waiting for the root), so its exit
 * plays when it is done, not only when it is finally retired or stopped; a reply that wakes it plays its arrival again.
 */
export const isWorking = (job: { running: boolean; waitingForRoot?: boolean; state?: string }): boolean =>
  job.running

/** How long ago a worker that is no longer at work was seen to stop, while it is still playing its exit (see exits.ts). */
const leavingFor = (job: WakeChip, now: number) => (isWorking(job) ? undefined : sinceIn(job.leftAt, now, EXIT_MS))

/** How long ago a worker at work was seen to start, while it is still arriving (exits.ts). */
const arrivingFor = (job: WakeChip, now: number) => (isWorking(job) ? sinceIn(job.arrivedAt, now, ARRIVE_MS) : undefined)

/** Each worker's gait clock: it runs on from one paint to the next, faster when the worker is busier (see gait.ts). */
const gaitClock = new PhaseClock()
/** The clock of where a worker is on its route: the same as its gait clock, except that it stands still while the worker hovers to talk to the root. */
const routeClock = new PhaseClock()
/**
 * Resting: a worker settles on a perch only once it has been quiet (waiting, paused, stale) for REST_AFTER_MS on end, so a
 * short wait for a tool or a reply never sends it down; any activity lifts it straight off again. Landing and taking off take
 * SETTLE_MS, and while one plays the worker does nothing else: its route holds until it is down or back up in the air.
 * One seen quiet for the first time (a stale job at startup) is already resting.
 */
export const REST_AFTER_MS = 20_000, SETTLE_MS = 1_600
const settling = new Map<string, { at: number; amount: number; quiet?: number }>()
export const gaitOf = (id: string, pace: number, now: number, rate = 1, stale = false) => {
  const previous = settling.get(id)
  const quiet = stale || pace <= 0.15 ? previous ? previous.quiet ?? now : now - REST_AFTER_MS : undefined
  const rest = quiet !== undefined && now - quiet >= REST_AFTER_MS
  const step = previous ? Math.min(1, Math.max(0, now - previous.at) / SETTLE_MS) : 1
  const amount = previous ? Math.max(0, Math.min(1, previous.amount + (rest ? step : -step))) : Number(rest)
  settling.set(id, { at: now, amount, quiet })
  if (settling.size > 256) for (const key of [...settling.keys()].slice(0, 64)) settling.delete(key)
  const moving = amount > 0 && amount < 1
  return { pace, settle: amount, phase: gaitClock.advance(id, pace, now), route: routeClock.advance(id, pace, now, moving ? 0 : rate) }
}

/**
 * Messages between the main conversation and native subagents, as scene edges: the same trail, packets, calls and replies as a
 * Bridge job's. Only a message to or from a subagent that is on the crew now is drawn. `root` is Mochi's place.
 */
function nativeEdges(state: BandState, now: number) {
  const live = new Set(state.subagents.filter(a => a.leftAt === undefined).map(a => a.id))
  return (state.messages ?? []).filter(m => now >= m.at && now - m.at <= 900_000 && (m.from === 'root' || live.has(m.from)) && (m.to === 'root' || live.has(m.to))).map(m => {
    const toRoot = m.to === 'root', fromRoot = m.from === 'root', lead = fromRoot ? 0 : TURN_LEAD_MS, since = now - m.at
    return {
      source: fromRoot ? 'mochi' : m.from,
      target: toRoot ? 'mochi' : m.to,
      stamp: m.at,
      strength: since < 2_000 ? 0.65 + 0.35 * (Math.floor(since / 400) % 2) : messageFade(since),
      preview: m.preview,
      messageState: toRoot || fromRoot ? 'sent' as const : undefined,
      count: 1,
      arriving: since <= packetWindow(1) + lead + (toRoot || fromRoot ? TURN_LEAD_MS : 0) + 500 ? since : undefined,
      turning: since <= packetWindow(1) + lead + TURN_HOLD_MS ? since : undefined,
      lead: lead || undefined,
      fresh: 1,
      family: 'claude' as const,
    }
  })
}

/** How fast a native subagent's route runs just now: it hovers to talk to the root just as a Bridge worker does (routeFor). */
const agentRouteFor = (id: string, messages: readonly WakeNativeMessage[] | undefined, now: number): number => {
  const m = [...(messages ?? [])].filter(x => x.from === id || x.to === id).sort((a, b) => b.at - a.at)[0]
  if (!m || now < m.at) return 1
  return routeRate(now - m.at, packetWindow(1) + (m.from === id ? TURN_LEAD_MS : 0), TURN_LEAD_MS)
}

/** How fast this worker's route runs just now: it brakes, hovers while it turns to the root, sends and turns back, then sets off again (routeRate). */
const routeFor = (job: WakeChip, now: number): number => {
  const message = [...(job.peers ?? [])].filter(p => p.observedAt !== undefined && now >= p.observedAt).sort((a, b) => b.observedAt! - a.observedAt!)[0]
  if (!message) return 1
  const window = packetWindow(message.fresh ?? 1) + (message.outgoing ? TURN_LEAD_MS : 0)
  return routeRate(now - message.observedAt!, window, TURN_LEAD_MS)
}

export function sceneInput(state: BandState, width: number, frame: number, effect: SceneEffect | null, now: number): SceneInput {
  const lifts = crewLifts(state.chips, now)
  const here = state.here
  const weather = here?.weather ?? null
  const { turns, live } = turnsOf(state.pulse, state.tally.turns, state.turnStartedAt !== null)
  const done = state.plan.filter(step => step.status === 'completed').length
  const localMs = weather ? now + weather.utcOffsetSeconds * 1000 : now
  const season = seasonAt(here?.place.lat ?? 45, new Date(localMs).getUTCMonth())
  const sky = weather ? skyOf(weather.code, weather.isDay) : undefined
  return {
    width,
    frame,
    hour: localHour(now, weather),
    sun: weather ? { rise: weather.sunrise, set: weather.sunset } : { rise: 6, set: 18 },
    moonPhase: moonPhase(now),
    season,
    snowy: weather ? weather.snowfall > 0 || (sky?.snow ?? 0) > 0 || (season === 'winter' && weather.temp <= 0) : false,
    weather: weather ? sceneWeather(weather) : null,
    preset: here?.preset ?? 'city',
    seed: seedOf(here?.place.key ?? 'wake'),
    turns,
    live,
    mood: state.mood,
    character: state.character,
    mail: mailAt(state.chips, now),
    peerEdges: [...state.chips.filter(job => job.running && job.id).flatMap(job => (job.peers ?? [])
      .filter(peer => (peer.target === 'root' ? peer.messageState !== undefined : peer.outgoing)
        && now >= peer.lastAt && now - peer.lastAt <= 900_000)
      .map(peer => {
        const age = now - peer.lastAt
        const pulse = peer.observedAt !== undefined && now >= peer.observedAt && now - peer.observedAt < 2_000
        const rootMessage = peer.target === 'root'
        const lead = peer.outgoing ? TURN_LEAD_MS : 0
        return {
          source: rootMessage && !peer.outgoing ? 'mochi' : job.id!,
          target: rootMessage ? peer.outgoing ? 'mochi' : job.id! : peer.target,
          stamp: peer.messageId ?? peer.lastAt,
          strength: pulse ? 0.65 + 0.35 * (Math.floor((now - peer.observedAt!) / 400) % 2) : messageFade(age),
          preview: peer.preview,
          messageState: rootMessage ? peer.messageState : undefined,
          count: peer.count,
          // packets run only for messages arriving in view right now, one per new message
          arriving: peer.observedAt !== undefined && now >= peer.observedAt && now - peer.observedAt <= packetWindow(peer.fresh ?? 1) + lead + (rootMessage ? TURN_LEAD_MS : 0) + 500 // keep the landing visible after the trail
            ? now - peer.observedAt : undefined,
          turning: peer.observedAt !== undefined && now >= peer.observedAt && now - peer.observedAt <= packetWindow(peer.fresh ?? 1) + lead + TURN_HOLD_MS ? now - peer.observedAt : undefined,
          lead: lead || undefined,
          fresh: peer.fresh,
          family: (['agy', 'claude', 'opencode'] as const).find(kind => kind === job.backend) ?? ('codex' as const),
        }
      })), ...nativeEdges(state, now)],
    jobs: state.chips.filter(job => isWorking(job) || leavingFor(job, now) !== undefined).map(job => {
      const peer = [...(job.peers ?? [])].filter(p => now - p.lastAt <= 900_000 && now >= p.lastAt).sort((a, b) => b.lastAt - a.lastAt)[0]
      return {
      leaving: leavingFor(job, now),
      struck: job.interrupted || undefined, // its last turn was cut off: it leaves by being struck down
      arriving: arrivingFor(job, now),
      lift: job.id ? lifts.get(job.id) : undefined,
      ...gaitOf(job.id ?? `${job.owner}/${job.name}`, isWorking(job) ? paceOf(job, now) : 0.3, now, routeFor(job, now), job.isStale),
      isStale: job.isStale, seed: seedOf(job.name), tier: modelTier(job.backend ?? 'codex', job.model),
      kind: (['agy', 'claude', 'opencode'] as const).find(kind => kind === job.backend) ?? ('codex' as const), maker: job.maker,
      signal: !!peer && peer.observedAt !== undefined && now >= peer.observedAt && now - peer.observedAt < 2_000 && Math.floor((now - peer.observedAt) / 400) % 2 === 1,
      hit: job.id || job.owner ? {
        id: job.id ?? `${job.owner}/${job.name}`, title: job.title ?? job.name,
        details: [
          ...(peer ? [`${peer.outgoing ? 'To' : 'From'}: ${peer.target}`, messagePreview(peer.preview)] : []),
          ...(peer ? [messageStatus(peer.messageState)] : []),
          `Harness: ${job.backend ?? 'codex'}`,
          job.model ? `Model ID: ${job.model}` : 'Model not reported',
          ...(job.effort ? [`Effort: ${job.effort}`] : []),
        ],
      } : undefined,
    }}),
    agents: state.subagents.filter(agent => agent.leftAt === undefined || now - agent.leftAt < EXIT_MS).map(agent => ({
      id: agent.id, seed: seedOf(agent.id), tier: agent.tier, ...gaitOf(agent.id, agent.leftAt === undefined ? 0.75 : 0.3, now, agentRouteFor(agent.id, state.messages, now)),
      leaving: agent.leftAt !== undefined && now >= agent.leftAt ? now - agent.leftAt : undefined,
      struck: agent.interrupted || undefined,
      arriving: agent.leftAt === undefined && now >= agent.since && now - agent.since < ARRIVE_MS ? now - agent.since : undefined,
      hit: {
        id: agent.id, title: agent.name ?? agent.description,
        details: [`Claude subagent · ${agent.type}`, agent.model ? `Model ID: ${agent.model}` : 'Model not reported'],
      },
    })),
    plan: state.plan.length > 0 ? { done, total: state.plan.length } : null,
    effect,
  }
}
