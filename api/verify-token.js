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

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL   = process.env.SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_ANON_KEY
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://your-app.vercel.app'

export default async function handler(req, res) {

  // ── CORS ───────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── CSRF ───────────────────────────────────────────────────
  const origin = req.headers.origin || ''
  if (origin && origin !== ALLOWED_ORIGIN) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Get token from request header ──────────────────────────
  const token = req.headers['x-session-token']

  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

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

    // ✅ Token is valid — return user badge for the page to use
    return res.status(200).json({
      success: true,
      badge:   session.badge
    })

  } catch (err) {
    console.error('Verify token error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
