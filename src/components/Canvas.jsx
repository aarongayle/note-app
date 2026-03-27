import {
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
} from 'react'
import useNotesStore, { PEN_TYPES } from '../stores/useNotesStore'
import {
  useDefaultNoteInputMode,
  usePhoneClassViewport,
} from '../lib/noteInputDefaults.js'
import { renderStroke } from '../lib/drawing'
import {
  strokeIntersectsLasso,
  unionBBoxOfStrokes,
  hitTransformHandle,
  LASSO_ROTATE_OFFSET,
  LASSO_HANDLE_RADIUS,
} from '../lib/lassoGeometry.js'
import {
  axisAlignedBBoxForRotatedRect,
  pointInRotatedRect,
} from '../lib/imageEmbedGeometry.js'
import {
  translateStroke,
  rotateStrokeAround,
  scaleStrokeAround,
  cloneStrokeList,
} from '../lib/strokeSelectionTransform.js'
import { LINE_SPACING, KEYBOARD_FONT_SIZE_PX } from '../lib/canvasConstants.js'
import {
  contentBottomForNote,
  BOTTOM_CONTENT_PAD,
  MIN_NOTE_SCROLL_HEIGHT,
} from '../lib/noteScrollBounds.js'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api.js'
import { v4 as uuidv4 } from 'uuid'
import PdfNoteBackground from './PdfNoteBackground.jsx'
import EpubNoteBackground from './EpubNoteBackground.jsx'
import ImageEmbedsLayer from './ImageEmbedsLayer.jsx'
import TextBoxesLayer from './TextBoxesLayer.jsx'

import { scrollPositionCache } from '../lib/scrollPositionCache.js'
import { setViewState, getViewState } from '../lib/noteViewState.js'

const SCROLL_PERSIST_DEBOUNCE_MS = 1500
const scrollPersistTimers = new Map()

function debouncedScrollPersist(noteId, noteZoom) {
  clearTimeout(scrollPersistTimers.get(noteId))
  scrollPersistTimers.set(
    noteId,
    setTimeout(() => {
      scrollPersistTimers.delete(noteId)
      const phys = scrollPositionCache.get(noteId)
      if (phys != null) setViewState(noteId, { lastScrollY: phys / noteZoom })
    }, SCROLL_PERSIST_DEBOUNCE_MS),
  )
}

function flushScrollPersist(noteId, noteZoom) {
  const timer = scrollPersistTimers.get(noteId)
  if (timer) {
    clearTimeout(timer)
    scrollPersistTimers.delete(noteId)
  }
  const phys = scrollPositionCache.get(noteId)
  if (phys != null) setViewState(noteId, { lastScrollY: phys / noteZoom })
}

/** Ray-casting point-in-polygon test for lasso hit detection. */
function pointInPolygon(px, py, polygon) {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1]
    const xj = polygon[j][0], yj = polygon[j][1]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

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


/**
 * @param {{ noteId?: string }} props — When `noteId` is set, this canvas edits that note (split view). Otherwise uses the store `activeNoteId`.
 */
