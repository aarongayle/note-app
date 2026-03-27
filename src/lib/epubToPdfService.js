/**
 * Convert EPUB → PDF via the epub-pdf HTTP service (NDJSON streaming).
 * @param {string} serviceUrl
 * @param {File} file
 * @param {{
 *   fontSizePt: number,
 *   marginsPt: { top: number, right: number, bottom: number, left: number },
 *   onProgress?: (msg: string) => void,
 * }} opts
 * @returns {Promise<Blob>}
 */
export async function convertEpubViaStreamingService(serviceUrl, file, opts) {
  const { fontSizePt, marginsPt, onProgress } = opts
  const toMm = (pt) => Math.round(pt * 0.352778)
  const { top, right, bottom, left } = marginsPt
  const params = new URLSearchParams({
    screenWidth: '600',
    screenHeight: '800',
    pageMargin: `${toMm(top)}mm ${toMm(right)}mm ${toMm(bottom)}mm ${toMm(left)}mm`,
    fontSize: `${fontSizePt}pt`,
    bookmarks: 'true',
    settleMs: '2000',
  })

  const url = `${serviceUrl.replace(/\/$/, '')}?${params}`
  onProgress?.('Sending to conversion service…')

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/epub+zip' },
    body: file,
  })

  if (!res.ok) {
    throw new Error(`Conversion service error: ${res.status} ${res.statusText}`)
  }

  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/pdf')) {
    return new Blob([await res.arrayBuffer()], { type: 'application/pdf' })
  }

  const body = res.body
  if (!body) throw new Error('No response body from conversion service')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  /** @type {Uint8Array[]} */
  const pdfParts = []

  const handleObject = (o) => {
    if (!o || typeof o !== 'object') return
    switch (o.type) {
      case 'start': {
        if (typeof o.epubBytes === 'number' && o.epubBytes > 0) {
          const mb = (o.epubBytes / (1024 * 1024)).toFixed(1)
          onProgress?.(`Starting conversion (${mb} MB)…`)
        } else {
          onProgress?.('Starting conversion…')
        }
        break
      }
      case 'progress': {
        const pct = o.percent != null ? `${o.percent}% ` : ''
        const stage = o.stage ?? ''
        const msg = o.message
          ? `${pct}${stage} — ${o.message}`.trim()
          : `${pct}${stage}`.trim()
        onProgress?.(msg || 'Converting…')
        break
      }
      case 'pdfChunk': {
        if (typeof o.data === 'string' && o.data.length > 0) {
          pdfParts.push(base64ToUint8Array(o.data))
        }
        break
      }
      case 'complete': {
        if (typeof o.totalBytes === 'number') {
          onProgress?.(`Finalizing PDF (${(o.totalBytes / 1024).toFixed(0)} KB)…`)
        }
        break
      }
      case 'error':
        throw new Error(typeof o.message === 'string' ? o.message : 'Conversion failed')
      default:
        break
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })
    else if (done) buffer += decoder.decode()

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      let o
      try {
        o = JSON.parse(t)
      } catch {
        throw new Error('Invalid conversion stream (bad JSON line)')
      }
      handleObject(o)
    }

    if (done) break
  }

  const tail = buffer.trim()
  if (tail) {
    let o
    try {
      o = JSON.parse(tail)
    } catch {
      throw new Error('Invalid conversion stream (bad JSON line)')
    }
    handleObject(o)
  }

  if (pdfParts.length === 0) {
    throw new Error('Conversion ended without PDF data')
  }

  return new Blob(pdfParts, { type: 'application/pdf' })
}

function base64ToUint8Array(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
