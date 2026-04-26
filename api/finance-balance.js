// ============================================================
//  CIB — Finance: Main Balance API
//  File location: api/finance-balance.js
//
//  GET  /api/finance-balance        → get current main balance
//  POST /api/finance-balance        → set/update main balance (Top Secret only)
// ============================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY)
}

// ── Verify token and return session badge + classification ────
async function getSession(req) {
  const token = req.headers['x-session-token']
  if (!token) return null
  const supabase = getSupabase()
  const { data } = await supabase
    .from('sessions')
    .select('badge, expires_at')
    .eq('token', token)
    .single()
  if (!data) return null
  if (new Date(data.expires_at) < new Date()) return null

  // Get classification from users table
  const { data: user } = await supabase
    .from('users')
    .select('classification')
    .eq('badge', data.badge)
    .single()

  return { badge: data.badge, classification: user?.classification || null }
}

export default async function handler(req, res) {
  const session = await getSession(req)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabase()

  try {
    // ── GET: Return current main balance ─────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('finance_balance')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (error && error.code !== 'PGRST116') throw error

      // Calculate available = total_amount - sum of all personal balances
      const { data: cards } = await supabase
        .from('finance_cards')
        .select('personal_balance')
        .eq('is_deleted', false)

      const allocated = (cards || []).reduce((s, c) => s + (c.personal_balance || 0), 0)
      const available = data ? Math.max(0, (data.total_amount || 0) - allocated) : 0

      return res.status(200).json({
        success: true,
        data: data ? { ...data, available, allocated } : null
      })
    }

    // ── POST: Update main balance (Top Secret only) ──────────
    if (req.method === 'POST') {
      if (session.classification !== 'top_secret') {
        return res.status(403).json({ error: 'Top Secret clearance required' })
      }

      const { total_amount, period_start, period_end, notes } = req.body

      if (!total_amount || total_amount <= 0) {
        return res.status(400).json({ error: 'Valid amount required' })
      }
      if (!period_start || !period_end) {
        return res.status(400).json({ error: 'Period start and end dates required' })
      }

      // Upsert — always keep only one main balance row
      const { data: existing } = await supabase
        .from('finance_balance')
        .select('id')
        .limit(1)
        .single()

      let result
      if (existing) {
        result = await supabase
          .from('finance_balance')
          .update({ total_amount, period_start, period_end, notes, updated_by: session.badge, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select().single()
      } else {
        result = await supabase
          .from('finance_balance')
          .insert([{ total_amount, period_start, period_end, notes, created_by: session.badge }])
          .select().single()
      }

      if (result.error) throw result.error
      return res.status(200).json({ success: true, data: result.data })
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch (err) {
    console.error('Finance balance API error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
