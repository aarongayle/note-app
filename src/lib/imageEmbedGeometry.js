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
