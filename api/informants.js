// ============================================================
//  CIB — Vercel Serverless CRUD for Informants + GIU Directives
//  File location: api/informants.js
//
//  Handles all operations:
//  GET    /api/informants              → fetch all informants
//  POST   /api/informants              → create new informant
//  PUT    /api/informants              → update existing informant
//  DELETE /api/informants?id=xxx       → delete informant
//
//  GET    /api/informants?type=directive          → fetch all directives
//  POST   /api/informants?type=directive          → create directive  [top_secret only]
//  PUT    /api/informants?type=directive           → update directive  [top_secret only]
//  DELETE /api/informants?type=directive&id=xxx   → delete directive  [top_secret only]
//
//  DIRECTIVES use the informants table with gang = '__directive__'
//  Extra fields stored in task (JSON stringified):
//  {
//    description, priority, deadline, status,       ← core
//    accepted, accepted_note, accepted_by,           ← response
//    progress,                                       ← 0-100
//    outcome, outcome_note, outcome_by,              ← success/failed
//    last_updated_by                                 ← callsign of last editor
//  }
//
//  DB NOTE: directives re-use the informants table.
//  No new table is needed. All directive rows have:
//    gang  = '__directive__'
//    code  = directive reference number  (e.g. GIU-001)
//    name  = directive title
//    notes = issued_by callsign (the creator's callsign)
//    task  = JSON string with the full directive payload (see above)
// ============================================================

import { allowMethods } from './_lib/http.js'
import { requireSession } from './_lib/session.js'
import { getSupabase } from './_lib/supabase.js'

// ── Classification check helpers ─────────────────────────────
const TOP_SECRET = 'top_secret'
const SECRET     = 'secret'

async function getUserClassification(supabase, badge) {
  const { data } = await supabase
    .from('users')
    .select('classification, callsign')
    .eq('badge', badge)
    .single()
  return data || {}
}

async function getUserCallsign(supabase, badge) {
  const { data } = await supabase
    .from('users')
    .select('callsign')
    .eq('badge', badge)
    .single()
  return data?.callsign || badge
}

