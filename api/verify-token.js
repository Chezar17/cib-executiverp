// ============================================================
//  CIB — Token Verification  (api/verify-token.js)
//
//  Every protected page calls this on load.
//  If the token is missing, fake, or expired → 401.
//  The page then redirects to login.
//
//  This is the fix for the #1 critical vulnerability:
//  "Any user can set cib_auth=true in DevTools"
// ============================================================

import {
  allowMethods,
  applyCors,
  handlePreflight,
  rejectForeignOrigin,
} from './_lib/http.js'
import { getSupabase } from './_lib/supabase.js'

export default async function handler(req, res) {

  applyCors(res, {
    methods: 'GET, OPTIONS',
    headers: 'Content-Type, x-session-token',
  })
  if (handlePreflight(req, res)) return
  if (rejectForeignOrigin(req, res)) return
  if (!allowMethods(req, res, ['GET'])) return

  // ── Get token from request header ──────────────────────────
  const token = req.headers['x-session-token']

  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  try {
    const supabase = getSupabase()

    // Look up the token in the sessions table
    const { data: session, error } = await supabase
      .from('sessions')
      .select('badge, expires_at')
      .eq('token', token)
      .single()

    if (error || !session) {
      return res.status(401).json({ error: 'Invalid session' })
    }

    // Check if it has expired
    if (new Date(session.expires_at) < new Date()) {
      // Clean up the expired row
      await supabase.from('sessions').delete().eq('token', token)
      return res.status(401).json({ error: 'Session expired' })
    }

    // Fetch GIU fields from users table
    const { data: user } = await supabase
      .from('users')
      .select('is_giu, callsign')
      .eq('badge', session.badge)
      .single()

    // ✅ Token is valid — return badge + GIU access fields
    return res.status(200).json({
      success:  true,
      badge:    session.badge,
      is_giu:   user?.is_giu   || false,
      callsign: user?.callsign  || null,
    })

  } catch (err) {
    console.error('Verify token error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
