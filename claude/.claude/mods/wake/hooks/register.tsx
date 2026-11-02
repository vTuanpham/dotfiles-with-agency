import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, Timer } from 'claude-code'

import type { WakeAgent, WakeCall, WakeChip, WakeQuota, WakeDigest, WakeMood, WakeNeed, WakeNow, WakePreset, WakePulse, WakePulseKind, WakeRecap, WakeRecapLine, WakeSceneHit, WakeStep, WakeSurroundings, WakeTally } from '../types'
import { ownedBy, ownersIn, scanCodex, withoutDetachedOwners, type CodexCursor } from './sources/codex'
import { makerOf, modelTier, scanQuotas } from './sources/accounts'
import { extractCalls, writeRecap } from './sources/recap'
import { scanTidy, tidyRequest } from './sources/tidy'
import { type BandState, sceneInput } from './band'
import { EFFECT_FRAMES, SCENE_ROWS, type SceneEffect, type SceneHitMap, type SceneSelection, readScenePointer, sceneCardBounds, sceneFrame, sceneHitAt } from './scene'
import { PRESETS, nextRain, skyOf } from './sources/weather'
import { lookAround, namePlace, pinPreset } from './surroundings'
import { CHARACTERS, CHARACTER_IDS, type CharacterId, asCharacter, isCharacter } from './mochi'
import { COLOR, readable, clock, commandHead, hash, isAnswerText, isTestCommand, lines, patchCounts, shortPath, span } from './util'
import { CLASS_GLYPH, activityFlash, cells, harnessSpin, packetWindow, type RootCell, type RootLink, rootSpine, crewBox, crewPage, crewRows, quotaMark, quotaRows, quotaText, truncate } from './crew-row'
import { type EffortLevels, effortDots, levelsFor, scanEfforts } from './sources/efforts'
import { PeerMessageTracker } from './peer-messages'
import { LOGOS, modelLogo } from './logos'

// Wake lives in the flow of the chat: a living diorama above the prompt (the session as a
// town in the real weather where you are, Mochi on the street), a line of words and the
// crew at work (subagents, bridge jobs) under it, then whatever needs you; the plan in the
// spinner; cards in the transcript; chips under the answer that made a judgment call.
// It observes; it never blocks.

const AWAY_MS = 10 * 60_000
const ASK_AWAY_MS = 3 * 60_000
const CODEX_POLL_MS = 15_000
const QUOTA_POLL_MS = 60_000 // Read provider caches; only agy refreshes on this schedule.
const AGY_REFRESH = 30
const ANIMATE_MS = 400
const PACKET_FRAME_MS = 120 // rows redraw this often only while a real message's packets are on their way
const SCENE_MS = 50 // the diorama paints 20 a second: half steps of its frame, which motion paces at 10 a second
const AGENTS_MS = 2_000
const SURROUNDINGS_MS = 10 * 60_000
const NOTICE = '◈ wake'
const dimPeer = (color: string, subtle: string, strength: number) => '#' + [1, 3, 5].map(i =>
  Math.round(parseInt(color.slice(i, i + 2), 16) * strength + parseInt(subtle.slice(i, i + 2), 16) * (1 - strength)).toString(16).padStart(2, '0')).join('')

/** `color` lifted toward `light` by `amount` (0..1). */
const glint = (color: string, light: string, amount: number) => amount <= 0 ? color : dimPeer(light, color, Math.min(1, amount) * 0.8)

/** Nerd Font glyphs (escaped: editors drop private-use characters); the dingbat marks are missing from many fonts. */
const G = {
  done: '\u{f00c}',
  fail: '\u{f00d}',
  needs: '\u{f071}',
  agent: '\u{f021}',
  call: '\u{f0e3}',
  idle: '\u{f10c}',
  sleep: '\u{f186}',
  stale: '\u{f252}',
  wake: '\u{f0eb}',
  umbrella: '\u{e34b}',
  pin: '\u{f041}',
}

const MARK: Record<WakeRecapLine['mark'], { glyph: string; color: string }> = {
  done: { glyph: G.done, color: COLOR.green },
  decision: { glyph: G.call, color: COLOR.mauve },
  needs: { glyph: G.needs, color: COLOR.yellow },
  agent: { glyph: G.agent, color: COLOR.teal },
  fail: { glyph: G.fail, color: COLOR.red },
}

/** Nerd Font circle slices (the status line's spinner); the geometric quarter circles are missing from many fonts. */
const spinner = (frame: number) => String.fromCodePoint(0xf0a9e + (frame % 8))
/** What a bridge job is called to the person: its title, else (old jobs) its name. */
const titleOf = (job: { name: string; title?: string }) => job.title ?? job.name

const diamond = (frame: number) => '◆◇◈◇◆◇◈◇'[frame % 8]!
/** The working headline's spinner takes its shape from the landscape the session is standing in. */
const SCENE_SPIN: Record<WakePreset, string> = {
  city: '▁▃▅▇▅▃', harbor: '≈∽~∽', beach: '∽≈~≈', mountains: '▁▂▃▄▅▆▇▆▅▄▃▂', countryside: '✿❀✾❀', forest: '❦❧☙❧', desert: '◜◠◝◞◡◟', tundra: '❄❅❆❅',
}
const sceneSpin = (place: WakePreset, frame: number) => { const set = [...SCENE_SPIN[place]]; return set[frame % set.length]! }
/** What the headline is doing sets its motion: a shell spins, tests fill a gauge, edits grow a caret, reads fill a page, searches circle, agents turn a gem, the web turns a globe; thinking keeps the landscape's own. */
const KIND_SPIN: Partial<Record<WakePulseKind, string>> = {
  run: '⣾⣽⣻⢿⡿⣟⣯⣷', test: '○◔◑◕●◕◑◔', edit: '▏▎▍▌▋▊▉▊▋▌▍▎', read: '⠁⠃⠇⡇⣇⣧⣷⣿', search: '◜◝◞◟', agent: '◇◈◆◈', web: '◐◓◑◒',
}
const workSpin = (place: WakePreset, kind: WakePulseKind | undefined, frame: number) => {
  const set = [...(kind && KIND_SPIN[kind] || '')]
  return set.length ? set[frame % set.length]! : sceneSpin(place, frame)
}

const hex = (rgb: number) => '#' + rgb.toString(16).padStart(6, '0')

const PRESET_LABEL: Record<WakePreset, string> = {
  city: 'City',
  harbor: 'Harbor',
  beach: 'Beach',
  mountains: 'Mountains',
  countryside: 'Countryside',
  forest: 'Forest',
  desert: 'Desert',
  tundra: 'Tundra',
}

const freshDigest = (awaySince: number, prompt?: string): WakeDigest => ({
  awaySince, prompt, answers: [], files: [], failures: [], tests: [], agents: [], codex: [], needs: [],
})

const mood = atom({ plugin: 'wake', key: 'mood' } as const, 'idle' as WakeMood)
const plan = atom({ plugin: 'wake', key: 'plan' } as const, [] as WakeStep[])
const needs = atom({ plugin: 'wake', key: 'needs' } as const, [] as WakeNeed[])
const calls = atom({ plugin: 'wake', key: 'calls' } as const, [] as WakeCall[])
const chips = atom({ plugin: 'wake', key: 'chips' } as const, [] as WakeChip[])
const owners = atom({ plugin: 'wake', key: 'owners' } as const, [] as string[])
const quotas = atom({ plugin: 'wake', key: 'quotas' } as const, [] as WakeQuota[])
// which effort levels each model offers, read from the native inventory; refreshed a few times a day, not hardcoded
const effortLevels = atom({ plugin: 'wake', key: 'effortLevels' } as const, { at: 0, levels: {} as EffortLevels })
const EFFORT_LEVELS_MS = 6 * 60 * 60_000
const EFFORT_RETRY_MS = 10 * 60_000
const recap = atom({ plugin: 'wake', key: 'recap' } as const, null as WakeRecap | null)
const digest = atom({ plugin: 'wake', key: 'digest' } as const, freshDigest(0))
const turnStartedAt = atom({ plugin: 'wake', key: 'turnStartedAt' } as const, null as number | null)
const lastActivity = atom({ plugin: 'wake', key: 'lastActivity' } as const, 0)
const tick = atom({ plugin: 'wake', key: 'tick' } as const, 0)
const doing = atom({ plugin: 'wake', key: 'now' } as const, null as WakeNow | null)
const pulse = atom({ plugin: 'wake', key: 'pulse' } as const, [] as WakePulse[])
const tally = atom({ plugin: 'wake', key: 'tally' } as const, { turns: 0, added: 0, removed: 0, files: [], lastTurnMs: 0 } as WakeTally)
const subagents = atom({ plugin: 'wake', key: 'subagents' } as const, [] as WakeAgent[])
const agentModels = atom({ plugin: 'wake', key: 'agentModels' } as const, {} as Record<string, string>) // subagent id -> the model its spawn resolved to
const parentModel = atom({ plugin: 'wake', key: 'parentModel' } as const, '')
const characterAtom = atom({ plugin: 'wake', key: 'character' } as const, 'mochi' as CharacterId) // who stands in Mochi's place (/wake mochi)
const parentEffort = atom({ plugin: 'wake', key: 'parentEffort' } as const, '') // the session's effort level, what a subagent inherits
const agentEfforts = atom({ plugin: 'wake', key: 'agentEfforts' } as const, {} as Record<string, string>) // subagent id -> the effort its tool calls reported
const surroundings = atom({ plugin: 'wake', key: 'surroundings' } as const, null as WakeSurroundings | null)
const crewPageIndex = atom({ plugin: 'wake', key: 'crewPage' } as const, 0)

/** Bookkeeping must never break a tool call or a turn. */
async function safely(work: () => unknown): Promise<void> {
  try {
    await work()
  } catch {
    // observation only
  }
}