// ── Main handler ─────────────────────────────────────────────
export default async function handler(req, res) {

  const session = await requireSession(req, res)
  if (!session) return

  const supabase = getSupabase()

  try {
    if (!allowMethods(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return

    const isDirective = req.query.type === 'directive'

    if (isDirective) {
      return handleDirective(req, res, supabase, session)
    }

    // ═══════════════════════════════════════════════════════
    //  INFORMANT CRUD (unchanged from original)
    // ═══════════════════════════════════════════════════════

    // ── GET: Load informants ────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('informants')
        .select('*')
        .eq('is_deleted', false)
        .neq('gang', '__directive__')
        .order('created_at', { ascending: true })
      if (error) throw error
      return res.status(200).json({ success: true, data })
    }

    // ── POST: Create new informant ──────────────────────────
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

    // ── PUT: Update existing informant ──────────────────────
    if (req.method === 'PUT') {
      const { id, code, name, status, handler, gang, task, notes } = req.body
      if (!id) return res.status(400).json({ error: 'ID is required for update' })
      const { data, error } = await supabase
        .from('informants')
        .update({ code, name, status, handler, gang, task, notes })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return res.status(200).json({ success: true, data })
    }

    // ── DELETE: Soft delete informant ───────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query
      const { reason } = req.body || {}
      if (!id) return res.status(400).json({ error: 'ID is required for delete' })

      const { data: inf } = await supabase
        .from('informants')
        .select('id, code, name')
        .eq('id', id)
        .single()

      const { error: updateErr } = await supabase
        .from('informants')
        .update({ is_deleted: true, deleted_by: session.badge, deleted_at: new Date().toISOString() })
        .eq('id', id)

      if (updateErr) throw updateErr

      await supabase.from('deletion_logs').insert([{
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

// ═══════════════════════════════════════════════════════════
//  DIRECTIVE CRUD
//  Reuses the informants table with gang = '__directive__'
//  Classification gate:
//    top_secret  → full CRUD
//    secret      → GET only
//    anything else → 403
// ═══════════════════════════════════════════════════════════
async function handleDirective(req, res, supabase, session) {
  // Fetch the requesting user's classification + callsign
  const userMeta = await getUserClassification(supabase, session.badge)
  const cls      = (userMeta.classification || '').toLowerCase()

  // Only top_secret and secret can access directives at all
  if (cls !== TOP_SECRET && cls !== SECRET) {
    return res.status(403).json({ error: 'Insufficient clearance to access GIU directives.' })
  }

  // ── GET: Fetch all directives (secret + top_secret) ──────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('informants')
      .select('*')
      .eq('gang', '__directive__')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    if (error) throw error

    // Parse the JSON task payload back out for convenience
    const parsed = (data || []).map(row => ({
      ...row,
      _directive: safeParseJson(row.task)
    }))

    return res.status(200).json({ success: true, data: parsed })
  }

  // ── Everything below is top_secret only ──────────────────
  if (cls !== TOP_SECRET) {
    return res.status(403).json({ error: 'Only TOP SECRET personnel can modify directives.' })
  }

  // ── POST: Create new directive ────────────────────────────
  if (req.method === 'POST') {
    const { title, description, priority, deadline } = req.body

    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required.' })
    }

    const callsign = userMeta.callsign || session.badge

    // Auto-generate a directive reference code
    const { count } = await supabase
      .from('informants')
      .select('*', { count: 'exact', head: true })
      .eq('gang', '__directive__')

    const refNum  = String((count || 0) + 1).padStart(3, '0')
    const refCode = `GIU-${refNum}`

    const payload = {
      description,
      priority:         priority || 'medium',
      deadline:         deadline || null,
      status:           'active',
      accepted:         null,      // null = pending, true = accepted, false = declined
      accepted_note:    null,
      accepted_by:      null,
      progress:         0,
      outcome:          null,      // null | 'success' | 'failed'
      outcome_note:     null,
      outcome_by:       null,
      last_updated_by:  callsign,
    }

    const { data, error } = await supabase
      .from('informants')
      .insert([{
        code:       refCode,
        name:       title,
        gang:       '__directive__',
        notes:      callsign,      // issued_by callsign
        handler:    session.badge, // badge of creator
        status:     'active',
        task:       JSON.stringify(payload),
        is_deleted: false,
      }])
      .select()
      .single()

    if (error) throw error

    return res.status(201).json({ success: true, data: { ...data, _directive: payload } })
  }

  // ── PUT: Update directive ─────────────────────────────────
  if (req.method === 'PUT') {
    const { id, ...updates } = req.body
    if (!id) return res.status(400).json({ error: 'ID is required.' })

    // Fetch current row
    const { data: existing, error: fetchErr } = await supabase
      .from('informants')
      .select('*')
      .eq('id', id)
      .eq('gang', '__directive__')
      .single()

    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Directive not found.' })
    }

    const currentPayload = safeParseJson(existing.task) || {}
    const callsign       = await getUserCallsign(supabase, session.badge)

    // Merge the incoming update fields into the existing payload
    const updatedPayload = {
      ...currentPayload,
      ...pickDirectiveFields(updates),
      last_updated_by: callsign,
    }

    // Allow updating top-level name/title too
    const rowUpdates = { task: JSON.stringify(updatedPayload) }
    if (updates.title) rowUpdates.name = updates.title

    // Sync row-level status if outcome changes
    if (updatedPayload.outcome === 'success' || updatedPayload.outcome === 'failed') {
      rowUpdates.status = updatedPayload.outcome
    }

    const { data, error } = await supabase
      .from('informants')
      .update(rowUpdates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return res.status(200).json({ success: true, data: { ...data, _directive: updatedPayload } })
  }

  // ── DELETE: Soft delete directive ─────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'ID is required.' })

    const { error } = await supabase
      .from('informants')
      .update({ is_deleted: true, deleted_by: session.badge, deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('gang', '__directive__')

    if (error) throw error

    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── Helpers ───────────────────────────────────────────────────
function safeParseJson(str) {
  try { return JSON.parse(str) } catch { return {} }
}

// Only allow known directive payload fields through PUT
function pickDirectiveFields(obj) {
  const allowed = [
    'description', 'priority', 'deadline', 'status',
    'accepted', 'accepted_note', 'accepted_by',
    'progress',
    'outcome', 'outcome_note', 'outcome_by',
  ]
  const out = {}
  for (const k of allowed) {
    if (k in obj) out[k] = obj[k]
  }
  return out
}
