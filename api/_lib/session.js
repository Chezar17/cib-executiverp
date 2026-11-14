import { getSupabase } from './supabase.js'
import { SESSION_MINS, SESSION_EXTEND_WHEN_LEFT_MINS } from './config.js'

/**
 * Sliding session: while the user is active, push `expires_at` back to
 * now + SESSION_MINS. Only writes when less than SESSION_EXTEND_WHEN_LEFT_MINS is left.
 * Returns the (possibly new) expiry as a Date.
 */
export async function touchSession(supabase, token, expiresAt) {
  const current = new Date(expiresAt)
  const left = current.getTime() - Date.now()
  if (left > SESSION_EXTEND_WHEN_LEFT_MINS * 60 * 1000) return current
  const next = new Date(Date.now() + SESSION_MINS * 60 * 1000)
  try {
    await supabase.from('sessions').update({ expires_at: next.toISOString() }).eq('token', token)
    return next
  } catch (_) {
    return current
  }
}

export function getSessionToken(req) {
  return req.headers['x-session-token']
}

export async function getSessionFromToken(token) {
  if (!token) return null

  const supabase = getSupabase()
  const { data: session } = await supabase
    .from('sessions')
    .select('badge, expires_at')
    .eq('token', token)
    .single()

  if (!session || new Date(session.expires_at) < new Date()) return null
  const expiresAt = await touchSession(supabase, token, session.expires_at)

  const { data: user } = await supabase
    .from('users')
    .select('name, classification')
    .eq('badge', session.badge)
    .single()

  return {
    badge: session.badge,
    name: user?.name || null,
    classification: user?.classification || null,
    expiresAt: expiresAt.getTime(),
  }
}

export async function requireSession(req, res) {
  const session = await getSessionFromToken(getSessionToken(req))
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return session
}