// Module state resets on a hot reload; the timers are restarted where they are needed.
let animation: Timer | null = null
let laneLoop: Timer | null = null // redraws the crew rows while a message is fresh or a job works
let laneEvery = 0
let codexPoll: Timer | null = null
let quotaPoll: Timer | null = null
let effortPoll: Timer | null = null
let quotaTicks = 0
let awayTimer: Timer | null = null
let recapGeneration = 0
let userActivityInFlight = 0
let callRevision = 0
const resolvedCalls = new Map<string, number>()
let cursor: CodexCursor = {}
let turnFailed = false
let previousTurnFailed = false // the turn before this one ended on a failed command: passing tests now clear the weather
let turnTestsOk = false
const taskIds = new Map<string, string>() // tool_use_id of a TaskCreate -> its subject, until the id is known
let frameNo = 0
let labelClockBucket: number | null = null
const peerMessages = new PeerMessageTracker()
let effect: { kind: SceneEffect['kind']; start: number } | null = null
let tour: { start: number } | null = null // /wake tour: every landscape in turn, a whole day in each
const TOUR_FRAMES = 120 // 12 s a landscape

/** The landscape and hour the tour shows at a frame, or null when no tour plays. */
function tourAt(frame: number): { preset: WakePreset; hour: number; index: number } | null {
  if (!tour) return null
  const t = frame - tour.start
  const index = Math.floor(t / TOUR_FRAMES)
  if (index >= PRESETS.length) return null
  return { preset: PRESETS[index]!, hour: (4 + ((t % TOUR_FRAMES) / TOUR_FRAMES) * 24) % 24, index }
}

/** The scene input with the tour's landscape and hour laid over, while a tour plays. */
function toured<T extends { preset: WakePreset; hour: number }>(input: T): T {
  const at = tourAt(frameNo)
  return at ? { ...input, preset: at.preset, hour: at.hour } : input
}
let band: { id: string; width: number } | null = null // where the scene is mounted, for blits
let sceneHitMap: SceneHitMap | null = null
let scenePointer: { x: number; y: number } | null = null
let sceneSelection: SceneSelection | null = null
let lastSceneTarget: WakeSceneHit | null = null
let scenePainting = false
let sceneRetryAt = 0
let sceneRetryDelay = 50
let sceneLoop: Timer | null = null
let agentLoop: Timer | null = null
let surroundLoop: Timer | null = null

/** Plays a session effect in the scene: fireworks, a storm, a shooting star. */
const play = (kind: SceneEffect['kind']) => {
  effect = { kind, start: frameNo }
}

/** One frame of the diorama, blitted into the mounted Raster without a redraw. */
async function paint($: EngineInterface) {
  frameNo += 0.5
  const target = band
  if (!target) { sceneHitMap = null; return }
  if (scenePainting) return
  const now = await $.clock.now()
  if (now < sceneRetryAt || band !== target || scenePainting) return
  scenePainting = true
  try {
    const age = effect ? frameNo - effect.start : 0
    if (effect && age >= EFFECT_FRAMES[effect.kind]) effect = null
    if (tour && !tourAt(frameNo)) tour = null
    if (tour && (frameNo - tour.start) % TOUR_FRAMES === 0) await update($, tick, n => n + 1)
    const input = toured(sceneInput(await bandState($), target.width, frameNo, effect ? { kind: effect.kind, age } : null, now))
    const frame = sceneFrame(input, sceneSelection)
    const done = await $.ui.blit({ requestId: target.id, key: 'scene', columns: target.width, rows: SCENE_ROWS, cells: frame.cells })
    if (band !== target) return
    if (done.deny) {
      sceneHitMap = null
      sceneRetryAt = now + sceneRetryDelay
      sceneRetryDelay = Math.min(1_000, sceneRetryDelay * 2)
    } else {
      sceneRetryAt = 0
      sceneRetryDelay = 50
      sceneHitMap = frame.hits
    }
  } catch {
    if (band === target) {
      sceneHitMap = null
      sceneRetryAt = now + sceneRetryDelay
      sceneRetryDelay = Math.min(1_000, sceneRetryDelay * 2)
    }
  } finally {
    scenePainting = false
  }
}

function updateSceneHover(x: number, y: number, hadPointer: boolean) {
  const prior = sceneSelection
  if (hadPointer && prior && sceneHitMap) {
    const card = sceneCardBounds(sceneHitMap.columns, sceneHitMap.rows, { x: prior.x, y: prior.y, details: prior.target.details })
    if (card && x >= card.left && x < card.left + card.width && y >= card.top && y < card.top + card.height) return
  }
  const target = sceneHitAt(sceneHitMap, x, y)
  const next = target ? { target, x, y } : null
  if (hadPointer && prior?.target.id === next?.target.id && prior?.target.title === next?.target.title
    && prior?.target.details.join('\n') === next?.target.details.join('\n')) {
    if (target) lastSceneTarget = target
    return
  }
  sceneSelection = next
  if (target) lastSceneTarget = target
}

function resetSceneSelection() {
  lastSceneTarget = null
  scenePointer = null
  sceneSelection = null
}

/** What the scene reads from the session. */
async function bandState($: EngineInterface): Promise<BandState> {
  const crew = await read($, subagents)
  const parent = await read($, parentModel)
  return {
    here: await read($, surroundings),
    tally: await read($, tally),
    turnStartedAt: await read($, turnStartedAt),
    pulse: await read($, pulse),
    plan: await read($, plan),
    mood: await read($, mood),
    chips: await read($, chips),
    character: await read($, characterAtom),
    subagents: crew.map(a => ({ id: a.id, name: a.name, description: a.description, type: a.type, model: a.model, tier: modelTier('claude', a.model || parent) })),
  }
}

/** Looks around (place, landscape, weather) and keeps what it finds. */
async function refreshSurroundings($: EngineInterface, force = false) {
  const chosen = asCharacter(await $.store.get('mochi').catch(() => undefined)) // another session may have chosen
  if (chosen !== (await read($, characterAtom))) await update($, characterAtom, () => chosen)
  const found = await lookAround($, force)
  if (found && JSON.stringify(found) !== JSON.stringify(await read($, surroundings))) await update($, surroundings, () => found)
}

/** The running Claude Code subagents, written only when the list changes. */
async function pollAgents($: EngineInterface) {
  const live = (await $.agent.list()).filter(agent => agent.status === 'running' || agent.status === 'pending' || agent.status === 'waiting')
  const prior = await read($, subagents)
  const now = await $.clock.now()
  const models = await read($, agentModels)
  const efforts = await read($, agentEfforts)
  const inherited = await read($, parentEffort)
  const next = live.map(agent => ({ id: agent.id, type: agent.type, description: agent.description, name: agent.name, since: prior.find(p => p.id === agent.id)?.since ?? now, model: models[agent.id], effort: efforts[agent.id] ?? (inherited || undefined) }))
  if (JSON.stringify(next) !== JSON.stringify(prior)) await update($, subagents, () => next)
}

function watchScene($: EngineInterface) {
  sceneLoop ??= $.clock.every(SCENE_MS, () => void safely(() => paint($)))
  agentLoop ??= $.clock.every(AGENTS_MS, () => void safely(() => pollAgents($)))
  if (!surroundLoop) {
    surroundLoop = $.clock.every(SURROUNDINGS_MS, () => void safely(() => refreshSurroundings($)))
    void safely(() => refreshSurroundings($))
  }
}

function animate($: EngineInterface, on: boolean) {
  if (on) animation ??= $.clock.every(ANIMATE_MS, () => void update($, tick, n => n + 1).catch(() => {}))
  else {
    animation?.cancel()
    animation = null
  }
}

/**
 * Redraw the crew rows only while something real moves: a message's packets on their way, or a worker's activity flash.
 * Packets cross a lane in about a second, so frames are quick while they run; otherwise the rows rest and nothing redraws.
 */
function animateLanes($: EngineInterface, mode: 'packets' | null) {
  const every = PACKET_FRAME_MS
  if (mode === null || laneEvery !== every) {
    laneLoop?.cancel()
    laneLoop = null
    laneEvery = 0
  }
  if (mode !== null && !laneLoop) {
    laneLoop = $.clock.every(every, () => void update($, tick, n => n + 1).catch(() => {}))
    laneEvery = every
  }
}

function pollCodex($: EngineInterface) {
  codexPoll ??= $.clock.every(CODEX_POLL_MS, () => void safely(() => codexTick($)))
  if (!effortPoll) {
    // its own slow schedule: the inventory changes rarely and is independent of quota polling
    $.clock.after(5_000, () => void safely(() => effortTick($)))
    effortPoll = $.clock.every(EFFORT_RETRY_MS, () => void safely(() => effortTick($))) // cheap: the tick returns until the table is due
  }
  if (!quotaPoll) {
    void safely(() => quotaTick($))
    quotaPoll = $.clock.every(QUOTA_POLL_MS, () => void safely(() => quotaTick($)))
  }
}

/** Which effort levels each model offers, from the native inventory: once on start, then a few times a day. */
async function effortTick($: EngineInterface) {
  const known = await read($, effortLevels)
  const now = await $.clock.now()
  if (now - known.at < EFFORT_LEVELS_MS) return
  const levels = await scanEfforts($, ['codex', 'claude', 'agy', 'opencode'], known.levels)
  // a scan that found nothing is retried soon: stamping it would leave every effort a bare word for six hours
  await update($, effortLevels, () => ({ at: Object.keys(levels).length ? now : now - EFFORT_LEVELS_MS + EFFORT_RETRY_MS, levels }))
}

export async function quotaTick($: EngineInterface) {
  const mine = await read($, owners)
  const activeOwners = [...new Set((await read($, chips)).flatMap(job =>
    job.running && job.owner && ownedBy({ owner: job.owner }, mine) ? [job.owner] : []))]
  if (!activeOwners.length) return
  const found = await scanQuotas($, { owners: activeOwners, refreshAgy: quotaTicks++ % AGY_REFRESH === 0 })
  // an account that timed out this read keeps its last numbers rather than dropping off the line
  const projectQuotas = (previous: WakeQuota[]) =>
    found.map(q => (q.parts.length > 0 || q.status !== undefined ? q : { ...q, parts: previous.find(p => p.cli === q.cli && p.account === q.account)?.parts ?? q.parts }))
  const priorQuotas = await read($, quotas)
  if (JSON.stringify(projectQuotas(priorQuotas)) !== JSON.stringify(priorQuotas)) await update($, quotas, projectQuotas)
}

