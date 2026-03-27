import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import {
  PDFDocument, StandardFonts, rgb,
  PDFArray, PDFDict, PDFName, PDFNull, PDFNumber,
} from 'pdf-lib'

// ── Utilities ─────────────────────────────────────────────────────────────────

function asArray(v) {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

function resolveZipPath(baseDir, href) {
  if (!href || typeof href !== 'string') return null
  const clean = decodeURIComponent(href.split('?')[0].split('#')[0]).replace(/\\/g, '/')
  if (/^(https?:|\/\/)/.test(clean)) return null
  if (clean.startsWith('/')) return clean.slice(1)
  const parts = (baseDir + clean).split('/')
  const out = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.') out.push(p)
  }
  return out.join('/')
}

function mimeForExtension(ext) {
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] ?? null
}

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1]
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Resolve an EPUB internal href to a global anchor key.
 * chapterKey is the chapter path with opfDir already stripped.
 */
function resolveInternalHref(href, chapterKey) {
  if (!href) return null
  if (/^(https?:|mailto:|ftp:|javascript:)/i.test(href)) return null

  if (href.startsWith('#')) {
    const frag = href.slice(1)
    return frag ? `${chapterKey}#${frag}` : chapterKey
  }

  const [rawPath, frag] = href.split('#')
  const chapterDir = chapterKey.includes('/') ? chapterKey.replace(/\/[^/]+$/, '/') : ''
  const resolved = resolveZipPath(chapterDir, rawPath)
  if (!resolved) return null
  return frag ? `${resolved}#${frag}` : resolved
}

// Width cache so we don't recompute metrics for every token on every line
const _widthCache = new Map()
function cachedWidth(font, text, size) {
  const k = `${font.name}|${size}|${text}`
  let w = _widthCache.get(k)
  if (w === undefined) {
    try { w = font.widthOfTextAtSize(text, size) } catch { w = size * 0.5 * text.length }
    _widthCache.set(k, w)
  }
  return w
}

// ── PDF link annotation (GoTo) ─────────────────────────────────────────────────

function addGoToAnnotation(pdfDoc, sourcePage, rect, targetPageIdx, targetY) {
  const targetPage = pdfDoc.getPage(targetPageIdx)
  const ctx = pdfDoc.context

  const dest = PDFArray.withContext(ctx)
  dest.push(targetPage.ref)
  dest.push(PDFName.of('XYZ'))
  dest.push(PDFNull)
  dest.push(targetY != null ? PDFNumber.of(targetY) : PDFNull)
  dest.push(PDFNull)

  const action = PDFDict.withContext(ctx)
  action.set(PDFName.of('S'), PDFName.of('GoTo'))
  action.set(PDFName.of('D'), dest)

  const annot = PDFDict.withContext(ctx)
  annot.set(PDFName.of('Type'), PDFName.of('Annot'))
  annot.set(PDFName.of('Subtype'), PDFName.of('Link'))
  annot.set(PDFName.of('Rect'), ctx.obj(rect))
  annot.set(PDFName.of('Border'), ctx.obj([0, 0, 0]))
  annot.set(PDFName.of('A'), action)

  sourcePage.node.addAnnot(ctx.register(annot))
}

// ── PDF layout engine ─────────────────────────────────────────────────────────

const LINK_COLOR = rgb(0.05, 0.2, 0.7)
const TEXT_COLOR = rgb(0, 0, 0)

class PdfLayout {
  constructor(pdfDoc, { pageW, pageH, margins, baseFontSize, fonts }) {
    this.pdfDoc = pdfDoc
    this.pageW = pageW
    this.pageH = pageH
    this.ml = margins.left
    this.mr = margins.right
    this.mt = margins.top
    this.mb = margins.bottom
    this.baseFontSize = baseFontSize
    this.fonts = fonts
    this.contentW = pageW - margins.left - margins.right

    // { text, font, size, color }[]
    this._words = []
    this._lineW = 0
    this._lineSize = baseFontSize

    this.page = null
    this.y = 0
    this._newPage()
  }

