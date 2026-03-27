import {
  hitTransformHandleRotateMove,
  HANDLE_HIT_RADIUS,
  LASSO_HANDLE_RADIUS,
} from './lassoGeometry.js'

/**
 * @typedef {{
 *  id?: string
 *  fileId?: string
 *  x: number
 *  y: number
 *  width: number
 *  height: number
 *  rotation?: number
 *  cropLeft?: number
 *  cropTop?: number
 *  cropRight?: number
 *  cropBottom?: number
 *  skewNwX?: number
 *  skewNwY?: number
 *  skewNeX?: number
 *  skewNeY?: number
 *  skewSeX?: number
 *  skewSeY?: number
 *  skewSwX?: number
 *  skewSwY?: number
 * }} ImageEmbed
 */

/**
 * Compute a CSS `matrix3d()` that warps a W×H rectangle to an arbitrary convex quadrilateral.
 * Uses a 2D projective (homography) decomposition.
 * @param {number} w  element width
 * @param {number} h  element height
 * @param {[number,number]} nw target NW corner (relative to element top-left)
 * @param {[number,number]} ne target NE corner
 * @param {[number,number]} se target SE corner
 * @param {[number,number]} sw target SW corner
 * @returns {string} CSS matrix3d(...) value, or 'none' if degenerate
 */
