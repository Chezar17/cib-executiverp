// ============================================================
//  CIB — Logout  (api/logout.js)
//
//  Deletes the session token from Supabase.
//  After this, the token is permanently invalid —
//  even if someone kept a copy of it.
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
  if (!allowMethods(req, res, ['POST'])) return

  const token = req.headers['x-session-token']

  if (token) {
    try {
      const supabase = getSupabase()
      await supabase.from('sessions').delete().eq('token', token)
    } catch (err) {
      console.error('Logout error:', err)
    }
  }

  // Always succeed — even if the token was already gone
  return res.status(200).json({ success: true })
}
