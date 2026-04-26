import { ALLOWED_ORIGIN } from './config.js'

export function applyCors(res, { methods, headers }) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', methods)
  res.setHeader('Access-Control-Allow-Headers', headers)
}

export function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return true
  }
  return false
}

export function rejectForeignOrigin(req, res) {
  const origin = req.headers.origin || ''
  if (origin && origin !== ALLOWED_ORIGIN) {
    res.status(403).json({ error: 'Forbidden' })
    return true
  }
  return false
}

export function allowMethods(req, res, methods) {
  if (!methods.includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' })
    return false
  }
  return true
}

export function getClientIp(req) {
  return (
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    'unknown'
  )
    .split(',')[0]
    .trim()
}
