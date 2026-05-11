// ============================================================
//  CIB — Vercel Serverless CRUD for Wanted Individuals
//  File location: api/wanted.js
//
//  GET    /api/wanted           → fetch all active wanted entries (public)
//  POST   /api/wanted           → create new entry  (secret+ only)
//  PUT    /api/wanted           → update entry       (secret+ only)
//  DELETE /api/wanted?id=xxx    → soft-delete entry  (secret+ only)
//
//  Supabase table: wanted_individuals
//
//  ── Supabase table DDL (run once in Supabase SQL editor) ──
//
//  CREATE TABLE wanted_individuals (
//    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//    case_no        TEXT NOT NULL,
//    suspect_id     TEXT,
//    wanted_since   DATE NOT NULL,
//    full_name      TEXT NOT NULL,
//    alias          TEXT,
//    dob            TEXT,
//    nationality    TEXT,
//    bounty         TEXT NOT NULL,
//    bounty_note    TEXT,
//    debrief        TEXT NOT NULL,
//    last_location  TEXT,
//    affiliation    TEXT,
//    threat_level   TEXT NOT NULL DEFAULT 'critical',
//    status         TEXT NOT NULL DEFAULT 'At Large',
//    crimes         TEXT NOT NULL DEFAULT '[]',
//    det_name       TEXT,
//    det_rank       TEXT,
//    det_division   TEXT,
//    photo_url      TEXT,
//    is_deleted     BOOLEAN NOT NULL DEFAULT false,
//    deleted_by     TEXT,
//    deleted_at     TIMESTAMPTZ,
//    created_by     TEXT,
//    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
//    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
//  );
//
//  -- Reuses the trigger function already created for press_releases:
//  CREATE TRIGGER trg_wanted_updated_at
//    BEFORE UPDATE ON wanted_individuals
//    FOR EACH ROW EXECUTE PROCEDURE update_pr_updated_at();
//
//  ── Supabase Storage (for suspect photos) ──────────────────
//  Run in Supabase SQL editor:
//  INSERT INTO storage.buckets (id, name, public)
//    VALUES ('wanted-photos', 'wanted-photos', true);
// ============================================================

import { allowMethods } from './_lib/http.js'
import { requireSession } from './_lib/session.js'
import { getSupabase }    from './_lib/supabase.js'

const TABLE        = 'wanted_individuals'
const PHOTO_BUCKET = 'wanted-photos'
const WRITE_CLS    = ['top_secret', 'secret']

// ── Helpers ───────────────────────────────────────────────────

function getActor(req, session) {
  return req.headers['x-actor'] || req.body?.performed_by || session?.badge || 'Unknown'
}

async function uploadPhoto(supabase, base64Data, existingUrl) {
  if (!base64Data) return existingUrl || null
  try {
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/)
    if (!matches) return existingUrl || null

    const mimeType = matches[1]
    const ext      = mimeType.split('/')[1] || 'jpg'
    const buffer   = Buffer.from(matches[2], 'base64')
    const fileName = `wanted-${Date.now()}.${ext}`

    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(fileName, buffer, { contentType: mimeType, upsert: false })

    if (error) { console.error('Photo upload error:', error); return existingUrl || null }

    const { data: urlData } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(data.path)
    return urlData.publicUrl
  } catch (err) {
    console.error('Photo processing error:', err)
    return existingUrl || null
  }
}

// ── Main handler ──────────────────────────────────────────────

export default async function handler(req, res) {

  // Auth check for all writes
  if (req.method !== 'GET') {
    const session = await requireSession(req, res)
    if (!session) return

    const cls = (session.classification || '').toLowerCase()
    if (!WRITE_CLS.includes(cls)) {
      return res.status(403).json({ error: 'Insufficient clearance. Secret or Top Secret required.' })
    }
  }

  if (!allowMethods(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return

  const supabase = getSupabase()

  try {

    // ── GET: public — fetch all active wanted entries ─────────
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })

      if (error) throw error
      return res.status(200).json({ success: true, data })
    }

    // All writes need session + actor
    const session = await requireSession(req, res)
    if (!session) return
    const actor = getActor(req, session)

    // ── POST: create new wanted entry ─────────────────────────
    if (req.method === 'POST') {
      const {
        case_no, suspect_id, wanted_since, full_name, alias,
        dob, nationality, bounty, bounty_note, debrief,
        last_location, affiliation, threat_level, status, crimes,
        det_name, det_rank, det_division,
        photo_base64, photo_url: photo_url_direct,
      } = req.body

      if (!case_no)      return res.status(400).json({ error: 'Case number is required' })
      if (!full_name)    return res.status(400).json({ error: 'Full name is required' })
      if (!bounty)       return res.status(400).json({ error: 'Bounty is required' })
      if (!debrief)      return res.status(400).json({ error: 'Debrief is required' })
      if (!wanted_since) return res.status(400).json({ error: 'Wanted since date is required' })

      const photo_url = photo_base64
        ? await uploadPhoto(supabase, photo_base64, null)
        : (photo_url_direct || null)

      const { data, error } = await supabase
        .from(TABLE)
        .insert([{
          case_no, suspect_id, wanted_since,
          full_name, alias, dob, nationality,
          bounty, bounty_note, debrief,
          last_location, affiliation,
          threat_level:  threat_level || 'critical',
          status:        status       || 'At Large',
          crimes:        crimes       || '[]',
          det_name, det_rank, det_division,
          photo_url, created_by: actor,
        }])
        .select()
        .single()

      if (error) throw error
      return res.status(201).json({ success: true, data })
    }

    // ── PUT: update existing entry ────────────────────────────
    if (req.method === 'PUT') {
      const { id, photo_base64, photo_url: photo_url_direct, ...fields } = req.body

      if (!id) return res.status(400).json({ error: 'ID is required for update' })

      const { data: existing } = await supabase
        .from(TABLE).select('photo_url').eq('id', id).single()

      const photo_url = photo_base64
        ? await uploadPhoto(supabase, photo_base64, existing?.photo_url)
        : (photo_url_direct !== undefined ? photo_url_direct : existing?.photo_url || null)

      const { data, error } = await supabase
        .from(TABLE)
        .update({ ...fields, photo_url })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return res.status(200).json({ success: true, data })
    }

    // ── DELETE: soft delete ───────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query

      if (!id) return res.status(400).json({ error: 'ID is required for delete' })

      const { error } = await supabase
        .from(TABLE)
        .update({
          is_deleted: true,
          deleted_by: actor,
          deleted_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) throw error
      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch (err) {
    console.error('Wanted API error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
