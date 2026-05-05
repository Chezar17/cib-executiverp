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
//  GET    /api/informants?type=member             → fetch all members (full_name redacted for secret)
//  POST   /api/informants?type=member             → create member     [top_secret only]
//  PUT    /api/informants?type=member             → update member     [top_secret only]
//  DELETE /api/informants?type=member&id=xxx      → delete member     [top_secret only]
//
//  GET    /api/informants?type=warmap             → fetch all map markers (secret + top_secret)
//  POST   /api/informants?type=warmap             → create marker    [secret + top_secret]
//  PUT    /api/informants?type=warmap             → update marker    [secret + top_secret]
//  DELETE /api/informants?type=warmap&id=xxx      → delete marker    [secret + top_secret]
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
//  WARMAP markers use the informants table with gang = '__warmap__'
//  Extra fields stored in task (JSON stringified):
//  {
//    x, y,                  ← position as % of map width/height (0–100)
//    marker_type,           ← 'objective'|'intel'|'staging'|'hostile'|'extraction'|'contact'
//    label,                 ← short display label
//    description,           ← detailed briefing notes
//    directive_id,          ← optional linked directive UUID
//    directive_code,        ← e.g. GIU-003 (denormalized for display)
//    added_by,              ← callsign of creator
//    color,                 ← optional override hex
//  }
//
//  DB NOTE: all types re-use the informants table — no new tables needed.
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
    const isMember    = req.query.type === 'member'
    const isWarmap    = req.query.type === 'warmap'

    if (isDirective) return handleDirective(req, res, supabase, session)
    if (isMember)    return handleMember(req, res, supabase, session)
    if (isWarmap)    return handleWarmap(req, res, supabase, session)

    // ═══════════════════════════════════════════════════════
    //  INFORMANT CRUD (unchanged from original)
    // ═══════════════════════════════════════════════════════

    // ── GET: Load informants / chat messages ─────────────────
    if (req.method === 'GET') {
      const chatId = req.query.chat

      // ?chat=directiveId → return chat messages for that directive
      if (chatId) {
        const { data, error } = await supabase
          .from('informants')
          .select('*')
          .eq('gang', `__chat__:${chatId}`)
          .eq('is_deleted', false)
          .order('code', { ascending: true }) // code = ISO timestamp
        if (error) throw error
        return res.status(200).json({ success: true, data })
      }

      // default → all non-directive, non-chat records
      const { data, error } = await supabase
        .from('informants')
        .select('*')
        .eq('is_deleted', false)
        .neq('gang', '__directive__')
        .not('gang', 'like', '__chat__%')
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


// ═══════════════════════════════════════════════════════════
//  GIU MEMBER CRUD
//  Reuses the informants table with gang = '__member__'
//  Data stored in task (JSON):
//  {
//    callsign,               ← display name / operative handle
//    full_name,              ← real name — REDACTED for secret cls
//    biography,              ← background text
//    expertise,              ← comma-separated tags
//    photo_filename,         ← e.g. "phantom.jpg" → served from /images/
//    added_by,               ← callsign of creator
//  }
//
//  Classification gate:
//    top_secret  → full CRUD + sees full_name
//    secret      → GET only, full_name is redacted
//    anything else → 403
// ═══════════════════════════════════════════════════════════
async function handleMember(req, res, supabase, session) {
  const userMeta = await getUserClassification(supabase, session.badge)
  const cls      = (userMeta.classification || '').toLowerCase()
  const isTS     = cls === TOP_SECRET

  if (cls !== TOP_SECRET && cls !== SECRET) {
    return res.status(403).json({ error: 'Insufficient clearance to access GIU member registry.' })
  }

  // ── GET: Fetch all members ────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('informants')
      .select('*')
      .eq('gang', '__member__')
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })

    if (error) throw error

    const parsed = (data || []).map(row => {
      const m = safeParseJson(row.task)
      // Redact full_name for non-top-secret users
      if (!isTS) m.full_name = null
      return { ...row, _member: m }
    })

    return res.status(200).json({ success: true, data: parsed })
  }

  // Write operations: top_secret only
  if (!isTS) {
    return res.status(403).json({ error: 'Only TOP SECRET personnel can modify GIU member records.' })
  }

  // ── POST: Create new member ───────────────────────────────
  if (req.method === 'POST') {
    const { callsign, full_name, biography, expertise, photo_filename } = req.body

    if (!callsign || !callsign.trim()) {
      return res.status(400).json({ error: 'Callsign is required.' })
    }

    const creatorCallsign = userMeta.callsign || session.badge

    const payload = {
      callsign:       callsign.trim().toUpperCase(),
      full_name:      full_name      || null,
      biography:      biography      || null,
      expertise:      expertise      || null,
      photo_filename: photo_filename || null,
      added_by:       creatorCallsign,
    }

    const { data, error } = await supabase
      .from('informants')
      .insert([{
        code:       `MBR-${Date.now()}`,   // unique code
        name:       callsign.trim().toUpperCase(),
        gang:       '__member__',
        handler:    session.badge,
        notes:      creatorCallsign,
        status:     'active',
        task:       JSON.stringify(payload),
        is_deleted: false,
      }])
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, data: { ...data, _member: payload } })
  }

  // ── PUT: Update member ────────────────────────────────────
  if (req.method === 'PUT') {
    const { id, callsign, full_name, biography, expertise, photo_filename } = req.body
    if (!id) return res.status(400).json({ error: 'ID is required.' })

    if (!callsign || !callsign.trim()) {
      return res.status(400).json({ error: 'Callsign is required.' })
    }

    // Fetch current row to merge
    const { data: existing } = await supabase
      .from('informants')
      .select('task')
      .eq('id', id)
      .eq('gang', '__member__')
      .single()

    const current = safeParseJson(existing?.task) || {}

    const updatedPayload = {
      ...current,
      callsign:       callsign.trim().toUpperCase(),
      full_name:      full_name      !== undefined ? full_name      : current.full_name,
      biography:      biography      !== undefined ? biography      : current.biography,
      expertise:      expertise      !== undefined ? expertise      : current.expertise,
      photo_filename: photo_filename !== undefined ? photo_filename : current.photo_filename,
    }

    const { data, error } = await supabase
      .from('informants')
      .update({
        name: callsign.trim().toUpperCase(),
        task: JSON.stringify(updatedPayload),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return res.status(200).json({ success: true, data: { ...data, _member: updatedPayload } })
  }

  // ── DELETE: Soft delete member ────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'ID is required.' })

    const { error } = await supabase
      .from('informants')
      .update({
        is_deleted: true,
        deleted_by: session.badge,
        deleted_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('gang', '__member__')

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


// ═══════════════════════════════════════════════════════════
//  WARMAP MARKER CRUD
//  Reuses the informants table with gang = '__warmap__'
//  Access: top_secret + secret → full CRUD
//  Data stored in task (JSON):
//  {
//    x, y,              ← position 0–100% of map
//    marker_type,       ← objective|intel|staging|hostile|extraction|contact
//    label,             ← short name shown on pin
//    description,       ← briefing notes
//    directive_id,      ← optional UUID of linked directive
//    directive_code,    ← denormalized ref e.g. GIU-003
//    added_by,          ← callsign of creator
//    phase,             ← integer phase number (1, 2, 3 …)
//  }
//
//  PHASE RULE: each phase may only contain ONE 'objective' marker.
//  POST will 400 if the requested phase already has an objective.
// ═══════════════════════════════════════════════════════════
async function handleWarmap(req, res, supabase, session) {
  const userMeta = await getUserClassification(supabase, session.badge)
  const cls      = (userMeta.classification || '').toLowerCase()
  const isTS     = cls === TOP_SECRET
  const isSecret = cls === SECRET

  // Require at least SECRET clearance
  if (!isTS && !isSecret) {
    return res.status(403).json({ error: 'Insufficient clearance to access GIU War Map.' })
  }

  // ── GET: Fetch all warmap markers ────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('informants')
      .select('*')
      .eq('gang', '__warmap__')
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })

    if (error) throw error

    const parsed = (data || []).map(row => ({
      ...row,
      _marker: safeParseJson(row.task)
    }))

    return res.status(200).json({ success: true, data: parsed })
  }

  // ── POST: Create new marker (secret + top_secret) ────────
  if (req.method === 'POST') {
    const {
      x, y, marker_type, label, description,
      directive_id, directive_code, phase
    } = req.body

    if (x === undefined || y === undefined) {
      return res.status(400).json({ error: 'Map coordinates (x, y) are required.' })
    }
    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Marker label is required.' })
    }

    const callsign = userMeta.callsign || session.badge

    // ── Phase rule: only one objective per phase ──────────────
    const phaseNum = phase ? parseInt(phase) : null
    if (phaseNum && (marker_type || 'intel') === 'objective') {
      const { data: existingPhaseMarkers } = await supabase
        .from('informants')
        .select('task')
        .eq('gang', '__warmap__')
        .eq('is_deleted', false)

      const alreadyHasObjective = (existingPhaseMarkers || []).some(row => {
        const t = safeParseJson(row.task)
        return t.phase === phaseNum && t.marker_type === 'objective'
      })
      if (alreadyHasObjective) {
        return res.status(400).json({
          error: `Phase ${phaseNum} already has an Objective marker. Each phase can only have one objective.`
        })
      }
    }

    const payload = {
      x:              parseFloat(x),
      y:              parseFloat(y),
      marker_type:    marker_type    || 'intel',
      label:          label.trim(),
      description:    description    || null,
      directive_id:   directive_id   || null,
      directive_code: directive_code || null,
      added_by:       callsign,
      phase:          phaseNum,
    }

    const { data, error } = await supabase
      .from('informants')
      .insert([{
        code:       `WM-${Date.now()}`,
        name:       label.trim(),
        gang:       '__warmap__',
        handler:    session.badge,
        notes:      callsign,
        status:     'active',
        task:       JSON.stringify(payload),
        is_deleted: false,
      }])
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, data: { ...data, _marker: payload } })
  }

  // ── PUT: Update marker ────────────────────────────────────
  if (req.method === 'PUT') {
    const { id, x, y, marker_type, label, description, directive_id, directive_code, phase } = req.body
    if (!id) return res.status(400).json({ error: 'ID is required.' })

    const { data: existing } = await supabase
      .from('informants')
      .select('task')
      .eq('id', id)
      .eq('gang', '__warmap__')
      .single()

    const current = safeParseJson(existing?.task) || {}

    const updatedPayload = {
      ...current,
      ...(x              !== undefined ? { x: parseFloat(x) }       : {}),
      ...(y              !== undefined ? { y: parseFloat(y) }       : {}),
      ...(marker_type    !== undefined ? { marker_type }            : {}),
      ...(label          !== undefined ? { label: label.trim() }    : {}),
      ...(description    !== undefined ? { description }            : {}),
      ...(directive_id   !== undefined ? { directive_id }           : {}),
      ...(directive_code !== undefined ? { directive_code }         : {}),
      ...(phase          !== undefined ? { phase: phase !== null ? parseInt(phase) : null } : {}),
    }

    const rowUpdates = { task: JSON.stringify(updatedPayload) }
    if (label) rowUpdates.name = label.trim()

    const { data, error } = await supabase
      .from('informants')
      .update(rowUpdates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return res.status(200).json({ success: true, data: { ...data, _marker: updatedPayload } })
  }

  // ── DELETE: Soft delete marker ────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'ID is required.' })

    const { error } = await supabase
      .from('informants')
      .update({
        is_deleted: true,
        deleted_by: session.badge,
        deleted_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('gang', '__warmap__')

    if (error) throw error
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
