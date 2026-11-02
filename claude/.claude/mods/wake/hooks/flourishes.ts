// Session effects that mark a milestone, one function each: `drawEffect` in scene.ts picks them by kind.
//   lanterns  every step of the plan is done: warm paper lanterns are let go and drift up into the sky
//   rainbow   tests pass right after a failed turn: the weather clears and a rainbow rises over the scene
// To add one: write it here, add its kind to SceneEffect and EFFECT_FRAMES in scene.ts, and play() it where its signal happens.
import { P } from './landscapes/kit'
import { type Canvas, hash, mix } from './pixels'

const LANTERNS = 7
const LANTERN = ['.YY.', 'YWWY', 'YWWY', '.OO.'] // paper, lit centre, and a flame-coloured base
const LANTERN_INKS = { Y: P.peach, W: P.yellow, O: P.red }

/** Lanterns leave the ground one after another, sway as they climb, and fade as they near the top. `t` is 0..1 through it. */
export function drawLanterns(c: Canvas, t: number, ground: number, right: number) {
  for (let i = 0; i < LANTERNS; i++) {
    const start = (i / LANTERNS) * 0.45 // staggered release
    const life = (t - start) / 0.55
    if (life < 0 || life > 1) continue
    const seed = hash(i * 53 + 11)
    const x = right * (0.08 + 0.84 * (i + (seed % 5) / 10) / LANTERNS) + Math.sin(life * 6 + i) * 2
    const y = ground - 2 - life * (ground - 2) * (0.75 + (seed % 3) * 0.08)
    const fade = Math.min(1, (1 - life) * 3) * Math.min(1, life * 6 + 0.3)
    for (let dy = -2; dy <= 5; dy++) for (let dx = -3; dx <= 4; dx++) { // the soft light it casts, kept faint so the lantern stays a shape
      const d = Math.hypot(dx - 0.5, dy - 1)
      if (d < 4) c.glow(Math.round(x) + dx, Math.round(y) + dy, P.yellow, 0.09 * (1 - d / 4) * fade)
    }
    LANTERN.forEach((row, dy) => [...row].forEach((cell, dx) => {
      if (cell !== '.') c.glow(Math.round(x) - 2 + dx, Math.round(y) + dy, LANTERN_INKS[cell as keyof typeof LANTERN_INKS], fade)
    }))
  }
}

const BANDS = [P.red, P.peach, P.yellow, P.green, P.sky, P.mauve] // outside in

/** A rainbow that draws itself left to right, holds, then fades. It stands on the ground, behind nothing it can cover. */
export function drawRainbow(c: Canvas, t: number, ground: number, right: number) {
  const reveal = Math.min(1, t / 0.4) // how far along the arc is drawn
  const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1
  const cx = right * 0.5, rx = Math.min(right * 0.42, 44), ry = ground - 4
  BANDS.forEach((color, band) => {
    const inset = band * 0.9
    const steps = Math.ceil(Math.PI * rx * 2)
    for (let i = 0; i <= steps; i++) {
      const along = i / steps // 0 left foot .. 1 right foot
      if (along > reveal) break
      const angle = Math.PI * (1 - along)
      const x = cx + (rx - inset) * Math.cos(angle), y = ground - 1 - (ry - inset) * Math.sin(angle)
      if (y < ground - 1) c.glow(Math.round(x), Math.round(y), mix(color, P.white, 0.15), 0.55 * fade)
    }
  })
}
