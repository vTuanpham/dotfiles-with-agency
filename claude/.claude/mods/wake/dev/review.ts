import { scenePixels } from '../hooks/scene'
import { fly } from '../hooks/landscapes/crew'
import { canvas, mix } from '../hooks/pixels'
import { P, SCENE_H, type Look } from '../hooks/landscapes/kit'
import { packetWindow, TURN_LEAD_MS } from '../hooks/crew-row'
import { PLACES } from './places'
import { families, actions, base, body, makeFrames, type Family, type Config } from './review-scene'

type Item = { id: string; title: string; kind: string; assessment: string; expectation: string; source: string; config: Config; at: number }
const defaults: Config = { place: 'city', family: 'codex', tier: 3, hour: 22, width: 120, mode: 'to' }
const item = (id: string, title: string, kind: string, assessment: string, expectation: string, source: string, config: Partial<Config> = {}, at = 2800): Item => ({ id, title, kind, assessment, expectation, source, config: { ...defaults, ...config }, at })
const findings: Item[] = [
  item('trail-ahead', '01 · Charge, release, residue', 'Revised', 'The mouth or lamp charges locally. Faint residue appears only in cells the projectile has crossed. The harbor tug launches its dart upward before it curves toward the recipient.', 'Step across 2.9 s: no route should appear ahead of the shot. Follow its fading residue after delivery.', 'scene.ts · drawTrails; reactions.ts · charge.', {}, 3000),
  item('trail-rewrites', '02 · An independent flight', 'Revised', 'Each projectile keeps the launch and destination it had when released. Moving bodies no longer pull its route around. Bursts record separate launches.', 'Watch the workers move after delivery. The old trace should stay in the same sky coordinates.', 'scene.ts · MessageTrails.', { mode: 'peer', family: 'opencode' }, 3150),
  item('song-residue', '03 · Notes and embers leave their own path', 'Revised', 'The small wave belongs to the flight geometry, so its fading trace occupies the same cells. Messages are drawn above the aurora and weather.', 'Check the note or ember against its residue, including at night in the tundra.', 'scene.ts · flight geometry and layer order.', { family: 'claude', mode: 'peer' }, 3300),
  item('constellation-turn', '04 · Stable stars, moving light', 'Revised', 'AGY figures drift without banking or squeezing. During launch, light gathers from their stars at the sending node.', 'The figure should stay composed while its internal light and position change.', 'design.ts · AGY motion; reactions.ts · charge.', { family: 'agy', place: 'mountains' }, 2850),
  item('passage-template', '05 · Arrivals and departures', 'Reworked', 'The dragon warps; probes and saucers lift through a beam; boats travel over water; ground creatures walk out. Birds use scene-specific flights, constellations assemble from streaking stars, and paper folds or lanterns disperse according to the design.', 'Compare arrival and exit across places: anticipation, a clear main action and a final settle.', 'design.ts; passage-styles.ts; exit-styles.ts.', { place: 'city', mode: 'arrive', tier: 4 }, 1900),
  item('rest-contact', '06 · Landing, rest and takeoff continuity', 'Motion check', 'The rest poses and perches are implemented, but a still contact sheet does not establish a convincing landing. This sequence winds the worker down and back up so changes in height, pose and direction are visible.', 'Keep momentum and continuous contact with the surface. No snap into a rest pose or takeoff that starts from the wrong body position.', 'crew.ts · placeRest; band.ts · activity settle transition.', { family: 'claude', place: 'forest', mode: 'rest' }, 6500),
  item('turn-resume', '07 · Aim, send, then resume naturally', 'Motion check', 'This is the full braking and return cycle, not only a message frame. Look for backwards sliding, offset launch points, sudden pose changes and a pointless second turn near a boundary.', 'Aim from the body, keep momentum, and choose a sensible onward heading. The same behavior must fit headed and face-on crews.', 'gait.ts · routeRate; crew.ts · orientation; scene.ts · message anchors.', { width: 72, tier: 4 }, 4000),
  item('density', '08 · Mixed crews at terminal width', 'Composition check', 'Effects, companions and bodies need to remain readable together. A clear isolated sprite can become an indistinct bright mass beside three other workers.', 'Keep silhouettes distinct, companions subordinate and scenery legible. Check the narrow width and night treatment as well.', 'scene.ts · shared lanes; crew.ts · escorts, effects and body layering.', { width: 72, mode: 'crowd', tier: 4 }, 5000),
  item('distant-crew', '09 · Distant crews behind the skyline', 'Revised', 'Celestial figures, the mountain airship and sky lanterns use the distant layer. Buildings and terrain occlude their bodies and arrival effects. They cast no local ground light.', 'Follow the stars behind a rooftop. Their connecting lines are faint, with slower light and brighter local bloom.', 'design.ts · depth; scene.ts · scenery occlusion.', { family: 'agy', mode: 'depth', width: 72, tier: 4 }, 3500),
  item('surface-light', '10 · Light belongs to the surface', 'Revised', 'Crew light projects onto the nearest roof or terrain and weakens with distance. Water breaks it into ripples. A warp moves the light source; it does not carry the illuminated surface into the sky.', 'Watch the dragon lift and leave, then compare the harbor and the dry landscapes.', 'fx.ts · surfaceLights; exits.ts · light source movement.', { family: 'codex', mode: 'leave', tier: 4 }, 4100),
]
const names: Record<Family, string[]> = {
  codex: ['Mechanical dragon', 'Tug', 'Saucer', 'Airship', 'Strider', 'Forest probe', 'Sun skiff', 'Snowcat'],
  claude: ['Rooftop sparrow', 'Crab', 'Flamingo', 'Eagle', 'Butterfly', 'Owl', 'Fox', 'Puffin'],
  agy: ['Crown', 'Sail', 'Starfish', 'Condor', 'Plough', 'Tree', 'Scorpion', 'Aurora arch'],
  opencode: ['Origami crane', 'Paper boat', 'Kite', 'Sky lantern', 'Carp streamer', 'Lantern string', 'Flying carpet', 'Paper star'],
}
const critiques: Record<Family, string[]> = {
  codex: [
    'This is the reference for intentional detail: segmented motion and propulsion have a purpose. Preserve the dragon’s identity; judge its rest pose, escorts and night glow separately from its original art.',
    'A waterborne machine fits the harbor. The risk is a generic hull with little mechanical identity; check whether the small sizes retain a readable wheelhouse and propulsion rather than becoming a bar.',
    'A saucer can be rigid without being dull. Its rim lights and hovering should carry the character; the dome should not become an oversized flat slab.',
    'The long hull gives it a silhouette, but also a large solid body. Review whether fins, gondola and moving machinery create enough structure, especially in the bigger sizes.',
    'The field strider now has a forward visor, antenna, rear equipment and articulated hips. Check whether the smallest form still reads as the same machine.',
    'This is another priority review. A face-on probe risks reading as a glowing block. Its structure needs a clear purpose and a stronger relationship with the forest.',
    'Low flight suits the desert. The skiff needs readable propulsion and a deliberate turn rather than a generic thin flying shape; inspect the send and exit actions too.',
    'The snowcat belongs on snow, but a rectangular body and changing tread pixels may feel too plain. Check the smallest silhouette, suspension and the amount of solid body fill.',
  ],
  claude: [
    'A compact rooftop sparrow replaces the elongated swallow: raised head, pale cheek, broad wings and a short fan tail. Its bank and perch use the same proportions. Judge it in the skyline as well as close up.',
    'The crab gives the harbor a grounded creature instead of another flyer. Its claws and legs need to read separately from the shell rather than flickering around a pink lump.',
    'The flamingo has longer visible legs and a compact feathered body. Wading and face-on turns keep its feet on the beach; inspect the neck at the smallest size.',
    'The eagle needs weight, glide and a clear wingbeat. More motion is not automatically better; inspect whether its turn preserves the bird rather than flattening it.',
    'The butterfly’s wings can justify flexibility. Check for a readable body and an intentional wing rhythm, not a symmetric pulsing blob; followers should remain subordinate.',
    'The owl is a face-on design with a real perch. Its eyes and wings must remain distinct from its rounded body, and landing should have more intent than simply lowering it.',
    'The fox benefits from a ground route. Check the separation of ears, feet and tail and whether the gait has believable weight rather than sliding the whole silhouette.',
    'The puffin needs its own body proportions and wing rhythm. The perch, flock and night treatment need to support that distinction.',
  ],
  agy: [
    'The crown should read as a stable arrangement of stars. Links should sink into the sky while travelling light reveals the connections; a bright continuous outline defeats that.',
    'The sail outline gives this constellation a harbor identity. Check whether its node lighting is stronger than its permanent lines and whether movement remains composed.',
    'Radial symmetry suits a starfish constellation, but risks a generic sparkle. The node pattern and travelling light need to make it recognisable without inflating the whole shape.',
    'The condor keeps its star arrangement while drifting. Look for traveling light within the figure and the gathering launch reaction.',
    'The plough keeps a fixed star map and moves as a celestial figure. Its nodes should read more strongly than its connecting lines.',
    'The tree needs to belong visually among the forest canopy. Check whether bright links overwhelm the stars and whether its motion feels rooted in this scene’s composition.',
    'A scorpion gives the desert a strong shape, provided its claws and curved tail remain readable at small size. Its bank should not collapse that shape.',
    'The aurora arch is distinct from a filled body. Look for purposeful light moving between stars; merely breathing brighter and darker is not enough character.',
  ],
  opencode: [
    'The crane should read as folded paper, with a crease and purposeful wing action. Its turn should not replace that structure with a generic squeeze.',
    'The boat belongs on water. At small sizes, test whether the folds remain visible; at larger sizes, the wake and reflection should support the paper shape rather than obscure it.',
    'The kite can use tension and a loose tail for character. Its wind response and turn should feel tethered by its own structure, not like a bird with a diamond body.',
    'The lantern’s glow is a good material cue. Its envelope still needs shape and suspension, and the sister lanterns must read as one formation rather than extra jobs.',
    'The carp streamer is a good candidate for local flexibility. The mouth should feel supported while the cloth follows it; moving every part equally would lose that material.',
    'The lantern string already contains several bodies. Review its spacing, hanging motion and branch contact; excessive light can merge it into a bright bar.',
    'The carpet needs folds, a border and a restrained wave. A flat coloured rectangle with tassels would not meet the standard; compare its turn and exit at every size.',
    'The paper star needs folds and a readable silhouette. Its sisters and glow should reinforce the paper material rather than make it resemble AGY’s constellations.',
  ],
}
const catalog = PLACES.flatMap((place, p) => families.map(family => item(`${family}-${place}`, `${names[family][p]} · ${place}`, 'Design review', critiques[family][p]!, 'Review all four sizes, day and night, and the actions that fit this body. These are design judgments to discuss, not declarations that every design is broken.', `landscapes/${family === 'codex' ? 'craft' : family === 'claude' ? 'creatures' : family === 'agy' ? 'agy' : 'lantern'}.ts · ${place}`, { place, family, tier: 3, mode: 'cruise', hour: 14 }, 4000)))
const items = [...findings, ...catalog]
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const select = (id: string) => $<HTMLSelectElement>(id)
const addOptions = (id: string, entries: [string, string][]) => entries.forEach(([value, label]) => select(id).add(new Option(label, value)))
addOptions('place', PLACES.map(p => [p, p])); addOptions('family', families.map(f => [f, f])); addOptions('tier', [1, 2, 3, 4].map(t => [String(t), String(t)])); addOptions('mode', Object.entries(actions))
const requirements = [
  'Four distinct family identities: mechanical Codex, creature Claude, celestial AGY and paper / lantern OpenCode.',
  'A deliberate design for each scene and every size. Avoid big undifferentiated bodies and generic winged shapes.',
  'Use the dragon as a quality reference, not as a template for flexibility, escorts or effects everywhere.',
  'Movement belongs to the habitat: water, ground, perches and sky. Distant crews pass behind nearer scenery; brief effects may overlap.',
  'Brake, aim from the body, send or receive, then continue with momentum and a sensible heading.',
  'Keep constellations stable, blend links with the sky, and animate the light moving between star nodes.',
  'Night separates shaded material from purposeful lights. No searchlight or glow copied where it does not fit.',
  'A message leaves a fixed, fading record of where it actually passed. No future route, standing wire or moving historical line.',
]
for (const text of requirements) { const p = document.createElement('p'); p.textContent = text; $('requirements').append(p) }

