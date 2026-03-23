import getStroke from 'perfect-freehand'

export function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return ''

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...stroke[0], 'Q']
  )

  d.push('Z')
  return d.join(' ')
}

export function getStrokeOutline(points, options = {}) {
  return getStroke(points, {
    size: options.size ?? 3,
    thinning: options.thinning ?? 0.5,
    smoothing: options.smoothing ?? 0.5,
    streamline: options.streamline ?? 0.5,
    simulatePressure: options.simulatePressure ?? false,
    ...options,
  })
}

export function renderStroke(stroke) {
  const outline = getStrokeOutline(stroke.points, stroke.options)
  return getSvgPathFromStroke(outline)
}
