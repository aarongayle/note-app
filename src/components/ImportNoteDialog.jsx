import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { X } from 'lucide-react'
import useNotesStore from '../stores/useNotesStore'
import { KEYBOARD_FONT_SIZE_PX } from '../lib/canvasConstants.js'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const FONT_MIN = 12
const FONT_MAX = 36
const MARGIN_MIN = 36
const MARGIN_MAX = 120

/** LETTER width pt for preview proportion */
const LETTER_W_PT = 612

function collectFoldersFlat(state) {
  const { items, rootIds } = state
  const out = [{ id: null, label: 'Library root' }]
  function walkFolderChildren(folderId, prefix) {
    const folder = items[folderId]
    if (!folder || folder.type !== 'folder') return
    for (const cid of folder.childIds) {
      const c = items[cid]
      if (c?.type === 'folder') {
        out.push({ id: cid, label: prefix + c.name })
        walkFolderChildren(cid, prefix + c.name + ' / ')
      }
    }
  }
  for (const id of rootIds) {
    const it = items[id]
    if (it?.type === 'folder') {
      out.push({ id, label: it.name })
      walkFolderChildren(id, `${it.name} / `)
    }
  }
  return out
}

/**
 * @param {{ file: File; kind: 'image' | 'pdf' | 'epub'; defaultName: string; progressMsg?: string; onClose: () => void; onConfirm: (opts: { noteName: string; parentId: string | null; documentFontSizePt: number; epubMarginsPt: { top: number; right: number; bottom: number; left: number } }) => void | Promise<void> }} props
 */
