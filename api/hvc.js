// ============================================================
//  CIB — Vercel Serverless CRUD for High Value Criminals (HVC)
//  File location: api/hvc.js
//
//  Handles all 4 operations:
//  GET    /api/hvc        → fetch all HVC records
//  POST   /api/hvc        → create new HVC record
//  PUT    /api/hvc        → update existing HVC record
//  DELETE /api/hvc?id=xxx → soft-delete HVC record + log
//
//  Supabase table: high_value_criminals
//  Audit log table: hvc_audit_log
//
//  ── Supabase table DDL (run once in Supabase SQL editor) ──
//
//  CREATE TABLE high_value_criminals (
//    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//    name            TEXT NOT NULL,
//    threat          TEXT NOT NULL DEFAULT 'high',   -- critical / high / medium / low
//    warrant_status  TEXT NOT NULL DEFAULT 'active', -- active / none / cleared
//    affiliation     TEXT,
//    location        TEXT,
//    bio             TEXT,
//    crimes          JSONB DEFAULT '[]',             -- JSON array of crime strings
//    handler         TEXT,
//    notes           TEXT,
//    photo_url       TEXT,                           -- Supabase Storage URL
//    is_deleted      BOOLEAN NOT NULL DEFAULT false,
//    deleted_by      TEXT,
//    deleted_at      TIMESTAMPTZ,
//    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
//    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
//  );
//
//  CREATE TABLE hvc_audit_log (
//    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//    hvc_id         uuid REFERENCES high_value_criminals(id) ON DELETE SET NULL,
//    hvc_name       TEXT,
//    action         TEXT NOT NULL,    -- 'CREATE' | 'UPDATE' | 'DELETE'
//    performed_by   TEXT,
//    changes        JSONB,            -- diff of changed fields on UPDATE
//    reason         TEXT,             -- required for DELETE
//    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
//  );
//
//  -- Auto-update updated_at on row change
//  CREATE OR REPLACE FUNCTION update_updated_at()
//  RETURNS TRIGGER AS $$
//  BEGIN NEW.updated_at = now(); RETURN NEW; END;
//  $$ language 'plpgsql';
//
//  CREATE TRIGGER trg_hvc_updated_at
//    BEFORE UPDATE ON high_value_criminals
//    FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
//
//  ── Supabase Storage (for photos) ──────────────────────────
//  Create a public bucket named: hvc-photos
//  Run: UPDATE storage.buckets SET public = true WHERE name = 'hvc-photos';
// ============================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL     = process.env.SUPABASE_URL
const SUPABASE_KEY     = process.env.SUPABASE_ANON_KEY
const PHOTO_BUCKET     = 'hvc-photos'
const TABLE            = 'high_value_criminals'
const AUDIT_TABLE      = 'hvc_audit_log'

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY)
}

// ── Session check ─────────────────────────────────────────────
function isAuthorized(req) {
  const token = req.headers['x-session-token']
  return !!token
}

// ── Get badge/identity from session (for audit log) ──────────
function getActor(req) {
  // The token itself is the session token; for the audit log we rely
  // on the caller passing their badge via a custom header, or fall back
  // to parsing from the token if you later embed it there.
  return req.headers['x-actor'] || req.body?.performed_by || 'Unknown'
}

// ── Upload base64 photo to Supabase Storage ───────────────────
async function uploadPhoto(supabase, base64Data, existingUrl) {
  if (!base64Data) return existingUrl || null

  try {
    // Decode base64 data URI → buffer
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/)
    if (!matches) return existingUrl || null

    const mimeType  = matches[1]           // e.g. image/jpeg
    const ext       = mimeType.split('/')[1] || 'jpg'
    const buffer    = Buffer.from(matches[2], 'base64')
    const fileName  = `hvc-${Date.now()}.${ext}`

    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(fileName, buffer, { contentType: mimeType, upsert: false })

    if (error) {
      console.error('Photo upload error:', error)
      return existingUrl || null
    }

    // Build public URL
    const { data: urlData } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(data.path)
    return urlData.publicUrl

  } catch(err) {
    console.error('Photo processing error:', err)
    return existingUrl || null
  }
}

// ── Write audit log entry ─────────────────────────────────────
async function writeAuditLog(supabase, { hvc_id, hvc_name, action, performed_by, changes, reason }) {
  try {
    await supabase.from(AUDIT_TABLE).insert([{
      hvc_id,
      hvc_name,
      action,
      performed_by: performed_by || 'Unknown',
      changes:      changes      || null,
      reason:       reason       || null,
    }])
  } catch(err) {
    // Audit log failure should never crash the main operation
    console.error('Audit log write failed:', err)
  }
}

