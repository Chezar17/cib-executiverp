// Shared NMAIL attachment rules (storage path layout + MIME guard).
import { randomBytes } from 'crypto'

export const NMAIL_ATTACHMENTS_BUCKET = 'nmail-attachments'
export const NMAIL_MAX_ATTACHMENT_FILES = 15
/** Per-file ceiling for upload POST (aligned with sensible serverless limits). */
export const NMAIL_MAX_UPLOAD_BYTES = 12 * 1024 * 1024

/** @param {unknown} badge */
export function badgeStorageFolder(badge) {
  const t = String(badge ?? '')
    .trim()
    .toLowerCase()
  if (!t) return ''
  return Buffer.from(t, 'utf8').toString('base64url').replace(/=+$/, '')
}

/** Paths are always `{base64url(badge)} / {uuid}_{basename}`. */
export function isAttachmentPathOwnedByViewer(path, viewerBadge) {
  const folder = badgeStorageFolder(viewerBadge)
  const p = String(path ?? '').trim()
  if (!folder || !p) return false
  if (!p.startsWith(`${folder}/`)) return false
  const rest = p.slice(folder.length + 1)
  if (!rest || rest.includes('..') || rest.includes('\\') || rest.startsWith('/') || rest.includes('\0'))
    return false
  return true
}

/** @param {unknown} raw */
export function safeUploadedBasename(raw) {
  let base = String(raw ?? '')
    .split(/[/\\]/u)
    .pop()
    .replace(/^\.+/u, '')
    .trim()
  if (!base) base = 'file'
  return base.slice(0, 180)
}

/** @param {string} viewerBadge @param {string} safeBasename */
export function buildMailAttachmentStoragePath(viewerBadge, safeBasename) {
  const folder = badgeStorageFolder(viewerBadge)
  const id = randomBytes(10).toString('hex')
  return `${folder}/${id}_${safeBasename}`
}

const ALLOWED = new Set(
  /** @type {string[]} */
  ([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'video/mp4',
    'audio/mpeg',
    'audio/mp3',
  ]),
)

/** Minimal extension fallback when browser sends octet-stream. */
const ALLOW_EXT = /\.(jpg|jpeg|png|gif|webp|pdf|txt|csv|doc|docx|xls|xlsx|zip|mp4|mp3)$/i

/** @param {string} mime @param {string} filenameForExt */
export function isAllowedMailMime(mime, filenameForExt) {
  const m = String(mime || '')
    .trim()
    .toLowerCase()
  if (m && ALLOWED.has(m)) return true
  if (m === 'application/octet-stream' && ALLOW_EXT.test(String(filenameForExt || ''))) return true
  return false
}
