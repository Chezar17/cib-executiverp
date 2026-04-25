// ============================================================
//  CIB — Verify Password  (api/verify-password.js)
//
//  Used by the Miro board gate on gang.html.
//  User types their password → frontend hashes it with SHA-256
//  → sends here → we check it matches their record in Supabase.
//
//  This does NOT create a new session — the user is already
//  logged in. This is just a re-confirmation step.
// ============================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL   = process.env.SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_ANON_KEY
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://your-app.vercel.app'

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // Must be logged in first
  const token = req.headers['x-session-token']
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { badge, passwordHash } = req.body

    if (!badge || !passwordHash) {
      return res.status(400).json({ error: 'Badge and password are required' })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // Check badge + hashed password match in users table
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('badge', badge.trim())
      .eq('password', passwordHash)
      .single()

    if (error || !data) {
      return res.status(401).json({ error: 'Incorrect password' })
    }

    return res.status(200).json({ success: true })

  } catch (err) {
    console.error('verify-password error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
