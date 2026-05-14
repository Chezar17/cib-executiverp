// ============================================================
//  Shared Handler — HTTPS image proxy for Cropper (CDN without CORS)
//  Invoked only from GET /api/reports?imageProxy=1&url=...
// ============================================================

import { jsonApiError } from './api-error.js'

/** Comma-separated hostnames (default: ExecutiveRP image CDN). */
function allowedHosts() {
  const raw = process.env.IMAGE_PROXY_HOSTS || ''
  const trimmed = raw.trim()
  if (!trimmed) return ['images.executiverp.id']
  return trimmed.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
}

const MAX_BYTES = 15 * 1024 * 1024

/** @param {string} hostname */
function hostAllowed(hostname, hosts) {
  const h = String(hostname || '').toLowerCase()
  if (!h || h === 'localhost') return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false

  return hosts.some(
    (allowed) => allowed && (h === allowed || h.endsWith('.' + allowed)),
  )
}

/** @param {Buffer} buf */
function sniffBinaryImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg'
  if (buf.length >= 8 && buf.slice(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n')
    return 'image/png'
  if (buf.length >= 6) {
    const g = buf.slice(0, 6).toString('ascii')
    if (g === 'GIF87a' || g === 'GIF89a') return 'image/gif'
  }
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp'
  return null
}

function isSafeImageUrl(candidate, hosts) {
  let u
  try {
    u = new URL(candidate)
  } catch (_) {
    return false
  }
  if (u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  const path = `${u.pathname || ''}${u.search || ''}${u.hash || ''}`
  if (/[\u0000-\u001f]/.test(path)) return false
  return hostAllowed(u.hostname, hosts)
}

/** Session required — caller verifies before invoking. */
export async function handleReportImageProxy(req, res) {
  try {
    const hosts = allowedHosts()
    const rawUrl = typeof req.query?.url === 'string' ? req.query.url.trim() : ''
    if (!rawUrl) {
      res.status(400).json({ error: 'Missing url' })
      return
    }

    let target
    try {
      target = new URL(rawUrl)
    } catch (_) {
      res.status(400).json({ error: 'Invalid url' })
      return
    }

    if (!isSafeImageUrl(rawUrl, hosts)) {
      res.status(403).json({ error: 'URL host not allowed for image proxy' })
      return
    }

    const upstream = await fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    })

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return jsonApiError(res, upstream.status <= 599 ? upstream.status : 502, 'Upstream image fetch failed', {
        context: 'reports imageProxy',
        cause: Error(text.slice(0, 200)),
      })
    }

    const finalHref = upstream.url || target.toString()
    if (!isSafeImageUrl(finalHref, hosts)) {
      res.status(403).json({ error: 'Redirect target not allowed' })
      return
    }

    const len = upstream.headers.get('content-length')
    if (len && /^[0-9]+$/.test(len) && Number(len) > MAX_BYTES) {
      res.status(413).json({ error: 'Image too large' })
      return
    }

    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) {
      res.status(413).json({ error: 'Image too large' })
      return
    }

    const ct = upstream.headers.get('content-type')
    let contentType =
      ct && /^image\/[a-z0-9.+-]+$/.test(ct.split(';')[0].trim())
        ? ct.split(';')[0].trim().toLowerCase()
        : 'application/octet-stream'

    const nonImageCt =
      !contentType.startsWith('image/') && contentType !== 'application/octet-stream'
    if (nonImageCt) {
      res.status(415).json({ error: 'Not an image response' })
      return
    }
    if (contentType === 'application/octet-stream') {
      const sniffed = sniffBinaryImageType(buf)
      if (sniffed) contentType = sniffed
      else if (!buf.byteLength || buf.byteLength < 8) {
        res.status(422).json({ error: 'Unrecognized image data' })
        return
      }
    }

    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', String(buf.length))
    res.status(200).end(buf)
  } catch (e) {
    return jsonApiError(res, 502, 'Image proxy failed', { cause: e, context: 'reports imageProxy' })
  }
}
