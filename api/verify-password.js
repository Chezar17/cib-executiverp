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

import {
  allowMethods,
  applyCors,
  handlePreflight,
  rejectForeignOrigin,
} from './_lib/http.js'
import { getSupabase } from './_lib/supabase.js'

export default async function handler(req, res) {

  applyCors(res, {
    methods: 'POST, OPTIONS',
    headers: 'Content-Type, x-session-token',
  })
  if (handlePreflight(req, res)) return
  if (rejectForeignOrigin(req, res)) return

  // Must be logged in first
  const token = req.headers['x-session-token']
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  if (!allowMethods(req, res, ['POST'])) return

  try {
    const { badge, passwordHash } = req.body

    if (!badge || !passwordHash) {
      return res.status(400).json({ error: 'Badge and password are required' })
    }

    const supabase = getSupabase()

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
