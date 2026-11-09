/** The companion's state, driven by real events. */
export type WakeMood = 'idle' | 'work' | 'alert' | 'happy' | 'sad' | 'sleep'

/** One step of Claude's live plan (TodoWrite or the Task tools). */
export type WakeStep = { id: string; text: string; active: string; status: 'pending' | 'in_progress' | 'completed' }

/** Something waiting on the person: a bridge job's question or finished result. */
export type WakeNeed = { id: string; kind: 'codex-ask' | 'codex-done'; owner?: string; job: string; title?: string; text: string; at: number }

/** A judgment call Claude made without asking, tied to the answer it came from. */
export type WakeCall = { id: string; text: string; answer: string }

/** A running or recent bridge job (Codex, agy, Claude or OpenCode), as a chip; account = codex-auth number or agy login dir;
 *  maker = the model's maker when it has a crew family of its own (a Claude model inside agy), read once from the model id. */
export type WakeChip = {
  id?: string
  owner?: string
  name: string; title?: string; backend: string; account: string; model: string; effort: string
  running: boolean; isStale: boolean; since: number; lastEventAt?: number; startedAt?: number
  observationUnavailable?: boolean
  /** when this view first saw lastEventAt change: the worker just did something */
  activitySeenAt?: number
  /** when this view first saw the worker running (a start, or a resume of an idle one); its arrival plays from here */
  arrivedAt?: number
  /** when this view first saw the worker stop; its exit plays from here */
  leftAt?: number
  /** its last turn was cut off by the root (an interrupt), so its exit is a strike, not a farewell */
  interrupted?: boolean
  /** the effort levels this model offers, weakest first, from the native inventory; absent when unknown */
  effortLevels?: string[]
  awaitingRoot?: boolean; waitingForRoot?: boolean; maker?: 'claude'; state?: string; reason?: string
  memoryBytes?: number | null; memoryCap?: string
  /** observedAt: when this view first saw the newest message; fresh: how many messages arrived with it (one packet each) */
  peers?: { target: string; count: number; lastAt: number; outgoing: boolean; preview?: string | null; kind?: string; messageId?: string; observedAt?: number; fresh?: number; messageState?: 'observed' | 'sent' }[]
  waitingPeer?: { target: string; declaredAt: number }
}

/** Remaining quota of one signed-in account: Codex/Claude windows or agy model buckets. */
export type WakeQuota = { cli: 'codex' | 'agy' | 'claude' | 'opencode'; account: string; plan: string; active: boolean; parts: { label: string; pct: number | null; resets: string | null; name?: string }[]; status?: string; freshness?: 'fresh' | 'stale' | 'unknown'; observedAt?: string; refreshStatus?: string }

export type WakeSceneHit = { id: string; title: string; details: string[] }

export type WakeRecapLine = { mark: 'done' | 'decision' | 'needs' | 'agent' | 'fail'; text: string; evidence?: string }

/** The card waiting for the person when they come back. */
export type WakeRecap = { lines: WakeRecapLine[]; awaySince: number; source: 'model' | 'digest' }

/** What happened since the person's last prompt: the recap's only source of facts. */
export type WakeDigest = {
  awaySince: number
  prompt?: string
  answers: string[]
  files: { path: string; added: number; removed: number }[]
  failures: { command: string; code?: number }[]
  tests: { command: string; ok: boolean }[]
  agents: { name: string; model?: string; ok: boolean; summary?: string }[]
  codex: { owner?: string; name: string; model: string; summary?: string; urgent?: string }[]
  needs: string[]
}

/** What kind of thing one tool call did: the colour of its window in the city. */
export type WakePulseKind = 'read' | 'search' | 'edit' | 'run' | 'test' | 'fail' | 'agent' | 'web' | 'plan'

/** One finished tool call of the main agent; `turn` groups them into buildings. */
export type WakePulse = { kind: WakePulseKind; turn: number }

