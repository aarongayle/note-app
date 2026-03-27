import { useEffect, useRef } from 'react'
import useNotesStore from '../stores/useNotesStore'
import { MIN_NOTE_SCROLL_HEIGHT } from '../lib/noteScrollBounds.js'
import { KEYBOARD_FONT_SIZE_PX } from '../lib/canvasConstants.js'
import { parseEpub } from '../lib/epubParser.js'

const EPUB_BOTTOM_PAD = 48
const BASE_FONT_PX = 16

// ── Module-level cache so remounts don't re-fetch / re-parse ──────────────
const MAX_CACHE = 4
const parsedCache = new Map()

function acquireCached(url) {
  const entry = parsedCache.get(url)
  if (!entry) return null
  entry.refs++
  return entry.data
}

async function fetchAndCache(url) {
  const existing = parsedCache.get(url)
  if (existing) { existing.refs++; return existing.data }

  const res = await fetch(url)
  const blob = await res.blob()
  const data = await parseEpub(blob)

  if (parsedCache.size >= MAX_CACHE && !parsedCache.has(url)) {
    const oldest = parsedCache.keys().next().value
    const evicted = parsedCache.get(oldest)
    if (evicted.refs <= 0) { evicted.data.revokeUrls(); parsedCache.delete(oldest) }
  }
  parsedCache.set(url, { data, refs: 1 })
  return data
}

function releaseCached(url) {
  const entry = parsedCache.get(url)
  if (!entry) return
  entry.refs--
  if (entry.refs <= 0 && parsedCache.size > MAX_CACHE) {
    entry.data.revokeUrls()
    parsedCache.delete(url)
  }
}

/**
 * Resolve an EPUB-internal href relative to the chapter that contains the link.
 * Returns { chapterSrc, fragment } or null for external / unresolvable links.
 */
function resolveEpubHref(href, currentChapterSrc) {
  if (!href) return null
  if (/^(https?:|mailto:|javascript:|tel:|data:|blob:)/i.test(href)) return null

  const hashIdx = href.indexOf('#')
  const pathPart = hashIdx >= 0 ? href.substring(0, hashIdx) : href
  const fragment = hashIdx >= 0 ? href.substring(hashIdx + 1) : null

  if (!pathPart) {
    return { chapterSrc: currentChapterSrc, fragment }
  }

  const currentDir = currentChapterSrc.includes('/')
    ? currentChapterSrc.replace(/\/[^/]+$/, '/')
    : ''
  const decoded = decodeURIComponent(pathPart).replace(/\\/g, '/')
  const parts = (currentDir + decoded).split('/')
  const resolved = []
  for (const p of parts) {
    if (p === '..') resolved.pop()
    else if (p !== '.') resolved.push(p)
  }
  return { chapterSrc: resolved.join('/'), fragment }
}

/**
 * Populate a shadow root with parsed EPUB content. Synchronous — used for
 * both cached (instant) and fresh (after async fetch) paths.
 */
function renderIntoShadow(root, shadow, parsed, paperWidth, epubFontPx, margins) {
  shadow.replaceChildren()

  const style = document.createElement('style')
  style.textContent = `
    :host {
      display: block;
      width: ${paperWidth}px;
    }
    .epub-body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: ${epubFontPx}px;
      line-height: 1.6;
      color: #1a1a1a;
      padding: ${margins.top}pt ${margins.right}pt ${margins.bottom}pt ${margins.left}pt;
      box-sizing: border-box;
      word-wrap: break-word;
      overflow-wrap: break-word;
      hyphens: auto;
    }
    .epub-body img, .epub-body svg {
      max-width: 100%;
      height: auto;
    }
    .epub-body a[href] {
      color: #1a4fa0;
      cursor: pointer;
    }
    .epub-body a[href]:hover {
      background-color: rgb(255 255 0 / 0.2);
    }
    .epub-body table {
      border-collapse: collapse;
      max-width: 100%;
    }
    .epub-body td, .epub-body th {
      padding: 4px 8px;
      border: 1px solid #ccc;
    }
    .epub-chapter {
      break-inside: avoid;
    }
    ${parsed.css}
  `
  shadow.appendChild(style)

  const wrapper = document.createElement('div')
  wrapper.className = 'epub-body'

  for (const ch of parsed.chapters) {
    const chDiv = document.createElement('div')
    chDiv.className = 'epub-chapter'
    chDiv.dataset.epubSrc = ch.key
    chDiv.innerHTML = ch.bodyHtml
    wrapper.appendChild(chDiv)
  }
  shadow.appendChild(wrapper)
}

