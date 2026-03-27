import { v4 as uuidv4 } from 'uuid'

export function stripExtension(name) {
  return name.replace(/\.[^/.]+$/, '') || 'Imported'
}

export async function measureImageBitmap(file) {
  const bmp = await createImageBitmap(file)
  return { w: bmp.width, h: bmp.height }
}

export function layoutImageSize(natW, natH, maxW) {
  if (natW <= maxW) return { width: natW, height: natH }
  const width = maxW
  const height = (natH * maxW) / natW
  return { width, height }
}

/**
 * @param {string} fileId
 * @param {{ width: number, height: number }} size
 * @param {{ x: number, y: number }} [origin]
 */
export function createImageEmbed(fileId, size, origin = { x: 40, y: 40 }) {
  return {
    id: uuidv4(),
    fileId,
    x: origin.x,
    y: origin.y,
    width: size.width,
    height: size.height,
    rotation: 0,
  }
}

/**
 * @param {string} fileId
 * @param {{ width: number, height: number }} size
 */
export function singleImageEmbed(fileId, size) {
  return [createImageEmbed(fileId, size)]
}

/** Offset origins so multiple photos do not stack exactly on top of each other. */
export function nextImageEmbedOrigin(existingEmbedCount) {
  const step = 36
  const col = existingEmbedCount % 8
  const row = Math.floor(existingEmbedCount / 8)
  return { x: 40 + col * step, y: 40 + row * step }
}
