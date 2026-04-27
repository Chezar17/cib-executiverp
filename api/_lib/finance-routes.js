// Merged from api/finance-*.js — imported only by api/finance.js (one serverless function)

import { CLEARANCE_LEVELS } from './config.js'
import { allowMethods } from './http.js'
import { requireSession } from './session.js'
import { getSupabase } from './supabase.js'

export async function handleFinanceBalance(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  const supabase = getSupabase()
  try {
    if (!allowMethods(req, res, ['GET', 'POST'])) return
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('finance_balance')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (error && error.code !== 'PGRST116') throw error
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

export async function handleFinanceCards(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (!CLEARANCE_LEVELS.includes(session.classification)) {
    return res.status(403).json({ error: 'Insufficient clearance' })
  }
  const supabase = getSupabase()
  try {
    if (!allowMethods(req, res, ['GET', 'POST', 'DELETE'])) return
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('finance_cards')
        .select('*, finance_expenses(amount,is_deleted), finance_income(amount,is_deleted)')
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
      if (error) throw error
      const enriched = (data || []).map(card => {
        const total_spent  = (card.finance_expenses || []).filter(e => !e.is_deleted).reduce((s, e) => s + (e.amount || 0), 0)
        const total_income = (card.finance_income   || []).filter(i => !i.is_deleted).reduce((s, i) => s + (i.amount || 0), 0)
        const remaining_balance = Math.max(0, (card.personal_balance || 0) + total_income - total_spent)
        return { ...card, total_spent, total_income, remaining_balance, finance_expenses: undefined, finance_income: undefined }
      })
      return res.status(200).json({ success: true, data: enriched })
    }
    if (req.method === 'POST') {
      const { owner_badge, personal_balance, date_retrieved, label } = req.body
      if (owner_badge !== session.badge) {
        return res.status(403).json({ error: 'You can only create a card for yourself' })
      }
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
    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Card ID required' })
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

export async function handleFinanceExpenses(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (!CLEARANCE_LEVELS.includes(session.classification)) {
    return res.status(403).json({ error: 'Insufficient clearance' })
  }
  const supabase = getSupabase()
  try {
    if (!allowMethods(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return
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
    if (req.method === 'POST') {
      const { card_id, description, expense_date, amount } = req.body
      if (!card_id)      return res.status(400).json({ error: 'card_id required' })
      if (!description)  return res.status(400).json({ error: 'Description required' })
      if (!expense_date) return res.status(400).json({ error: 'Date required' })
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' })
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
    if (req.method === 'PATCH') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Expense ID required' })
      const { description, expense_date, amount } = req.body
      if (!description)  return res.status(400).json({ error: 'Description required' })
      if (!expense_date) return res.status(400).json({ error: 'Date required' })
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' })
      const { data: expense, error: expErr } = await supabase
        .from('finance_expenses')
        .select('id, card_id, amount')
        .eq('id', id)
        .eq('is_deleted', false)
        .single()
      if (expErr || !expense) return res.status(404).json({ error: 'Expense not found' })
      const { data: card } = await supabase
        .from('finance_cards')
        .select('owner_badge, personal_balance')
        .eq('id', expense.card_id)
        .eq('is_deleted', false)
        .single()
      if (!card) return res.status(404).json({ error: 'Card not found' })
      if (card.owner_badge !== session.badge && session.classification !== 'top_secret') {
        return res.status(403).json({ error: 'You can only edit your own expenses' })
      }
      const { data: otherExp } = await supabase
        .from('finance_expenses')
        .select('amount')
        .eq('card_id', expense.card_id)
        .eq('is_deleted', false)
        .neq('id', id)
      const otherSpent = (otherExp || []).reduce((s, e) => s + (e.amount || 0), 0)
      const maxAllowed = (card.personal_balance || 0) - otherSpent
      if (amount > maxAllowed) {
        return res.status(400).json({
          error: `Amount exceeds available balance. Maximum allowed: $${maxAllowed.toLocaleString()}`
        })
      }
      const { data: updated, error: updErr } = await supabase
        .from('finance_expenses')
        .update({
          description,
          expense_date,
          amount,
          updated_at: new Date().toISOString(),
          updated_by: session.badge
        })
        .eq('id', id)
        .select()
        .single()
      if (updErr) throw updErr
      return res.status(200).json({ success: true, data: updated })
    }
    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Expense ID required' })
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

export async function handleFinanceIncome(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (!CLEARANCE_LEVELS.includes(session.classification)) {
    return res.status(403).json({ error: 'Insufficient clearance' })
  }
  const supabase = getSupabase()
  try {
    if (!allowMethods(req, res, ['GET', 'POST', 'DELETE'])) return
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
    if (req.method === 'POST') {
      const { card_id, description, income_date, amount } = req.body
      if (!card_id)     return res.status(400).json({ error: 'card_id required' })
      if (!description) return res.status(400).json({ error: 'Description required' })
      if (!income_date) return res.status(400).json({ error: 'Date required' })
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' })
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
    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'Income ID required' })
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
