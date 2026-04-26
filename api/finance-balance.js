// ============================================================
//  CIB — Finance: Main Balance API
//  File location: api/finance-balance.js
//
//  GET  /api/finance-balance        → get current main balance
//  POST /api/finance-balance        → set/update main balance (Top Secret only)
// ============================================================

import { allowMethods } from './_lib/http.js'
import { requireSession } from './_lib/session.js'
import { getSupabase } from './_lib/supabase.js'

export default async function handler(req, res) {
  const session = await requireSession(req, res)
  if (!session) return

  const supabase = getSupabase()

  try {
    if (!allowMethods(req, res, ['GET', 'POST'])) return

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
