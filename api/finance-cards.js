// ============================================================
//  CIB — Finance: Personal Expense Cards API
//  File location: api/finance-cards.js
//
//  GET    /api/finance-cards        → get all cards
//  POST   /api/finance-cards        → create new card (deducts from main balance)
//  DELETE /api/finance-cards?id=xxx → delete own card (returns balance)
//
//  Rules:
//  - Only one card per badge (enforced server-side)
//  - Only the owner can delete their own card
//  - Deletion returns remaining balance back to main pool
//  - top_secret / secret / confidential can create cards
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

    // ── GET: All active cards ─────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('finance_cards')
        .select('*, finance_expenses(amount)')
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })

      if (error) throw error

      // Compute remaining_balance and total_spent per card
      const enriched = (data || []).map(card => {
        const total_spent = (card.finance_expenses || []).reduce((s, e) => s + (e.amount || 0), 0)
        const remaining_balance = Math.max(0, (card.personal_balance || 0) - total_spent)
        return { ...card, total_spent, remaining_balance, finance_expenses: undefined }
      })

      return res.status(200).json({ success: true, data: enriched })
    }

    // ── POST: Create new card ─────────────────────────────────
    if (req.method === 'POST') {
      const { owner_badge, personal_balance, date_retrieved, label } = req.body

      // Must be creating for yourself
      if (owner_badge !== session.badge) {
        return res.status(403).json({ error: 'You can only create a card for yourself' })
      }

      // One card per person
      const { data: existing } = await supabase
        .from('finance_cards')
        .select('id')
        .eq('owner_badge', session.badge)
        .eq('is_deleted', false)
        .single()

      if (existing) {
        return res.status(400).json({ error: 'You already have an expense card' })
      }

      if (!personal_balance || personal_balance <= 0) {
        return res.status(400).json({ error: 'Valid balance amount required' })
      }
      if (!date_retrieved) {
        return res.status(400).json({ error: 'Date retrieved is required' })
      }

      // Check main balance has enough
      const { data: bal } = await supabase
        .from('finance_balance')
        .select('total_amount')
        .limit(1)
        .single()

      const { data: allCards } = await supabase
        .from('finance_cards')
        .select('personal_balance')
        .eq('is_deleted', false)

      const allocated = (allCards || []).reduce((s, c) => s + (c.personal_balance || 0), 0)
      const available = bal ? (bal.total_amount || 0) - allocated : 0

      if (personal_balance > available) {
        return res.status(400).json({
          error: `Insufficient main balance. Available: $${available.toLocaleString()}`
        })
      }

      const { data: card, error } = await supabase
        .from('finance_cards')
        .insert([{
          owner_badge,
          personal_balance,
          date_retrieved,
          label: label || owner_badge,
          is_deleted: false
        }])
        .select()
        .single()

      if (error) throw error
      return res.status(201).json({ success: true, data: card })
    }

    // ── DELETE: Delete own card ───────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query

      if (!id) return res.status(400).json({ error: 'Card ID required' })

      // Verify ownership
      const { data: card } = await supabase
        .from('finance_cards')
        .select('id, owner_badge')
        .eq('id', id)
        .single()

      if (!card) return res.status(404).json({ error: 'Card not found' })

      if (card.owner_badge !== session.badge && session.classification !== 'top_secret') {
        return res.status(403).json({ error: 'You can only delete your own card' })
      }

      const { error } = await supabase
        .from('finance_cards')
        .update({ is_deleted: true, deleted_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch (err) {
    console.error('Finance cards API error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
