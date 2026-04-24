// ============================================================
//  CIB — Logout  (api/logout.js)
//
//  Deletes the session token from Supabase.
//  After this, the token is permanently invalid —
//  even if someone kept a copy of it.
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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers['x-session-token']

  if (token) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      await supabase.from('sessions').delete().eq('token', token)
    } catch (err) {
      console.error('Logout error:', err)
    }
  }

  // Always succeed — even if the token was already gone
  return res.status(200).json({ success: true })
}
