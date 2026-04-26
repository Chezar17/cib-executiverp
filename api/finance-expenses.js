// ============================================================
//  CIB — Finance: Expenses API
//  File location: api/finance-expenses.js
//
//  GET    /api/finance-expenses?card_id=xxx → get expenses for a card
//  POST   /api/finance-expenses             → add expense to own card
//  DELETE /api/finance-expenses?id=xxx      → delete own expense
//
//  Rules:
//  - Only the card owner can add / delete expenses on their card
//  - Amount is validated against remaining personal balance
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

    // ── GET: All expenses for a card ──────────────────────────
    if (req.method === 'GET') {
      const { card_id } = req.query
      if (!card_id) return res.status(400).json({ error: 'card_id required' })

      const { data, error } = await supabase
        .from('finance_expenses')
        .select('*')
        .eq('card_id', card_id)
        .eq('is_deleted', false)
        .order('expense_date', { ascending: false })

      if (error) throw error
      return res.status(200).json({ success: true, data })
    }

    // ── POST: Add expense ─────────────────────────────────────
    if (req.method === 'POST') {
      const { card_id, description, expense_date, amount } = req.body

      if (!card_id)      return res.status(400).json({ error: 'card_id required' })
      if (!description)  return res.status(400).json({ error: 'Description required' })
      if (!expense_date) return res.status(400).json({ error: 'Date required' })
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' })

      // Verify card ownership
      const { data: card } = await supabase
        .from('finance_cards')
        .select('id, owner_badge, personal_balance')
        .eq('id', card_id)
        .eq('is_deleted', false)
        .single()

      if (!card) return res.status(404).json({ error: 'Card not found' })

      if (card.owner_badge !== session.badge) {
        return res.status(403).json({ error: 'You can only add expenses to your own card' })
      }

      // Check remaining balance
      const { data: existingExp } = await supabase
        .from('finance_expenses')
        .select('amount')
        .eq('card_id', card_id)
        .eq('is_deleted', false)

      const totalSpent = (existingExp || []).reduce((s, e) => s + (e.amount || 0), 0)
      const remaining  = (card.personal_balance || 0) - totalSpent

      if (amount > remaining) {
        return res.status(400).json({
          error: `Insufficient personal balance. Available: $${remaining.toLocaleString()}`
        })
      }

      const { data: expense, error } = await supabase
        .from('finance_expenses')
        .insert([{ card_id, description, expense_date, amount, is_deleted: false }])
        .select()
        .single()

      if (error) throw error
      return res.status(201).json({ success: true, data: expense })
    }

    // ── DELETE: Delete own expense ────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Expense ID required' })

      // Verify ownership via card
      const { data: expense } = await supabase
        .from('finance_expenses')
        .select('id, card_id')
        .eq('id', id)
        .single()

      if (!expense) return res.status(404).json({ error: 'Expense not found' })

      const { data: card } = await supabase
        .from('finance_cards')
        .select('owner_badge')
        .eq('id', expense.card_id)
        .single()

      if (!card) return res.status(404).json({ error: 'Card not found' })

      if (card.owner_badge !== session.badge && session.classification !== 'top_secret') {
        return res.status(403).json({ error: 'You can only delete your own expenses' })
      }

      const { error } = await supabase
        .from('finance_expenses')
        .update({ is_deleted: true })
        .eq('id', id)

      if (error) throw error
      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch (err) {
    console.error('Finance expenses API error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
