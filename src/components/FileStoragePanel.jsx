import { useMutation } from 'convex/react'
import { useState } from 'react'
import { Upload } from 'lucide-react'
import { api } from '../../convex/_generated/api.js'
import useNotesStore from '../stores/useNotesStore'
import {
  layoutImageSize,
  measureImageBitmap,
  singleImageEmbed,
  stripExtension,
} from '../lib/fileToNote.js'
import { KEYBOARD_FONT_SIZE_PX } from '../lib/canvasConstants.js'
import ImportNoteDialog from './ImportNoteDialog.jsx'

function detectImportKind(file) {
  const lower = file.name.toLowerCase()
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf'
  if (
    lower.endsWith('.epub') ||
    file.type.includes('epub') ||
    file.type === 'application/epub+zip'
  ) {
    return 'epub'
  }
  return null
}

export default function FileStoragePanel() {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl)
  const saveUploadedFile = useMutation(api.files.saveUploadedFile)
  const createNote = useNotesStore((s) => s.createNote)

  const [importSession, setImportSession] = useState(null)
  const [progressMsg, setProgressMsg] = useState('')

  function onPickFile(e) {
    const input = e.target
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const kind = detectImportKind(file)
    if (!kind) {
      window.alert('Unsupported file type. Use an image, PDF, or EPUB.')
      return
    }
    setImportSession({
      file,
      kind,
      defaultName: stripExtension(file.name),
    })
  }

  async function uploadBlob(blob, name, contentType) {
    const postUrl = await generateUploadUrl()
    const res = await fetch(postUrl, {
      method: 'POST',
      headers: contentType ? { 'Content-Type': contentType } : {},
      body: blob,
    })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    const { storageId } = await res.json()
    return await saveUploadedFile({ storageId, name, contentType: contentType || undefined })
  }

  async function runImport({
    noteName,
    parentId,
    documentFontSizePt,
    epubMarginsPt,
    epubContentWidth,
  }) {
    if (!importSession) return
    const { file, kind } = importSession

    if (kind === 'epub') {
      setProgressMsg('Uploading EPUB…')
      const epubFileId = await uploadBlob(file, file.name, 'application/epub+zip')
      createNote(noteName, 'blank', parentId, {
        epubBackgroundFileId: epubFileId,
        epubContentWidth,
        importDocFontSizePt: documentFontSizePt,
        importEpubMargins: epubMarginsPt,
      })
      return
    }

    const fileId = await uploadBlob(file, file.name, file.type || undefined)

    const scale = documentFontSizePt / KEYBOARD_FONT_SIZE_PX
    const maxImageW = Math.round(680 * scale)

    if (kind === 'image') {
      const { w, h } = await measureImageBitmap(file)
      const { width, height } = layoutImageSize(w, h, maxImageW)
      createNote(noteName, 'blank', parentId, {
        imageEmbeds: singleImageEmbed(fileId, { width, height }),
        importDocFontSizePt: documentFontSizePt,
      })
      return
    }

    if (kind === 'pdf') {
      createNote(noteName, 'blank', parentId, {
        pdfBackgroundFileId: fileId,
        importDocFontSizePt: documentFontSizePt,
      })
    }
  }

  return (
    <div className="border-t border-border px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Import file
        </span>
        <label className="inline-flex items-center gap-1 text-[11px] text-accent cursor-pointer hover:text-accent-hover">
          <Upload size={12} />
          Choose file
          <input
            type="file"
            className="sr-only"
            accept="image/*,.pdf,.epub,application/pdf,application/epub+zip"
            onChange={onPickFile}
          />
        </label>
      </div>
      <p className="text-[10px] text-text-muted leading-snug">
        Images, PDFs, and EPUBs become notes.
      </p>

      {importSession && (
        <ImportNoteDialog
          file={importSession.file}
          kind={importSession.kind}
          defaultName={importSession.defaultName}
          progressMsg={progressMsg}
          onClose={() => {
            setImportSession(null)
            setProgressMsg('')
          }}
          onConfirm={runImport}
        />
      )}
    </div>
  )
}
