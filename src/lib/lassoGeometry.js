import { getStrokeOutline } from './drawing.js'

/**
 * @param {number} x
 * @param {number} y
 * @param {number[][]} poly Closed polygon vertices [x,y][]
 */
export function pointInPolygon(x, y, poly) {
  if (poly.length < 3) return false
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    const intersect =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-30) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx
}

/**
 * @returns {boolean} True if closed segments (p1-p2) and (p3-p4) intersect (inclusive endpoints).
 */
export function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d1x = x2 - x1
  const d1y = y2 - y1
  const d2x = x4 - x3
  const d2y = y4 - y3
  const den = cross(d1x, d1y, d2x, d2y)
  if (Math.abs(den) < 1e-12) return false
  const t = cross(x3 - x1, y3 - y1, d2x, d2y) / den
  const u = cross(x3 - x1, y3 - y1, d1x, d1y) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

/**
 * Edges of a closed polygon (last vertex connects to first).
 * @param {number[][]} poly
 * @returns {[number, number, number, number][]}
 */
function polygonEdges(poly) {
  const n = poly.length
  if (n < 2) return []
  const out = []
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    out.push([a[0], a[1], b[0], b[1]])
  }
  return out
}

/**
 * True if closed polygons A and B have non-empty intersection (including boundary overlap).
 * @param {number[][]} polyA
 * @param {number[][]} polyB
 */
export function polygonsIntersect(polyA, polyB) {
  if (polyA.length < 2 || polyB.length < 2) return false
  if (polyA.length >= 3) {
    for (const p of polyA) {
      if (pointInPolygon(p[0], p[1], polyB)) return true
    }
  }
  if (polyB.length >= 3) {
    for (const p of polyB) {
      if (pointInPolygon(p[0], p[1], polyA)) return true
    }
  }
  const edgesA = polygonEdges(polyA)
  const edgesB = polygonEdges(polyB)
  for (const [ax, ay, bx, by] of edgesA) {
    for (const [cx, cy, dx, dy] of edgesB) {
      if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return true
    }
  }
  return false
}

/**
 * Outline polygon for a saved stroke (same as rendered fill boundary).
 * @param {{ points: number[][]; options?: object }} stroke
 * @returns {number[][]}
 */
export function strokeToOutlinePolygon(stroke) {
  const outline = getStrokeOutline(stroke.points, stroke.options ?? {})
  if (!outline?.length) return []
  return outline.map((pt) => [pt[0], pt[1]])
}

/**
 * Stroke is selected if any part of its ink intersects the closed lasso polygon.
 * @param {{ points: number[][]; options?: object }} stroke
 * @param {number[][]} lassoPoly At least 3 points; first point should equal last only if you want explicit close — we always close last→first.
 */
export function strokeIntersectsLasso(stroke, lassoPoly) {
  if (!lassoPoly || lassoPoly.length < 3) return false
  const ink = strokeToOutlinePolygon(stroke)
  if (ink.length >= 3) {
    return polygonsIntersect(ink, lassoPoly)
  }
  const pts = stroke.points ?? []
  if (pts.length === 0) return false
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i]
    if (pointInPolygon(x, y, lassoPoly)) return true
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    for (const [ax, ay, bx, by] of polygonEdges(lassoPoly)) {
      if (segmentsIntersect(x1, y1, x2, y2, ax, ay, bx, by)) return true
    }
  }
  return false
}

/**
 * @param {{ points: number[][]; options?: object }} stroke
 * @returns {{ minX: number; minY: number; maxX: number; maxY: number } | null}
 */
export function bboxOfStroke(stroke) {
  const ink = strokeToOutlinePolygon(stroke)
  const pts = ink.length >= 2 ? ink : (stroke.points ?? []).map((p) => [p[0], p[1]])
  if (pts.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

/**
 * @param {unknown[]} strokes
 * @param {number[]} sortedIndices
 */
export function unionBBoxOfStrokes(strokes, sortedIndices) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const i of sortedIndices) {
    const b = bboxOfStroke(strokes[i])
    if (!b) continue
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

/** Exported so Canvas can draw handles where hit-test expects them */
export const LASSO_ROTATE_OFFSET = 32
export const LASSO_HANDLE_RADIUS = 9

const HANDLE_HIT_RADIUS = 12

/**
 * Hit-test transform UI in note space. Returns `rotate`, `scale`, `move`, or null.
 * @param {number} x
 * @param {number} y
 * @param {{ minX: number; minY: number; maxX: number; maxY: number }} bbox
 * @returns {'rotate' | 'scale' | 'move' | null}
 */
export function hitTransformHandle(x, y, bbox) {
  const { minX: mx, minY: my, maxX: Mx, maxY: My } = bbox
  const cx = (mx + Mx) / 2
  const rx = cx
  const ry = my - LASSO_ROTATE_OFFSET
  if (Math.hypot(x - rx, y - ry) < HANDLE_HIT_RADIUS + 8) return 'rotate'

  const corners = [
    [mx, my],
    [Mx, my],
    [Mx, My],
    [mx, My],
  ]
  for (const [hx, hy] of corners) {
    if (Math.hypot(x - hx, y - hy) < HANDLE_HIT_RADIUS) return 'scale'
  }

  if (x >= mx && x <= Mx && y >= my && y <= My) return 'move'
  return null
}