export function quadWarpMatrix3d(w, h, nw, ne, se, sw) {
  const [x0, y0] = nw
  const [x1, y1] = ne
  const [x2, y2] = se
  const [x3, y3] = sw

  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const sx = x0 - x1 + x2 - x3
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const sy = y0 - y1 + y2 - y3

  const det = dx1 * dy2 - dy1 * dx2
  if (Math.abs(det) < 1e-10) return 'none'

  const g = (sx * dy2 - sy * dx2) / det
  const hh = (dx1 * sy - dy1 * sx) / det

  const a = x1 - x0 + g * x1
  const b = x3 - x0 + hh * x3
  const c = x0
  const d = y1 - y0 + g * y1
  const e = y3 - y0 + hh * y3
  const f = y0

  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${hh / h},0,0,1,0,${c},${f},0,1)`
}

/**
 * Rotate embed-local delta (origin at center, +y down) to world delta — same basis as {@link embedPolygonPointsAttr}.
 * @param {number} dlx
 * @param {number} dly
 * @param {number} rotDeg
 * @returns {[number, number]}
 */
export function embedLocalDeltaToWorld(dlx, dly, rotDeg) {
  const r = (rotDeg * Math.PI) / 180
  const cr = Math.cos(r)
  const sr = Math.sin(r)
  return [dlx * cr - dly * sr, dlx * sr + dly * cr]
}

/**
 * Axis-aligned bounding box for a rectangle with top-left (x,y), size w×h, rotation (deg) around center.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} rotDeg
 */
export function axisAlignedBBoxForRotatedRect(x, y, w, h, rotDeg) {
  const rad = (rotDeg * Math.PI) / 180
  const cx = x + w / 2
  const cy = y + h / 2
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ]
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [lx, ly] of corners) {
    const rx = lx * cos - ly * sin + cx
    const ry = lx * sin + ly * cos + cy
    minX = Math.min(minX, rx)
    minY = Math.min(minY, ry)
    maxX = Math.max(maxX, rx)
    maxY = Math.max(maxY, ry)
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Embed center and unrotated half-extents in note space.
 */
export function embedCenter(embed) {
  return {
    cx: embed.x + embed.width / 2,
    cy: embed.y + embed.height / 2,
  }
}

/**
 * Map note-space point into embed-local axes (origin at center, +y down).
 * Inverse of rotating by `embed.rotation` around the embed center.
 */
export function worldToEmbedLocal(px, py, embed) {
  const { cx, cy } = embedCenter(embed)
  const rad = (-(embed.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - cx
  const dy = py - cy
  return [dx * cos - dy * sin, dx * sin + dy * cos]
}

/** Axis-aligned bbox in embed-local space for transform handles (before rotation). */
export function embedLocalHandleBBox(embed) {
  const w = embed.width
  const h = embed.height
  return { minX: -w / 2, maxX: w / 2, minY: -h / 2, maxY: h / 2 }
}

/**
 * Per-corner local skew offsets.
 * @param {ImageEmbed} embed
 */
export function embedSkewOffsets(embed) {
  return {
    nwX: Number(embed.skewNwX ?? 0),
    nwY: Number(embed.skewNwY ?? 0),
    neX: Number(embed.skewNeX ?? 0),
    neY: Number(embed.skewNeY ?? 0),
    seX: Number(embed.skewSeX ?? 0),
    seY: Number(embed.skewSeY ?? 0),
    swX: Number(embed.skewSwX ?? 0),
    swY: Number(embed.skewSwY ?? 0),
  }
}

/**
 * Four local corner points after skew offsets: NW, NE, SE, SW.
 * @param {ImageEmbed} embed
 * @returns {[number, number][]}
 */
export function embedLocalCorners(embed) {
  const w = embed.width
  const h = embed.height
  const s = embedSkewOffsets(embed)
  return [
    [-w / 2 + s.nwX, -h / 2 + s.nwY],
    [w / 2 + s.neX, -h / 2 + s.neY],
    [w / 2 + s.seX, h / 2 + s.seY],
    [-w / 2 + s.swX, h / 2 + s.swY],
  ]
}

/**
 * Map world delta to embed-local axes (+x right, +y down).
 * @param {number} dx
 * @param {number} dy
 * @param {number} rotDeg
 * @returns {[number, number]}
 */
export function worldDeltaToEmbedLocal(dx, dy, rotDeg) {
  const r = (-rotDeg * Math.PI) / 180
  const cr = Math.cos(r)
  const sr = Math.sin(r)
  return [dx * cr - dy * sr, dx * sr + dy * cr]
}

/**
 * @param {'scaleNW' | 'scaleNE' | 'scaleSE' | 'scaleSW'} kind
 */
function cornerSign(kind) {
  switch (kind) {
    case 'scaleNW':
      return { sx: -1, sy: -1 }
    case 'scaleNE':
      return { sx: 1, sy: -1 }
    case 'scaleSE':
      return { sx: 1, sy: 1 }
    case 'scaleSW':
      return { sx: -1, sy: 1 }
    default:
      return { sx: 1, sy: 1 }
  }
}

/**
 * @param {'skewNwX' | 'skewNwY' | 'skewNeX' | 'skewNeY' | 'skewSeX' | 'skewSeY' | 'skewSwX' | 'skewSwY'} kind
 */
function skewTarget(kind) {
  switch (kind) {
    case 'skewNwX':
      return { corner: 'nw', axis: 'x' }
    case 'skewNwY':
      return { corner: 'nw', axis: 'y' }
    case 'skewNeX':
      return { corner: 'ne', axis: 'x' }
    case 'skewNeY':
      return { corner: 'ne', axis: 'y' }
    case 'skewSeX':
      return { corner: 'se', axis: 'x' }
    case 'skewSeY':
      return { corner: 'se', axis: 'y' }
    case 'skewSwX':
      return { corner: 'sw', axis: 'x' }
    case 'skewSwY':
      return { corner: 'sw', axis: 'y' }
    default:
      return { corner: 'nw', axis: 'x' }
  }
}

/**
 * Midpoint helper.
 * @param {[number,number]} a
 * @param {[number,number]} b
 * @returns {[number,number]}
 */
function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/**
 * Edge midpoints from skewed corners: N (top), E, S, W.
 * @param {[number,number][]} corners [NW, NE, SE, SW]
 */
export function embedEdgeMidpoints(corners) {
  const [nw, ne, se, sw] = corners
  return {
    n: mid(nw, ne),
    e: mid(ne, se),
    s: mid(se, sw),
    w: mid(sw, nw),
  }
}

/**
 * @param {number} lx
 * @param {number} ly
 * @param {[number,number][]} corners [NW, NE, SE, SW]
 * @param {number} noteZoom
 * @returns {'scaleNW' | 'scaleNE' | 'scaleSE' | 'scaleSW' | null}
 */
function hitEmbedScaleCorner(lx, ly, corners, noteZoom) {
  const z = Math.max(noteZoom, 0.05)
  const r = (HANDLE_HIT_RADIUS + 4) / z
  const [nw, ne, se, sw] = corners
  const list = [
    { kind: 'scaleNW', x: nw[0], y: nw[1] },
    { kind: 'scaleNE', x: ne[0], y: ne[1] },
    { kind: 'scaleSE', x: se[0], y: se[1] },
    { kind: 'scaleSW', x: sw[0], y: sw[1] },
  ]
  for (const c of list) {
    if (Math.hypot(lx - c.x, ly - c.y) < r) return c.kind
  }
  return null
}

/**
 * 8 skew handles: two per corner.
 * X-controlling handles sit on vertical edges (left/right); Y-controlling handles sit on horizontal edges (top/bottom).
 * @param {[number,number][]} corners [NW, NE, SE, SW]
 */
export function embedSkewHandlePoints(corners) {
  const [nw, ne, se, sw] = corners
  const m = embedEdgeMidpoints(corners)
  return [
    { kind: 'skewNwY', x: mid(nw, m.n)[0], y: mid(nw, m.n)[1] },
    { kind: 'skewNwX', x: mid(nw, m.w)[0], y: mid(nw, m.w)[1] },
    { kind: 'skewNeY', x: mid(ne, m.n)[0], y: mid(ne, m.n)[1] },
    { kind: 'skewNeX', x: mid(ne, m.e)[0], y: mid(ne, m.e)[1] },
    { kind: 'skewSeY', x: mid(se, m.s)[0], y: mid(se, m.s)[1] },
    { kind: 'skewSeX', x: mid(se, m.e)[0], y: mid(se, m.e)[1] },
    { kind: 'skewSwY', x: mid(sw, m.s)[0], y: mid(sw, m.s)[1] },
    { kind: 'skewSwX', x: mid(sw, m.w)[0], y: mid(sw, m.w)[1] },
  ]
}

/** Skew-handle size in note/local space (same basis as Canvas `skewVr`). */
export function embedSkewHandleVisualRadius(noteZoom) {
  const z = Math.max(noteZoom, 0.05)
  const inv = 1 / z
  return Math.max(0.95 * LASSO_HANDLE_RADIUS * inv, 3.5 * inv)
}

/** Invisible skew-handle hit radius (triangle scale basis in local space). */
export function embedSkewHandleHitRadius(noteZoom) {
  const z = Math.max(noteZoom, 0.05)
  const inv = 1 / z
  return Math.max(embedSkewHandleVisualRadius(noteZoom) * 1.75, 8 * inv)
}

/**
 * Isosceles triangle pointing outward from the quad centroid (apex away from center).
 * @param {[number,number][]} corners
 * @param {number} sx
 * @param {number} sy
 * @param {number} [noteZoom=1]
 * @param {number} [sizeOverride] local-space size; defaults from zoom
 * @returns {[number, number][]} three vertices [apex, base, base]
 */
export function embedSkewHandleTrianglePoints(
  corners,
  sx,
  sy,
  noteZoom = 1,
  sizeOverride
) {
  const size = sizeOverride ?? embedSkewHandleVisualRadius(noteZoom)
  const cx = corners.reduce((s, p) => s + p[0], 0) / 4
  const cy = corners.reduce((s, p) => s + p[1], 0) / 4
  let ux = sx - cx
  let uy = sy - cy
  const len = Math.hypot(ux, uy) || 1
  ux /= len
  uy /= len
  const px = -uy
  const py = ux
  const tip = size * 0.9
  const back = size * 0.4
  const halfBase = size * 0.65
  return [
    [sx + ux * tip, sy + uy * tip],
    [sx - ux * back + px * halfBase, sy - uy * back + py * halfBase],
    [sx - ux * back - px * halfBase, sy - uy * back - py * halfBase],
  ]
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const sign = (p1x, p1y, p2x, p2y, p3x, p3y) =>
    (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y)
  const d1 = sign(px, py, ax, ay, bx, by)
  const d2 = sign(px, py, bx, by, cx, cy)
  const d3 = sign(px, py, cx, cy, ax, ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/**
 * @param {number} lx
 * @param {number} ly
 * @param {[number,number][]} corners
 * @param {number} noteZoom
 */
function hitEmbedSkewHandle(lx, ly, corners, noteZoom) {
  const hitSize = embedSkewHandleHitRadius(noteZoom)
  for (const p of embedSkewHandlePoints(corners)) {
    // First allow a forgiving radial tap target around each skew handle.
    if (Math.hypot(lx - p.x, ly - p.y) <= hitSize) return p.kind
    const tri = embedSkewHandleTrianglePoints(
      corners,
      p.x,
      p.y,
      noteZoom,
      hitSize
    )
    const [a, b, c] = tri
    if (
      pointInTriangle(lx, ly, a[0], a[1], b[0], b[1], c[0], c[1])
    ) {
      return p.kind
    }
  }
  return null
}

/**
 * @param {number} lx
 * @param {number} ly
 * @param {[number,number][]} corners
 * @param {number} noteZoom
 * @returns {'cropN' | 'cropS' | 'cropE' | 'cropW' | null}
 */
function hitEmbedCropEdges(lx, ly, corners, noteZoom) {
  const z = Math.max(noteZoom, 0.05)
  const cropR = (HANDLE_HIT_RADIUS + 2) / z
  const cornerR = (HANDLE_HIT_RADIUS + 4) / z
  for (const c of corners) {
    if (Math.hypot(lx - c[0], ly - c[1]) < cornerR) return null
  }
  const m = embedEdgeMidpoints(corners)
  const list = [
    { kind: 'cropN', x: m.n[0], y: m.n[1] },
    { kind: 'cropE', x: m.e[0], y: m.e[1] },
    { kind: 'cropS', x: m.s[0], y: m.s[1] },
    { kind: 'cropW', x: m.w[0], y: m.w[1] },
  ]
  for (const h of list) {
    if (Math.hypot(lx - h.x, ly - h.y) < cropR) return h.kind
  }
  return null
}

/**
 * World-space point on the **fixed** opposite edge midpoint while cropping with `handle`.
 * @param {ImageEmbed} embed
 * @param {'cropN' | 'cropS' | 'cropE' | 'cropW'} handle
 * @returns {[number, number]}
 */
export function embedCropFixedAnchorWorld(embed, handle) {
  const { cx, cy } = embedCenter(embed)
  const rot = embed.rotation ?? 0
  const hw = embed.width / 2
  const hh = embed.height / 2
  let lx = 0
  let ly = 0
  switch (handle) {
    case 'cropN':
      lx = 0
      ly = hh
      break
    case 'cropS':
      lx = 0
      ly = -hh
      break
    case 'cropE':
      lx = -hw
      ly = 0
      break
    case 'cropW':
      lx = hw
      ly = 0
      break
    default:
      return [cx, cy]
  }
  const [ox, oy] = embedLocalDeltaToWorld(lx, ly, rot)
  return [cx + ox, cy + oy]
}

/**
 * Top-left `(x,y)` for an embed with given size so the fixed anchor from `handle` stays at `(fx,fy)` in world space.
 * @param {number} fx
 * @param {number} fy
 * @param {'cropN' | 'cropS' | 'cropE' | 'cropW'} handle
 * @param {number} wNew
 * @param {number} hNew
 * @param {number} rotDeg
 */
export function embedPositionFromCropAnchor(fx, fy, handle, wNew, hNew, rotDeg) {
  const hw = wNew / 2
  const hh = hNew / 2
  let lx = 0
  let ly = 0
  switch (handle) {
    case 'cropN':
      lx = 0
      ly = hh
      break
    case 'cropS':
      lx = 0
      ly = -hh
      break
    case 'cropE':
      lx = -hw
      ly = 0
      break
    case 'cropW':
      lx = hw
      ly = 0
      break
    default:
      return { x: fx - wNew / 2, y: fy - hNew / 2 }
  }
  const [ox, oy] = embedLocalDeltaToWorld(lx, ly, rotDeg)
  const cx = fx - ox
  const cy = fy - oy
  return { x: cx - wNew / 2, y: cy - hNew / 2 }
}

/**
 * Unit vector in world space along **inward** (into the image) from the dragged edge.
 * @param {'cropN' | 'cropS' | 'cropE' | 'cropW'} handle
 * @param {number} rotDeg
 * @returns {[number, number]}
 */
export function embedCropInwardWorld(handle, rotDeg) {
  const map = {
    cropN: [0, 1],
    cropS: [0, -1],
    cropE: [-1, 0],
    cropW: [1, 0],
  }
  const v = map[handle]
  if (!v) return [0, 0]
  const [wx, wy] = embedLocalDeltaToWorld(v[0], v[1], rotDeg)
  const len = Math.hypot(wx, wy) || 1
  return [wx / len, wy / len]
}

/**
 * Edge-mid crop hit targets from skewed corners.
 * @param {[number,number][]} corners [NW, NE, SE, SW]
 * @param {number} [noteZoom=1]
 */
export function embedCropEdgeHitShapes(corners, noteZoom = 1) {
  const z = Math.max(noteZoom, 0.05)
  const cropW = 22 / z
  const cropH = 12 / z
  const m = embedEdgeMidpoints(corners)
  return {
    cropW,
    cropH,
    items: [
      { kind: 'cropN', cx: m.n[0], cy: m.n[1] },
      { kind: 'cropE', cx: m.e[0], cy: m.e[1] },
      { kind: 'cropS', cx: m.s[0], cy: m.s[1] },
      { kind: 'cropW', cx: m.w[0], cy: m.w[1] },
    ],
  }
}

/**
 * Local-space position and hit radius for the delete control (past NE corner, outward from centroid).
 * @param {[number,number][]} corners
 * @param {number} [noteZoom=1]
 */
export function embedImageDeleteHandleLocal(corners, noteZoom = 1) {
  const z = Math.max(noteZoom, 0.05)
  const [nw, ne, se, sw] = corners
  const cx = (nw[0] + ne[0] + se[0] + sw[0]) / 4
  const cy = (nw[1] + ne[1] + se[1] + sw[1]) / 4
  const vx = ne[0] - cx
  const vy = ne[1] - cy
  const len = Math.hypot(vx, vy) || 1
  const margin = ((LASSO_HANDLE_RADIUS + HANDLE_HIT_RADIUS + 10) / z) * 0.95
  return {
    x: ne[0] + (vx / len) * margin,
    y: ne[1] + (vy / len) * margin,
    r: (HANDLE_HIT_RADIUS + 2) / z,
  }
}

/**
 * @param {number} lx
 * @param {number} ly
 * @param {[number,number][]} corners
 * @param {number} noteZoom
 */
function hitEmbedDeleteHandle(lx, ly, corners, noteZoom) {
  const { x, y, r } = embedImageDeleteHandleLocal(corners, noteZoom)
  return Math.hypot(lx - x, ly - y) < r
}

/**
 * Hit-test move / scale / rotate / crop / skew handles for an image embed.
 * Priority: scale corners → skew → crop → rotate stem/knob → delete → move (point-in-quad).
 * @returns {'move' | 'rotate' | 'deleteImage' | 'cropN' | 'cropS' | 'cropE' | 'cropW' | 'scaleNW' | 'scaleNE' | 'scaleSE' | 'scaleSW' | 'skewNwX' | 'skewNwY' | 'skewNeX' | 'skewNeY' | 'skewSeX' | 'skewSeY' | 'skewSwX' | 'skewSwY' | null}
 */
export function hitImageEmbedTransformHandle(px, py, embed, noteZoom = 1) {
  const corners = embedLocalCorners(embed)
  const [lx, ly] = worldToEmbedLocal(px, py, embed)
  const corner = hitEmbedScaleCorner(lx, ly, corners, noteZoom)
  if (corner) return corner
  const skew = hitEmbedSkewHandle(lx, ly, corners, noteZoom)
  if (skew) return skew
  const crop = hitEmbedCropEdges(lx, ly, corners, noteZoom)
  if (crop) return crop
  const lb = embedLocalHandleBBox(embed)
  const rm = hitTransformHandleRotateMove(lx, ly, lb, noteZoom)
  if (rm === 'rotate') return 'rotate'
  if (hitEmbedDeleteHandle(lx, ly, corners, noteZoom)) return 'deleteImage'
  if (pointInLocalQuad(lx, ly, corners)) return 'move'
  return null
}

function pointInLocalQuad(lx, ly, corners) {
  let inside = false
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const xi = corners[i][0]
    const yi = corners[i][1]
    const xj = corners[j][0]
    const yj = corners[j][1]
    const inter =
      yi > ly !== yj > ly &&
      lx < ((xj - xi) * (ly - yi)) / (yj - yi + 1e-30) + xi
    if (inter) inside = !inside
  }
  return inside
}

/**
 * World-space fixed opposite corner for a dragged corner scale handle.
 * @param {ImageEmbed} embed
 * @param {'scaleNW' | 'scaleNE' | 'scaleSE' | 'scaleSW'} kind
 * @returns {[number, number]}
 */
export function embedScaleFixedCornerWorld(embed, kind) {
  const { cx, cy } = embedCenter(embed)
  const { sx, sy } = cornerSign(kind)
  const fxLocal = -sx * embed.width / 2
  const fyLocal = -sy * embed.height / 2
  const [ox, oy] = embedLocalDeltaToWorld(fxLocal, fyLocal, embed.rotation ?? 0)
  return [cx + ox, cy + oy]
}

/**
 * Solve rect position/size from dragging one corner with opposite corner fixed.
 * @param {number} fx
 * @param {number} fy
 * @param {number} px
 * @param {number} py
 * @param {'scaleNW' | 'scaleNE' | 'scaleSE' | 'scaleSW'} kind
 * @param {number} rotDeg
 * @param {number} [minSize=8]
 */
export function embedRectFromCornerDrag(
  fx,
  fy,
  px,
  py,
  kind,
  rotDeg,
  minSize = 8
) {
  const { sx, sy } = cornerSign(kind)
  const [dxLocal, dyLocal] = worldDeltaToEmbedLocal(px - fx, py - fy, rotDeg)
  const w = Math.max(minSize, sx * dxLocal)
  const h = Math.max(minSize, sy * dyLocal)
  const fixedOffsetLocalX = -sx * w / 2
  const fixedOffsetLocalY = -sy * h / 2
  const [ox, oy] = embedLocalDeltaToWorld(fixedOffsetLocalX, fixedOffsetLocalY, rotDeg)
  const cx = fx - ox
  const cy = fy - oy
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
  }
}

/**
 * Apply one-axis skew drag to one corner; other corners remain unchanged.
 * @param {ImageEmbed} embed
 * @param {'skewNwX' | 'skewNwY' | 'skewNeX' | 'skewNeY' | 'skewSeX' | 'skewSeY' | 'skewSwX' | 'skewSwY'} kind
 * @param {number} dLocal
 * @returns {Partial<ImageEmbed>}
 */
export function embedSkewPatchFromDrag(embed, kind, dLocal) {
  const w = Math.max(1, embed.width)
  const h = Math.max(1, embed.height)
  const maxX = 0.45 * w
  const maxY = 0.45 * h
  const t = skewTarget(kind)
  const key =
    t.corner === 'nw'
      ? t.axis === 'x'
        ? 'skewNwX'
        : 'skewNwY'
      : t.corner === 'ne'
        ? t.axis === 'x'
          ? 'skewNeX'
          : 'skewNeY'
        : t.corner === 'se'
          ? t.axis === 'x'
            ? 'skewSeX'
            : 'skewSeY'
          : t.axis === 'x'
            ? 'skewSwX'
            : 'skewSwY'
  const current = Number(embed[key] ?? 0)
  const next = current + dLocal
  const clamped =
    t.axis === 'x'
      ? Math.max(-maxX, Math.min(maxX, next))
      : Math.max(-maxY, Math.min(maxY, next))
  return { [key]: clamped }
}

/**
 * Re-parameterize an embed so that redundant skew offsets are absorbed into
 * x / y / width / height.  The world-space corner positions are preserved
 * exactly; only the internal split between "base rect" and "skew offsets"
 * changes.
 *
 * Best-fit rectangle: each edge sits at the average of its two corner
 * coordinates, so symmetric offsets collapse to zero skew.
 *
 * @param {ImageEmbed} embed
 * @returns {ImageEmbed}
 */
export function normalizeEmbedQuad(embed) {
  const [nw, ne, se, sw] = embedLocalCorners(embed)

  const newLeft = (nw[0] + sw[0]) / 2
  const newRight = (ne[0] + se[0]) / 2
  const newTop = (nw[1] + ne[1]) / 2
  const newBottom = (sw[1] + se[1]) / 2

  const newW = Math.max(1, newRight - newLeft)
  const newH = Math.max(1, newBottom - newTop)
  const localCx = (newLeft + newRight) / 2
  const localCy = (newTop + newBottom) / 2

  const rot = embed.rotation ?? 0
  const [worldDx, worldDy] = embedLocalDeltaToWorld(localCx, localCy, rot)
  const oldCx = embed.x + embed.width / 2
  const oldCy = embed.y + embed.height / 2

  return {
    ...embed,
    x: oldCx + worldDx - newW / 2,
    y: oldCy + worldDy - newH / 2,
    width: newW,
    height: newH,
    skewNwX: nw[0] - (localCx - newW / 2),
    skewNwY: nw[1] - (localCy - newH / 2),
    skewNeX: ne[0] - (localCx + newW / 2),
    skewNeY: ne[1] - (localCy - newH / 2),
    skewSeX: se[0] - (localCx + newW / 2),
    skewSeY: se[1] - (localCy + newH / 2),
    skewSwX: sw[0] - (localCx - newW / 2),
    skewSwY: sw[1] - (localCy + newH / 2),
  }
}

/**
 * Hit-test point inside rotated rectangle (in note space).
 */
export function pointInRotatedRect(px, py, x, y, w, h, rotDeg) {
  const cx = x + w / 2
  const cy = y + h / 2
  const rad = (-rotDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - cx
  const dy = py - cy
  const lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  return Math.abs(lx) <= w / 2 + 1e-6 && Math.abs(ly) <= h / 2 + 1e-6
}

/**
 * Point-in-quad for potentially skewed embed.
 * @param {number} px
 * @param {number} py
 * @param {ImageEmbed} embed
 */
export function pointInImageEmbed(px, py, embed) {
  const [lx, ly] = worldToEmbedLocal(px, py, embed)
  const poly = embedLocalCorners(embed)
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    const intersects =
      yi > ly !== yj > ly &&
      lx < ((xj - xi) * (ly - yi)) / (yj - yi + 1e-30) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/**
 * Bottom extent of embed for scroll height (axis-aligned).
 * @param {{ x: number; y: number; width: number; height: number; rotation?: number }} embed
 */
export function bottomExtentForEmbed(embed) {
  const r = embed.rotation ?? 0
  const b = axisAlignedBBoxForRotatedRect(
    embed.x,
    embed.y,
    embed.width,
    embed.height,
    r
  )
  return b.maxY
}

/**
 * SVG `points` attribute for a transparent hit polygon matching the rotated embed rect (note space).
 * @param {{ x: number; y: number; width: number; height: number; rotation?: number }} embed
 */
export function embedPolygonPointsAttr(embed) {
  const rotDeg = embed.rotation ?? 0
  const { cx, cy } = embedCenter(embed)
  return embedLocalCorners(embed)
    .map(([lx, ly]) => {
      const [ox, oy] = embedLocalDeltaToWorld(lx, ly, rotDeg)
      return `${cx + ox},${cy + oy}`
    })
    .join(' ')
}