function draw(target: HTMLCanvasElement, px: Uint32Array, width: number, height = SCENE_H) {
  if (target.width !== width || target.height !== height) { target.width = width; target.height = height }
  const context = target.getContext('2d')!, data = context.createImageData(width, height)
  for (let i = 0; i < px.length; i++) { const c = px[i]!; data.data.set([c >> 16 & 255, c >> 8 & 255, c & 255, 255], i * 4) }
  context.putImageData(data, 0, 0)
}
function sizes(config: Config, frame: number) {
  const c = canvas(184, 16), night = config.hour > 18 ? 1 : 0, top = mix(P.blue, P.ink, night * .9), horizon = mix(P.sky, P.base, night * .85)
  for (let y = 0; y < c.H; y++) for (let x = 0; x < c.W; x++) c.set(x, y, mix(top, horizon, y / c.H))
  const look = { W: c.W, H: c.H, frame, night, isDay: !night, place: config.place, top, horizon, crewGround: 15, crewZones: [], crewSpriteZones: [] } as unknown as Look
  for (const tier of [1, 2, 3, 4] as const) { const x = (tier - .5) * 46; fly(c, look, x, 7, { ...body(config), tier }, config.family, false, () => [x, 7], []) }
  draw($('sizes'), c.px, c.W, c.H)
}
type Note = { text: string; at: number; config: Config }
let drafts: Record<string, Note> = {}, selected = findings[0]!, config = { ...selected.config }, frames: Uint32Array[] = [], time = 0, playing = false, last = 0, accumulator = 0, dirty = false
let timer: ReturnType<typeof setTimeout>, saving = Promise.resolve()
function status() {
  $('saved').textContent = dirty ? 'Draft not saved yet' : `${Object.values(drafts).filter(n => n.text.trim()).length} item(s) with feedback · drafts saved`
  const n = drafts[selected.id]
  $('note-anchor').textContent = n?.text ? `Note attached to ${(n.at / 1000).toFixed(2)} s · ${n.config.family} / ${n.config.place} / size ${n.config.tier}` : ''
}
function persist(submit = false) {
  const snapshot = JSON.stringify(drafts)
  saving = saving.catch(() => {}).then(async () => {
    const response = await fetch(submit ? '/submit' : '/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: snapshot })
    if (!response.ok) throw new Error('Saving failed. Keep this page open and retry, or download a copy.')
    const receipt = await response.json(); dirty = JSON.stringify(drafts) !== snapshot; $('error').textContent = ''; status()
    if (submit) $('submitted').textContent = `Feedback sent at ${new Date(receipt.at).toLocaleTimeString()}. You can keep reviewing and send another batch.`
  }).catch(e => { $('error').textContent = String(e.message); throw e })
  return saving
}
function render() {
  draw($('scene'), frames[Math.round(time / 50)]!, config.width)
  $('scene').style.width = `${config.width * Number(select('zoom').value)}px`
  $('scene').style.height = `${SCENE_H * Number(select('zoom').value)}px`
  $<HTMLInputElement>('time').value = String(time); $('time-label').textContent = `${(time / 1000).toFixed(2)} s`
  const since = time - 2000, window = TURN_LEAD_MS + packetWindow(config.mode === 'burst' ? 3 : 1)
  $('phase').textContent = ['to', 'from', 'peer', 'burst'].includes(config.mode) ? since < 0 ? 'Before the message' : since < TURN_LEAD_MS ? 'Braking / aiming' : since < window ? 'Message in flight — inspect the leading edge and residue' : 'After delivery — the crew moves on' : actions[config.mode]
  sizes(config, Math.floor(time / 50))
}
function choose(next: Item, scroll = false) {
  selected = next; config = { ...(drafts[next.id]?.config ?? next.config) }; time = drafts[next.id]?.at ?? next.at
  playing = false; $('play').textContent = 'Play'
  for (const key of ['place', 'family', 'tier', 'hour', 'width', 'mode'] as const) select(key).value = String(config[key])
  $('title').textContent = next.title; $('severity').textContent = next.kind; $('context').textContent = `${config.family} · ${config.place} · size ${config.tier}`
  $('assessment').textContent = next.assessment; $('expectation').textContent = next.expectation; $('source').textContent = next.source
  $<HTMLTextAreaElement>('note').value = drafts[next.id]?.text ?? ''; status()
  frames = makeFrames(config); accumulator = 0; render()
  document.querySelectorAll<HTMLButtonElement>('.card').forEach(c => c.classList.toggle('active', c.dataset.id === next.id))
  if (scroll) $('review').scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function card(entry: Item, parent: string) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'card'; button.dataset.id = entry.id
  const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = entry.kind
  const title = document.createElement('h3'); title.textContent = entry.title
  const thumb = document.createElement('canvas'); thumb.setAttribute('aria-label', `${entry.title} preview`)
  draw(thumb, scenePixels({ ...base({ ...entry.config, width: 90 }, 80), jobs: [body(entry.config)] }), 90)
  const text = document.createElement('p'); text.textContent = entry.assessment
  button.append(badge, title, thumb, text); button.onclick = () => choose(entry, true); $(parent).append(button)
}
findings.forEach(i => card(i, 'findings')); catalog.forEach(i => card(i, 'catalog'))
select('filter').onchange = () => document.querySelectorAll<HTMLButtonElement>('#catalog .card').forEach(c => { c.hidden = select('filter').value !== 'all' && !c.dataset.id!.startsWith(select('filter').value + '-') })
for (const key of ['place', 'family', 'tier', 'hour', 'width', 'mode'] as const) select(key).onchange = () => {
  config = { place: select('place').value as Config['place'], family: select('family').value as Family, tier: Number(select('tier').value) as Config['tier'], hour: Number(select('hour').value), width: Number(select('width').value), mode: select('mode').value as Config['mode'] }
  frames = makeFrames(config); render(); $('context').textContent = `${config.family} · ${config.place} · size ${config.tier} · adjusted example`
}
const pause = () => { playing = false; $('play').textContent = 'Play' }
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play' }
$('restart').onclick = () => { time = 0; accumulator = 0; playing = true; $('play').textContent = 'Pause'; render() }
$('back').onclick = () => { pause(); time = Math.max(0, time - 50); render() }
$('step').onclick = () => { pause(); time = Math.min(16000, time + 50); render() }
$<HTMLInputElement>('time').oninput = () => { pause(); time = Number($<HTMLInputElement>('time').value); render() }
select('zoom').onchange = render
$<HTMLTextAreaElement>('note').oninput = () => { drafts[selected.id] = { text: $<HTMLTextAreaElement>('note').value, at: time, config: { ...config } }; dirty = true; status(); clearTimeout(timer); timer = setTimeout(() => { void persist().catch(() => {}) }, 500) }
$<HTMLTextAreaElement>('note').onfocus = pause
$('submit').onclick = async () => { clearTimeout(timer); if (!Object.values(drafts).some(n => n.text.trim())) { $('error').textContent = 'Add a note before sending.'; return } const button = $<HTMLButtonElement>('submit'); button.disabled = true; try { await persist(true) } finally { button.disabled = false } }
function download(blob: Blob, name: string) { const link = document.createElement('a'), url = URL.createObjectURL(blob); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
$('export').onclick = () => download(new Blob([JSON.stringify({ review: 'wake', drafts }, null, 2)], { type: 'application/json' }), 'wake-feedback.json')
$('capture').onclick = () => $<HTMLCanvasElement>('scene').toBlob(blob => { if (blob) download(blob, `${selected.id}-${time}ms.png`) })
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = '' } })
try { const response = await fetch('/feedback'); if (!response.ok) throw new Error('Could not load saved drafts'); drafts = (await response.json()).drafts; choose(selected) }
catch (e) { choose(selected); $('error').textContent = `${String(e)}. Reload before editing to protect existing notes.`; $<HTMLTextAreaElement>('note').disabled = true; $<HTMLButtonElement>('submit').disabled = true }
function tick(now: number) {
  if (playing && !document.hidden) {
    accumulator += Math.min(now - (last || now), 100) * Number(select('speed').value)
    if (accumulator >= 50) { time = (time + Math.floor(accumulator / 50) * 50) % 16050; accumulator %= 50; render() }
  }
  last = now; requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
