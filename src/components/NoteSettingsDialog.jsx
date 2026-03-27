import { useState } from 'react'
import { X, Square, AlignJustify, Grid3X3, Grip, AlertTriangle } from 'lucide-react'
import useNotesStore, { TEMPLATES } from '../stores/useNotesStore'
import { KEYBOARD_FONT_SIZE_PX } from '../lib/canvasConstants.js'

const TEMPLATE_ICONS = {
  blank: Square,
  lined: AlignJustify,
  grid: Grid3X3,
  dotted: Grip,
}

const FONT_MIN = 10
const FONT_MAX = 48
const MARGIN_MIN = 0
const MARGIN_MAX = 120
const EPUB_WIDTH_MIN = 200
const EPUB_WIDTH_MAX = 1600

/** @param {object} note */
function initialFormState(note) {
  const epubMarginsPt = note.importEpubMargins
    ? { ...note.importEpubMargins }
    : note.importEpubMarginPt != null
      ? {
          top: note.importEpubMarginPt,
          right: note.importEpubMarginPt,
          bottom: note.importEpubMarginPt,
          left: note.importEpubMarginPt,
        }
      : { top: 32, right: 32, bottom: 32, left: 32 }

  return {
    template:
      note.template && TEMPLATES[note.template] ? note.template : 'lined',
    documentFontSizePt: note.importDocFontSizePt ?? KEYBOARD_FONT_SIZE_PX,
    epubContentWidth: note.epubContentWidth ?? 600,
    epubMarginsPt,
  }
}

/** @param {{ note: object; noteId: string; onClose: () => void }} props */
function NoteSettingsForm({ note, noteId, onClose }) {
  const updateNoteSettings = useNotesStore((s) => s.updateNoteSettings)
  const init = initialFormState(note)
  const [template, setTemplate] = useState(init.template)
  const [documentFontSizePt, setDocumentFontSizePt] = useState(
    init.documentFontSizePt
  )
  const [epubContentWidth, setEpubContentWidth] = useState(init.epubContentWidth)
  const [epubMarginsPt, setEpubMarginsPt] = useState(init.epubMarginsPt)

  const hasPdf = Boolean(note.pdfBackgroundFileId)
  const hasEpub = Boolean(note.epubBackgroundFileId)
  const isPlain = !hasPdf && !hasEpub

  function handleSave(e) {
    e.preventDefault()
    if (hasEpub) {
      updateNoteSettings(noteId, {
        epubContentWidth,
        importDocFontSizePt: documentFontSizePt,
        importEpubMargins: epubMarginsPt,
      })
    } else if (hasPdf) {
      updateNoteSettings(noteId, {
        importDocFontSizePt: documentFontSizePt,
      })
    } else {
      updateNoteSettings(noteId, { template })
    }
    onClose()
  }

  return (
    <>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-surface-light z-10">
        <h2 className="text-sm font-semibold text-text-primary">
          Note settings
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-lighter text-text-muted hover:text-text-primary"
        >
          <X size={16} />
        </button>
      </div>

      <form onSubmit={handleSave} className="p-5 space-y-5">
        <p className="text-xs text-text-secondary leading-relaxed">
          {note.name}
        </p>

        {isPlain && (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">
              Page template
            </label>
            <div className="grid grid-cols-4 gap-2">
              {Object.values(TEMPLATES).map((tmpl) => {
                const Icon = TEMPLATE_ICONS[tmpl.id]
                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => setTemplate(tmpl.id)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs transition-colors ${
                      template === tmpl.id
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border bg-surface hover:border-border-light text-text-secondary'
                    }`}
                  >
                    <Icon size={20} />
                    {tmpl.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {hasPdf && (
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
        )}

        {hasEpub && (
          <>
            <div
              className="flex gap-2.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-xs text-text-secondary leading-relaxed"
              role="status"
            >
              <AlertTriangle
                size={16}
                className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5"
              />
              <p>
                Changing width, margins, or text size reflows the book text.
                Existing ink highlights and annotations may no longer line up
                with the same words or passages.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Document text size ({documentFontSizePt} pt) — scales EPUB body
                text relative to the baseline ({KEYBOARD_FONT_SIZE_PX} pt)
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

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Content width ({epubContentWidth} px) — fixed layout width for
                the EPUB
              </label>
              <input
                type="range"
                min={EPUB_WIDTH_MIN}
                max={EPUB_WIDTH_MAX}
                step={10}
                value={epubContentWidth}
                onChange={(e) =>
                  setEpubContentWidth(Number(e.target.value))
                }
                className="w-full accent-accent"
              />
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium text-text-secondary">
                Content margins (pt)
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
          </>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-surface-lighter text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            Save
          </button>
        </div>
      </form>
    </>
  )
}

/**
 * @param {{ noteId: string; onClose: () => void }} props
 */
export default function NoteSettingsDialog({ noteId, onClose }) {
  const note = useNotesStore((s) => s.items[noteId])

  if (!note || note.type !== 'note') return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-surface-light border border-border rounded-xl shadow-2xl w-full max-w-lg my-auto max-h-[90vh] overflow-y-auto">
        <NoteSettingsForm
          key={noteId}
          noteId={noteId}
          note={note}
          onClose={onClose}
        />
      </div>
    </div>
  )
}