  get pageIndex() { return this.pdfDoc.getPageCount() - 1 }

  _newPage() {
    this.page = this.pdfDoc.addPage([this.pageW, this.pageH])
    this.y = this.pageH - this.mt
  }

  _ensureY(h) {
    if (this.y - h < this.mb) this._newPage()
  }

  _commitLine(lineH) {
    if (this._words.length === 0) return
    this._ensureY(lineH)
    let x = this.ml
    let i = 0
    while (i < this._words.length) {
      const { font, size, color } = this._words[i]
      let merged = ''
      let j = i
      // Merge consecutive tokens with the same font/size/color into one drawText call
      while (
        j < this._words.length &&
        this._words[j].font === font &&
        this._words[j].size === size &&
        this._words[j].color === color
      ) {
        merged += this._words[j].text
        j++
      }
      try {
        this.page.drawText(merged, { x, y: this.y - size, size, font, color })
        x += cachedWidth(font, merged, size)
      } catch {
        // Fall back word-by-word for strings with out-of-range characters
        for (let k = i; k < j; k++) {
          const t = this._words[k]
          try {
            this.page.drawText(t.text, { x, y: this.y - t.size, size: t.size, font: t.font, color: t.color })
            x += cachedWidth(t.font, t.text, t.size)
          } catch { x += t.size * 0.5 }
        }
      }
      i = j
    }
    this.y -= lineH
    this._words = []
    this._lineW = 0
    this._lineSize = this.baseFontSize
  }

  getFont(bold, italic) {
    if (bold && italic) return this.fonts.boldItalic
    if (bold) return this.fonts.bold
    if (italic) return this.fonts.italic
    return this.fonts.regular
  }

  addText(raw, bold, italic, size, isLink = false) {
    const text = raw.replace(/[\r\n]+/g, ' ').replace(/\t/g, ' ')
    if (!text) return
    const font = this.getFont(bold, italic)
    const color = isLink ? LINK_COLOR : TEXT_COLOR
    const lineH = size * 1.4
    if (size > this._lineSize) this._lineSize = size

    for (const token of text.split(/(\s+)/)) {
      if (!token) continue
      const isSpace = /^\s+$/.test(token)
      // Drop whitespace at the beginning of a new line
      if (isSpace && this._words.length === 0) continue

      const w = cachedWidth(font, token, size)
      if (!isSpace && this._lineW + w > this.contentW && this._words.length > 0) {
        this._commitLine(lineH)
        if (isSpace) continue
      }

      this._words.push({ text: token, font, size, color })
      this._lineW += w
      if (size > this._lineSize) this._lineSize = size
    }
  }

  flushLine(size) {
    const lineH = (size ?? this._lineSize) * 1.4
    this._commitLine(lineH)
  }

  addSpacing(amount) {
    if (amount <= 0) return
    this.y -= Math.min(amount, this.y - this.mb - 1)
    if (this.y <= this.mb) this._newPage()
  }

  async addImage(dataUrl) {
    this.flushLine(this.baseFontSize)
    try {
      const bytes = dataUrlToBytes(dataUrl)
      const embedded = dataUrl.startsWith('data:image/png')
        ? await this.pdfDoc.embedPng(bytes)
        : await this.pdfDoc.embedJpg(bytes)
      const { width, height } = embedded
      const maxH = (this.pageH - this.mt - this.mb) * 0.7
      const scale = Math.min(this.contentW / width, maxH / height, 1)
      const dw = width * scale
      const dh = height * scale
      this._ensureY(dh + this.baseFontSize)
      this.page.drawImage(embedded, { x: this.ml, y: this.y - dh, width: dw, height: dh })
      this.y -= dh + this.baseFontSize * 0.5
    } catch { /* skip unembeddable images */ }
  }
}