async function isAway($: EngineInterface, threshold: number) {
  return (await $.clock.now()) - (await read($, lastActivity)) >= threshold
}

/** A card in the transcript: a notice the model never reads, drawn richly by the InfoNotice hook. */
function card($: EngineInterface, header: string, body: string[]) {
  return $.session.append({ message: { type: 'system', content: [{ type: 'text', text: [`${NOTICE} · ${header}`, ...body].join('\n') }] } })
}

const base = (file: unknown) => String(file ?? '').split('/').pop() || '…'

/** A tool call in words a person would say, and its kind for the ribbon. */
function activity(e: { tool: string } & Record<string, unknown>): { label: string; kind: WakePulseKind } {
  switch (e.tool) {
    case 'Bash': {
      const command = String(e.command ?? '')
      return isTestCommand(command) ? { label: `Testing · ${commandHead(command)}`, kind: 'test' } : { label: `Running ${commandHead(command)}`, kind: 'run' }
    }
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return { label: `Editing ${base(e.file_path ?? e.notebook_path)}`, kind: 'edit' }
    case 'Read':
      return { label: `Reading ${base(e.file_path)}`, kind: 'read' }
    case 'Grep':
    case 'Glob':
      return { label: `Searching ${String(e.pattern ?? '')}`, kind: 'search' }
    case 'Agent':
    case 'Task':
      return { label: `Agent · ${String(e.description ?? e.subagent_type ?? '')}`, kind: 'agent' }
    case 'WebFetch':
    case 'WebSearch':
      return { label: `Browsing ${String(e.query ?? e.url ?? '')}`, kind: 'web' }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return { label: 'Planning', kind: 'plan' }
    default:
      return { label: e.tool.replace(/^mcp__([^_]+)__/, '$1 · '), kind: 'run' }
  }
}

const recapBody = (lines_: WakeRecapLine[]) => lines_.map(line => `${MARK[line.mark].glyph} ${line.text}`)

export async function codexTick($: EngineInterface) {
  const mine = await read($, owners)
  const sessionId = await $.session.id()
  const scan = await scanCodex($, cursor, {
    root: { backend: 'claude', session_id: sessionId },
    owners: mine,
  })
  cursor = scan.cursor
  const detachedOwners = scan.detachedOwners.filter(owner => mine.includes(owner))
  scan.jobs = scan.jobs.filter(job => ownedBy(job, mine)) // other sessions share the root
  if (detachedOwners.length) {
    const priorNeeds = await read($, needs)
    if (withoutDetachedOwners(priorNeeds, detachedOwners).length !== priorNeeds.length) {
      await update($, needs, list => withoutDetachedOwners(list, detachedOwners))
    }
    const priorDigest = await read($, digest)
    if (withoutDetachedOwners(priorDigest.codex, detachedOwners).length !== priorDigest.codex.length) {
      await update($, digest, value => ({ ...value, codex: withoutDetachedOwners(value.codex, detachedOwners) }))
    }
  }
  const now = await $.clock.now()
  const peerScope = JSON.stringify([
    sessionId,
    [...mine].sort(),
    detachedOwners.filter(owner => mine.includes(owner)).sort(),
  ])
  // New IDs pulse when Bridge first exposes their record to this Wake session.
  // `lastAt` can be the attempt-start time, so it is not an observation clock.
  const newPeerMessages = peerMessages.observe(peerScope, scan.jobs)
  const projectChips = (previous: WakeChip[]) => scan.jobs
    .filter(job => job.running || job.awaitingRoot || (job.finishedAt ?? 0) > now - 30 * 60_000)
    .map(job => ({ id: job.id, owner: job.owner, name: job.name, title: titleOf(job), backend: job.backend, account: job.account, model: job.model, effort: job.effort, running: job.running, isStale: job.isStale, since: job.finishedAt ?? job.lastEventAt, startedAt: job.startedAt, lastEventAt: job.eventKnown ? job.lastEventAt : undefined, activitySeenAt: (() => {
      // When this view first saw the worker do something new; the first sight of a job is not an event.
      const oldJob = previous.find(old => old.id === job.id)
      const last = job.eventKnown ? job.lastEventAt : undefined
      return oldJob && last !== undefined && last !== oldJob.lastEventAt ? now : oldJob?.activitySeenAt
    })(), awaitingRoot: job.awaitingRoot, waitingForRoot: job.waitingForRoot, maker: makerOf(job.model), state: job.state, reason: job.reason, memoryBytes: job.memoryBytes, memoryCap: job.memoryCap, peers: job.peers.map(peer => {
      const oldJob = previous.find(old => old.id === job.id)
      const old = oldJob?.peers?.find(p => p.target === peer.target && p.outgoing === peer.outgoing)
      const changed = peer.messageId && newPeerMessages.has(JSON.stringify([job.owner, job.id, peer.messageId]))
      // one packet per message that arrived since the last look (a burst of three runs three), capped so a flood stays legible
      const fresh = changed ? Math.min(5, Math.max(1, peer.count - (old?.count ?? peer.count - 1))) : old?.messageId === peer.messageId ? old?.fresh : undefined
      return { ...peer, observedAt: changed ? now : old?.messageId === peer.messageId ? old?.observedAt : undefined, fresh }
    }), waitingPeer: job.waitingPeer }))
  const priorChips = await read($, chips)
  const nextChips = projectChips(priorChips)
  if (JSON.stringify(nextChips) !== JSON.stringify(priorChips)) await update($, chips, projectChips)
  const away = await isAway($, ASK_AWAY_MS)
  for (const job of scan.jobs) {
    for (const ask of job.urgent) {
      const text = ask.text.replace(/^URGENT:\s*/, '')
      await update($, needs, list => [...list, { id: hash(job.dir + ask.at), kind: 'codex-ask' as const, owner: job.owner, job: job.name, title: titleOf(job), text, at: ask.at }].slice(-6))
      await card($, `${job.backend} ${titleOf(job)} asks`, [`${G.needs} ${text}`])
      await update($, digest, d => ({ ...d, codex: [...d.codex, { owner: job.owner, name: titleOf(job), model: job.model, urgent: text }] }))
      await update($, mood, () => 'alert')
      if (away) await $.ui.notify(`${job.backend} ${titleOf(job)}: ${text.slice(0, 120)}`, { title: 'Wake · needs you' })
    }
    if (job.completedNow) {
      const summary = (job.lastMessage ?? '').split('\n')[0]!.slice(0, 160)
      // one done row per job: a later turn replaces it
      await update($, needs, list => [...list.filter(one => one.kind !== 'codex-done' || one.owner !== job.owner || one.job !== job.name), { id: hash(job.dir + job.finishedAt), kind: 'codex-done' as const, owner: job.owner, job: job.name, title: titleOf(job), text: summary, at: now }].slice(-6))
      play('shoot')
      await card($, `${job.backend} ${titleOf(job)} finished · ${job.model} ${job.effort}`, [`${G.agent} ${summary || 'no final message'}`])
      await update($, digest, d => ({ ...d, codex: [...d.codex, { owner: job.owner, name: titleOf(job), model: job.model, summary }] }))
      if (away) await $.ui.notify(`${job.backend} ${titleOf(job)} finished`, { title: 'Wake' })
    }
  }
  if (away && (scan.detachedOwners.length || scan.jobs.some(job => job.completedNow || job.urgent.length))) await refreshRecap($)
  const clockBucket = Math.floor(now / CODEX_POLL_MS)
  if (clockBucket !== labelClockBucket) {
    labelClockBucket = clockBucket
    if (!animation && ((await read($, tally)).turns > 0
      || nextChips.some(job => job.running || job.awaitingRoot)
      || (await read($, subagents)).length > 0 || await read($, recap))) await update($, tick, value => value + 1)
  }
}

async function refreshRecap($: EngineInterface, generation = ++recapGeneration) {
  if (userActivityInFlight) return
  const since = await read($, lastActivity)
  if (!(await isAway($, AWAY_MS)) || (await read($, turnStartedAt)) !== null) return
  const d = await read($, digest)
  const open = (await read($, needs)).map(need => `${(need.title ?? need.job)}: ${need.text}`)
  const written = await writeRecap($, { ...d, codex: d.codex.filter(c => !c.urgent), needs: open })
  const next = written.lines.length ? { lines: written.lines, awaySince: since, source: written.source } : null
  if (generation === recapGeneration && JSON.stringify(next) !== JSON.stringify(await read($, recap))) {
    await update($, recap, previous => generation !== recapGeneration ? previous : next)
  }
}

async function goAway($: EngineInterface, since: number) {
  if (userActivityInFlight) return
  const generation = ++recapGeneration
  if ((await read($, lastActivity)) !== since || (await read($, turnStartedAt)) !== null) return
  await update($, mood, previous => generation === recapGeneration ? 'sleep' : previous)
  await refreshRecap($, generation)
}