export default function ImportNoteDialog({
  file,
  kind,
  defaultName,
  progressMsg = '',
  onClose,
  onConfirm,
}) {
  const items = useNotesStore((s) => s.items)
  const rootIds = useNotesStore((s) => s.rootIds)
  const folderOptions = useMemo(
    () => collectFoldersFlat({ items, rootIds }),
    [items, rootIds]
  )
  const [noteName, setNoteName] = useState(defaultName)
  const [parentId, setParentId] = useState(null)
  const [documentFontSizePt, setDocumentFontSizePt] = useState(
    KEYBOARD_FONT_SIZE_PX
  )
  const [epubMarginsPt, setEpubMarginsPt] = useState({
    top: 72,
    right: 72,
    bottom: 72,
    left: 72,
  })
  const [busy, setBusy] = useState(false)
  const [imageObjectUrl, setImageObjectUrl] = useState(null)
  const pdfPreviewRef = useRef(null)

  useEffect(() => {
    if (kind !== 'image' || !file) {
      setImageObjectUrl(null)
      return undefined
    }
    const u = URL.createObjectURL(file)
    setImageObjectUrl(u)
    return () => {
      URL.revokeObjectURL(u)
      setImageObjectUrl(null)
    }
  }, [file, kind])

  useEffect(() => {
    const canvas = pdfPreviewRef.current
    if (!file || kind !== 'pdf' || !canvas) return undefined

    let cancelled = false
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    ;(async () => {
      const blobUrl = URL.createObjectURL(file)
      try {
        const task = pdfjs.getDocument({
          url: blobUrl,
          withCredentials: false,
        })
        const pdf = await task.promise
        if (cancelled) return
        const page = await pdf.getPage(1)
        const base = page.getViewport({ scale: 1 })
        const maxW = 280
        const docScale = documentFontSizePt / KEYBOARD_FONT_SIZE_PX
        const scale = (maxW / base.width) * docScale
        const viewport = page.getViewport({ scale })
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvasContext: ctx, viewport }).promise
      } catch (e) {
        console.error('Preview render failed', e)
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [file, kind, documentFontSizePt])

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = noteName.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onConfirm({
        noteName: trimmed,
        parentId,
        documentFontSizePt,
        epubMarginsPt,
      })
      onClose()
    } catch (err) {
      console.error(err)
      window.alert(
        err instanceof Error ? err.message : 'Import failed.'
      )
    } finally {
      setBusy(false)
    }
  }

  const previewMarginScale =
    kind === 'epub' ? 200 / LETTER_W_PT : 0
  const previewPad =
    kind === 'epub'
      ? {
          paddingTop: Math.round(epubMarginsPt.top * previewMarginScale),
          paddingRight: Math.round(epubMarginsPt.right * previewMarginScale),
          paddingBottom: Math.round(epubMarginsPt.bottom * previewMarginScale),
          paddingLeft: Math.round(epubMarginsPt.left * previewMarginScale),
        }
      : {}

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-surface-light border border-border rounded-xl shadow-2xl w-full max-w-lg my-auto max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-surface-light z-10">
          <h2 className="text-sm font-semibold text-text-primary">
            Import {kind === 'image' ? 'image' : kind === 'pdf' ? 'PDF' : 'EPUB'}{' '}
            as note
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-lighter text-text-muted hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Note name
            </label>
            <input
              type="text"
              value={noteName}
              onChange={(e) => setNoteName(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-surface text-text-primary text-sm border border-border focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Location
            </label>
            <select
              value={parentId ?? ''}
              onChange={(e) =>
                setParentId(e.target.value === '' ? null : e.target.value)
              }
              className="w-full px-3 py-2 rounded-lg bg-surface text-text-primary text-sm border border-border focus:border-accent focus:outline-none"
            >
              {folderOptions.map((o) => (
                <option key={o.id ?? '__root__'} value={o.id ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Document text size ({documentFontSizePt} pt) — scales the page
              relative to note typography (baseline {KEYBOARD_FONT_SIZE_PX} pt)
            </label>
            <input
              type="range"
              min={FONT_MIN}
              max={FONT_MAX}
              step={1}
              value={documentFontSizePt}
              onChange={(e) =>
                setDocumentFontSizePt(Number(e.target.value))
              }
              className="w-full accent-accent"
            />
          </div>

          {kind === 'epub' && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-text-secondary">
                EPUB → PDF margins (pt)
              </p>
              {(
                [
                  ['top', 'Top'],
                  ['right', 'Right'],
                  ['bottom', 'Bottom'],
                  ['left', 'Left'],
                ]
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    {label} ({epubMarginsPt[key]} pt)
                  </label>
                  <input
                    type="range"
                    min={MARGIN_MIN}
                    max={MARGIN_MAX}
                    step={2}
                    value={epubMarginsPt[key]}
                    onChange={(e) =>
                      setEpubMarginsPt((prev) => ({
                        ...prev,
                        [key]: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-accent"
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="text-[11px] font-medium text-text-secondary mb-2">
              Preview
            </p>
            <div className="rounded-lg border border-border bg-canvas-bg p-3 min-h-[140px] flex items-center justify-center overflow-hidden">
              {kind === 'image' && imageObjectUrl && (
                <img
                  src={imageObjectUrl}
                  alt=""
                  className="max-h-48 max-w-full object-contain rounded"
                  style={{
                    transform: `scale(${documentFontSizePt / KEYBOARD_FONT_SIZE_PX})`,
                    transformOrigin: 'center center',
                  }}
                />
              )}
              {kind === 'pdf' && (
                <canvas
                  ref={pdfPreviewRef}
                  className="max-w-full h-auto rounded border border-border/50 bg-white"
                />
              )}
              {kind === 'epub' && (
                <div
                  className="w-full max-w-[200px] mx-auto bg-white text-neutral-800 rounded border border-border/60 shadow-sm"
                  style={{
                    ...previewPad,
                    fontSize: `${Math.min(14, documentFontSizePt * 0.55)}px`,
                    lineHeight: 1.45,
                  }}
                >
                  <p className="text-neutral-500 text-[10px] uppercase tracking-wide mb-1">
                    Approximate EPUB page
                  </p>
                  <p>
                    Sample body text at your chosen size. Margins reflect the
                    EPUB conversion layout (Letter page).
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            {busy && progressMsg && (
              <span className="self-center text-[11px] text-text-muted flex-1 truncate">
                {progressMsg}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-lighter"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !noteName.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
