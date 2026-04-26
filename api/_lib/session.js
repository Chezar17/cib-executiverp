import { getSupabase } from './supabase.js'

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

  const { data: user } = await supabase
    .from('users')
    .select('name, classification')
    .eq('badge', session.badge)
    .single()

  return {
    badge: session.badge,
    name: user?.name || null,
    classification: user?.classification || null,
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