async function resolveCall($: EngineInterface, id: string) {
  resolvedCalls.set(id, ++callRevision)
  await update($, calls, list => list.filter(call => call.id !== id))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    labelClockBucket = null
    cursor = {}
    peerMessages.reset()
    await safely(async () => {
      resetSceneSelection()
      await $.command.register({ name: 'wake', description: 'What Wake knows; /wake legend, detail, tour, scene or place', argumentHint: '[legend|detail|tour|scene <name>|place <city>]' })
      await $.tool.register({
        name: 'tidy_scan',
        description:
          'Read-only scan of retired agent-bridge jobs past their purge date ($AGENT_BRIDGE_HOME/jobs, default ~/.local/state/agent-bridge/jobs), with reclaimable sizes and dirty worktrees. Returns a purge request for the root; deletes nothing itself. Restorable jobs before their purge date are excluded.',
        inputSchema: { type: 'object', properties: { olderThanDays: { type: 'number', description: 'Also require this many idle days (default 0); never overrides the purge date' } } },
        isDeferred: true,
      })
      pollCodex($)
      watchScene($)
      await update($, lastActivity, () => Date.now())
    })
    return next(e)
  })

  // /clear, /resume and /branch reset $.state without a new session.start: look around again at once
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    labelClockBucket = null
    cursor = {}
    peerMessages.reset()
    await safely(async () => {
      resetSceneSelection()
      await update($, lastActivity, () => Date.now())
      await refreshSurroundings($)
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.message', { element: 'scene-pointer' }, (_$, e, next) => {
    const pointer = readScenePointer(e.data)
    if (!pointer) return next(e)
    const position = pointer.type !== 'leave' ? { x: pointer.x, y: pointer.y } : null
    if (position && scenePointer?.x === position.x && scenePointer.y === position.y) return {}
    const hadPointer = scenePointer !== null
    scenePointer = position
    updateSceneHover(position?.x ?? -1, position?.y ?? -1, hadPointer)
    // The next Raster blit paints the card too; no Client or band redraw.
    return {}
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'wake' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    if (verb === 'detail') {
      const target = sceneSelection?.target ?? lastSceneTarget
      return { text: target ? [target.title, ...target.details].join('\n') : 'No scene object has been selected.' }
    }
    if (verb === 'legend') return { text: 'Crew: harness logos identify Codex, agy, Claude and OpenCode; unsupported terminals show text instead. The circle fills with model size, ◔ small to ◉ largest. Hover crew marks for harness or model details; model IDs appear only when known. In the scene, hover a building for its turn and tool kinds, or a sprite for its worker; /wake detail shows its full details. Colour names the harness (Codex teal, agy mauve, Claude pink, OpenCode balloons) and a larger sprite means a larger model class; each landscape leaves its mark on them (a searchlight over the city, a pennant in the harbor, a ribbon on the beach, a contrail in the mountains, petals in the countryside, fireflies in the forest, dust in the desert, aurora glitter in the tundra). Their windows mark read, search, edit, run, test, agent, web and failed calls. Lamps show plan progress; fireworks mark passing tests, storms mark failed commands, shooting stars mark finished jobs, lanterns rise when a plan is complete and a rainbow follows tests that pass right after a failed turn. ● running · ⌁ heavy queue · = paused · ↻ retrying · ? needs answer · ! stalled · ✓ done · ○ idle. Signal bars (five rising bars as an image, ▁▃▄▆█ as text) show thinking effort, for Bridge jobs and Claude subagents alike; the number is time since the last event; ▣▰▱ is memory against the job cap (Claude subagents report none). Colored peer lanes join workers; ← points to the recipient, ─/━/═ means 1/2–4/5+ messages. The root sits at the right edge of the crew rows: ◉ is the root, a spine runs down to the last worker with a tie to it, ─┤ and ─┘ are the branches of workers, ↑ means the last message went to the root, ↓ came from it and · means the worker simply works for it. A bright packet runs each lane and the spine (two for a stream of five or more, faster when new); in the scene a trail behind everything joins workers to one another and to Mochi, and a comet with a short, quickly fading tail runs along it when a message arrives, and an envelope hops over Mochi when a message reaches or leaves the root. Message links pulse, then melt away gradually over 15 minutes. Narrow rows use ↗/↙ and the peer name instead. One logo opens the accounts of each CLI in the quota line, │ divides CLIs and idle accounts with the same numbers fold into a range (02–04). Quota bars show remaining per account/window; hover an account mark for percentages and source reset text when available. ✕ marks signed-out or expired accounts, ? means unknown, ~ means stale numbers.' }
    if (verb === 'tour') {
      tour = { start: frameNo }
      return { text: `Touring ${PRESETS.length} landscapes, 12 s each, a whole day in each; your own scene comes back after.` }
    }
    if (verb === 'scene') {
      const text = await pinPreset($, await read($, surroundings), arg)
      await refreshSurroundings($)
      return { text }
    }
    if (verb === 'mochi') {
      const list = CHARACTER_IDS.map(id => `${id} (${CHARACTERS[id].note})`).join(', ')
      if (!arg) return { text: `Now: ${CHARACTERS[asCharacter(await $.store.get('mochi'))].label}. Choose with /wake mochi <name>: ${list}.` }
      if (!isCharacter(arg)) return { text: `No character called "${arg}". ${list}.` }
      await $.store.set('mochi', arg) // remembered for every session on the machine
      await update($, characterAtom, () => arg) // and what the band reads (the render never touches the store)
      return { text: `${CHARACTERS[arg].label} stands in Mochi's place now.` }
    }
    if (verb === 'place') {
      if (!arg) return { text: 'Usage: /wake place <city> (or auto to follow your IP).' }
      const text = await namePlace($, arg)
      await refreshSurroundings($, true)
      return { text }
    }
    if (verb === 'call') {
      const call = (await read($, calls)).find(c => c.id === arg)
      return { text: call ? `${call.text}\n\nSource answer:\n${call.answer}` : 'Call not found. Use /wake to list calls.' }
    }
    if (verb === 'fine') {
      const call = (await read($, calls)).find(c => c.id === arg)
      if (!call) return { text: 'Call not found. Use /wake to list calls.' }
      await resolveCall($, call.id)
      return { text: `Resolved: ${call.text}` }
    }
    return { text: await summary($) }
  })

  // The registered tool's name is not among the built-in tool names the matcher type lists.
  on('tool.call', { tool: 'mcp__wake__tidy_scan' as 'Bash' }, async ($, e) => {
    const days = (e as { olderThanDays?: unknown }).olderThanDays
    const scan = await scanTidy($, typeof days === 'number' ? { olderThanDays: days } : {})
    const text = scan.jobs.length + scan.dirty.length === 0 ? 'Nothing to tidy.' : tidyRequest(scan)
    return { result: text as never, text }
  }).catch(() => ({ result: 'Tidy scan failed; nothing was changed.' as never, text: 'Tidy scan failed; nothing was changed.', isError: true as const }))

  on('prompt.submit', async ($, e, next) => {
    userActivityInFlight++
    recapGeneration++
    await safely(async () => {
      const now = await $.clock.now()
      const waiting = await read($, recap)
      if (waiting) {
        await card($, `since last activity · ${span(now - waiting.awaySince)} · ${waiting.source === 'digest' ? 'from the log' : 'model'}`, recapBody(waiting.lines))
        await update($, recap, () => null)
      }
      awayTimer?.cancel()
      await update($, digest, () => freshDigest(now, String(e.text ?? '').slice(0, 600)))
      await update($, lastActivity, () => now)
      await update($, mood, () => 'work')
    })
    userActivityInFlight--
    return next(e)
  }).catch(($, e, next) => next(e)) // observer: the prompt always goes through

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      userActivityInFlight++
      recapGeneration++
      await safely(async () => {
        turnFailed = false
        turnTestsOk = false
        const startedAt = await $.clock.now()
        await update($, turnStartedAt, () => startedAt)
        await update($, tally, t => ({ ...t, turns: t.turns + 1 }))
        await update($, doing, () => ({ label: 'Thinking', kind: 'plan' as const, at: startedAt }))
        await update($, mood, () => 'work')
        animate($, true)
      })
      userActivityInFlight--
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const act = activity(e as never)
    if (isMain) await safely(async () => update($, doing, () => ({ ...act, at: Date.now() })))
    // owners are learned when the command starts: a foreground `agent-bridge start` runs as long as its job
    const named = e.tool === 'Bash' ? ownersIn(e.command) : []
    if (named.length) await safely(async () => update($, owners, list => (named.every(o => list.includes(o)) ? list : [...new Set([...list, ...named])])))
    let ran: Awaited<ReturnType<typeof next>> | undefined
    try {
      ran = await next(e)
      return ran
    } finally {
      await safely(async () => {
        if (ran === undefined || ran.deny !== undefined) return
        const failed = ran.isError === true
        if (isMain) {
          const turn = (await read($, tally)).turns
          await update($, pulse, list => [...list, { kind: failed ? ('fail' as const) : act.kind, turn }].slice(-400))
        }
        if (e.tool === 'Bash') {
          const command = commandHead(e.command)
          if (isTestCommand(e.command)) {
            await update($, digest, d => ({ ...d, tests: [...d.tests, { command, ok: !failed }].slice(-20) }))
            if (isMain && !failed) turnTestsOk = true
          }
          if (failed) {
            const code = /Exit code (\d+)/.exec(ran.text ?? '')?.[1]
            await update($, digest, d => ({ ...d, failures: [...d.failures, { command, ...(code ? { code: Number(code) } : {}) }].slice(-10) }))
            if (isMain) turnFailed = true
          }
          return
        }
        if (failed) return
        if (isMain && e.tool === 'TodoWrite') {
          await update($, plan, () => e.todos.map((todo, i) => ({ id: String(i), text: todo.content, active: todo.activeForm, status: todo.status })))
          return
        }
        if (isMain && e.tool === 'TaskCreate') {
          const id = String((ran.result as { task?: { id?: unknown }; taskId?: unknown } | undefined)?.task?.id ?? (ran.result as { taskId?: unknown })?.taskId ?? e.tool_use_id)
          taskIds.set(id, e.subject)
          await update($, plan, list => [...list, { id, text: e.subject, active: e.activeForm ?? e.subject, status: 'pending' as const }])
          return
        }
        if (isMain && e.tool === 'TaskUpdate') {
          await update($, plan, list =>
            list
              .map(step => (step.id === e.taskId ? { ...step, text: e.subject ?? step.text, active: e.activeForm ?? step.active, status: e.status === 'deleted' ? step.status : (e.status ?? step.status) } : step))
              .filter(step => !(step.id === e.taskId && e.status === 'deleted')),
          )
          return
        }
        const file = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : undefined
        if (file === undefined || !/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(String(e.tool))) return
        const counts =
          patchCounts(ran.result) ??
          (e.tool === 'Edit' ? { added: lines(e.new_string), removed: lines(e.old_string) } : { added: lines((e as { content?: unknown }).content), removed: 0 })
        const path = shortPath(file, await $.session.cwd(), await $.env.get('HOME'))
        await update($, digest, d => {
          const prior = d.files.find(f => f.path === path)
          const merged = prior ? { path, added: prior.added + counts.added, removed: prior.removed + counts.removed } : { path, ...counts }
          return { ...d, files: [merged, ...d.files.filter(f => f.path !== path)].slice(0, 40) }
        })
        if (isMain) {
          await update($, tally, t => ({
            ...t,
            added: t.added + counts.added,
            removed: t.removed + counts.removed,
            files: t.files.includes(path) ? t.files : [...t.files, path],
          }))
        }
      })
      await safely(() => refreshRecap($))
    }
  }).catch(($, e, next) => next(e)) // observer only: never refuse, never run twice

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      animate($, false)
      await safely(async () => {
        const now = await $.clock.now()
        const startedAt = await read($, turnStartedAt)
        await update($, tally, t => ({ ...t, lastTurnMs: startedAt === null ? t.lastTurnMs : now - startedAt }))
        await update($, turnStartedAt, () => null)
        await update($, digest, d => ({ ...d, answers: [...d.answers, e.answer.slice(-2500)].slice(-4) }))
        await update($, lastActivity, () => now)
        const open = (await read($, needs)).length > 0
        await update($, mood, () => (open ? 'alert' : turnTestsOk && !turnFailed ? 'happy' : turnFailed ? 'sad' : 'idle'))
        // the biggest milestone of the turn gets the scene: a failure, then a finished plan, then tests passing again after a
        // failed turn (a rainbow), then plain passing tests (fireworks)
        const steps = plan ? await read($, plan) : []
        const planDone = steps.length > 0 && steps.every(step => step.status === 'completed')
        if (turnFailed) play('storm')
        else if (planDone) play('lanterns')
        else if (turnTestsOk) play(previousTurnFailed ? 'rainbow' : 'fireworks')
        previousTurnFailed = turnFailed
        awayTimer?.cancel()
        awayTimer = $.clock.after(AWAY_MS, () => void safely(() => goAway($, now)))
        if (plan && (await read($, plan)).every(step => step.status === 'completed')) await update($, plan, () => [])
        const revision = callRevision
        const known = await read($, calls)
        const fresh = await extractCalls($, e.answer, known)
        await update($, calls, current => [...current, ...fresh.filter(call => (resolvedCalls.get(call.id) ?? 0) <= revision && !current.some(existing => existing.id === call.id)).map(call => ({ ...call, answer: e.answer }))])
      })
    }
    return next(e)
  })

  // learn what each subagent runs on; $.agent.list() does not say
  on('agent.spawn', async ($, e, next) => {
    const out = await next(e)
    if (out.deny === undefined) {
      await safely(async () => {
        await update($, parentModel, () => e.parentModel)
        if (out.agentId) await update($, agentModels, m => ({ ...m, [out.agentId!]: e.model ?? e.parentModel }))
      })
    }
    return out
  }).catch(($, e, next) => next(e))

  // what effort each loop thinks at: every tool use says it, in the loop it ran in (the main one, or a subagent's id)
  on('classic.PostToolUse', async ($, e, next) => {
    const level = e.effort?.level
    if (level) {
      await safely(async () => {
        if (e.agent_id) {
          if ((await read($, agentEfforts))[e.agent_id] !== level) await update($, agentEfforts, m => ({ ...m, [e.agent_id!]: level }))
        } else if ((await read($, parentEffort)) !== level) await update($, parentEffort, () => level)
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    await safely(() =>
      update($, digest, d => ({
        ...d,
        agents: [...d.agents, { name: e.agent_type, ok: true, summary: (e.last_assistant_message ?? '').split('\n')[0]!.slice(0, 160) }].slice(-10),
      })),
    )
    await safely(() => refreshRecap($))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    await safely(async () => {
      await update($, mood, () => 'alert')
      if (await isAway($, ASK_AWAY_MS)) await $.ui.notify(`Claude is waiting for your OK on ${e.tool_name}`, { title: 'Wake · needs you' })
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  // ── the band above the prompt: the diorama, a line of words, what needs you ──
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    pollCodex($) // a hot reload dropped the timers
    watchScene($)
    const waiting = await read($, recap)
    const open = await read($, needs)
    const allCalls = await read($, calls)
    const jobs = await read($, chips)
    const accounts = await read($, quotas)
    const current = await read($, mood)
    const frame = await read($, tick)
    const act = await read($, doing)
    const total = await read($, tally)
    const started = await read($, turnStartedAt)
    const idleSince = await read($, lastActivity)
    const failures = (await read($, digest)).failures
    const here = await read($, surroundings)
    const crewAgents = await read($, subagents)
    const parentModelId = await read($, parentModel)
    const parentTier = modelTier('claude', parentModelId)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Raster = 'Raster' in ui ? ui.Raster : undefined // terminal only
    const Image = e.surface === 'terminal' && 'Image' in ui ? ui.Image : undefined
    const Client = 'Client' in ui ? ui.Client : undefined // terminal pointer surface
    const now = await $.clock.now()
    const working = e.props.isWorking || started !== null
    // Redraw only while something real is moving: a packet still on its way, or a worker's activity flash still fading.
    animateLanes($, jobs.some(job => job.running && ((job.peers ?? []).some(peer => peer.observedAt !== undefined
      && now >= peer.observedAt && now - peer.observedAt <= packetWindow(peer.fresh ?? 1))
      || activityFlash(job.activitySeenAt, now) > 0.02)) ? 'packets' : null)
    const width = e.props.bodyColumns
    const bridgeCount = jobs.filter(job => job.running || job.awaitingRoot).length
    const crewRowsNeeded = bridgeCount + crewAgents.length > 0 ? 2 : 0
    // The scene stays while a need, a call or a recap waits below it, as long as the prompt's room fits both (a need is
    // never pushed out: urgent rows are placed before the crew); it only gives way when there is no space for the two.
    const urgentRowsNeeded = Math.min(2, open.length + allCalls.length)
    // A waiting recap shares the room with the scene (it asks for one row, the rest is paged by "+N more"); it never evicts it.
    const recapRowsNeeded = waiting ? 1 : 0
    const withScene = Raster !== undefined && e.props.maxRows >= SCENE_ROWS + 2 + crewRowsNeeded + urgentRowsNeeded + recapRowsNeeded && width >= 40
    band = withScene ? { id: e.requestId, width } : null
    sceneRetryAt = 0
    sceneRetryDelay = 50
    const input = toured(sceneInput(await bandState($), width, frameNo, effect ? { kind: effect.kind, age: frameNo - effect.start } : null, now))
    const frame0 = withScene ? sceneFrame(input, sceneSelection) : null
    if (frame0) {
      sceneHitMap = frame0.hits
    } else {
      sceneHitMap = null
      scenePointer = null
      sceneSelection = null
    }
    // the words sit on the scene's floor colour, their colours pushed for contrast against it
    const floor = frame0 ? hex(frame0.floor) : undefined
    const ink = floor ? readable(floor) : COLOR

    // the headline: what is happening now, or how the last turn went
    let headline: RenderElement
    let clockNote: string
    if (working) {
      headline = (
        <Text wrap="truncate-end">
          <Text color={ink.teal}>{workSpin(input.preset, act?.kind, frame)} </Text>
          <Text color={ink.text} weight="bold">{act?.label ?? 'Working'}</Text>
        </Text>
      )
      clockNote = `turn ${total.turns} · ${clock(now - (started ?? now))}`
    } else {
      const lastFail = failures.at(-1)
      const [glyph, color, words] =
        open.length > 0
          ? [G.needs, ink.yellow, `${open[0]!.job} needs you${open.length > 1 ? ` · +${open.length - 1}` : ''}`]
          : current === 'sleep'
            ? [G.sleep, ink.subtle, waiting ? 'napping · your recap is below' : 'napping']
            : current === 'sad' && lastFail
              ? [G.fail, ink.red, `${lastFail.command}${lastFail.code !== undefined ? ` · exit ${lastFail.code}` : ''}`]
              : total.turns === 0
                ? [G.idle, ink.lavender, 'ready when you are']
                : [current === 'happy' ? G.done : G.idle, current === 'happy' ? ink.green : ink.lavender, `last turn ${span(total.lastTurnMs)}${current === 'happy' ? ' · tests green' : ''}`]
      headline = (
        <Text wrap="truncate-end">
          <Text color={color}>{glyph} </Text>
          <Text color={ink.text}>{words}</Text>
        </Text>
      )
      clockNote = total.turns === 0 ? '' : `idle ${span(now - idleSince)}`
    }
    const touring = tourAt(frameNo)
    if (touring) {
      headline = (
        <Text wrap="truncate-end">
          <Text color={ink.mauve}>{G.pin} </Text>
          <Text color={ink.text} weight="bold">touring · {PRESET_LABEL[touring.preset]}</Text>
          <Text color={ink.subtle}> {touring.index + 1}/{PRESETS.length} · dawn to night</Text>
        </Text>
      )
      clockNote = ''
    }

    // the right side: the weather where you are, then the session and its bridge jobs
    const w = here?.weather
    const sky = w ? skyOf(w.code, w.isDay) : undefined
    const rain = w ? nextRain(w.hours) : undefined
    const levels = (await read($, effortLevels)).levels
    const running = jobs.filter(job => job.running || job.awaitingRoot)
      .map(job => ({ ...job, effortLevels: levelsFor(levels, job.backend, job.model) }))
    const weather = here ? (
      <Text>
        {sky && w ? <Text color={ink.yellow}>{String.fromCodePoint(sky.icon)} </Text> : <Text color={ink.subtle}>{G.pin} </Text>}
        {w ? <Text color={ink.text}>{Math.round(w.temp)}° </Text> : ''}
        <Text color={ink.subtext}>{here.place.name}</Text>
        {sky ? <Text color={ink.subtle}> {sky.label}</Text> : ''}
        {rain ? <Text color={ink.sky}> · {G.umbrella} {rain.pop}% {rain.time.slice(11, 16)}</Text> : ''}
        <Text color={ink.surface}> │ </Text>
      </Text>
    ) : (
      ''
    )
    const words = (
      <Box key="wake-headline" paddingX={1}>
        <Box flexGrow={1} flexShrink={1}>
          {headline}
        </Box>
        <Text color={ink.subtle}>{clockNote ? ` ${clockNote}` : ''}</Text>
        <Text color={ink.surface}> │ </Text>
        {weather}
        <Text color={ink.subtle}>{total.turns} turns </Text>
        <Text color={ink.green}>+{total.added}</Text> <Text color={ink.red}>−{total.removed}</Text>
      </Box>
    )

    // what needs the person, under the words; first the crew at work: subagents and bridge jobs
    const rows: RenderElement[] = []
    // Keep Claude's native subagent row intact; bridge jobs each get their own line.
    const rowWidth = Math.max(0, width - 2) // extras has one cell of padding on either side
    // The worker rows end where the root's graph stands: one shared column that hugs the longest row (its words, metrics and
    // peer lanes), so every worker reaches it by a short branch instead of a long empty run. At rest it keeps a small gap;
    // while a message is crossing (a packet on a lane, beads on a branch) it stands a little further out, so the packets
    // have room and nothing is squeezed. A narrow band keeps it at the right edge.
    const crossing = jobs.some(job => job.running && ((job.peers ?? []).some(peer => peer.observedAt !== undefined
      && now >= peer.observedAt && now - peer.observedAt <= packetWindow(peer.fresh ?? 1))))
    const rowBox = crewBox(crewRows(running, now, rowWidth - 7), crewAgents.map(agent => agent.name ?? agent.description), rowWidth, crossing)
    // a logo always keeps one cell of air before the text beside it
    const logo = (backend: string, alt = ({ codex: 'Codex', agy: 'Antigravity', claude: 'Claude', opencode: 'OpenCode' } as Record<string, string>)[backend] ?? backend) => Image && LOGOS[backend]
      ? <Box flexDirection="row" flexShrink={0}><Image source={{ png: LOGOS[backend] }} columns={2} rows={1} alt={alt} /><Text> </Text></Box>
      : <Box width={3} flexShrink={0}><Text wrap="truncate-end">{alt}</Text></Box>
    // Popups open upward: an absolute Box paints over what came before it (the scene and rows above) but under anything
    // after it, and the band clips below its last row, so a downward card was hidden by the quota rows. Cells near the
    // right edge (the root graph, peer lanes) anchor on their right so the card stays inside the band.
    const hoverPopup = (title: string, details: string[], maker?: string, align: 'left' | 'right' = 'left') => (
      <Box position="absolute" bottom={1} {...(align === 'right' ? { right: 0 } : { left: 0 })} display="none" hover={{ display: 'flex' }} flexDirection="column" width={Math.max(1, Math.min(56, rowWidth))} overflow="hidden" backgroundColor="#11111b" paddingX={1}>
        <Box flexDirection="row">{maker ? logo(maker, maker === 'codex' ? 'OpenAI' : 'Anthropic') : ''}<Text color={COLOR.text} weight="bold" wrap="wrap">{title}</Text></Box>
        {details.map((detail, index) => <Text key={`detail-${index}`} color={COLOR.subtext} wrap="wrap">{detail}</Text>)}
      </Box>
    )
    // the root's graph, in the right edge of every worker row (native subagents first, then Bridge jobs): see rootSpine
    const nativeLink = (agent: WakeAgent): RootLink => ({ dir: 'tether', family: 'claude', at: now, count: 1, description: [`${agent.name ?? agent.description} · Claude subagent`, 'Working for the root'] })
    const bridgeLink = (job: WakeChip): RootLink | undefined => {
      const message = [...(job.peers ?? [])].filter(peer => peer.target === 'root' && now >= peer.lastAt && now - peer.lastAt <= 900_000).sort((a, b) => b.lastAt - a.lastAt)[0]
      if (message) {
        return {
          dir: message.outgoing ? 'out' : 'in', family: job.backend ?? 'codex', at: message.lastAt, count: message.count, observedAt: message.observedAt, fresh: message.fresh,
          description: [
            message.outgoing ? `${titleOf(job)} → root` : `Root → ${titleOf(job)}`,
            message.messageState === 'observed' ? 'Observed by Bridge; root read state unknown' : message.messageState === 'sent' ? 'Bridge sent; worker read state unknown' : 'Bridge message state unavailable',
            message.preview ?? 'Message preview unavailable',
          ],
        }
      }
      return job.running ? { dir: 'tether', family: job.backend ?? 'codex', at: now, count: 1, activeAt: job.lastEventAt ?? job.since, description: [`${titleOf(job)} · ${job.backend}`, job.lastEventAt === undefined ? 'Working for the root' : `Working for the root · last event ${span(now - job.lastEventAt)} ago`] } : undefined
    }
    const spineOf = (agents: WakeAgent[], jobs: WakeChip[]) => rootSpine([...agents.map(nativeLink), ...jobs.map(bridgeLink)], now)
    const rootCells = spineOf(crewAgents, running)
    const familyInk = (family: string) => family === 'agy' ? ink.blue : family === 'claude' ? ink.pink : family === 'opencode' ? ink.green : ink.teal
    /** One row's cell of the graph: branch in the worker's colour, spine and arrow in the root's, brightened while a packet passes. */
    const rootCell = (cell: RootCell | undefined, key: string) => cell ? <Box key={key} position="relative" flexShrink={0}>
      <Text>{' '}</Text>
      <Text color={glint(dimPeer(cell.family ? familyInk(cell.family) : ink.yellow, ink.subtle, cell.strength), ink.text, cell.flow)}>{cell.branch}</Text>
      <Text color={glint(dimPeer(ink.yellow, ink.subtle, cell.strength), ink.text, cell.flow)} weight={cell.flow > 0.65 ? 'bold' : undefined}>{cell.spine === '◉' && cell.flow > 0.55 ? '◎' : cell.spine}</Text>
      <Text color={glint(dimPeer(cell.family ? familyInk(cell.family) : ink.yellow, ink.subtle, cell.strength), ink.text, cell.flow)}>{cell.arrow}</Text>
      {/* the node's label takes five cells; every other row keeps them blank so the spine runs straight down one column */}
      {cell.spine === '◉' || cell.spine === '◎' ? <Text color={ink.subtle}> root</Text> : <Text>{'     '}</Text>}
      {cell.description.length ? hoverPopup('Root', cell.description, undefined, 'right') : ''}
    </Box> : ''
    /** The leader between the end of a worker's words and its branch in the graph: empty at rest, a few beads marching along it
     * while a message arrives (toward the root for a message to it, away for one from it). */
    const march = (cell: RootCell) => {
      // Beads run only while this row's message is arriving, toward the root for a message to it and away for one from it;
      // otherwise the leader is empty: a tether is a standing relationship, and the `─┤` tag at the edge says it.
      const period = 9
      if (cell.arriving === undefined) return ''
      const step = Math.floor(cell.arriving / PACKET_FRAME_MS) % period // whole cells per frame: even, never skipped or doubled
      const phase = cell.dir === 'in' ? step : period - 1 - step
      return (' '.repeat(period - 2) + '∙•').repeat(Math.ceil(rowWidth / period) + 1).slice(phase)
    }
    // (a long unbroken run wrapped inside a one-row box shows exactly the room there is: clipped, never an ellipsis)
    const leader = (cell: RootCell | undefined) => <Box width={1} height={1} flexGrow={1} flexShrink={1} overflow="hidden">
      {cell && cell.branch === '─' ? <Text color={glint(dimPeer(familyInk(cell.family), ink.subtle, cell.strength * 0.7), ink.text, 0.15 + cell.flow * 0.5)} wrap="wrap">{march(cell)}</Text> : ''}
    </Box>
    const renderNative = (agent: WakeAgent, index: number, cell?: RootCell) => {
      return (
            <Box width={rowBox} flexShrink={0} flexDirection="row">
              <Box key={`wake-agent-harness-${index}`} position="relative" flexShrink={0}>
                {logo('claude')}
                {hoverPopup(`Claude subagent · ${agent.type}`, [agent.name ?? agent.description, span(now - agent.since)])}
              </Box>
              <Text color={ink.pink}> {diamond(frame)} </Text>
              <Text color={ink.text} wrap="truncate-end">{agent.name ?? agent.description}</Text>
              <Box key={`wake-agent-model-${index}`} position="relative" flexShrink={0}>
                <Text color={ink.pink}>{` ${CLASS_GLYPH[(agent.model ? modelTier('claude', agent.model) : parentTier) - 1]}`}</Text>
                {hoverPopup('Claude subagent · model mark', [
                  agent.model ? `Model ID: ${agent.model}` : parentModelId ? `Model ID unavailable; size mark follows parent ${parentModelId}` : 'Model ID unavailable; size mark uses the default class',
                ], modelLogo(agent.model))}
              </Box>
              {/* the same columns as a Bridge job's row: effort, time, memory (a subagent reports no memory of its own) */}
              <Text color={ink.subtle}> </Text>
              {(() => {
                // the subagent's effort on its own model's scale (the parent's model when it reports none)
                const scale = levelsFor(levels, 'claude', agent.model || parentModelId)
                const dots = agent.effort ? effortDots(agent.effort, scale) : undefined
                if (!dots) return <Text color={ink.subtle}>{agent.effort || '?'}</Text>
                const lit = dots.indexOf('○') < 0 ? dots.length : dots.indexOf('○')
                return <Box key={`wake-agent-effort-${index}`} position="relative" flexShrink={0}>
                  <Text><Text color={ink.pink}>{dots.slice(0, lit)}</Text><Text color={ink.surface}>{dots.slice(lit)}</Text></Text>
                  {hoverPopup('Effort', [`${agent.effort} · ${lit} of ${scale!.length} levels this model offers`, scale!.join(' → ')])}
                </Box>
              })()}
              <Text color={ink.subtle} wrap="truncate-end"> {span(now - agent.since)}{agent.type === 'general-purpose' ? '' : ` · ${agent.type}`}</Text>
              {leader(cell)}
              {rootCell(cell, `root-native-${index}`)}
            </Box>
      )
    }
    for (const [index, agent] of crewAgents.entries()) rows.push(renderNative(agent, index, rootCells[index]))
    const renderBridgeRow = (job: WakeChip, index: number, row: ReturnType<typeof crewRows>[number], cell?: RootCell) => {
      const familyColor = job.backend === 'agy' ? ink.blue : job.backend === 'claude' ? ink.pink : job.backend === 'opencode' ? ink.green : ink.teal
      const stateColor = row.state === 'stalled' ? ink.red : row.state === 'blocked_on_question' ? ink.peach
        : row.state === 'paused' || row.state === 'waiting_for_heavy' ? ink.yellow
        : row.state === 'retrying' ? ink.mauve : row.state === 'done' || row.state === 'waiting_for_root' ? ink.green : ink.teal
      const [, modelMark] = [...row.family]
      return <Box width={rowBox} flexDirection="row" position="relative">
        {row.family && <Box key={`wake-crew-harness-${index}`} position="relative" flexShrink={0}>
          {logo(job.backend)}
          {hoverPopup(`Crew · ${job.backend}`, [row.title.trim(), `State: ${row.state}`, ...(job.waitingPeer ? [`Waiting for: ${job.waitingPeer.target}`] : [])])}
        </Box>}
        {row.family && <Text color={familyColor}> {row.state === 'running' ? harnessSpin(job.backend ?? 'codex', frame) : ' '} </Text>}
        <Text color={ink.text}>{row.title}</Text>
        {row.family && <Text> </Text>}
        {row.family && <Box key={`wake-crew-model-${index}`} position="relative" flexShrink={0}>
          <Text color={familyColor}>{modelMark}</Text>
          {hoverPopup('Model-size mark', [
            job.model ? `Model ID: ${job.model}` : 'Model ID unavailable',
            ...(job.effort ? [`Effort: ${job.effort}`] : []),
            'Unknown model families use the default middle mark',
          ], modelLogo(job.model))}
        </Box>}
        {row.family && <Text color={glint(stateColor, ink.text, row.beat * 0.7)}> {row.glyph}</Text>}
        <Box key={`wake-crew-detail-${index}`} position="relative" flexShrink={0}>
          {/* each column is a part of its own, so each metric can explain itself under a pointer */}
          <Box flexDirection="row">
            {row.parts.map(part => part.column === 'effort' && row.effortSlot ? <Box key={`wake-crew-effort-${index}`} flexDirection="row" flexShrink={0}>
              <Text color={ink.subtle}> </Text>
              {/* lit dots in the harness colour, the levels left dim: the model's own scale */}
              <Box key={`wake-crew-effort-dots-${index}`} position="relative" flexShrink={0}>
                <Text><Text color={familyColor}>{'●'.repeat(row.effortSlot.lit)}</Text><Text color={ink.surface}>{'○'.repeat(row.effortSlot.total - row.effortSlot.lit)}</Text></Text>
                {hoverPopup('Effort', [row.effortSlot.label])}
              </Box>
              <Text color={ink.subtle}>{' '.repeat(Math.max(0, row.effortSlot.size - row.effortSlot.total))}</Text>
            </Box> : <Box key={`wake-crew-${part.column}-${index}`} position="relative" flexShrink={0}>
              <Text color={ink.subtle}>{part.text}</Text>
              {part.hover ? hoverPopup(part.hover.title, part.hover.lines, undefined, part.column === 'memory' || part.column === 'elapsed' ? 'right' : 'left') : ''}
            </Box>)}
          </Box>
          {row.columns.includes('peers') && hoverPopup(
            job.peers?.some(peer => peer.target === 'root') ? 'Bridge messages' : 'Peer communication',
            (job.peers ?? [])
            .filter(peer => now - peer.lastAt <= 900_000)
            .flatMap(peer => [
              `${peer.outgoing ? 'To' : 'From'}: ${peer.target}`,
              ...(peer.messageState === 'observed'
                ? ['Worker output observed; root read status unknown']
                : peer.messageState === 'sent'
                  ? ['Bridge sent; worker read status unknown']
                  : []),
              peer.preview || 'Message preview unavailable',
            ])
          )}
        </Box>
        {row.gutter.slice(0, row.rootAt ?? row.gutter.length).map((segment, lane) => {
          const color = [ink.teal, ink.mauve, ink.yellow, ink.blue, ink.pink, ink.green][segment.color % 6]!
          // a packet passing lights its cell toward white (and bold at its head): the lane shows who sent to whom, live
          const lit = glint(dimPeer(color, ink.subtle, segment.strength), ink.text, segment.flow)
          return <Box key={String(lane)} position="relative" flexShrink={0}>
            <Text color={lit} weight={segment.flow > 0.65 ? 'bold' : undefined}>{segment.text}</Text>
            {segment.text.trim() ? hoverPopup('Peer communication', segment.description, undefined, 'right') : ''}
          </Box>
        })}
        {/* the root's slot: the same place in every row, at the right edge, so a message to or from the root needs no row of its own */}
        {leader(cell)}
        {rootCell(cell, `root-bridge-${index}`)}
      </Box>
    }
    const bridgeRows = crewRows(running, now, rowBox - 7) // less the spinner (3) and the root graph's cell (4)
    for (const [index, job] of running.entries()) rows.push(renderBridgeRow(job, index, bridgeRows[index]!, rootCells[crewAgents.length + index]))
    if (running.some(job => job.running) && accounts.length > 0) {
      const inUse = new Set(running.map(job => job.backend))
      const ordered = [...accounts.filter(q => inUse.has(q.cli)), ...accounts.filter(q => !inUse.has(q.cli))]
      for (const [lineIndex, line] of quotaRows(ordered, rowWidth).entries()) {
        rows.push(<Box width={rowWidth} flexDirection="row">
          {line.map((chunk, chunkIndex) => {
            const scope = `wake-quota-${lineIndex}-${chunkIndex}`
            const quota = chunk.quotas[0]!
            const mark = quotaMark(quota)
            const details = (quota.status ? chunk.quotas : [quota]).flatMap(account => account.status
              ? [`${account.account}: ${account.status}`]
              : account.parts.length
                ? account.parts.map(part => `${part.label} · ${Math.round(part.pct)}% remaining${part.resets ? ` · reset: ${truncate(part.resets, 48)}` : ''}`)
                : ['Quota unavailable'])
            const first = chunk.quotas.length === 1 ? quota.account : `${quota.account}–${chunk.quotas.at(-1)!.account}`
            const hasMark = chunk.text.startsWith(mark)
            // one logo opens each CLI's run of accounts, a divider closes it; the accounts after it share that logo
            const opensCli = chunkIndex === 0 || line[chunkIndex - 1]!.quotas[0]!.cli !== quota.cli
            const popup = hoverPopup(`${quota.cli} quota · ${first}${chunk.quotas.length === 1 && quota.active ? ' · active' : ''}`, [
              ...details,
              ...(quota.freshness && quota.freshness !== 'fresh' ? [`Snapshot ${quota.freshness}`] : []),
            ])
            const text = hasMark ? chunk.text.slice(mark.length) : chunk.text
            // Each harness's run of accounts sits on its own faint tint with hard edges at the │ between harnesses;
            // remaining allowance reads by colour: green with plenty left, yellow getting low, red nearly gone.
            const tint = dimPeer(familyInk(quota.cli), floor ?? '#1e1e2e', 0.13)
            const level = (pct: number) => pct >= 50 ? ink.green : pct >= 20 ? ink.yellow : ink.red
            const [head, ...tokens] = text.split(' ')
            const body = <Text>
              <Text color={quota.active ? ink.text : ink.subtle} weight={quota.active ? 'bold' : undefined}>{head}</Text>
              {tokens.map((token, k) => {
                const part = /^([A-Za-z]+)(\d+)%(.*)$/.exec(token) // label, percent, bar: anything else (a status, a cut token) stays plain
                return part
                  ? <Text key={`part-${k}`}> <Text color={ink.subtle}>{part[1]}</Text><Text color={level(Number(part[2]))}>{part[2]}%{part[3]}</Text></Text>
                  : <Text key={`part-${k}`} color={ink.subtle}> {token}</Text>
              })}
            </Text>
            return <Box key={`quota-${lineIndex}-${chunkIndex}`} flexDirection="row" position="relative" flexShrink={0}>
              {chunkIndex > 0 && opensCli && <Text color={ink.surface}> │ </Text>}
              <Box flexDirection="row" flexShrink={0} backgroundColor={tint}>
                {chunkIndex > 0 && !opensCli && <Text color={ink.surface}> · </Text>}
                {opensCli ? <Box key={scope} position="relative" flexDirection="row" flexShrink={0}>
                  {logo(quota.cli)}
                  {popup}
                </Box> : ''}
                {opensCli ? body : <Box position="relative" flexShrink={0}>{body}{popup}</Box>}
              </Box>
            </Box>
          })}
        </Box>)
      }
    }
    const crew = rows.splice(0)
    let hotkey = 1
    const key = () => String(hotkey++)
    const recapRows: RenderElement[] = []
    if (waiting) {
      recapRows.push(
        <Text color={ink.mauve} italic>
          since last activity · {span(now - waiting.awaySince)}
          <Text color={ink.subtle}> · {waiting.source === 'digest' ? 'from the log' : 'model'}</Text>
        </Text>,
      )
      for (const line of waiting.lines) {
        recapRows.push(
          <Text wrap="truncate-end">
            <Text color={MARK[line.mark].color}>{MARK[line.mark].glyph} </Text>
            <Text color={ink.text}>{line.text}</Text>
          </Text>,
        )
      }
    }
    for (const need of open) {
      const isAsk = need.kind === 'codex-ask'
      rows.push(
        <Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={isAsk ? ink.yellow : ink.teal}>{isAsk ? G.needs : G.agent} </Text>
              <Text color={ink.subtext}>{need.title ?? need.job} </Text>
              <Text color={ink.text}>{need.text}</Text>
            </Text>
          </Box>
          <Button
            key={`do-${need.id}`}
            hotkey={key()}
            label={isAsk ? 'reply' : 'review'}
            onPress={async () => {
              await $.prompt.fill({ text: isAsk ? `\nReply to bridge job ${need.job}: ` : `\nReview bridge job ${need.job}'s result.`, mode: 'append' })
            }}
          />
          <Text> </Text>
          <Button key={`drop-${need.id}`} plain label="dismiss" onPress={async () => {
            await update($, needs, list => list.filter(one => one.id !== need.id))
            // Mochi is alert only while something still needs you: the last dismissal lets her settle
            if ((await read($, needs)).length === 0) await update($, mood, current => (current === 'alert' ? 'idle' : current))
            await refreshRecap($)
          }} />
        </Box>,
      )
    }
    for (const call of allCalls) {
      const callText = <Text wrap="truncate-end"><Text color={ink.mauve}>{G.call} </Text><Text color={ink.text}>{call.text}</Text></Text>
      const actions = <Box>
          <Button
            key={`call-push-${call.id}`}
            hotkey={key()}
            label="push back"
            onPress={async () => { await $.prompt.fill({ text: `\nRevisit your call "${call.text}": I'd rather `, mode: 'append' }) }}
          />
          <Text> </Text>
          <Button key={`call-inspect-${call.id}`} plain label="inspect" onPress={async () => { await card($, 'call source', [call.answer]) }} />
          <Text> </Text>
          <Button key={`call-fine-${call.id}`} plain label="fine" onPress={() => resolveCall($, call.id)} />
        </Box>
      if (width < 60) rows.push(callText, actions)
      else rows.push(<Box><Box flexGrow={1} flexShrink={1}>{callText}</Box>{actions}</Box>)
    }
    const room = Math.max(1, e.props.maxRows - (withScene ? SCENE_ROWS : 0) - 2)
    const workerCount = crewAgents.length + running.length
    const otherRows = [...rows, ...recapRows]
    const urgentCount = rows.length
    const remaining = Math.max(0, room - urgentCount)
    const reserved = workerCount ? Math.min(workerCount > 1 ? 2 : 1, remaining) : 0
    const otherLimit = !workerCount && otherRows.length > room ? Math.max(0, room - 1)
      : Math.min(urgentCount, room) + Math.min(recapRows.length, Math.max(0, remaining - reserved))
    rows.length = 0
    rows.push(...otherRows.slice(0, otherLimit))
    const hiddenOther = otherRows.length - Math.min(otherRows.length, otherLimit)
    const crewRoom = room - rows.length
    const pager = crewPage(workerCount, crewRoom, await read($, crewPageIndex))
    if (pager) {
      const { page, pages, start, end } = pager
      const startBridge = Math.max(0, start - crewAgents.length)
      const endBridge = Math.max(0, end - crewAgents.length)
      const pageJobs = running.slice(startBridge, endBridge)
      const pageRows = crewRows(pageJobs, now, rowBox - 7)
      const agentsOnPage = crewAgents.slice(start, Math.min(end, crewAgents.length))
      const pageCells = spineOf(agentsOnPage, pageJobs) // the graph is drawn for the rows on this page
      rows.push(...agentsOnPage.map((agent, i) => renderNative(agent, start + i, pageCells[i])), ...pageJobs.map((job, i) => renderBridgeRow(job, startBridge + i, pageRows[i]!, pageCells[agentsOnPage.length + i])))
      rows.push(<Box flexDirection="row">
        <Button key="crew-prev" plain label="‹" onPress={async () => { await update($, crewPageIndex, () => (page + pages - 1) % pages) }} />
        <Text color={ink.subtle}>{` crew ${page + 1}/${pages} `}</Text>
        <Button key="crew-next" plain label="›" onPress={async () => { await update($, crewPageIndex, () => (page + 1) % pages) }} />
        {hiddenOther > 0 && <Text color={ink.subtle}>{` +${hiddenOther} · /wake`}</Text>}
        {accounts.length > 0 && hiddenOther === 0 && <Text color={ink.subtle}> · quotas: /wake</Text>}
      </Box>)
    } else if (workerCount > 1 && crewRoom === 1) {
      const page = Math.min(await read($, crewPageIndex), workerCount - 1)
      const name = page < crewAgents.length ? crewAgents[page]!.name ?? crewAgents[page]!.description : running[page - crewAgents.length]!.title ?? running[page - crewAgents.length]!.name
      rows.push(<Box flexDirection="row">
        <Button key="crew-prev" plain label="‹" onPress={async () => { await update($, crewPageIndex, () => (page + workerCount - 1) % workerCount) }} />
        <Box flexGrow={1} flexShrink={1}><Text color={ink.text} wrap="truncate-end">{` ${name} ${page + 1}/${workerCount} `}</Text></Box>
        <Button key="crew-next" plain label="›" onPress={async () => { await update($, crewPageIndex, () => (page + 1) % workerCount) }} />
      </Box>)
    } else if (crewRoom > 0) {
      rows.push(...crew)
      if (hiddenOther) rows.push(<Text color={ink.subtle}>{`+${hiddenOther} more · /wake`}</Text>)
    }
    const visible = rows.slice(0, rows.length > room ? Math.max(0, room - 1) : room)
    const extras = (
      <Box flexDirection="column" paddingX={1}>
        {visible}
        {rows.length > visible.length && <Text color={ink.subtle}>+{rows.length - visible.length} more · /wake</Text>}
      </Box>
    )
    if (!withScene || !Raster) {
      return (
        <Box flexDirection="column">
          {words}
          {extras}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box key="wake-scene" position="relative">
          <Box flexDirection="column"><Raster key="scene" columns={width} rows={SCENE_ROWS} cells={frame0!.cells} /></Box>
          {Client && <Box position="absolute" top={0} left={0} width={width} height={SCENE_ROWS}>
            <Client key="scene-pointer" module="./scene-hover.tsx" width={width} height={SCENE_ROWS} />
          </Box>}
        </Box>
        <Box flexDirection="column" backgroundColor={floor}>
          {words}
          {extras}
        </Box>
      </Box>
    )
  })

  // ── the spinner carries the plan step and progress ──────────────────────
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const steps = await read($, plan)
    const started = await read($, turnStartedAt)
    const frame = await read($, tick)
    const active = steps.find(step => step.status === 'in_progress')
    if (!active || started === null) return next(e)
    const { Text } = $.ui.resolve(e)
    const done = steps.filter(step => step.status === 'completed').length
    const width = 12
    const filled = Math.round((done / steps.length) * width)
    const spin = spinner(frame)
    return (
      <Text wrap="truncate-end">
        <Text color={COLOR.teal}>{spin} </Text>
        <Text color={COLOR.text} weight="bold">{active.active}</Text>
        <Text color={COLOR.subtle}>  {done + 1}/{steps.length} </Text>
        <Text color={COLOR.green}>{'━'.repeat(filled)}</Text>
        <Text color={COLOR.surface}>{'━'.repeat(width - filled)}</Text>
        <Text color={COLOR.subtle}>  {clock((await $.clock.now()) - started)}</Text>
      </Text>
    )
  })

  // ── Wake's own cards in the transcript ───────────────────────────────────
  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    if (!e.props.text.startsWith(NOTICE)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const [header, ...body] = e.props.text.split('\n')
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLOR.surface} paddingX={1}>
        <Text color={COLOR.mauve} weight="bold">
          {header!.replace(NOTICE, G.wake)}
        </Text>
        {body.map(line => {
          const mark = Object.values(MARK).find(m => line.startsWith(m.glyph))
          return (
            <Text wrap="wrap">
              <Text color={mark?.color ?? COLOR.subtle}>{line.slice(0, 1)}</Text>
              {line.slice(1)}
            </Text>
          )
        })}
      </Box>
    )
  })

  // ── judgment calls as chips under the answer that made them ─────────────
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    const mine = (await read($, calls)).filter(call => isAnswerText(e.props.text, call.answer))
    if (mine.length === 0) return drawn
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        <Box marginTop={0}>
          <Text wrap="truncate-end">
            {mine.map(call => (
              <Text>
                <Text color={COLOR.mauve}>  {G.call} </Text>
                <Text color={COLOR.subtext}>{call.text}</Text>
              </Text>
            ))}
          </Text>
        </Box>
      </Box>
    )
  })
}