/**
 * Renders EPUB HTML in a fixed-width shadow DOM container.
 * The container width stays constant regardless of noteZoom — the parent's
 * transform: scale(noteZoom) handles visual zoom without reflowing the HTML.
 * This keeps annotations aligned with the text at every zoom level.
 *
 * Parsed EPUB data is cached at module scope so toggling split view or
 * switching notes doesn't re-fetch / re-parse.
 *
 * @param {{
 *   epubUrl: string | null | undefined
 *   paperWidth: number — fixed layout width (px) chosen at import
 *   noteZoom: number — used only for link scroll math, does NOT trigger re-render
 *   importDocFontSizePt?: number
 *   importEpubMargins?: { top: number, right: number, bottom: number, left: number }
 *   noteId: string
 *   textSelectable?: boolean
 *   onScrollTo?: (yLogical: number) => void
 * }} props
 */
export default function EpubNoteBackground({
  epubUrl,
  paperWidth,
  noteZoom,
  importDocFontSizePt,
  importEpubMargins,
  noteId,
  textSelectable = false,
  onScrollTo,
}) {
  const containerRef = useRef(null)
  const ensureNoteScrollHeight = useNotesStore((s) => s.ensureNoteScrollHeight)
  const setPdfBaseScrollHeight = useNotesStore((s) => s.setPdfBaseScrollHeight)

  const noteZoomRef = useRef(noteZoom)
  noteZoomRef.current = noteZoom
  const onScrollToRef = useRef(onScrollTo)
  onScrollToRef.current = onScrollTo

  const fontScale = (importDocFontSizePt ?? KEYBOARD_FONT_SIZE_PX) / KEYBOARD_FONT_SIZE_PX
  const epubFontPx = BASE_FONT_PX * fontScale

  const margins = importEpubMargins ?? { top: 32, right: 32, bottom: 32, left: 32 }

  useEffect(() => {
    const root = containerRef.current
    if (!root || !epubUrl || paperWidth <= 0) return undefined

    let cancelled = false
    let resizeOb = null

    function finishRender(parsed) {
      if (cancelled) return

      let shadow = root.shadowRoot
      if (!shadow) shadow = root.attachShadow({ mode: 'open' })

      renderIntoShadow(root, shadow, parsed, paperWidth, epubFontPx, margins)

      // ── Internal link handler ───────────────────────────────────────────
      shadow.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]')
        if (!link) return

        const href = link.getAttribute('href')

        if (/^https?:/i.test(href)) {
          e.preventDefault()
          e.stopPropagation()
          window.open(href, '_blank', 'noopener,noreferrer')
          return
        }

        const chapterDiv = link.closest('.epub-chapter[data-epub-src]')
        if (!chapterDiv) { e.preventDefault(); return }

        const resolved = resolveEpubHref(href, chapterDiv.dataset.epubSrc)
        if (!resolved) { e.preventDefault(); return }

        e.preventDefault()
        e.stopPropagation()

        const targetChapter = shadow.querySelector(
          `.epub-chapter[data-epub-src="${CSS.escape(resolved.chapterSrc)}"]`
        )
        if (!targetChapter) return

        let targetEl = null
        if (resolved.fragment) {
          targetEl = targetChapter.querySelector(`[id="${CSS.escape(resolved.fragment)}"]`) ??
                     targetChapter.querySelector(`[name="${CSS.escape(resolved.fragment)}"]`)
        }

        const scrollTarget = targetEl ?? targetChapter
        const rootRect = root.getBoundingClientRect()
        const targetRect = scrollTarget.getBoundingClientRect()
        const yLogical = (targetRect.top - rootRect.top) / noteZoomRef.current

        onScrollToRef.current?.(yLogical)
      })

      // Report height
      const reportHeight = () => {
        if (cancelled) return
        const h = root.offsetHeight
        if (h > 0) {
          const logicalH = Math.max(MIN_NOTE_SCROLL_HEIGHT, Math.ceil(h + EPUB_BOTTOM_PAD))
          ensureNoteScrollHeight(noteId, logicalH)
          setPdfBaseScrollHeight(noteId, logicalH)
        }
      }

      reportHeight()
      resizeOb = new ResizeObserver(reportHeight)
      resizeOb.observe(root)
    }

    // Fast path: render from cache synchronously
    const cached = acquireCached(epubUrl)
    if (cached) {
      finishRender(cached)
    } else {
      // Slow path: fetch, parse, cache, then render
      ;(async () => {
        try {
          const parsed = await fetchAndCache(epubUrl)
          if (!cancelled) finishRender(parsed)
          else releaseCached(epubUrl)
        } catch (e) {
          console.error('EPUB load failed', e)
        }
      })()
    }

    return () => {
      cancelled = true
      resizeOb?.disconnect()
      releaseCached(epubUrl)
    }
  }, [epubUrl, paperWidth, epubFontPx, margins.top, margins.right, margins.bottom, margins.left, noteId, ensureNoteScrollHeight, setPdfBaseScrollHeight])

  if (!epubUrl) return null

  return (
    <div
      ref={containerRef}
      className={`absolute left-0 top-0 z-0 pointer-events-none${textSelectable ? ' epub-text-selectable' : ''}`}
      style={{ width: `${paperWidth}px` }}
      aria-hidden={!textSelectable}
    />
  )
}