// ── Compute field diff for UPDATE audit ──────────────────────
function computeDiff(oldRecord, newRecord) {
  const diff = {}
  const auditFields = ['name','threat','warrant_status','affiliation','location','bio','crimes','handler','notes']
  auditFields.forEach(field => {
    const oldVal = JSON.stringify(oldRecord?.[field] ?? null)
    const newVal = JSON.stringify(newRecord?.[field]  ?? null)
    if (oldVal !== newVal) {
      diff[field] = { from: oldRecord?.[field] ?? null, to: newRecord?.[field] ?? null }
    }
  })
  return Object.keys(diff).length ? diff : null
}

// ══════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getSupabase()
  const actor    = getActor(req)

  try {

    // ── GET: Load all active HVC records ─────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('is_deleted', false)
        .order('threat', { ascending: true })   // critical first via alphabetical; adjust if needed
        .order('name',   { ascending: true })

      if (error) throw error
      return res.status(200).json({ success: true, data })
    }

    // ── POST: Create new HVC record ───────────────────────────
    if (req.method === 'POST') {
      const { name, threat, warrant_status, affiliation, location, bio, crimes, handler, notes, photo_base64 } = req.body

      if (!name)   return res.status(400).json({ error: 'Name is required' })
      if (!threat) return res.status(400).json({ error: 'Threat level is required' })

      // Upload photo if provided
      const photo_url = await uploadPhoto(supabase, photo_base64, null)

      // Parse crimes — accept both JSON strings and raw arrays
      let crimesJson = '[]'
      try {
        crimesJson = Array.isArray(crimes)
          ? JSON.stringify(crimes)
          : JSON.stringify(JSON.parse(crimes || '[]'))
      } catch(e) { crimesJson = '[]' }

      const { data, error } = await supabase
        .from(TABLE)
        .insert([{ name, threat, warrant_status: warrant_status||'active', affiliation, location, bio, crimes: crimesJson, handler, notes, photo_url }])
        .select()
        .single()

      if (error) throw error

      // Audit log
      await writeAuditLog(supabase, {
        hvc_id:       data.id,
        hvc_name:     data.name,
        action:       'CREATE',
        performed_by: actor,
      })

      return res.status(201).json({ success: true, data })
    }

    // ── PUT: Update existing HVC record ──────────────────────
    if (req.method === 'PUT') {
      const { id, name, threat, warrant_status, affiliation, location, bio, crimes, handler, notes, photo_base64 } = req.body

      if (!id) return res.status(400).json({ error: 'ID is required for update' })

      // Fetch old record for diff
      const { data: oldData } = await supabase.from(TABLE).select('*').eq('id', id).single()

      // Upload new photo only if a new base64 was submitted
      const photo_url = await uploadPhoto(supabase, photo_base64, oldData?.photo_url)

      let crimesJson
      try {
        crimesJson = Array.isArray(crimes)
          ? JSON.stringify(crimes)
          : JSON.stringify(JSON.parse(crimes || '[]'))
      } catch(e) { crimesJson = oldData?.crimes || '[]' }

      const updatePayload = { name, threat, warrant_status: warrant_status||'active', affiliation, location, bio, crimes: crimesJson, handler, notes, photo_url }

      const { data, error } = await supabase
        .from(TABLE)
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      // Audit log with diff
      const diff = computeDiff(oldData, data)
      await writeAuditLog(supabase, {
        hvc_id:       data.id,
        hvc_name:     data.name,
        action:       'UPDATE',
        performed_by: actor,
        changes:      diff,
      })

      return res.status(200).json({ success: true, data })
    }

    // ── DELETE: Soft delete + audit log ──────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query
      const { reason } = req.body || {}

      if (!id) return res.status(400).json({ error: 'ID is required for delete' })

      // Fetch record before marking deleted (for audit)
      const { data: hvc } = await supabase
        .from(TABLE)
        .select('id, name')
        .eq('id', id)
        .single()

      // Soft delete — mark the row, never remove it
      const { error: updateErr } = await supabase
        .from(TABLE)
        .update({
          is_deleted: true,
          deleted_by: actor,
          deleted_at: new Date().toISOString()
        })
        .eq('id', id)

      if (updateErr) throw updateErr

      // Audit log
      await writeAuditLog(supabase, {
        hvc_id:       hvc?.id   || null,
        hvc_name:     hvc?.name || null,
        action:       'DELETE',
        performed_by: actor,
        reason:       reason || null,
      })

      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch(err) {
    console.error('HVC API error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
