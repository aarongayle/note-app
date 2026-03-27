import { useEffect, useRef } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import useNotesStore from '../stores/useNotesStore'
import { MIN_NOTE_SCROLL_HEIGHT } from '../lib/noteScrollBounds.js'
import { KEYBOARD_FONT_SIZE_PX } from '../lib/canvasConstants.js'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const PDF_BOTTOM_PAD = 48

/**
 * Minimal link service for internal PDF navigation. Resolves named/explicit
 * destinations and calls onScrollTo with the logical Y coordinate (pre-zoom).
 */
function createLinkService(pageInfoRef) {
  const svc = {
    pdfDocument: null,
    /** Must be true or pdf.js disables URL links (empty href + blocked click). */
    externalLinkEnabled: true,
    eventBus: null,

    _onScrollTo: null,

    /**
     * Required by pdf.js AnnotationLayer for Link annotations with a URL action.
     * Without this, render() throws and no link annotations appear for that page.
     * Mirrors mozilla/pdf.js PDFLinkService.addLinkAttributes (simplified).
     */
    addLinkAttributes(link, url, newWindow = false) {
      if (!url || typeof url !== 'string') {
        throw new Error('A valid "url" parameter must be provided.')
      }
      if (!svc.externalLinkEnabled) {
        link.href = ''
        link.title = `Disabled: ${url}`
        link.onclick = () => false
        return
      }
      link.href = link.title = url
      link.target = newWindow ? '_blank' : ''
      link.rel = 'noopener noreferrer nofollow'
    },

    executeNamedAction() {
      // Optional: PrevPage/NextPage etc.; no-op is fine for our scroll-only viewer.
    },

    async executeSetOCGState() {},

    async goToDestination(dest) {
      let explicitDest
      if (typeof dest === 'string') {
        if (!svc.pdfDocument) return
        try {
          explicitDest = await svc.pdfDocument.getDestination(dest)
        } catch {
          return
        }
      } else {
        explicitDest = await dest
      }
      if (!Array.isArray(explicitDest)) return

      const [destRef] = explicitDest
      let pageIndex
      if (destRef && typeof destRef === 'object') {
        try {
          pageIndex = await svc.pdfDocument.getPageIndex(destRef)
        } catch {
          return
        }
      } else if (Number.isInteger(destRef)) {
        pageIndex = destRef
      } else {
        return
      }

      const info = pageInfoRef.current[pageIndex]
      if (!info) return

      let yOffset = 0
      // destArray[1] is a PDF name object like { name: 'XYZ' } or the string 'XYZ'
      const destTypeName = explicitDest[1]?.name ?? explicitDest[1]
      if (destTypeName === 'XYZ') {
        const destY = explicitDest[3]  // bottom-left origin, in PDF user units
        if (destY != null) {
          const yFraction = 1 - destY / info.pdfHeight
          yOffset = Math.max(0, Math.min(1, yFraction)) * info.displayHeight
        }
      } else if (destTypeName === 'FitH' || destTypeName === 'FitBH') {
        const destY = explicitDest[2]
        if (destY != null) {
          const yFraction = 1 - destY / info.pdfHeight
          yOffset = Math.max(0, Math.min(1, yFraction)) * info.displayHeight
        }
      }
      // Other dest types (Fit, FitV, FitR…) → navigate to top of target page

      svc._onScrollTo?.(info.topY + yOffset)
    },

    getDestinationHash() { return '' },
    getAnchorUrl() { return '' },
    get isInPresentationMode() { return false },
    get pagesCount() { return svc.pdfDocument?.numPages ?? 0 },
    get page() { return 1 },
    set page(_) {},
    get rotation() { return 0 },
    set rotation(_) {},
  }
  return svc
}

/**
 * Renders a PDF as stacked pages in note space. Uses measured paper width so
 * rasterization tracks note zoom (same coordinate system as ink).
 *
 * @param {{
 *   pdfUrl: string | null | undefined
 *   paperWidth: number — CSS display width (= viewport width, constant)
 *   noteZoom: number — current note zoom; used to render at higher resolution for crispness
 *   importDocFontSizePt?: number
 *   noteId: string
 *   textSelectable?: boolean — when true, the text layer + link annotations receive pointer events
 *   onScrollTo?: (yLogical: number) => void — called when a PDF internal link is activated
 * }} props
 */
