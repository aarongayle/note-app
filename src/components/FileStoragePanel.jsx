import { useMutation, useQuery } from 'convex/react'
import { Trash2, Upload } from 'lucide-react'
import { api } from '../../convex/_generated/api.js'

export default function FileStoragePanel() {
  const files = useQuery(api.files.listMyFiles)
  const generateUploadUrl = useMutation(api.files.generateUploadUrl)
  const saveUploadedFile = useMutation(api.files.saveUploadedFile)
  const removeFile = useMutation(api.files.removeFile)

  async function onUpload(e) {
    const input = e.target
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const postUrl = await generateUploadUrl()
    const res = await fetch(postUrl, {
      method: 'POST',
      headers: file.type ? { 'Content-Type': file.type } : {},
      body: file,
    })
    if (!res.ok) {
      throw new Error(`Upload failed: ${res.status}`)
    }
    const { storageId } = await res.json()
    await saveUploadedFile({
      storageId,
      name: file.name,
      contentType: file.type || undefined,
    })
  }

  return (
    <div className="border-t border-border px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Convex files
        </span>
        <label className="inline-flex items-center gap-1 text-[11px] text-accent cursor-pointer hover:text-accent-hover">
          <Upload size={12} />
          Upload
          <input type="file" className="sr-only" onChange={(e) => void onUpload(e)} />
        </label>
      </div>
      {files === undefined ? (
        <p className="text-[11px] text-text-muted">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-[11px] text-text-muted">No files yet.</p>
      ) : (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {files.map((f) => (
            <FileRow
              key={f._id}
              file={f}
              removeFile={removeFile}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function FileRow({ file, removeFile }) {
  const url = useQuery(api.files.getDownloadUrl, { fileId: file._id })

  return (
    <li className="flex items-center gap-1.5 text-[11px] text-text-secondary group">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="truncate flex-1 hover:text-accent transition-colors"
        >
          {file.name}
        </a>
      ) : (
        <span className="truncate flex-1">{file.name}</span>
      )}
      <button
        type="button"
        onClick={() => void removeFile({ fileId: file._id })}
        className="p-0.5 rounded text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={`Delete ${file.name}`}
      >
        <Trash2 size={12} />
      </button>
    </li>
  )
}
