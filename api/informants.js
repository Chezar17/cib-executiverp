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

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY)
}

// ── Simple session check (reuse your existing token system) ──
function isAuthorized(req) {
  const token = req.headers['x-session-token']
  // You can make this more strict — for now just checks it exists
  return !!token
}

export default async function handler(req, res) {

  // Block if not logged in
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getSupabase()

  try {

    // ── GET: Load all informants (exclude soft-deleted) ────────
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('informants')
        .select('*')
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })

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
      const { deleted_by, reason } = req.body || {}

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
          deleted_by: deleted_by || 'Unknown',
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
          deleted_by:     deleted_by || 'Unknown',
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