/** The /wake answer: everything Wake knows, as plain text in the chat. */
async function summary($: EngineInterface): Promise<string> {
  const steps = await read($, plan)
  const open = await read($, needs)
  const allCalls = await read($, calls)
  const jobs = await read($, chips)
  const agents = await read($, subagents)
  const accounts = await read($, quotas)
  const waiting = await read($, recap)
  const out: string[] = []
  if (waiting) out.push(`Since last activity · ${span((await $.clock.now()) - waiting.awaySince)} · ${waiting.source === 'digest' ? 'from the log' : 'model'}:`, ...recapBody(waiting.lines).map(l => `  ${l}`))
  if (steps.length) out.push('Plan:', ...steps.map(s => `  ${s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '◐' : '○'} ${s.text}`))
  if (open.length) out.push('Waiting on you:', ...open.map(n => `  ${n.kind === 'codex-ask' ? '▲' : '⟲'} ${n.job}: ${n.text}`))
  if (allCalls.length) out.push('Judgment calls (inspect: /wake call <id>; resolve: /wake fine <id>):', ...allCalls.map(c => `  ◆ ${c.id} ${c.text}`))
  if (jobs.length) out.push('Jobs:', ...jobs.map(j => `  ${j.running ? '◐' : '✓'} ${j.title ?? j.name} · ${j.backend ?? 'codex'}·${j.account ?? ''} ${j.model} ${j.effort}${j.waitingPeer ? ` · waiting for ${j.waitingPeer.target}` : ''}`))
  if (agents.length) out.push('Claude subagents:', ...agents.map(a => `  ◐ ${a.name ?? a.description} · ${a.type}${a.model ? ` · ${a.model}` : ''}`))
  if (accounts.length) out.push('Quotas:', ...accounts.map(account => `  ${quotaText(account)}${account.parts.some(part => part.resets) ? ` · ${account.parts.filter(part => part.resets).map(part => `${part.label} resets ${part.resets}`).join(', ')}` : ''}`))
  return out.length ? out.join('\n') : 'Nothing to report: no plan, no open items, no bridge jobs.'
}
