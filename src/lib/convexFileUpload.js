/**
 * Upload a blob to Convex file storage and register a `files` row.
 *
 * @param {() => Promise<string>} generateUploadUrl
 * @param {(args: { storageId: string, name: string, contentType?: string }) => Promise<string>} saveUploadedFile
 * @param {Blob} blob
 * @param {string} name
 * @param {string} [contentType]
 */
export async function uploadBlobToFiles(
  generateUploadUrl,
  saveUploadedFile,
  blob,
  name,
  contentType,
) {
  const postUrl = await generateUploadUrl()
  const res = await fetch(postUrl, {
    method: 'POST',
    headers: contentType ? { 'Content-Type': contentType } : {},
    body: blob,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  const { storageId } = await res.json()
  return await saveUploadedFile({
    storageId,
    name,
    contentType: contentType || undefined,
  })
}
