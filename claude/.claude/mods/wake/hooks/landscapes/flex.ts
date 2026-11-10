// A part of a hand-drawn body that moves freely: a tail, a brush, a streamer, a string of bows. The drawn poses give the body
// its strokes; this bends one stretch of it smoothly on every beat, further the nearer the tip, with a wave running out along
// it. The dragon is all flex; these are only flexible where the real thing is.
export type Flex = {
  /** where the loose part starts, as a fraction of the width (it runs to the trailing edge) */
  from: number
  /** how far the tip swings, in rows */
  amp: number
  /** how much of a wave runs along it (0 = it swings as one piece) */
  wave?: number
  /** only cells in this band of rows (fractions of the height) belong to the loose part */
  rows?: readonly [number, number]
}

/** The rows with the loose part swung for this beat. Bodies three rows tall are too small to bend. */
export function flex(rows: readonly string[], spec: Flex | undefined, beat: number, beats: number): readonly string[] {
  const h = rows.length, w = rows[0]?.length ?? 0, x0 = Math.round((spec?.from ?? 1) * w)
  if (!spec || h <= 3 || x0 >= w) return rows
  const [top, bottom] = spec.rows ? [Math.floor(spec.rows[0] * h), Math.ceil(spec.rows[1] * h)] : [0, h]
  const out = rows.map(row => [...row])
  for (let x = x0; x < w; x++) {
    const reach = (x - x0 + 1) / (w - x0)
    const dy = Math.round(spec.amp * reach * Math.sin(beat * Math.PI * 2 / beats - (spec.wave ?? 0) * (x - x0)))
    if (!dy) continue
    const column = rows.map(row => row[x]!)
    for (let y = top; y < bottom; y++) out[y]![x] = '.'
    for (let y = top; y < bottom; y++) if (column[y] !== '.' && y + dy >= 0 && y + dy < h && out[y + dy]![x] === '.') out[y + dy]![x] = column[y]!
  }
  return out.map(row => row.join(''))
}
