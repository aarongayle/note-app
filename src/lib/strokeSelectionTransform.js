/**
 * @param {{ points: number[][]; options?: { size?: number }; color: string; opacity?: number }} stroke
 * @param {number} dx
 * @param {number} dy
 */
export function translateStroke(stroke, dx, dy) {
  return {
    ...stroke,
    points: stroke.points.map((p) => {
      const next = [p[0] + dx, p[1] + dy]
      if (p.length > 2) next.push(...p.slice(2))
      return next
    }),
  }
}

/**
 * @param {{ points: number[][]; options?: object; color: string; opacity?: number }} stroke
 * @param {number} cx
 * @param {number} cy
 * @param {number} rad
 */
export function rotateStrokeAround(stroke, cx, cy, rad) {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    ...stroke,
    points: stroke.points.map((p) => {
      const x = p[0] - cx
      const y = p[1] - cy
      const nx = cx + x * cos - y * sin
      const ny = cy + x * sin + y * cos
      const next = [nx, ny]
      if (p.length > 2) next.push(...p.slice(2))
      return next
    }),
  }
}

/**
 * Uniform scale about (cx, cy). Point positions scale; stroke thickness (`options.size`) is unchanged.
 * @param {{ points: number[][]; options?: object; color: string; opacity?: number }} stroke
 * @param {number} cx
 * @param {number} cy
 * @param {number} scale
 */
export function scaleStrokeAround(stroke, cx, cy, scale) {
  return {
    ...stroke,
    points: stroke.points.map((p) => {
      const nx = cx + (p[0] - cx) * scale
      const ny = cy + (p[1] - cy) * scale
      const next = [nx, ny]
      if (p.length > 2) next.push(...p.slice(2))
      return next
    }),
  }
}

/** Deep-clone stroke list for transform baselines (local only). */
export function cloneStrokeList(strokes) {
  return strokes.map((s) => ({
    ...s,
    points: (s.points ?? []).map((p) => (Array.isArray(p) ? [...p] : p)),
    options: s.options ? { ...s.options } : s.options,
  }))
}

/**
 * @param {unknown[]} allStrokes
 * @param {number[]} indicesSorted
 * @param {(s: object) => object} fn
 */
export function mapStrokesAtIndices(allStrokes, indicesSorted, fn) {
  const next = allStrokes.slice()
  for (const i of indicesSorted) {
    next[i] = fn(/** @type {object} */ (allStrokes[i]))
  }
  return next
}
