import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'

function asArray(v) {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

function resolveZipPath(baseDir, href) {
  if (!href || typeof href !== 'string') return null
  const clean = decodeURIComponent(href.split('?')[0].split('#')[0]).replace(/\\/g, '/')
  if (/^(https?:|\/\/|data:|blob:)/.test(clean)) return null
  if (clean.startsWith('/')) return clean.slice(1)
  const parts = (baseDir + clean).split('/')
  const out = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.') out.push(p)
  }
  return out.join('/')
}

const ASSET_MIMES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
}

function mimeForAsset(ext) {
  return ASSET_MIMES[ext] ?? null
}

/**
 * Rewrite CSS url() references using a lookup from absolute ZIP paths to blob URLs.
 */
function rewriteCssUrls(cssText, baseDir, assetBlobUrls) {
  return cssText.replace(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/g, (match, rawPath) => {
    if (/^(data:|blob:|https?:)/.test(rawPath)) return match
    const resolved = resolveZipPath(baseDir, rawPath)
    if (!resolved) return match
    const blobUrl = assetBlobUrls.get(resolved) ?? assetBlobUrls.get(decodeURIComponent(resolved))
    return blobUrl ? `url('${blobUrl}')` : match
  })
}

/**
 * Parse an EPUB blob and extract chapters, CSS, and image blob URLs.
 *
 * @param {Blob} epubBlob
 * @returns {Promise<{
 *   chapters: Array<{ bodyHtml: string, key: string }>,
 *   css: string,
 *   revokeUrls: () => void,
 * }>}
 */
export async function parseEpub(epubBlob) {
  const zip = await JSZip.loadAsync(epubBlob)

  const containerXml = await zip.file('META-INF/container.xml')?.async('string')
  if (!containerXml) throw new Error('Invalid EPUB (missing container.xml)')

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true })
  const containerDoc = parser.parse(containerXml)
  const rootfileRaw = containerDoc?.container?.rootfiles?.rootfile
  const rootfile = Array.isArray(rootfileRaw) ? rootfileRaw[0] : rootfileRaw
  const opfPath = rootfile?.['@_full-path']
  if (!opfPath) throw new Error('Could not find OPF file in EPUB container.')

  const opfDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]+$/, '/') : ''

  const opfXml = await zip.file(opfPath)?.async('string')
  if (!opfXml) throw new Error('OPF file missing in EPUB.')
  const opf = parser.parse(opfXml)?.package

  const manifestMap = new Map()
  for (const item of asArray(opf?.manifest?.item)) {
    manifestMap.set(item['@_id'], { href: item['@_href'], mediaType: item['@_media-type'] ?? '' })
  }
  const spine = asArray(opf?.spine?.itemref)

  // Create blob URLs for all binary assets (images + fonts)
  const assetBlobUrls = new Map()
  for (const [relPath, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    const ext = relPath.split('.').pop()?.toLowerCase() ?? ''
    const mime = mimeForAsset(ext)
    if (!mime) continue
    const buf = await file.async('arraybuffer')
    assetBlobUrls.set(relPath, URL.createObjectURL(new Blob([buf], { type: mime })))
  }

  // Collect linked stylesheets from manifest
  const cssTexts = []
  const seenCssPaths = new Set()
  for (const [, item] of manifestMap) {
    if (item.mediaType !== 'text/css') continue
    const cssPath = resolveZipPath(opfDir, item.href)
    if (!cssPath || seenCssPaths.has(cssPath)) continue
    seenCssPaths.add(cssPath)
    const cssFile = zip.file(cssPath) ?? zip.file(decodeURIComponent(cssPath))
    if (!cssFile) continue
    const cssDir = cssPath.includes('/') ? cssPath.replace(/\/[^/]+$/, '/') : ''
    cssTexts.push(rewriteCssUrls(await cssFile.async('string'), cssDir, assetBlobUrls))
  }

  // Parse spine chapters
  const chapters = []
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
    const rawHtml = await chapterFile.async('string')
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html')

    // Extract inline <style> from head
    for (const styleEl of doc.querySelectorAll('head style')) {
      cssTexts.push(rewriteCssUrls(styleEl.textContent ?? '', chapterDir, assetBlobUrls))
    }

    // Rewrite <img src> to blob URLs
    for (const img of doc.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src')
      if (!src) continue
      const imgPath = resolveZipPath(chapterDir, src)
      if (!imgPath) continue
      const blobUrl = assetBlobUrls.get(imgPath) ?? assetBlobUrls.get(decodeURIComponent(imgPath))
      if (blobUrl) img.setAttribute('src', blobUrl)
      else img.removeAttribute('src')
    }

    // Rewrite SVG <image> href
    for (const img of doc.querySelectorAll('image[href], image')) {
      const href2 = img.getAttribute('href') ??
        img.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      if (!href2) continue
      const imgPath = resolveZipPath(chapterDir, href2)
      if (!imgPath) continue
      const blobUrl = assetBlobUrls.get(imgPath) ?? assetBlobUrls.get(decodeURIComponent(imgPath))
      if (blobUrl) {
        img.setAttribute('href', blobUrl)
        img.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
      }
    }

    const bodyHtml = doc.body?.innerHTML ?? ''
    if (bodyHtml.trim()) {
      chapters.push({ bodyHtml, key: chapterPath })
    }
  }

  if (chapters.length === 0) throw new Error('No readable chapters found in this EPUB.')

  // Deduplicate CSS by content hash
  const uniqueCss = [...new Set(cssTexts)]

  return {
    chapters,
    css: uniqueCss.join('\n'),
    revokeUrls() {
      for (const url of assetBlobUrls.values()) URL.revokeObjectURL(url)
    },
  }
}
