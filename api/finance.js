// ============================================================
//  CIB — Finance API (unified) — 1 Vercel Function for Hobby 12 limit
//  Routed via rewrites: /api/finance-balance → /api/finance?__f=balance
// ============================================================

import {
  handleFinanceBalance,
  handleFinanceCards,
  handleFinanceExpenses,
  handleFinanceIncome
} from './_lib/finance-routes.js'

const HANDLERS = {
  balance: handleFinanceBalance,
  cards: handleFinanceCards,
  expenses: handleFinanceExpenses,
  income: handleFinanceIncome
}

export default async function handler(req, res) {
  const f = req.query?.__f
  const h = f && HANDLERS[f]
  if (!h) {
    return res.status(400).json({ error: 'Use legacy paths: /api/finance-balance, /api/finance-cards, etc.' })
  }
  return h(req, res)
}
