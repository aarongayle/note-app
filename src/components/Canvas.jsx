import {
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
} from 'react'
import useNotesStore, { PEN_TYPES } from '../stores/useNotesStore'
import { renderStroke } from '../lib/drawing'
import {
  strokeIntersectsLasso,
  unionBBoxOfStrokes,
  hitTransformHandle,
  LASSO_ROTATE_OFFSET,
  LASSO_HANDLE_RADIUS,
} from '../lib/lassoGeometry.js'
import {
  translateStroke,
  rotateStrokeAround,
  scaleStrokeAround,
  cloneStrokeList,
} from '../lib/strokeSelectionTransform.js'
import {
  LINE_SPACING,
  KEYBOARD_FONT_SIZE_PX,
  KEYBOARD_HORIZONTAL_PADDING_PX,
  CANVAS_TYPING_INK,
} from '../lib/canvasConstants.js'
import {
  estimatedWrappedTextBottomLayoutPx,
  valueAndCaretForCanvasClick,
} from '../lib/keyboardTextLayout.js'

const TEXT_PAD_TOP_PX = 2

/** @param {number} lineSpacingPx Scaled line / grid spacing */
function templateStylesForSpacing(lineSpacingPx) {
  const t = lineSpacingPx - 1
  return {
    blank: {},
    lined: {
      backgroundImage: `linear-gradient(to bottom, transparent ${t}px, #d0d0e8 ${t}px)`,
      backgroundSize: `100% ${lineSpacingPx}px`,
    },
    grid: {
      backgroundImage: `
      linear-gradient(to bottom, transparent ${t}px, #d8d8e8 ${t}px),
      linear-gradient(to right, transparent ${t}px, #d8d8e8 ${t}px)
    `,
      backgroundSize: `${lineSpacingPx}px ${lineSpacingPx}px`,
    },
    dotted: {
      backgroundImage: `radial-gradient(circle, #c0c0d8 1px, transparent 1px)`,
      backgroundSize: `${lineSpacingPx}px ${lineSpacingPx}px`,
    },
  }
}

function joinTextBlocks(blocks) {
  return (blocks ?? []).map((b) => b.content).join('\n')
}