export default function PdfNoteBackground({
  pdfUrl,
  paperWidth,
  noteZoom,
  importDocFontSizePt,
  noteId,
  textSelectable = false,
  onScrollTo,
}) {
  const containerRef = useRef(null)
  const ensureNoteScrollHeight = useNotesStore((s) => s.ensureNoteScrollHeight)
  const setPdfBaseScrollHeight = useNotesStore((s) => s.setPdfBaseScrollHeight)

  // Per-page info for link navigation: { topY, displayHeight, pdfHeight }
  const pageInfoRef = useRef([])

  // Link service singleton — stable across renders
  const linkServiceRef = useRef(null)
  if (!linkServiceRef.current) {
    linkServiceRef.current = createLinkService(pageInfoRef)
  }
  // Keep onScrollTo callback current without re-triggering the render effect
  linkServiceRef.current._onScrollTo = onScrollTo ?? null

  const baseFont = KEYBOARD_FONT_SIZE_PX
  const docScale = (importDocFontSizePt ?? baseFont) / baseFont

  useEffect(() => {
    const root = containerRef.current
    if (!root || !pdfUrl || paperWidth <= 0 || !Number.isFinite(noteZoom) || noteZoom <= 0) {
      return undefined
    }

    let cancelled = false
    const textLayers = []
    const annotLayers = []
    pageInfoRef.current = []
    const linkService = linkServiceRef.current

    ;(async () => {
      root.replaceChildren()
      try {
        const task = pdfjs.getDocument({
          url: pdfUrl,
          withCredentials: false,
        })
        const pdf = await task.promise
        if (cancelled) return
        linkService.pdfDocument = pdf

        let totalH = 0
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return
          const page = await pdf.getPage(i)
          const base = page.getViewport({ scale: 1 })
          // Render at noteZoom × paperWidth pixels so the canvas has 1:1 pixel
          // density after the parent's transform: scale(noteZoom) magnifies it.
          const scale = (paperWidth / base.width) * docScale * noteZoom
          const viewport = page.getViewport({ scale })
          const w = Math.ceil(viewport.width)
          const h = Math.ceil(viewport.height)
          // CSS display size (what the layout sees, before the parent scale transform).
          const displayW = Math.round(w / noteZoom)
          const displayH = Math.round(h / noteZoom)

          // Record page info for link navigation (topY before appending to DOM)
          pageInfoRef.current.push({
            topY: totalH,
            displayHeight: displayH,
            pdfHeight: base.height,  // PDF natural height in user units
          })

          // Wrapper holds canvas + text layer + annotation layer at the same CSS size
          const pageWrapper = document.createElement('div')
          pageWrapper.style.cssText = `position:relative;display:block;width:${displayW}px;height:${displayH}px;`

          // Canvas
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            root.appendChild(pageWrapper)
            totalH += displayH
            continue
          }
          canvas.width = w
          canvas.height = h
          canvas.style.display = 'block'
          canvas.style.width = `${displayW}px`
          canvas.style.height = `${displayH}px`
          canvas.style.verticalAlign = 'top'
          await page.render({ canvasContext: ctx, viewport }).promise
          if (cancelled) return
          pageWrapper.appendChild(canvas)

          // --total-scale-factor maps viewport coords → container CSS pixels.
          // Canvas renders at `scale` but is displayed at `scale/noteZoom` CSS pixels
          // (the parent transform: scale(noteZoom) restores full size visually).
          const scaleFactor = scale / noteZoom

          // Text layer — positioned absolute over the canvas
          const textLayerDiv = document.createElement('div')
          textLayerDiv.className = 'pdfTextLayer'
          textLayerDiv.style.setProperty('--total-scale-factor', `${scaleFactor}`)
          textLayerDiv.style.setProperty('--scale-round-x', '1px')
          textLayerDiv.style.setProperty('--scale-round-y', '1px')
          try {
            const textLayer = new pdfjs.TextLayer({
              textContentSource: page.streamTextContent(),
              container: textLayerDiv,
              viewport,
            })
            textLayers.push(textLayer)
            await textLayer.render()
            if (cancelled) {
              textLayer.cancel()
              return
            }
          } catch {
            // Text layer failed (e.g. no text content) — skip silently
          }
          pageWrapper.appendChild(textLayerDiv)

          // Annotation layer — renders link annotations (and others) over the page
          try {
            const annotations = await page.getAnnotations({ intent: 'display' })
            if (!cancelled && annotations.length > 0) {
              const annotDiv = document.createElement('div')
              annotDiv.className = 'pdfAnnotationLayer'
              annotDiv.style.setProperty('--total-scale-factor', `${scaleFactor}`)
              // pdf.js setLayerDimensions() uses round(..., var(--scale-round-x/y)) when the
              // browser supports CSS round(); without these, width/height are invalid → 0×0.
              annotDiv.style.setProperty('--scale-round-x', '1px')
              annotDiv.style.setProperty('--scale-round-y', '1px')
              const annotLayer = new pdfjs.AnnotationLayer({
                div: annotDiv,
                page,
                viewport: viewport.clone({ dontFlip: true }),
                linkService,
              })
              annotLayers.push(annotLayer)
              await annotLayer.render({
                annotations,
                renderForms: false,
                enableScripting: false,
                hasJSActions: false,
                fieldObjects: null,
              })
              if (cancelled) return
              // Match pageWrapper / canvas CSS size (same coordinate space as link rects).
              annotDiv.style.width = `${displayW}px`
              annotDiv.style.height = `${displayH}px`
              pageWrapper.appendChild(annotDiv)
            }
          } catch {
            // Annotation layer failed — skip silently
          }

          root.appendChild(pageWrapper)
          totalH += displayH
        }
        if (!cancelled && totalH > 0) {
          const pdfLogicalH = Math.max(MIN_NOTE_SCROLL_HEIGHT, Math.ceil(totalH + PDF_BOTTOM_PAD))
          ensureNoteScrollHeight(noteId, pdfLogicalH)
          // Record the PDF content height separately so Canvas can trim any
          // user-extended blank space below the last page when scrolling back up.
          setPdfBaseScrollHeight(noteId, pdfLogicalH)
        }
      } catch (e) {
        console.error('PDF render failed', e)
      }
    })()

    return () => {
      cancelled = true
      for (const tl of textLayers) {
        try { tl.cancel() } catch { /* ignore */ }
      }
    }
  }, [pdfUrl, paperWidth, noteZoom, docScale, noteId, ensureNoteScrollHeight, setPdfBaseScrollHeight])

  if (!pdfUrl) return null

  return (
    <div
      ref={containerRef}
      className={`absolute left-0 right-0 top-0 z-0 pointer-events-none w-full${textSelectable ? ' pdf-text-selectable' : ''}`}
      aria-hidden={!textSelectable}
    />
  )
}
