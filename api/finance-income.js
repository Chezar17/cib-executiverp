// ============================================================
//  CIB — Finance: Income API
//  File location: api/finance-income.js
//
//  GET    /api/finance-income?card_id=xxx → get income entries for a card
//  POST   /api/finance-income             → add income to own card (adds to balance)
//  DELETE /api/finance-income?id=xxx      → delete own income entry
//
//  Rules:
//  - Only the card owner can add / delete income on their card
//  - top_secret can delete any income entry
// ============================================================

import { CLEARANCE_LEVELS } from './_lib/config.js'
import { allowMethods } from './_lib/http.js'
import { requireSession } from './_lib/session.js'
import { getSupabase } from './_lib/supabase.js'

export default async function handler(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (!CLEARANCE_LEVELS.includes(session.classification)) {
    return res.status(403).json({ error: 'Insufficient clearance' })
  }

  const supabase = getSupabase()

  try {
    if (!allowMethods(req, res, ['GET', 'POST', 'DELETE'])) return

    // ── GET: All income entries for a card ────────────────────
    if (req.method === 'GET') {
      const { card_id } = req.query
      if (!card_id) return res.status(400).json({ error: 'card_id required' })

      const { data, error } = await supabase
        .from('finance_income')
        .select('*')
        .eq('card_id', card_id)
        .eq('is_deleted', false)
        .order('income_date', { ascending: false })

      if (error) throw error
      return res.status(200).json({ success: true, data })
    }

    // ── POST: Add income entry ────────────────────────────────
    if (req.method === 'POST') {
      const { card_id, description, income_date, amount } = req.body

      if (!card_id)     return res.status(400).json({ error: 'card_id required' })
      if (!description) return res.status(400).json({ error: 'Description required' })
      if (!income_date) return res.status(400).json({ error: 'Date required' })
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' })

      // Verify card ownership
      const { data: card } = await supabase
        .from('finance_cards')
        .select('id, owner_badge')
        .eq('id', card_id)
        .eq('is_deleted', false)
        .single()

      if (!card) return res.status(404).json({ error: 'Card not found' })

      if (card.owner_badge !== session.badge) {
        return res.status(403).json({ error: 'You can only add income to your own card' })
      }

      const { data: income, error } = await supabase
        .from('finance_income')
        .insert([{ card_id, description, income_date, amount, is_deleted: false }])
        .select()
        .single()

      if (error) throw error
      return res.status(201).json({ success: true, data: income })
    }

    // ── DELETE: Remove income entry ───────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Income ID required' })

      // Fetch entry to verify ownership via card
      const { data: income } = await supabase
        .from('finance_income')
        .select('id, card_id')
        .eq('id', id)
        .single()

      if (!income) return res.status(404).json({ error: 'Income entry not found' })

      const { data: card } = await supabase
        .from('finance_cards')
        .select('owner_badge')
        .eq('id', income.card_id)
        .single()

      if (!card) return res.status(404).json({ error: 'Card not found' })

      if (card.owner_badge !== session.badge && session.classification !== 'top_secret') {
        return res.status(403).json({ error: 'You can only delete your own income entries' })
      }

      const { error } = await supabase
        .from('finance_income')
        .update({ is_deleted: true })
        .eq('id', id)

      if (error) throw error
      return res.status(200).json({ success: true })
    }

  } catch (err) {
    console.error('Finance income API error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
