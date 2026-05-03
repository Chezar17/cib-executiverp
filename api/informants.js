// ============================================================
//  CIB — Vercel Serverless CRUD for Informants
//  File location: api/informants.js
//
//  Handles all 4 operations:
//  GET    /api/informants        → fetch all informants
//  POST   /api/informants        → create new informant
//  PUT    /api/informants        → update existing informant
//  DELETE /api/informants?id=xxx → delete informant
// ============================================================

import { allowMethods } from './_lib/http.js'
import { requireSession } from './_lib/session.js'
import { getSupabase } from './_lib/supabase.js'

export default async function handler(req, res) {

  const session = await requireSession(req, res)
  if (!session) return

  const supabase = getSupabase()

  try {
    if (!allowMethods(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return


    // ── GET: Load informants or directives ─────────────────────
    if (req.method === 'GET') {
      // ?type=directive → return only directive records (gang = '__directive__')
      // default         → return all non-directive informant records
      const isDirective = req.query.type === 'directive'

      let query = supabase
        .from('informants')
        .select('*')
        .eq('is_deleted', false)

      if (isDirective) {
        query = query.eq('gang', '__directive__')
      } else {
        query = query.neq('gang', '__directive__')
      }

      query = query.order('created_at', { ascending: isDirective ? false : true })

      const { data, error } = await query
      if (error) throw error
      return res.status(200).json({ success: true, data })
    }

    // ── POST: Create new informant ───────────────────────────
    if (req.method === 'POST') {
      const { code, name, status, handler, gang, task, notes } = req.body

      if (!code || !name) {
        return res.status(400).json({ error: 'Code and name are required' })
      }

      const { data, error } = await supabase
        .from('informants')
        .insert([{ code, name, status, handler, gang, task, notes }])
        .select()
        .single()

      if (error) throw error
      return res.status(201).json({ success: true, data })
    }

    // ── PUT: Update existing informant ───────────────────────
    if (req.method === 'PUT') {
      const { id, code, name, status, handler, gang, task, notes } = req.body

      if (!id) {
        return res.status(400).json({ error: 'ID is required for update' })
      }

      const { data, error } = await supabase
        .from('informants')
        .update({ code, name, status, handler, gang, task, notes })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return res.status(200).json({ success: true, data })
    }

    // ── DELETE: Soft delete + write to deletion_logs ───────────
    //  The row is NEVER removed from the database.
    //  is_deleted=true hides it from the portal.
    //  A permanent log entry is written to deletion_logs.
    if (req.method === 'DELETE') {
      const { id } = req.query
      const { reason } = req.body || {}

      if (!id) {
        return res.status(400).json({ error: 'ID is required for delete' })
      }

      // Fetch the informant before marking deleted (need name + code for the log)
      const { data: inf } = await supabase
        .from('informants')
        .select('id, code, name')
        .eq('id', id)
        .single()

      // Soft delete — mark the row, never remove it
      const { error: updateErr } = await supabase
        .from('informants')
        .update({
          is_deleted: true,
          deleted_by: session.badge,
          deleted_at: new Date().toISOString()
        })
        .eq('id', id)

      if (updateErr) throw updateErr

      // Write a permanent entry to the deletion log
      await supabase
        .from('deletion_logs')
        .insert([{
          informant_id:   inf?.id   || null,
          informant_code: inf?.code || null,
          informant_name: inf?.name || null,
          deleted_by:     session.badge,
          reason:         reason || null
        }])

      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch (err) {
    console.error('Informants API error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