/** A running Claude Code subagent, from $.agent.list(); `since` is when Wake first saw it; `model` is what its spawn resolved to. */
export type WakeAgent = {
  id: string; type: string; name?: string; description: string; since: number; model?: string; effort?: string
  status?: 'running' | 'pending' | 'waiting'
  unavailable?: boolean
  /** When Wake saw it finish; it stays in the list only while its exit plays (hooks/exits.ts), and nothing else counts it. */
  leftAt?: number
  /** Its last turn was interrupted (turn.complete, isAborted), so its exit is a strike. */
  interrupted?: boolean
}

/** One SendMessage seen leaving a native conversation (the engine's `session.send`): `from` and `to` are a subagent's id, or `root` for the main conversation (Mochi's place). */
export type WakeNativeMessage = { from: string; to: string; at: number; preview: string }

export type WakeResource = {
  id: string; agentId: string; command: string; state: 'running' | 'queued' | 'cancelling'; running: boolean; needBytes: number
  position: number | null; queueLength: number; reason: string | null
}

/** The landscape the band draws. */
export type WakePreset = 'city' | 'harbor' | 'beach' | 'mountains' | 'countryside' | 'forest' | 'desert' | 'tundra'

/** Where the person is: by IP, or a place they named. */
export type WakePlace = {
  key: string
  name: string
  country: string
  lat: number
  lon: number
  source: 'ip' | 'named'
  elevation?: number
  population?: number
}

/** One hour of the forecast. */
export type WakeHour = { time: string; temp: number; pop: number; code: number }

/** Open-Meteo's current conditions and the next hours, decoded. */
export type WakeWeather = {
  fetchedAt: number
  utcOffsetSeconds: number
  temp: number
  code: number
  isDay: boolean
  cloud: number
  precipitation: number
  snowfall: number
  wind: number
  sunrise: number // local hours today, e.g. 5.87
  sunset: number
  hours: WakeHour[]
}

/** The band's surroundings: where, what landscape, what weather. */
export type WakeSurroundings = { place: WakePlace; preset: WakePreset; presetSource: 'pinned' | 'guessed'; weather: WakeWeather | null }

/** What the main agent is doing now (or did last). */
export type WakeNow = { label: string; kind: WakePulseKind; at: number }

/** The whole session so far, for the dock's headline. */
export type WakeTally = { turns: number; added: number; removed: number; files: string[]; lastTurnMs: number }

declare module 'claude-code' {
  interface PluginState {
    wake: {
      now: WakeNow | null
      pulse: WakePulse[]
      tally: WakeTally
      mood: WakeMood
      plan: WakeStep[]
      needs: WakeNeed[]
      bridgeCursor: Record<string, number>
      calls: WakeCall[]
      chips: WakeChip[]
      owners: string[] // Codex job owners this session's commands named; only their jobs are shown
      quotas: WakeQuota[]
      recap: WakeRecap | null
      digest: WakeDigest
      turnStartedAt: number | null
      lastActivity: number
      tick: number
      subagents: WakeAgent[]
      nativeResources: WakeResource[] | null
      agentModels: Record<string, string> // subagent id -> the model its spawn resolved to
      parentModel: string
      parentEffort: string // the session's effort level, what a subagent inherits
      agentEfforts: Record<string, string> // subagent id -> the effort its tool calls reported
      interruptedAgents: Record<string, true> // subagent id -> its turn was interrupted
      nativeMessages: WakeNativeMessage[] // the latest messages between the main conversation and its subagents
      effortLevels: { at: number; levels: Record<string, Record<string, string[]>> } // backend -> model -> levels it offers
      surroundings: WakeSurroundings | null
      crewPage: number
      quotaPage: number
      character: 'mochi' | 'tabby' | 'tuxedo' | 'bun' // who stands in Mochi's place (/wake mochi); see hooks/mochi.ts
    }
  }
}
