import type { SceneInput } from './scene'
import { ARRIVE_MS, EXIT_MS } from './exits'
import { TURN_LEAD_MS, packetWindow } from './crew-row'

const CREW_TIMELINE = [
  { frames: Math.ceil(ARRIVE_MS / 100), state: 'arrive', tier: 1 },
  { frames: 30, state: 'work', tier: 1 }, { frames: 30, state: 'work', tier: 2 },
  { frames: 30, state: 'work', tier: 3 }, { frames: 30, state: 'work', tier: 4 },
  { frames: Math.ceil(TURN_LEAD_MS / 100), state: 'turn' },
  { frames: Math.ceil((packetWindow(1) + TURN_LEAD_MS) / 100), state: 'send' },
  { frames: Math.ceil((packetWindow(1) + TURN_LEAD_MS) / 100), state: 'receive' },
  { frames: 30, state: 'rest' }, { frames: Math.ceil(EXIT_MS / 100), state: 'strike' },
  { frames: Math.ceil(ARRIVE_MS / 100), state: 'arrive', tier: 4 },
  { frames: Math.ceil(EXIT_MS / 100), state: 'leave' },
] as const
const CREW_FRAMES = CREW_TIMELINE.reduce((sum, step) => sum + step.frames, 0)
const CREW_FAMILIES = ['codex', 'claude', 'agy', 'opencode'] as const
export const CREW_CYCLE = CREW_FRAMES * CREW_FAMILIES.length

/** One family's demonstration; no live job state is changed. */
export function crewTour(input: SceneInput, frame: number): SceneInput {
  const kind = CREW_FAMILIES[Math.floor(frame / CREW_FRAMES) % CREW_FAMILIES.length]!
  let elapsed = frame % CREW_FRAMES
  const step = CREW_TIMELINE.find(item => { if (elapsed < item.frames) return true; elapsed -= item.frames; return false })!
  const ms = Math.max(1, elapsed * 100), id = `demo-${kind}`
  const job = { kind, tier: 'tier' in step ? step.tier : 4 as const, seed: 6, isStale: step.state === 'rest', pace: step.state === 'rest' ? 0.1 : 0.8,
    ...(step.state === 'rest' ? { settle: 1 } : {}), hit: { id, title: kind, details: [] },
    ...(step.state === 'arrive' ? { arriving: ms } : {}),
    ...(step.state === 'leave' || step.state === 'strike' ? { leaving: ms, struck: step.state === 'strike' } : {}) }
  const peerEdges = step.state === 'turn' || step.state === 'send' || step.state === 'receive' ? [{
    source: step.state === 'receive' ? 'mochi' : id, target: step.state === 'receive' ? id : 'mochi',
    strength: 0.9, count: 1, family: kind, fresh: 1, lead: TURN_LEAD_MS,
    ...(step.state === 'turn' ? { turning: ms } : { arriving: ms }),
  }] : []
  return { ...input, jobs: [job], agents: [], peerEdges, mail: undefined }
}