export default function Canvas({ noteId: noteIdProp } = {}) {
  const containerRef = useRef(null)
  /** Viewport width of the scroll container — logical note width for strokes. */
  const [layoutW, setLayoutW] = useState(0)
  const svgRef = useRef(null)
  const currentStrokeRef = useRef(null)
  const currentPathRef = useRef(null)
  const isDrawingRef = useRef(false)
  /** Ignore stray pointer events (e.g. second finger during pinch) while drawing. */
  const drawingPointerIdRef = useRef(null)
  /** @type {React.MutableRefObject<number[][] | null>} */
  const lassoDraftRef = useRef(null)
  /** @type {React.MutableRefObject<null | { kind: 'move' | 'rotate' | 'scale'; startX: number; startY: number; baseStrokes: unknown[]; indices: number[]; centerX: number; centerY: number; startDist: number; angle0: number }>} */
  const transformGestureRef = useRef(null)
  /** @type {React.MutableRefObject<null | { kind: 'move' | 'rotate' | 'scale'; startX: number; startY: number; baseEmbed: object; embedId: string; centerX: number; centerY: number; startDist: number; angle0: number; baseRotation: number }>} */
  const imageTransformRef = useRef(null)
  /** @type {React.MutableRefObject<null | { embedId: string; startX: number; startY: number }>} */
  const imageTapRef = useRef(null)

  const [selectedStrokeIndices, setSelectedStrokeIndices] = useState([])
  const [selectedImageEmbedId, setSelectedImageEmbedId] = useState(null)
  const [selectedTextBoxIds, setSelectedTextBoxIds] = useState([])
  const [editingTextBoxId, setEditingTextBoxId] = useState(null)
  /** Heights reported by TextBoxesLayer — used for SVG chrome placement. */
  const textBoxHeightsRef = useRef({})
  const [lassoDraftPoints, setLassoDraftPoints] = useState(null)

  const defaultInputMode = useDefaultNoteInputMode()
  const phoneClassViewport = usePhoneClassViewport()
  const splitViewNoteId = useNotesStore((s) => s.splitViewNoteId)
  const setSplitToolbarNoteId = useNotesStore((s) => s.setSplitToolbarNoteId)

  const note = useNotesStore((s) => {
    const id = noteIdProp ?? s.activeNoteId
    return id ? s.items[id] : null
  })
  const inputMode = useNotesStore((s) => {
    const id = noteIdProp ?? s.activeNoteId
    if (!id) return defaultInputMode
    return s.noteInputModes[id] ?? defaultInputMode
  })
  const isKeyboard = inputMode === 'keyboard'
  const isSelect = inputMode === 'select'
  /** True when the SVG drawing layer should be passive (no ink, no lasso) */
  const isPassive = isKeyboard || isSelect

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
  const beginImageEmbedEditGesture = useNotesStore(
    (s) => s.beginImageEmbedEditGesture
  )
  const commitImageEmbedEditGesture = useNotesStore(
    (s) => s.commitImageEmbedEditGesture
  )
  const cancelImageEmbedEditGesture = useNotesStore(
    (s) => s.cancelImageEmbedEditGesture
  )
  const setNoteImageEmbedsLive = useNotesStore(
    (s) => s.setNoteImageEmbedsLive
  )
  const cancelStrokesEditGesture = useNotesStore(
    (s) => s.cancelStrokesEditGesture
  )
  const extendScrollHeight = useNotesStore((s) => s.extendScrollHeight)
  const trimScrollHeight = useNotesStore((s) => s.trimScrollHeight)
  const createTextBox = useNotesStore((s) => s.createTextBox)
  const updateTextBox = useNotesStore((s) => s.updateTextBox)
  const deleteTextBox = useNotesStore((s) => s.deleteTextBox)
  // Delete selected textboxes when the Delete/Backspace key is pressed while
  // the lasso tool is active and no textbox textarea is focused.
  useEffect(() => {
    if (!note) return
    const onKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTextBoxIds.length > 0) {
        const active = document.activeElement
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return
        for (const id of selectedTextBoxIds) {
          deleteTextBox(note.id, id)
        }
        setSelectedTextBoxIds([])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [note, selectedTextBoxIds, deleteTextBox])
  const noteZoom = useNotesStore((s) => {
    const id = noteIdProp ?? s.activeNoteId
    const n = id ? s.items[id] : null
    if (!n || n.type !== 'note') return 1
    return n.zoom ?? 1
  })

  // Keep the same logical content at the top of the viewport when zoom changes.
  const prevZoomRef = useRef(noteZoom)
  useLayoutEffect(() => {
    const prev = prevZoomRef.current
    prevZoomRef.current = noteZoom
    if (prev === noteZoom) return
    const container = containerRef.current
    if (!container) return
    container.scrollTop = container.scrollTop * (noteZoom / prev)
  }, [noteZoom])

  /** Scroll the note viewport to a logical (pre-zoom) Y coordinate. Used by PDF/EPUB internal links. */
  const handlePdfScrollTo = useCallback((yLogical) => {
    const container = containerRef.current
    if (container) {
      container.scrollTo({ top: yLogical * noteZoom, behavior: 'smooth' })
    }
  }, [noteZoom])

  /**
   * Logical canvas width in CSS pixels (before zoom transform).
   * The canvas fills the viewport at all zoom levels by scaling the logical
   * coordinate space: zooming out reveals more canvas area, zooming in
   * reveals less.  Works uniformly for blank, PDF, and EPUB notes.
   */
  const logicalCanvasW = layoutW > 0 ? layoutW / noteZoom : layoutW

  /**
   * Maximum right extent (in logical canvas pixels) of all persisted content,
   * including the PDF/EPUB page width for notes with a background document.
   * Used to determine when zooming in would push content off-screen and
   * horizontal scrollbars are needed.
   */
  const maxContentRight = useMemo(() => {
    if (!note) return 0
    let max = 0

    if (note.pdfBackgroundFileId) {
      const docScale = (note.importDocFontSizePt ?? KEYBOARD_FONT_SIZE_PX) / KEYBOARD_FONT_SIZE_PX
      max = Math.max(max, layoutW * docScale)
    }
    if (note.epubBackgroundFileId) {
      max = Math.max(max, note.epubContentWidth ?? 600)
    }

    for (const s of note.strokes) {
      const r = (s.options?.size ?? 3) / 2
      for (const p of s.points) {
        if (p[0] + r > max) max = p[0] + r
      }
    }
    for (const e of note.imageEmbeds ?? []) {
      const bbox = axisAlignedBBoxForRotatedRect(e.x, e.y, e.width, e.height, e.rotation ?? 0)
      if (bbox.maxX > max) max = bbox.maxX
    }
    for (const tb of note.textBoxes ?? []) {
      const right = tb.x + tb.width
      if (right > max) max = right
    }
    return max
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when content or layout changes
  }, [note?.strokes, note?.imageEmbeds, note?.textBoxes, note?.pdfBackgroundFileId, note?.epubBackgroundFileId, note?.epubContentWidth, note?.importDocFontSizePt, layoutW])

  const pdfUrl = useQuery(
    api.files.getDownloadUrl,
    note?.pdfBackgroundFileId != null
      ? { fileId: note.pdfBackgroundFileId }
      : 'skip'
  )
  const epubUrl = useQuery(
    api.files.getDownloadUrl,
    note?.epubBackgroundFileId != null
      ? { fileId: note.epubBackgroundFileId }
      : 'skip'
  )

  const bumpToolbarToThisPane = useCallback(() => {
    if (splitViewNoteId != null && noteIdProp != null) {
      setSplitToolbarNoteId(noteIdProp)
    }
  }, [splitViewNoteId, noteIdProp, setSplitToolbarNoteId])

  const prevActiveNoteIdRef = useRef(null)

  useLayoutEffect(() => {
    if (!note) {
      const prevId = prevActiveNoteIdRef.current
      if (prevId) {
        cancelStrokeEraserGesture(prevId)
        cancelStrokesEditGesture(prevId)
        cancelImageEmbedEditGesture(prevId)
      }
      prevActiveNoteIdRef.current = null
      return
    }
    const prevId = prevActiveNoteIdRef.current
    if (prevId && prevId !== note.id) {
      cancelStrokeEraserGesture(prevId)
      cancelStrokesEditGesture(prevId)
      cancelImageEmbedEditGesture(prevId)
    }
    prevActiveNoteIdRef.current = note.id
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when note id changes, not on every note mutation
  }, [note?.id, cancelStrokeEraserGesture, cancelStrokesEditGesture, cancelImageEmbedEditGesture])

  useLayoutEffect(() => {
    const id = note?.id
    return () => {
      if (id) {
        cancelStrokesEditGesture(id)
        cancelImageEmbedEditGesture(id)
      }
    }
  }, [note?.id, cancelStrokesEditGesture, cancelImageEmbedEditGesture])

  useEffect(() => {
    if (!note?.id) {
      setSelectedStrokeIndices([])
      setSelectedImageEmbedId(null)
      setSelectedTextBoxIds([])
      setLassoDraftPoints(null)
      lassoDraftRef.current = null
      transformGestureRef.current = null
      imageTransformRef.current = null
      imageTapRef.current = null
      return
    }
    setSelectedStrokeIndices((prev) =>
      prev.filter((i) => i < note.strokes.length)
    )
  }, [note?.id, note?.strokes.length])

  useEffect(() => {
    if (PEN_TYPES[activePen]?.isLasso) return
    const id = note?.id
    if (id) {
      cancelStrokesEditGesture(id)
      cancelImageEmbedEditGesture(id)
    }
    setSelectedStrokeIndices([])
    setSelectedImageEmbedId(null)
    setSelectedTextBoxIds([])
    setLassoDraftPoints(null)
    lassoDraftRef.current = null
    transformGestureRef.current = null
    imageTransformRef.current = null
    imageTapRef.current = null
  }, [activePen, note?.id, cancelStrokesEditGesture, cancelImageEmbedEditGesture])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || !note) return
    const measure = () => setLayoutW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebind ResizeObserver when switching notes only
  }, [note?.id])

  const scrollSyncNoteId = note?.id
  const syncScrollExtent = useCallback(() => {
    const container = containerRef.current
    if (!container || !scrollSyncNoteId) return
    scrollPositionCache.set(scrollSyncNoteId, container.scrollTop)
    const curZoom = useNotesStore.getState().items[scrollSyncNoteId]?.zoom ?? 1
    debouncedScrollPersist(scrollSyncNoteId, curZoom)
    if (isPassive) return
    const n = useNotesStore.getState().items[scrollSyncNoteId]
    if (!n || n.type !== 'note') return
    const zoom = n.zoom ?? 1
    const scrollExtent = n.scrollHeight * zoom

    // Compute the minimum logical height needed to contain all content.
    let contentBottom = contentBottomForNote(n)
    for (const tb of n.textBoxes ?? []) {
      const h = textBoxHeightsRef.current[tb.id] ?? LINE_SPACING * 2
      contentBottom = Math.max(contentBottom, tb.y + h)
    }
    let minH = Math.max(MIN_NOTE_SCROLL_HEIGHT, Math.ceil(contentBottom + BOTTOM_CONTENT_PAD))

    const pdfBase = useNotesStore.getState().pdfBaseScrollHeights[scrollSyncNoteId]
    if (pdfBase) minH = Math.max(minH, pdfBase)

    // ── Extend: grow the canvas when the user approaches the bottom ──────
    // Require (1) real overflow, (2) near the bottom in scroll px, (3) the
    // canvas is not already taller than content — otherwise zoom-out (extent
    // shrinks) or prior false extends leave huge blank space below the PDF.
    if (
      scrollExtent > container.clientHeight &&
      container.scrollTop + container.clientHeight >= scrollExtent - 200 &&
      n.scrollHeight <= minH + 200
    ) {
      extendScrollHeight(scrollSyncNoteId)
      return
    }

    // ── Trim: drop off-screen blank space (logical bottom of viewport in note space)
    const logicalBottom = Math.ceil(
      (container.scrollTop + container.clientHeight) / zoom
    )
    const targetH = Math.max(minH, logicalBottom)

    if (n.scrollHeight > targetH + 200) {
      trimScrollHeight(scrollSyncNoteId, targetH)
    }
  }, [scrollSyncNoteId, extendScrollHeight, trimScrollHeight, isPassive])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !note) return
    container.addEventListener('scroll', syncScrollExtent, { passive: true })
    const noteIdForCleanup = note.id
    const getZoom = () => useNotesStore.getState().items[noteIdForCleanup]?.zoom ?? 1
    const onBeforeUnload = () => flushScrollPersist(noteIdForCleanup, getZoom())
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      container.removeEventListener('scroll', syncScrollExtent)
      if (noteIdForCleanup) flushScrollPersist(noteIdForCleanup, getZoom())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- note.id controls when to rebind; fresh state read inside handler
  }, [note?.id, syncScrollExtent])

  // Restore scroll position before first paint after remount (e.g. split-view
  // toggle or page refresh). Prefer the in-memory cache (exact physical
  // scrollTop from this session); fall back to the persisted logical Y
  // in localStorage (survives page refresh).
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !note?.id) return
    const cached = scrollPositionCache.get(note.id)
    if (cached != null && cached > 0) {
      container.scrollTop = cached
    } else {
      const vs = getViewState(note.id)
      if (vs.lastScrollY != null && vs.lastScrollY > 0) {
        container.scrollTop = vs.lastScrollY * noteZoom
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore only on mount for this note
  }, [note?.id])

  useLayoutEffect(() => {
    syncScrollExtent()
  }, [note?.id, noteZoom, syncScrollExtent])

  // Clear textbox editing state when switching away from text mode.
  useEffect(() => {
    if (!isKeyboard) {
      setEditingTextBoxId(null)
    }
  }, [isKeyboard])

  // Clear lasso/selection state when switching to select mode (no lasso available).
  useEffect(() => {
    if (isSelect) {
      setSelectedStrokeIndices([])
      setSelectedImageEmbedId(null)
      setSelectedTextBoxIds([])
      setLassoDraftPoints(null)
      lassoDraftRef.current = null
    }
  }, [isSelect])

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
    !isPassive && PEN_TYPES[activePen]?.isLasso && selectionBBox

  const selectedImageEmbed = useMemo(() => {
    if (!note || !selectedImageEmbedId) return null
    return (note.imageEmbeds ?? []).find((e) => e.id === selectedImageEmbedId) ?? null
  }, [note, selectedImageEmbedId])

  const selectedImageBBox = useMemo(() => {
    if (!selectedImageEmbed) return null
    return axisAlignedBBoxForRotatedRect(
      selectedImageEmbed.x,
      selectedImageEmbed.y,
      selectedImageEmbed.width,
      selectedImageEmbed.height,
      selectedImageEmbed.rotation ?? 0
    )
  }, [selectedImageEmbed])

  const showImageLassoChrome =
    !isPassive &&
    PEN_TYPES[activePen]?.isLasso &&
    selectedImageBBox &&
    selectedImageEmbedId

  const handlePointerDown = useCallback(
    (e) => {
      if (!note || isPassive) return
      bumpToolbarToThisPane()
      if (e.button !== 0) return
      // Pen/mouse always; touch only on phone-class viewports (see noteInputDefaults).
      if (e.pointerType === 'touch' && !phoneClassViewport) return

      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      isDrawingRef.current = true
      drawingPointerIdRef.current = e.pointerId

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
        const row = useNotesStore.getState().items[note.id]
        const strokesNow = row?.strokes ?? []
        const embeds = row?.imageEmbeds ?? []

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

        if (selectedImageEmbedId) {
          const emb = embeds.find((e) => e.id === selectedImageEmbedId)
          if (emb) {
            const ibox = axisAlignedBBoxForRotatedRect(
              emb.x,
              emb.y,
              emb.width,
              emb.height,
              emb.rotation ?? 0
            )
            const ihit = hitTransformHandle(px, py, ibox)
            if (ihit) {
              beginImageEmbedEditGesture(note.id)
              const cx = emb.x + emb.width / 2
              const cy = emb.y + emb.height / 2
              imageTransformRef.current = {
                kind: ihit,
                startX: px,
                startY: py,
                baseEmbed: { ...emb },
                embedId: emb.id,
                centerX: cx,
                centerY: cy,
                startDist: Math.max(Math.hypot(px - cx, py - cy), 1e-6),
                angle0: Math.atan2(py - cy, px - cx),
                baseRotation: emb.rotation ?? 0,
              }
              return
            }
          }
        }

        for (let i = embeds.length - 1; i >= 0; i--) {
          const emb = embeds[i]
          if (
            pointInRotatedRect(
              px,
              py,
              emb.x,
              emb.y,
              emb.width,
              emb.height,
              emb.rotation ?? 0
            )
          ) {
            imageTapRef.current = {
              embedId: emb.id,
              startX: px,
              startY: py,
            }
            const p2 = [px, py]
            lassoDraftRef.current = [p2]
            setLassoDraftPoints([p2])
            return
          }
        }

        setSelectedStrokeIndices([])
        setSelectedImageEmbedId(null)
        imageTapRef.current = null
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
      isPassive,
      activePen,
      activeColor,
      penSize,
      getPointerPos,
      eraseStrokesAt,
      beginStrokeEraserGesture,
      cancelStrokeEraserGesture,
      beginStrokesEditGesture,
      beginImageEmbedEditGesture,
      selectedStrokeIndices,
      selectedImageEmbedId,
      phoneClassViewport,
      bumpToolbarToThisPane,
    ]
  )

  const handlePointerMove = useCallback(
    (e) => {
      if (!isDrawingRef.current || !note || isPassive) return
      if (e.pointerId !== drawingPointerIdRef.current) return

      e.preventDefault()
      const point = getPointerPos(e)
      const pen = PEN_TYPES[activePen]

      if (imageTransformRef.current) {
        const g = imageTransformRef.current
        const x = point[0]
        const y = point[1]
        const row = useNotesStore.getState().items[note.id]
        const list = [...(row?.imageEmbeds ?? [])]
        const idx = list.findIndex((e) => e.id === g.embedId)
        if (idx < 0) return
        const base = g.baseEmbed
        const cx = g.centerX
        const cy = g.centerY
        if (g.kind === 'move') {
          const dx = x - g.startX
          const dy = y - g.startY
          list[idx] = {
            ...base,
            x: base.x + dx,
            y: base.y + dy,
          }
          setNoteImageEmbedsLive(note.id, list)
          return
        }
        if (g.kind === 'rotate') {
          const ang = Math.atan2(y - cy, x - cx) - g.angle0
          const deg = g.baseRotation + (ang * 180) / Math.PI
          list[idx] = { ...base, rotation: deg }
          setNoteImageEmbedsLive(note.id, list)
          return
        }
        if (g.kind === 'scale') {
          const d = Math.hypot(x - cx, y - cy)
          const sc = d / g.startDist
          const scale = Math.max(0.05, Math.min(sc, 40))
          const nw = Math.max(8, base.width * scale)
          const nh = Math.max(8, base.height * scale)
          list[idx] = {
            ...base,
            x: cx - nw / 2,
            y: cy - nh / 2,
            width: nw,
            height: nh,
          }
          setNoteImageEmbedsLive(note.id, list)
          return
        }
      }

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
      isPassive,
      activePen,
      getPointerPos,
      eraseStrokesAt,
      setNoteStrokesLive,
      setNoteImageEmbedsLive,
    ]
  )

  const handlePointerUp = useCallback((e) => {
    if (
      e?.pointerId != null &&
      drawingPointerIdRef.current != null &&
      e.pointerId !== drawingPointerIdRef.current
    ) {
      return
    }
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    drawingPointerIdRef.current = null

    if (imageTransformRef.current && note) {
      imageTransformRef.current = null
      commitImageEmbedEditGesture(note.id)
      return
    }

    if (transformGestureRef.current && note) {
      transformGestureRef.current = null
      commitStrokesEditGesture(note.id)
      return
    }

    if (note && PEN_TYPES[activePen]?.isLasso && lassoDraftRef.current) {
      const tap = imageTapRef.current
      const pts = lassoDraftRef.current
      lassoDraftRef.current = null
      setLassoDraftPoints(null)
      imageTapRef.current = null

      if (tap && pts.length >= 1) {
        let maxD = 0
        for (const p of pts) {
          maxD = Math.max(
            maxD,
            Math.hypot(p[0] - tap.startX, p[1] - tap.startY)
          )
        }
        if (maxD < 12) {
          setSelectedStrokeIndices([])
          setSelectedImageEmbedId(tap.embedId)
          return
        }
      }

      if (pts.length >= 3) {
        const noteState = useNotesStore.getState().items[note.id]
        const strokes = noteState?.strokes ?? []
        const idx = []
        for (let i = 0; i < strokes.length; i++) {
          if (strokeIntersectsLasso(strokes[i], pts)) idx.push(i)
        }
        setSelectedStrokeIndices(idx.sort((a, b) => a - b))
        setSelectedImageEmbedId(null)

        // Also select textboxes whose center falls inside the lasso polygon.
        const tbs = noteState?.textBoxes ?? []
        const tbIds = tbs
          .filter((tb) => {
            const h = textBoxHeightsRef.current[tb.id] ?? LINE_SPACING
            const cx = tb.x + tb.width / 2
            const cy = tb.y + h / 2
            return pointInPolygon(cx, cy, pts)
          })
          .map((tb) => tb.id)
        setSelectedTextBoxIds(tbIds)
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
    commitImageEmbedEditGesture,
  ])

  /**
   * If the currently-editing textbox has no content, delete it.
   * Called before switching to a different textbox or leaving edit mode.
   */
  const cleanUpEmptyEditingTextBox = useCallback(
    (currentEditingId) => {
      if (!currentEditingId || !note) return
      const noteState = useNotesStore.getState().items[note.id]
      const box = noteState?.textBoxes?.find((b) => b.id === currentEditingId)
      if (box && !box.content.trim()) {
        deleteTextBox(note.id, currentEditingId)
        setEditingTextBoxId(null)
        setSelectedTextBoxIds((prev) => prev.filter((sid) => sid !== currentEditingId))
      }
    },
    [note, deleteTextBox]
  )

  /** Wrapped setEditingTextBoxId that cleans up any previous empty textbox first. */
  const handleStartEditTextBox = useCallback(
    (id) => {
      if (editingTextBoxId && editingTextBoxId !== id) {
        cleanUpEmptyEditingTextBox(editingTextBoxId)
      }
      setEditingTextBoxId(id)
    },
    [editingTextBoxId, cleanUpEmptyEditingTextBox]
  )

  /**
   * Handles a tap/click on empty canvas space while in text (keyboard) mode:
   * creates a new textbox whose left edge is at the click position and whose
   * right edge reaches the current viewport right boundary.
   */
  const handlePaperPointerDown = useCallback(
    (e) => {
      if (!isKeyboard || !note) return
      if (e.button !== 0) return
      // Prevent the browser from moving focus to document.body (mobile) or
      // generating a click event that could steal focus away from the new textarea.
      e.preventDefault()
      bumpToolbarToThisPane()
      cleanUpEmptyEditingTextBox(editingTextBoxId)
      const [x, y] = getPointerPos(e)
      const id = uuidv4()
      // Extend to the current viewport's right edge in logical coordinates.
      // Using (scrollLeft + clientWidth) / zoom works for all note types and
      // all horizontal scroll positions.
      const container = containerRef.current
      const viewportRight = container && layoutW > 0
        ? (container.scrollLeft + container.clientWidth) / noteZoom
        : layoutW / noteZoom
      const width = Math.max(60, viewportRight - x - 16)
      createTextBox(note.id, { id, x, y, width, content: '' })
      setEditingTextBoxId(id)
    },
    [isKeyboard, note, editingTextBoxId, getPointerPos, layoutW, noteZoom, createTextBox, bumpToolbarToThisPane, cleanUpEmptyEditingTextBox]
  )

  const handleTextBoxEdit = useCallback(
    (id, content) => {
      if (!note) return
      updateTextBox(note.id, id, { content })
    },
    [note, updateTextBox]
  )

  const handleDeleteTextBox = useCallback(
    (id) => {
      if (!note) return
      deleteTextBox(note.id, id)
      setEditingTextBoxId((prev) => (prev === id ? null : prev))
      setSelectedTextBoxIds((prev) => prev.filter((sid) => sid !== id))
    },
    [note, deleteTextBox]
  )

  const handleTextBoxResize = useCallback(
    (id, newWidth) => {
      if (!note) return
      updateTextBox(note.id, id, { width: newWidth })
    },
    [note, updateTextBox]
  )

  const handleTextBoxMove = useCallback(
    (id, newX, newY) => {
      if (!note) return
      updateTextBox(note.id, id, { x: newX, y: newY })
    },
    [note, updateTextBox]
  )

  const handleTextBoxRotate = useCallback(
    (id, rotation) => {
      if (!note) return
      updateTextBox(note.id, id, { rotation })
    },
    [note, updateTextBox]
  )

  const handleTextBoxHeightChange = useCallback((id, height) => {
    textBoxHeightsRef.current = { ...textBoxHeightsRef.current, [id]: height }
  }, [])

  const templateStyle = useMemo(() => {
    if (!note) return {}
    if (note.pdfBackgroundFileId || note.epubBackgroundFileId) return {}
    const styles = templateStylesForSpacing(LINE_SPACING)
    return styles[note.template] || {}
  }, [note])

  /** PDF render target width — constant viewport width so re-rasterization stays at 1:1 pixel density regardless of zoom. */
  const paperWidthForPdf = layoutW

  const spacerStyle = useMemo(() => {
    if (!note) return {}
    // Always at least as wide as the viewport. When content extends beyond the
    // logical canvas boundary (e.g. zoomed in past existing strokes) the spacer
    // grows so the browser shows a horizontal scrollbar.
    const minVisualW = layoutW > 0 ? layoutW : 100
    const contentVisualW = maxContentRight * noteZoom
    return {
      width: layoutW > 0
        ? `${Math.ceil(Math.max(minVisualW, contentVisualW))}px`
        : `${Math.max(100, contentVisualW > 0 ? contentVisualW : 100)}%`,
      minHeight: note.scrollHeight * noteZoom,
      minWidth: 0,
      boxSizing: 'border-box',
    }
  }, [note, noteZoom, layoutW, maxContentRight])

  /**
   * Inner note surface. For non-PDF notes the logical width is `layoutW / zoom`
   * so the canvas always fills the viewport after the scale transform regardless
   * of zoom level. Zooming out expands the drawable area; zooming in contracts it.
   * If persisted content extends beyond the logical boundary the inner div grows
   * to fit it (the spacer widens accordingly so the container scrolls).
   * For PDF notes the width stays fixed at `layoutW` to keep the PDF background
   * correctly sized against the parent scale transform.
   */
  const scaledInnerStyle = useMemo(() => {
    if (!note) return {}
    const z = noteZoom
    // Grow to fit any content that would otherwise be off-screen.
    const effectiveLogicalW = Math.max(logicalCanvasW, maxContentRight)
    const widthPx = layoutW > 0 ? `${effectiveLogicalW}px` : '100%'
    return {
      width: widthPx,
      minHeight: note.scrollHeight,
      minWidth: 0,
      boxSizing: 'border-box',
      transform: `scale(${z})`,
      transformOrigin: 'left top',
      ...templateStyle,
    }
  }, [note, noteZoom, templateStyle, layoutW, logicalCanvasW, maxContentRight])

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
    if (noteIdProp != null) {
      return (
        <div className="flex flex-1 items-center justify-center bg-canvas-bg text-text-muted min-h-0 min-w-0 text-sm px-4 text-center">
          This note is no longer available.
        </div>
      )
    }
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
      data-note-scroll={note?.id}
      className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative bg-canvas-bg min-w-0 touch-pan-x touch-pan-y"
    >
      <div className="relative min-w-0" style={spacerStyle}>
        {/* data-notezoom lets the resize handle drag compute note-space deltas */}
        <div
          className="relative w-full min-w-0"
          style={scaledInnerStyle}
          data-notezoom={noteZoom}
          onPointerDown={isKeyboard ? handlePaperPointerDown : undefined}
        >
          <PdfNoteBackground
            pdfUrl={pdfUrl ?? null}
            paperWidth={paperWidthForPdf}
            noteZoom={noteZoom}
            importDocFontSizePt={note.importDocFontSizePt}
            noteId={note.id}
            textSelectable={isSelect}
            onScrollTo={handlePdfScrollTo}
          />
          <EpubNoteBackground
            epubUrl={epubUrl ?? null}
            paperWidth={note.epubContentWidth ?? 600}
            noteZoom={noteZoom}
            importDocFontSizePt={note.importDocFontSizePt}
            importEpubMargins={note.importEpubMargins}
            noteId={note.id}
            textSelectable={isSelect}
            onScrollTo={handlePdfScrollTo}
          />
          <ImageEmbedsLayer
            embeds={note.imageEmbeds ?? []}
            minHeight={note.scrollHeight}
            isKeyboard={isKeyboard}
          />
          <TextBoxesLayer
            textBoxes={note.textBoxes ?? []}
            editingId={editingTextBoxId}
            selectedIds={selectedTextBoxIds}
            isTextMode={isKeyboard}
            onStartEdit={handleStartEditTextBox}
            onCommitEdit={handleTextBoxEdit}
            onDelete={handleDeleteTextBox}
            onResize={handleTextBoxResize}
            onMove={handleTextBoxMove}
            onRotate={handleTextBoxRotate}
            onHeightChange={handleTextBoxHeightChange}
          />
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            className={`absolute top-0 left-0 w-full ${
              isPassive
                ? `z-[5] pointer-events-none${isSelect ? ' cursor-default' : ''}`
                : 'cursor-crosshair z-[5]'
            }`}
            style={{
              minHeight: note.scrollHeight,
              touchAction: isPassive ? 'auto' : 'none',
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
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
            {showImageLassoChrome && selectedImageBBox && (
              <g pointerEvents="none">
                {(() => {
                  const { minX: mx, minY: my, maxX: Mx, maxY: My } =
                    selectedImageBBox
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