// ── DOM walker ────────────────────────────────────────────────────────────────

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'blockquote',
  'header', 'footer', 'main', 'aside', 'figure', 'figcaption',
  'address', 'pre', 'details', 'summary', 'nav',
])
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'head', 'meta', 'link', 'template'])
const H_SCALES = [1.8, 1.5, 1.25, 1.1, 1.0, 1.0]

/**
 * ctx: {
 *   chapterKey: string,          // normalized chapter path (opfDir stripped)
 *   anchorPositions: Map,        // globalKey → { pageIndex, y }
 *   pendingLinks: Array,         // { dest, pageIndex, rect }
 * }
 */
async function walkNode(node, layout, style, ctx) {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const text = node.nodeValue ?? ''
    // Pass all text nodes through — addText handles whitespace collapsing.
    // Skipping whitespace-only nodes here would drop spaces between <span>s.
    if (text) layout.addText(text, style.bold, style.italic, style.size, style.isLink)
    return
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return

  const tag = (node.tagName ?? '').toLowerCase()
  if (SKIP_TAGS.has(tag)) return

  // Record any element with an id or name as a potential anchor target
  const anchorId = node.getAttribute?.('id') || (tag === 'a' ? node.getAttribute?.('name') : null)
  if (anchorId) {
    ctx.anchorPositions.set(`${ctx.chapterKey}#${anchorId}`, {
      pageIndex: layout.pageIndex,
      y: layout.y,
    })
  }

  // ── <a> links ─────────────────────────────────────────────────────────────
  if (tag === 'a') {
    const href = (node.getAttribute('href') ?? '').trim()
    const dest = resolveInternalHref(href, ctx.chapterKey)
    if (dest) {
      const startPageIdx = layout.pageIndex
      const startY = layout.y
      for (const c of node.childNodes) await walkNode(c, layout, { ...style, isLink: true }, ctx)
      layout.flushLine(style.size)
      // rect: [x1, y1_bottom, x2, y2_top] in PDF user space (bottom-left origin)
      ctx.pendingLinks.push({
        dest,
        pageIndex: startPageIdx,
        rect: [layout.ml, layout.y, layout.ml + layout.contentW, startY],
      })
      return
    }
    // External or unresolvable — render as plain text
    for (const c of node.childNodes) await walkNode(c, layout, style, ctx)
    return
  }

  // ── Headings ───────────────────────────────────────────────────────────────
  const hMatch = tag.match(/^h([1-6])$/)
  if (hMatch) {
    const hSize = Math.round(layout.baseFontSize * H_SCALES[parseInt(hMatch[1]) - 1])
    layout.flushLine(style.size)
    layout.addSpacing(hSize * 0.6)
    for (const c of node.childNodes) await walkNode(c, layout, { bold: true, italic: false, size: hSize }, ctx)
    layout.flushLine(hSize)
    layout.addSpacing(hSize * 0.3)
    return
  }

  // ── Lists ──────────────────────────────────────────────────────────────────
  if (tag === 'ul' || tag === 'ol') {
    layout.flushLine(style.size)
    layout.addSpacing(style.size * 0.3)
    let counter = 0
    for (const child of node.childNodes) {
      if ((child.tagName ?? '').toLowerCase() === 'li') {
        counter++
        layout.flushLine(style.size)
        layout.addText(tag === 'ol' ? `${counter}. ` : '• ', false, false, style.size)
        for (const c of child.childNodes) await walkNode(c, layout, style, ctx)
        layout.flushLine(style.size)
      } else {
        await walkNode(child, layout, style, ctx)
      }
    }
    layout.addSpacing(style.size * 0.3)
    return
  }

  // ── Block elements ─────────────────────────────────────────────────────────
  if (BLOCK_TAGS.has(tag)) {
    layout.flushLine(style.size)
    for (const c of node.childNodes) await walkNode(c, layout, style, ctx)
    layout.flushLine(style.size)
    layout.addSpacing(style.size * 0.5)
    return
  }

  // ── Void / break ───────────────────────────────────────────────────────────
  if (tag === 'br') { layout.flushLine(style.size); return }
  if (tag === 'hr') { layout.flushLine(style.size); layout.addSpacing(style.size * 0.8); return }

  // ── Inline formatting ──────────────────────────────────────────────────────
  if (tag === 'b' || tag === 'strong') {
    for (const c of node.childNodes) await walkNode(c, layout, { ...style, bold: true }, ctx)
    return
  }
  if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn') {
    for (const c of node.childNodes) await walkNode(c, layout, { ...style, italic: true }, ctx)
    return
  }

  // ── Image ──────────────────────────────────────────────────────────────────
  if (tag === 'img') {
    const src = node.getAttribute('src') ?? ''
    if (src.startsWith('data:image/png') || src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) {
      await layout.addImage(src)
    }
    return
  }

  // ── Table (minimal: cells as inline blocks) ────────────────────────────────
  if (tag === 'table') { layout.flushLine(style.size); layout.addSpacing(style.size * 0.3) }
  if (tag === 'tr') { layout.flushLine(style.size) }
  if (tag === 'td' || tag === 'th') {
    const cs = tag === 'th' ? { ...style, bold: true } : style
    for (const c of node.childNodes) await walkNode(c, layout, cs, ctx)
    layout.addText('  ', false, false, style.size)
    return
  }

  // ── Default: recurse ───────────────────────────────────────────────────────
  for (const c of node.childNodes) await walkNode(c, layout, style, ctx)

  if (tag === 'table') layout.addSpacing(style.size * 0.3)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert an EPUB File to a PDF Blob in the browser.
 * Preserves headings, bold/italic, images, lists, and internal hyperlinks.
 *
 * @param {File} epubFile
 * @param {{
 *   pageWidthPx?: number,
 *   pageHeightPx?: number,
 *   fontSizePt?: number,
 *   marginsPt?: { top: number, right: number, bottom: number, left: number },
 *   onProgress?: (msg: string) => void,
 * }} opts
 * @returns {Promise<Blob>}
 */
