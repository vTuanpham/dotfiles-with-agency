import type { WakeChip, WakeMood, WakePulse, WakeStep, WakeSurroundings, WakeTally, WakeWeather } from '../types'
import { PACKET_RUN_MS, TURN_LEAD_MS, activityFlash, messageFade, packetWindow } from './crew-row'
import type { Season } from './landscapes/kit'
import { seedOf } from './pixels'
import { PhaseClock, paceOf } from './landscapes/gait'
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
 * A running worker with no message of its own stays tied to the root: a faint, still thread from Mochi. It is a
 * relationship, not a message, so nothing travels it. Native subagents and Bridge jobs both wear one; four at most,
 * so a big crew never turns the sky into wiring.
 */
function tethers(state: BandState, now: number): NonNullable<SceneInput['peerEdges']> {
  const talking = new Set(state.chips.filter(job => (job.peers ?? []).some(peer => peer.target === 'root'
    && peer.messageState !== undefined && now >= peer.lastAt && now - peer.lastAt <= 900_000)).map(job => job.id))
  const edges: NonNullable<SceneInput['peerEdges']> = [
    ...state.subagents.filter(agent => agent.leftAt === undefined).map(agent => ({ id: agent.id, family: 'claude' as const, name: agent.name ?? agent.description, what: `Claude subagent · ${agent.type}`, activeAt: undefined as number | undefined })),
    ...state.chips.filter(job => job.running && job.id && !talking.has(job.id)).map(job => ({
      id: job.id!, family: (['agy', 'claude', 'opencode'] as const).find(kind => kind === job.backend) ?? ('codex' as const), name: job.title ?? job.name, what: `Bridge job · ${job.backend}`, activeAt: job.lastEventAt,
    })),
  ].slice(0, 4).map(worker => ({
    source: 'mochi', target: worker.id,
    // as present as the worker is busy: bright just after its last real event, fading over minutes of silence (a subagent has no event feed: steady)
    strength: worker.activeAt === undefined ? 0.45 : 0.12 + 0.55 * Math.exp(-Math.max(0, now - worker.activeAt) / 180_000),
    preview: `${worker.what} · working for the root`, count: 1, family: worker.family, relationship: true,
  }))
  return edges
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
      const t = now - peer.observedAt
      if (t > packetWindow(peer.fresh ?? 1) + 500) continue
      const sender = peer.outgoing ? job.id : peer.target === 'root' ? undefined : peer.target
      const recipient = peer.outgoing ? (peer.target === 'root' ? undefined : peer.target) : job.id
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
export function passageStamps(old: Pick<WakeChip, 'running' | 'arrivedAt' | 'leftAt'> | undefined, job: { running: boolean; startedAt?: number; finishedAt?: number }, now: number): Pick<WakeChip, 'arrivedAt' | 'leftAt'> {
  const recent = (at: number | undefined) => at !== undefined && now >= at && now - at < SEEN_LATE_MS
  if (job.running) return { arrivedAt: old ? (old.running ? old.arrivedAt : now) : recent(job.startedAt) ? now : undefined }
  return { leftAt: old ? (old.running ? now : old.leftAt) : recent(job.finishedAt) ? now : undefined }
}

/** How long ago a worker that is no longer running was seen to stop, while it is still playing its exit (see exits.ts). */
const leavingFor = (job: WakeChip, now: number) => (job.running ? undefined : sinceIn(job.leftAt, now, EXIT_MS))

/** How long ago a running worker was seen to start, while it is still arriving (exits.ts). */
const arrivingFor = (job: WakeChip, now: number) => (job.running ? sinceIn(job.arrivedAt, now, ARRIVE_MS) : undefined)

/** Each worker's gait clock: it runs on from one paint to the next, faster when the worker is busier (see gait.ts). */
const gaitClock = new PhaseClock()
const gaitOf = (id: string, pace: number, now: number) => ({ pace, phase: gaitClock.advance(id, pace, now) })

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
        const lead = rootMessage && peer.outgoing ? TURN_LEAD_MS : 0 // a worker turns to face the root before it sends to her
        return {
          source: rootMessage && !peer.outgoing ? 'mochi' : job.id!,
          target: rootMessage ? peer.outgoing ? 'mochi' : job.id! : peer.target,
          strength: pulse ? 0.65 + 0.35 * (Math.floor((now - peer.observedAt!) / 400) % 2) : messageFade(age),
          preview: peer.preview,
          messageState: rootMessage ? peer.messageState : undefined,
          count: peer.count,
          // packets run only for messages arriving in view right now, one per new message
          arriving: peer.observedAt !== undefined && now >= peer.observedAt && now - peer.observedAt <= packetWindow(peer.fresh ?? 1) + lead
            ? now - peer.observedAt : undefined,
          lead: lead || undefined,
          fresh: peer.fresh,
          family: (['agy', 'claude', 'opencode'] as const).find(kind => kind === job.backend) ?? ('codex' as const),
        }
      })), ...tethers(state, now)],
    jobs: state.chips.filter(job => job.running || leavingFor(job, now) !== undefined).map(job => {
      const peer = [...(job.peers ?? [])].filter(p => now - p.lastAt <= 900_000 && now >= p.lastAt).sort((a, b) => b.lastAt - a.lastAt)[0]
      return {
      leaving: leavingFor(job, now),
      struck: job.interrupted || undefined, // its last turn was cut off: it leaves by being struck down
      arriving: arrivingFor(job, now),
      lift: job.id ? lifts.get(job.id) : undefined,
      ...gaitOf(job.id ?? `${job.owner}/${job.name}`, job.running ? paceOf(job, now) : 0.3, now),
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
      id: agent.id, seed: seedOf(agent.id), tier: agent.tier, ...gaitOf(agent.id, agent.leftAt === undefined ? 0.75 : 0.3, now),
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