export default function Canvas() {
  const containerRef = useRef(null)
  /** Viewport width of the scroll container — logical note width for strokes / keyboard. */
  const [layoutW, setLayoutW] = useState(0)
  const svgRef = useRef(null)
  const textareaRef = useRef(null)
  const measureCanvasRef = useRef(null)
  const currentStrokeRef = useRef(null)
  const currentPathRef = useRef(null)
  const isDrawingRef = useRef(false)
  /** @type {React.MutableRefObject<number[][] | null>} */
  const lassoDraftRef = useRef(null)
  /** @type {React.MutableRefObject<null | { kind: 'move' | 'rotate' | 'scale'; startX: number; startY: number; baseStrokes: unknown[]; indices: number[]; centerX: number; centerY: number; startDist: number; angle0: number }>} */
  const transformGestureRef = useRef(null)

  const [selectedStrokeIndices, setSelectedStrokeIndices] = useState([])
  const [lassoDraftPoints, setLassoDraftPoints] = useState(null)

  const note = useNotesStore((s) =>
    s.activeNoteId ? s.items[s.activeNoteId] : null
  )
  const inputMode = useNotesStore((s) => {
    const id = s.activeNoteId
    if (!id) return 'stylus'
    return s.noteInputModes[id] ?? 'stylus'
  })
  const isKeyboard = inputMode === 'keyboard'

  const activePen = useNotesStore((s) => s.activePen)
  const activeColor = useNotesStore((s) => s.activeColor)
  const penSize = useNotesStore((s) => s.penSize)
  const addStroke = useNotesStore((s) => s.addStroke)
  const eraseStrokesAt = useNotesStore((s) => s.eraseStrokesAt)
  const beginStrokeEraserGesture = useNotesStore(
    (s) => s.beginStrokeEraserGesture
  )
  const cancelStrokeEraserGesture = useNotesStore(
    (s) => s.cancelStrokeEraserGesture
  )
  const commitStrokeEraserGesture = useNotesStore(
    (s) => s.commitStrokeEraserGesture
  )
  const beginStrokesEditGesture = useNotesStore(
    (s) => s.beginStrokesEditGesture
  )
  const commitStrokesEditGesture = useNotesStore(
    (s) => s.commitStrokesEditGesture
  )
  const setNoteStrokesLive = useNotesStore((s) => s.setNoteStrokesLive)
  const cancelStrokesEditGesture = useNotesStore(
    (s) => s.cancelStrokesEditGesture
  )
  const extendScrollHeight = useNotesStore((s) => s.extendScrollHeight)
  const ensureNoteScrollHeight = useNotesStore((s) => s.ensureNoteScrollHeight)
  const setNoteKeyboardContent = useNotesStore((s) => s.setNoteKeyboardContent)
  const noteZoom = useNotesStore((s) => {
    const id = s.activeNoteId
    const n = id ? s.items[id] : null
    if (!n || n.type !== 'note') return 1
    return n.zoom ?? 1
  })

  const draftTextRef = useRef('')
  const wasKeyboardRef = useRef(false)
  const prevActiveNoteIdRef = useRef(null)

  const getMeasureCtx = useCallback((ta) => {
    if (!measureCanvasRef.current) {
      measureCanvasRef.current = document.createElement('canvas')
    }
    const ctx = measureCanvasRef.current.getContext('2d')
    if (!ctx) return null
    const cs = getComputedStyle(ta)
    const size = cs.fontSize || `${KEYBOARD_FONT_SIZE_PX}px`
    ctx.font = `${size} ${cs.fontFamily}`
    return ctx
  }, [])

  useLayoutEffect(() => {
    if (!note) {
      const prevId = prevActiveNoteIdRef.current
      if (prevId) {
        cancelStrokeEraserGesture(prevId)
        cancelStrokesEditGesture(prevId)
        const modes = useNotesStore.getState().noteInputModes
        if ((modes[prevId] ?? 'stylus') === 'keyboard') {
          const prevNote = useNotesStore.getState().items[prevId]
          const text =
            prevNote?.type === 'note'
              ? joinTextBlocks(prevNote.textBlocks)
              : draftTextRef.current
          setNoteKeyboardContent(prevId, text)
        }
      }
      prevActiveNoteIdRef.current = null
      return
    }
    const prevId = prevActiveNoteIdRef.current
    if (prevId && prevId !== note.id) {
      cancelStrokeEraserGesture(prevId)
      cancelStrokesEditGesture(prevId)
      const modes = useNotesStore.getState().noteInputModes
      if ((modes[prevId] ?? 'stylus') === 'keyboard') {
        const prevNote = useNotesStore.getState().items[prevId]
        const text =
          prevNote?.type === 'note'
            ? joinTextBlocks(prevNote.textBlocks)
            : draftTextRef.current
        setNoteKeyboardContent(prevId, text)
      }
    }
    prevActiveNoteIdRef.current = note.id
  }, [
    note?.id,
    note,
    setNoteKeyboardContent,
    cancelStrokeEraserGesture,
    cancelStrokesEditGesture,
  ])

  useLayoutEffect(() => {
    const id = note?.id
    return () => {
      if (id) cancelStrokesEditGesture(id)
    }
  }, [note?.id, cancelStrokesEditGesture])

  useEffect(() => {
    if (!note?.id) {
      setSelectedStrokeIndices([])
      setLassoDraftPoints(null)
      lassoDraftRef.current = null
      transformGestureRef.current = null
      return
    }
    setSelectedStrokeIndices((prev) =>
      prev.filter((i) => i < note.strokes.length)
    )
  }, [note?.id, note?.strokes.length])

  useEffect(() => {
    if (PEN_TYPES[activePen]?.isLasso) return
    const id = note?.id
    if (id) cancelStrokesEditGesture(id)
    setSelectedStrokeIndices([])
    setLassoDraftPoints(null)
    lassoDraftRef.current = null
    transformGestureRef.current = null
  }, [activePen, note?.id, cancelStrokesEditGesture])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || !note) return
    const measure = () => setLayoutW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [note?.id])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !note) return

    const handleScroll = () => {
      if (isKeyboard) return
      const n = useNotesStore.getState().items[note.id]
      const zoom = n?.type === 'note' ? (n.zoom ?? 1) : 1
      const scrollExtent = note.scrollHeight * zoom
      if (
        container.scrollTop + container.clientHeight >=
        scrollExtent - 200
      ) {
        extendScrollHeight(note.id)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable listener deps
  }, [note?.id, note?.scrollHeight, extendScrollHeight, isKeyboard, noteZoom])

  const flushKeyboardPersist = useCallback(() => {
    if (!note) return
    const text = textareaRef.current?.value ?? draftTextRef.current
    draftTextRef.current = text
    setNoteKeyboardContent(note.id, text)
  }, [note, setNoteKeyboardContent])

  useEffect(() => {
    if (!note) {
      wasKeyboardRef.current = false
      return
    }
    const prev = wasKeyboardRef.current
    wasKeyboardRef.current = isKeyboard
    if (prev && !isKeyboard) {
      const text = textareaRef.current?.value ?? draftTextRef.current
      draftTextRef.current = text
      setNoteKeyboardContent(note.id, text)
    }
  }, [isKeyboard, note?.id, note, setNoteKeyboardContent])

  const adjustTextLayerHeight = useCallback(() => {
    const ta = textareaRef.current
    if (!ta || !note) return
    ta.style.height = 'auto'
    const contentH = ta.scrollHeight
    const nextH = Math.max(note.scrollHeight, contentH)
    ta.style.height = `${nextH}px`
    if (contentH > note.scrollHeight) {
      ensureNoteScrollHeight(note.id, Math.ceil(contentH + 240))
    }
  }, [note, ensureNoteScrollHeight])

  useLayoutEffect(() => {
    if (!note) return
    requestAnimationFrame(adjustTextLayerHeight)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid layout thrash on every `note` replace
  }, [note?.id, note?.scrollHeight, adjustTextLayerHeight, isKeyboard, noteZoom])

  const getPointerPos = useCallback(
    (e) => {
      const svg = svgRef.current
      if (!svg) return [0, 0, 0.5]

      const pressure = e.pressure !== undefined ? e.pressure : 0.5

      const vb = svg.viewBox?.baseVal
      if (vb && vb.width > 0 && vb.height > 0) {
        const pt = svg.createSVGPoint()
        pt.x = e.clientX
        pt.y = e.clientY
        const ctm = svg.getScreenCTM()
        if (ctm) {
          const p = pt.matrixTransform(ctm.inverse())
          return [p.x, p.y, pressure]
        }
      }

      const rect = svg.getBoundingClientRect()
      const cw = svg.clientWidth
      const ch = svg.clientHeight
      const rw = rect.width > 0 ? rect.width : 1
      const rh = rect.height > 0 ? rect.height : 1
      const x = ((e.clientX - rect.left) / rw) * cw
      const y = ((e.clientY - rect.top) / rh) * ch
      return [x, y, pressure]
    },
    []
  )

  const selectionBBox = useMemo(() => {
    if (!note || selectedStrokeIndices.length === 0) return null
    return unionBBoxOfStrokes(note.strokes, selectedStrokeIndices)
  }, [note, selectedStrokeIndices])

  const selectedStrokeSet = useMemo(
    () => new Set(selectedStrokeIndices),
    [selectedStrokeIndices]
  )

  const showLassoChrome =
    !isKeyboard && PEN_TYPES[activePen]?.isLasso && selectionBBox

  const handlePointerDown = useCallback(
    (e) => {
      if (!note || isKeyboard) return
      if (e.button !== 0) return
      if (e.pointerType === 'touch') return

      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      isDrawingRef.current = true

      const point = getPointerPos(e)
      const pen = PEN_TYPES[activePen]

      if (pen.isEraser) {
        beginStrokeEraserGesture(note.id)
        eraseStrokesAt(note.id, point, pen.size)
        return
      }

      cancelStrokeEraserGesture(note.id)

      if (pen.isLasso) {
        const px = point[0]
        const py = point[1]
        const strokesNow =
          useNotesStore.getState().items[note.id]?.strokes ?? []
        if (selectedStrokeIndices.length > 0) {
          const bbox = unionBBoxOfStrokes(
            strokesNow,
            selectedStrokeIndices
          )
          const hit = bbox ? hitTransformHandle(px, py, bbox) : null
          if (hit) {
            const cx = (bbox.minX + bbox.maxX) / 2
            const cy = (bbox.minY + bbox.maxY) / 2
            beginStrokesEditGesture(note.id)
            transformGestureRef.current = {
              kind: hit,
              startX: px,
              startY: py,
              baseStrokes: cloneStrokeList(strokesNow),
              indices: [...selectedStrokeIndices],
              centerX: cx,
              centerY: cy,
              startDist: Math.max(Math.hypot(px - cx, py - cy), 1e-6),
              angle0: Math.atan2(py - cy, px - cx),
            }
            return
          }
        }
        setSelectedStrokeIndices([])
        const p2 = [px, py]
        lassoDraftRef.current = [p2]
        setLassoDraftPoints([p2])
        return
      }

      const hasPressure = e.pressure > 0 && e.pressure < 1
      const color = pen.id === 'marker' ? pen.color : activeColor
      const strokeOptions = {
        size: pen.id === 'marker' ? pen.size : penSize,
        thinning: pen.thinning,
        smoothing: pen.smoothing,
        streamline: pen.streamline,
        simulatePressure: !hasPressure,
      }

      currentStrokeRef.current = {
        points: [point],
        options: strokeOptions,
        color,
        opacity: pen.opacity ?? 1,
      }

      const svg = svgRef.current
      if (svg) {
        const path = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'path'
        )
        path.setAttribute('fill', color)
        path.setAttribute('opacity', pen.opacity ?? 1)
        svg.appendChild(path)
        currentPathRef.current = path
      }
    },
    [
      note,
      isKeyboard,
      activePen,
      activeColor,
      penSize,
      getPointerPos,
      eraseStrokesAt,
      beginStrokeEraserGesture,
      cancelStrokeEraserGesture,
      beginStrokesEditGesture,
      selectedStrokeIndices,
    ]
  )

  const handlePointerMove = useCallback(
    (e) => {
      if (!isDrawingRef.current || !note || isKeyboard) return

      e.preventDefault()
      const point = getPointerPos(e)
      const pen = PEN_TYPES[activePen]

      if (transformGestureRef.current) {
        const g = transformGestureRef.current
        const x = point[0]
        const y = point[1]
        const { baseStrokes, indices, centerX: cx, centerY: cy } = g
        if (g.kind === 'move') {
          const dx = x - g.startX
          const dy = y - g.startY
          const next = baseStrokes.slice()
          for (const i of indices) {
            next[i] = translateStroke(baseStrokes[i], dx, dy)
          }
          setNoteStrokesLive(note.id, next)
          return
        }
        if (g.kind === 'rotate') {
          const ang = Math.atan2(y - cy, x - cx) - g.angle0
          const next = baseStrokes.slice()
          for (const i of indices) {
            next[i] = rotateStrokeAround(baseStrokes[i], cx, cy, ang)
          }
          setNoteStrokesLive(note.id, next)
          return
        }
        if (g.kind === 'scale') {
          const d = Math.hypot(x - cx, y - cy)
          const sc = d / g.startDist
          const scale = Math.max(0.05, Math.min(sc, 40))
          const next = baseStrokes.slice()
          for (const i of indices) {
            next[i] = scaleStrokeAround(baseStrokes[i], cx, cy, scale)
          }
          setNoteStrokesLive(note.id, next)
          return
        }
      }

      if (
        pen.isLasso &&
        lassoDraftRef.current &&
        lassoDraftRef.current.length > 0
      ) {
        const x = point[0]
        const y = point[1]
        const draft = lassoDraftRef.current
        const last = draft[draft.length - 1]
        if (Math.hypot(x - last[0], y - last[1]) < 1.5) return
        const nextPt = [x, y]
        lassoDraftRef.current = [...draft, nextPt]
        setLassoDraftPoints([...lassoDraftRef.current])
        return
      }

      if (pen.isEraser) {
        eraseStrokesAt(note.id, point, pen.size)
        return
      }

      if (currentStrokeRef.current) {
        currentStrokeRef.current.points.push(point)
        const pathData = renderStroke(currentStrokeRef.current)
        if (currentPathRef.current) {
          currentPathRef.current.setAttribute('d', pathData)
        }
      }
    },
    [
      note,
      isKeyboard,
      activePen,
      getPointerPos,
      eraseStrokesAt,
      setNoteStrokesLive,
    ]
  )

  const handlePointerUp = useCallback(() => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false

    if (transformGestureRef.current && note) {
      transformGestureRef.current = null
      commitStrokesEditGesture(note.id)
      return
    }

    if (note && PEN_TYPES[activePen]?.isLasso && lassoDraftRef.current) {
      const pts = lassoDraftRef.current
      lassoDraftRef.current = null
      setLassoDraftPoints(null)
      if (pts.length >= 3) {
        const strokes =
          useNotesStore.getState().items[note.id]?.strokes ?? []
        const idx = []
        for (let i = 0; i < strokes.length; i++) {
          if (strokeIntersectsLasso(strokes[i], pts)) idx.push(i)
        }
        setSelectedStrokeIndices(idx.sort((a, b) => a - b))
      }
      return
    }

    if (currentStrokeRef.current && note) {
      addStroke(note.id, currentStrokeRef.current)
    } else if (note) {
      commitStrokeEraserGesture(note.id)
    }

    if (currentPathRef.current) {
      currentPathRef.current.remove()
      currentPathRef.current = null
    }
    currentStrokeRef.current = null
  }, [
    note,
    activePen,
    addStroke,
    commitStrokeEraserGesture,
    commitStrokesEditGesture,
  ])

  const handleKeyboardChange = useCallback(
    (e) => {
      const text = e.target.value
      draftTextRef.current = text
      setNoteKeyboardContent(note.id, text)
      requestAnimationFrame(adjustTextLayerHeight)
    },
    [note, setNoteKeyboardContent, adjustTextLayerHeight]
  )

  const handleKeyboardBlur = useCallback(() => {
    flushKeyboardPersist()
  }, [flushKeyboardPersist])

  const handleTextAreaPointerDown = useCallback(
    (e) => {
      if (!isKeyboard || e.button !== 0) return
      const ta = textareaRef.current
      if (!ta) return
      const rect = ta.getBoundingClientRect()
      const line = LINE_SPACING
      const padL = KEYBOARD_HORIZONTAL_PADDING_PX
      const rw = rect.width > 0 ? rect.width : 1
      const rh = rect.height > 0 ? rect.height : 1
      const layoutY =
        ((e.clientY - rect.top) / rh) * ta.clientHeight
      const ctx = getMeasureCtx(ta)
      const textBottom = estimatedWrappedTextBottomLayoutPx(ta, 1, ctx)
      if (layoutY < textBottom - 1) {
        return
      }
      if (!ctx) return

      e.preventDefault()
      ta.focus()
      const layoutX = ((e.clientX - rect.left) / rw) * ta.clientWidth
      const layoutRect = {
        left: 0,
        top: 0,
        width: ta.clientWidth,
        height: ta.clientHeight,
      }
      const { nextValue, index } = valueAndCaretForCanvasClick(
        ta.value,
        layoutX,
        layoutY,
        layoutRect,
        ctx,
        {
          lineSpacingPx: line,
          padLeftPx: padL,
          padTopPx: TEXT_PAD_TOP_PX,
        }
      )
      if (nextValue !== ta.value) {
        draftTextRef.current = nextValue
        setNoteKeyboardContent(note.id, nextValue)
      }
      requestAnimationFrame(() => {
        ta.setSelectionRange(index, index)
        adjustTextLayerHeight()
      })
    },
    [
      isKeyboard,
      getMeasureCtx,
      adjustTextLayerHeight,
      setNoteKeyboardContent,
      note?.id,
    ]
  )

  const templateStyle = useMemo(() => {
    if (!note) return {}
    const styles = templateStylesForSpacing(LINE_SPACING)
    return styles[note.template] || {}
  }, [note])

  /** Base typography; zoom is applied once via `transform: scale` on the inner wrapper. */
  const keyboardTextStyle = useMemo(() => {
    if (!note) return {}
    return {
      fontSize: KEYBOARD_FONT_SIZE_PX,
      lineHeight: `${LINE_SPACING}px`,
      paddingLeft: KEYBOARD_HORIZONTAL_PADDING_PX,
      paddingRight: KEYBOARD_HORIZONTAL_PADDING_PX,
      paddingTop: TEXT_PAD_TOP_PX,
      paddingBottom: LINE_SPACING,
      color: CANVAS_TYPING_INK,
      caretColor: CANVAS_TYPING_INK,
    }
  }, [note])

  const spacerStyle = useMemo(() => {
    if (!note) return {}
    return {
      width: '100%',
      minHeight: note.scrollHeight * noteZoom,
      minWidth: 0,
      boxSizing: 'border-box',
    }
  }, [note, noteZoom])

  /**
   * Same formula for every zoom: layout width layoutW/z × scale(z) → visual paper width layoutW.
   * Avoids a discontinuity at z=1 (no min(z,1) branch) so wrapping and ink behave uniformly.
   */
  const scaledInnerStyle = useMemo(() => {
    if (!note) return {}
    const z = noteZoom
    const widthPx = layoutW > 0 ? `${layoutW / z}px` : `${100 / z}%`
    return {
      width: widthPx,
      minHeight: note.scrollHeight,
      minWidth: 0,
      boxSizing: 'border-box',
      transform: `scale(${z})`,
      transformOrigin: 'left top',
      ...templateStyle,
    }
  }, [note, noteZoom, templateStyle, layoutW])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !note) return

    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.002)
      useNotesStore.getState().zoomNoteBy(note.id, factor)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind per note id only
  }, [note?.id])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !note) return

    const pointers = new Map()
    /** @type {{ d0: number, z0: number } | null} */
    let pinchBase = null

    const twoFingerDistance = () => {
      const pts = [...pointers.values()]
      if (pts.length < 2) return 0
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
    }

    const onPointerDown = (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        const d = twoFingerDistance()
        const row = useNotesStore.getState().items[note.id]
        const z = row?.type === 'note' ? (row.zoom ?? 1) : 1
        pinchBase = { d0: Math.max(d, 1e-6), z0: z }
      }
    }

    const onPointerMove = (e) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2 && pinchBase) {
        const d = twoFingerDistance()
        const next = pinchBase.z0 * (d / pinchBase.d0)
        useNotesStore.getState().setNoteZoom(note.id, next)
      }
    }

    const onPointerUp = (e) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchBase = null
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind per note id only
  }, [note?.id])

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface text-text-muted min-w-0">
        <div className="text-center space-y-3">
          <div className="text-4xl opacity-30">&#9998;</div>
          <p className="text-sm">
            Select a note or create one to start writing
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden relative bg-canvas-bg min-w-0 touch-pan-x touch-pan-y"
    >
      <div className="relative min-w-0" style={spacerStyle}>
        <div className="relative w-full min-w-0" style={scaledInnerStyle}>
          <textarea
            key={note.id}
            ref={textareaRef}
            readOnly={!isKeyboard}
            value={joinTextBlocks(note.textBlocks)}
            onChange={handleKeyboardChange}
            onPointerDown={handleTextAreaPointerDown}
            onBlur={handleKeyboardBlur}
            spellCheck={isKeyboard}
            tabIndex={isKeyboard ? 0 : -1}
            className={`relative z-0 w-full min-w-0 max-w-full bg-transparent border-0 outline-none resize-none font-sans whitespace-pre-wrap break-words selection:bg-accent/25 placeholder:text-neutral-400 ${
              isKeyboard ? '' : 'pointer-events-none'
            }`}
            style={{
              ...keyboardTextStyle,
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
            }}
            placeholder={isKeyboard ? 'Type here…' : ''}
          />
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            className={`absolute top-0 left-0 w-full ${
              isKeyboard ? 'z-10 pointer-events-none' : 'cursor-crosshair z-10'
            }`}
            style={{
              minHeight: note.scrollHeight,
              touchAction: isKeyboard ? 'auto' : 'none',
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            {note.strokes.map((stroke, i) => (
              <path
                key={i}
                d={renderStroke(stroke)}
                fill={stroke.color}
                opacity={
                  selectedStrokeSet.has(i)
                    ? Math.min(1, (stroke.opacity ?? 1) * 0.92)
                    : (stroke.opacity ?? 1)
                }
              />
            ))}
            {lassoDraftPoints && lassoDraftPoints.length > 0 && (
              <g pointerEvents="none">
                <polyline
                  fill="none"
                  stroke="rgb(99 102 241)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={lassoDraftPoints
                    .map((p) => `${p[0]},${p[1]}`)
                    .join(' ')}
                />
                {lassoDraftPoints.length >= 2 && (
                  <line
                    stroke="rgb(99 102 241 / 0.45)"
                    strokeWidth={1}
                    strokeDasharray="4 6"
                    x1={
                      lassoDraftPoints[lassoDraftPoints.length - 1][0]
                    }
                    y1={
                      lassoDraftPoints[lassoDraftPoints.length - 1][1]
                    }
                    x2={lassoDraftPoints[0][0]}
                    y2={lassoDraftPoints[0][1]}
                  />
                )}
              </g>
            )}
            {showLassoChrome && selectionBBox && (
              <g pointerEvents="none">
                {(() => {
                  const { minX: mx, minY: my, maxX: Mx, maxY: My } =
                    selectionBBox
                  const cx = (mx + Mx) / 2
                  const ro = LASSO_ROTATE_OFFSET
                  const hr = LASSO_HANDLE_RADIUS
                  const accent = 'rgb(99 102 241)'
                  const hy = my - ro
                  return (
                    <>
                      <rect
                        x={mx}
                        y={my}
                        width={Mx - mx}
                        height={My - my}
                        fill="none"
                        stroke={accent}
                        strokeWidth={1}
                        strokeDasharray="5 4"
                        rx={2}
                      />
                      <line
                        x1={cx}
                        y1={my}
                        x2={cx}
                        y2={hy + hr}
                        stroke={accent}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      <circle
                        cx={cx}
                        cy={hy}
                        r={hr + 2}
                        fill="white"
                        stroke={accent}
                        strokeWidth={1.5}
                      />
                      {[
                        [mx, my],
                        [Mx, my],
                        [Mx, My],
                        [mx, My],
                      ].map(([x, y], hi) => (
                        <circle
                          key={hi}
                          cx={x}
                          cy={y}
                          r={hr}
                          fill="white"
                          stroke={accent}
                          strokeWidth={1.5}
                        />
                      ))}
                    </>
                  )
                })()}
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  )
}