export async function convertEpubToPdfInBrowser(epubFile, opts = {}) {
  const {
    pageWidthPx = 600,
    pageHeightPx = 800,
    fontSizePt = 14,
    marginsPt = { top: 48, right: 48, bottom: 48, left: 48 },
    onProgress = null,
  } = opts

  // ── 1. Unzip ───────────────────────────────────────────────────────────────
  onProgress?.('Extracting EPUB…')
  const zip = await JSZip.loadAsync(epubFile)

  // ── 2. Find OPF ───────────────────────────────────────────────────────────
  const containerXml = await zip.file('META-INF/container.xml')?.async('string')
  if (!containerXml) throw new Error('Invalid EPUB (missing container.xml)')

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true })
  const containerDoc = parser.parse(containerXml)
  const rootfileRaw = containerDoc?.container?.rootfiles?.rootfile
  const rootfile = Array.isArray(rootfileRaw) ? rootfileRaw[0] : rootfileRaw
  const opfPath = rootfile?.['@_full-path']
  if (!opfPath) throw new Error('Could not find OPF file in EPUB container.')

  const opfDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]+$/, '/') : ''

  // ── 3. Parse OPF ──────────────────────────────────────────────────────────
  const opfXml = await zip.file(opfPath)?.async('string')
  if (!opfXml) throw new Error('OPF file missing in EPUB.')
  const opf = parser.parse(opfXml)?.package

  const manifestMap = new Map()
  for (const item of asArray(opf?.manifest?.item)) {
    manifestMap.set(item['@_id'], { href: item['@_href'], mediaType: item['@_media-type'] ?? '' })
  }
  const spine = asArray(opf?.spine?.itemref)

  // ── 4. Pre-load images as data URLs ───────────────────────────────────────
  onProgress?.('Loading assets…')
  const assetDataUrls = new Map()
  for (const [relPath, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    const ext = relPath.split('.').pop()?.toLowerCase() ?? ''
    const mime = mimeForExtension(ext)
    if (!mime) continue
    const b64 = await file.async('base64')
    assetDataUrls.set(relPath, `data:${mime};base64,${b64}`)
  }

  // ── 5. Parse spine chapters ────────────────────────────────────────────────
  onProgress?.('Parsing chapters…')
  const chapters = [] // { doc, chapterKey }

  for (const itemRef of spine) {
    const idref = itemRef['@_idref']
    if (!idref) continue
    const item = manifestMap.get(idref)
    if (!item) continue
    const { href, mediaType } = item
    if (!href || (!mediaType.includes('html') && !mediaType.includes('xhtml'))) continue

    const chapterPath = resolveZipPath(opfDir, href)
    if (!chapterPath) continue
    const chapterFile = zip.file(chapterPath) ?? zip.file(decodeURIComponent(chapterPath))
    if (!chapterFile) continue

    const chapterDir = chapterPath.includes('/') ? chapterPath.replace(/\/[^/]+$/, '/') : ''
    // Normalize: strip opfDir prefix to get the key used for anchor matching
    const chapterKey = chapterPath.startsWith(opfDir) ? chapterPath.slice(opfDir.length) : chapterPath

    const rawHtml = await chapterFile.async('string')
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html')

    // Replace img src with data URLs
    for (const img of doc.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src')
      if (!src) continue
      const imgPath = resolveZipPath(chapterDir, src)
      const dataUrl = imgPath
        ? (assetDataUrls.get(imgPath) ?? assetDataUrls.get(decodeURIComponent(imgPath)))
        : null
      if (dataUrl) img.setAttribute('src', dataUrl)
      else img.removeAttribute('src')
    }

    if (doc.body?.innerText?.trim()) chapters.push({ doc, chapterKey })
  }

  if (chapters.length === 0) throw new Error('No readable chapters found in this EPUB.')

  // ── 6. Build PDF ───────────────────────────────────────────────────────────
  onProgress?.('Building PDF…')
  const pdfDoc = await PDFDocument.create()
  const fonts = {
    regular:    await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold:       await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic:     await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
  }

  const layout = new PdfLayout(pdfDoc, {
    pageW: pageWidthPx,
    pageH: pageHeightPx,
    margins: marginsPt,
    baseFontSize: fontSizePt,
    fonts,
  })

  const ctx = {
    anchorPositions: new Map(), // `chapterKey#id` → { pageIndex, y }
    pendingLinks: [],           // { dest, pageIndex, rect }
  }

  const baseStyle = { bold: false, italic: false, size: fontSizePt, isLink: false }

  for (let i = 0; i < chapters.length; i++) {
    const { doc, chapterKey } = chapters[i]
    onProgress?.(`Laying out chapter ${i + 1} / ${chapters.length}…`)

    // Record chapter-start anchor (for links like href="chapter2.xhtml" without fragment)
    ctx.anchorPositions.set(chapterKey, { pageIndex: layout.pageIndex, y: layout.y })
    ctx.chapterKey = chapterKey

    await walkNode(doc.body, layout, baseStyle, ctx)
    layout.flushLine(fontSizePt)
  }

  // ── 7. Resolve pending link annotations ───────────────────────────────────
  for (const link of ctx.pendingLinks) {
    const target =
      ctx.anchorPositions.get(link.dest) ??
      // Fall back to chapter start if fragment not found
      ctx.anchorPositions.get(link.dest.split('#')[0])

    if (!target) continue
    if (link.pageIndex >= pdfDoc.getPageCount()) continue

    try {
      addGoToAnnotation(
        pdfDoc,
        pdfDoc.getPage(link.pageIndex),
        link.rect,
        target.pageIndex,
        target.y,
      )
    } catch { /* skip broken annotation */ }
  }

  return new Blob([await pdfDoc.save()], { type: 'application/pdf' })
}
