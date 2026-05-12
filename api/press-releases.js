// ============================================================
//  CIB — Vercel Serverless CRUD
//  File location: api/press-releases.js
//
//  Handles TWO resource types via a `type` query-param:
//
//    ?type=press  (default) — Press Releases
//    ?type=wanted           — Most Wanted entries
//
//  Press Releases:
//  GET    /api/press-releases              → all active press releases
//  POST   /api/press-releases              → create press release
//  PUT    /api/press-releases              → update press release
//  DELETE /api/press-releases?id=xxx       → soft-delete press release
//
//  Wanted List:
//  GET    /api/press-releases?type=wanted            → all active wanted entries
//  GET    /api/press-releases?type=wanted&id=xxx     → single wanted entry
//  POST   /api/press-releases?type=wanted            → create wanted entry
//  PUT    /api/press-releases?type=wanted            → update wanted entry
//  DELETE /api/press-releases?type=wanted&id=xxx     → soft-delete wanted entry
//
//  Supabase tables: press_releases, press_audit_log, wanted_list, wanted_audit_log
//
//  ── Supabase table DDL (run once in Supabase SQL editor) ──
//
//  -- PRESS RELEASES (unchanged)
//  CREATE TABLE press_releases (
//    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//    pr_number        TEXT NOT NULL,
//    headline_type    TEXT NOT NULL DEFAULT 'sub',
//    news_type        TEXT NOT NULL,
//    title            TEXT NOT NULL,
//    body             TEXT NOT NULL,
//    news_maker       TEXT NOT NULL,
//    event_date       DATE NOT NULL,
//    release_date     DATE NOT NULL,
//    release_time     TEXT,
//    photo_url        TEXT,
//    photo_caption    TEXT,
//    division_tag     TEXT,
//    slug             TEXT UNIQUE NOT NULL,
//    is_deleted       BOOLEAN NOT NULL DEFAULT false,
//    deleted_by       TEXT,
//    deleted_at       TIMESTAMPTZ,
//    created_by       TEXT,
//    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
//    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
//  );
//
//  CREATE TABLE press_audit_log (
//    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//    pr_id          uuid REFERENCES press_releases(id) ON DELETE SET NULL,
//    pr_number      TEXT,
//    action         TEXT NOT NULL,
//    performed_by   TEXT,
//    changes        JSONB,
//    reason         TEXT,
//    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
//  );
//
//  -- WANTED LIST (new table)
//  CREATE TABLE wanted_list (
//    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//    case_number       TEXT NOT NULL UNIQUE,        -- e.g. CIB-MW-2026-003
//    alias             TEXT,                        -- AKA / nickname
//    full_name         TEXT NOT NULL,               -- display name / charge label
//    suspect_id        TEXT,                        -- e.g. SS-01
//    dob               TEXT,                        -- free text, e.g. "Unknown" or "Jan 12 1985"
//    nationality       TEXT,
//    threat_level      TEXT NOT NULL DEFAULT 'high', -- critical | high | medium | low
//    bounty_amount     TEXT,                        -- e.g. "$10,000"
//    bounty_note       TEXT,                        -- e.g. "Dead or Alive · Authorized by CIB Director"
//    last_known_loc    TEXT,
//    affiliation       TEXT,
//    status            TEXT NOT NULL DEFAULT 'at_large', -- at_large | in_custody | deceased | cleared
//    debrief           TEXT,
//    charges           TEXT[],                      -- array of charge strings
//    detective_initials TEXT,
//    detective_name    TEXT,
//    detective_rank    TEXT,
//    detective_division TEXT,
//    photo_url         TEXT,
//    photo_caption     TEXT,
//    wanted_since      DATE,
//    is_deleted        BOOLEAN NOT NULL DEFAULT false,
//    deleted_by        TEXT,
//    deleted_at        TIMESTAMPTZ,
//    created_by        TEXT,
//    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
//    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
//  );
//
//  CREATE TABLE wanted_audit_log (
//    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//    wanted_id      uuid REFERENCES wanted_list(id) ON DELETE SET NULL,
//    case_number    TEXT,
//    action         TEXT NOT NULL,
//    performed_by   TEXT,
//    changes        JSONB,
//    reason         TEXT,
//    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
//  );
//
//  -- Auto-update triggers
//  CREATE OR REPLACE FUNCTION update_updated_at_column()
//  RETURNS TRIGGER AS $$
//  BEGIN NEW.updated_at = now(); RETURN NEW; END;
//  $$ language 'plpgsql';
//
//  CREATE TRIGGER trg_pr_updated_at
//    BEFORE UPDATE ON press_releases
//    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
//
//  CREATE TRIGGER trg_wanted_updated_at
//    BEFORE UPDATE ON wanted_list
//    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
//
//  -- Supabase Storage bucket for photos
//  Create a public bucket named: press-photos
//  UPDATE storage.buckets SET public = true WHERE name = 'press-photos';
// ============================================================

import { allowMethods } from './_lib/http.js'
import { requireSession } from './_lib/session.js'
import { getSupabase }    from './_lib/supabase.js'

const PHOTO_BUCKET  = 'press-photos'
const PR_TABLE      = 'press_releases'
const PR_AUDIT      = 'press_audit_log'
const MW_TABLE      = 'wanted_list'
const MW_AUDIT      = 'wanted_audit_log'

const WRITE_CLEARANCES = ['top_secret', 'secret']

function getActor(req, session) {
  return req.headers['x-actor'] || req.body?.performed_by || session?.badge || 'Unknown'
}

function generateSlug(title) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return base + '-' + Date.now().toString(36)
}

async function uploadPhoto(supabase, base64Data, existingUrl) {
  if (!base64Data) return existingUrl || null
  try {
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/)
    if (!matches) return existingUrl || null
    const mimeType = matches[1]
    const ext      = mimeType.split('/')[1] || 'jpg'
    const buffer   = Buffer.from(matches[2], 'base64')
    const fileName = `pr-${Date.now()}.${ext}`
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

async function writePrAudit(supabase, { pr_id, pr_number, action, performed_by, changes, reason }) {
  try {
    await supabase.from(PR_AUDIT).insert([{
      pr_id, pr_number, action,
      performed_by: performed_by || 'Unknown',
      changes: changes || null,
      reason:  reason  || null,
    }])
  } catch (err) { console.error('PR audit log write failed:', err) }
}

async function writeMwAudit(supabase, { wanted_id, case_number, action, performed_by, changes, reason }) {
  try {
    await supabase.from(MW_AUDIT).insert([{
      wanted_id, case_number, action,
      performed_by: performed_by || 'Unknown',
      changes: changes || null,
      reason:  reason  || null,
    }])
  } catch (err) { console.error('Wanted audit log write failed:', err) }
}

function computeDiff(oldRec, newRec, fields) {
  const diff = {}
  fields.forEach(f => {
    const o = JSON.stringify(oldRec?.[f] ?? null)
    const n = JSON.stringify(newRec?.[f]  ?? null)
    if (o !== n) diff[f] = { from: oldRec?.[f] ?? null, to: newRec?.[f] ?? null }
  })
  return Object.keys(diff).length ? diff : null
}

// ══════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {

  const resourceType = (req.query.type || 'press').toLowerCase()

  // GET is always public; writes need clearance
  if (req.method !== 'GET') {
    const session = await requireSession(req, res)
    if (!session) return
    const cls = (session.classification || '').toLowerCase()
    if (!WRITE_CLEARANCES.includes(cls)) {
      return res.status(403).json({ error: 'Insufficient clearance. Secret or Top Secret required.' })
    }
  }

  if (!allowMethods(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return

  const supabase = getSupabase()

  // ── Route to the correct sub-handler ─────────────────────────
  try {
    if (resourceType === 'wanted') {
      return await handleWanted(req, res, supabase)
    } else {
      return await handlePressReleases(req, res, supabase)
    }
  } catch (err) {
    console.error('API error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

// ══════════════════════════════════════════════════════════════
//  PRESS RELEASES handler (unchanged logic)
// ══════════════════════════════════════════════════════════════
async function handlePressReleases(req, res, supabase) {

  // GET
  if (req.method === 'GET') {
    const { slug } = req.query
    if (slug) {
      const { data, error } = await supabase
        .from(PR_TABLE).select('*').eq('slug', slug).eq('is_deleted', false).single()
      if (error) return res.status(404).json({ error: 'Not found' })
      return res.status(200).json({ success: true, data })
    }
    const { data, error } = await supabase
      .from(PR_TABLE).select('*').eq('is_deleted', false)
      .order('release_date', { ascending: false })
      .order('created_at',   { ascending: false })
    if (error) throw error
    return res.status(200).json({ success: true, data })
  }

  const session = await requireSession(req, res)
  if (!session) return
  const actor = getActor(req, session)

  // POST
  if (req.method === 'POST') {
    const {
      pr_number, headline_type, news_type, title, body,
      news_maker, event_date, release_date, release_time,
      photo_url_direct, photo_base64, photo_caption, division_tag
    } = req.body

    if (!title)        return res.status(400).json({ error: 'Title is required' })
    if (!body)         return res.status(400).json({ error: 'Body is required' })
    if (!pr_number)    return res.status(400).json({ error: 'PR number is required' })
    if (!news_maker)   return res.status(400).json({ error: 'News maker is required' })
    if (!event_date)   return res.status(400).json({ error: 'Event date is required' })
    if (!release_date) return res.status(400).json({ error: 'Release date is required' })

    const photo_url = photo_base64
      ? await uploadPhoto(supabase, photo_base64, null)
      : (photo_url_direct || null)
    const slug = generateSlug(title)

    const { data, error } = await supabase.from(PR_TABLE).insert([{
      pr_number, headline_type: headline_type || 'sub',
      news_type: news_type || 'Official Statement',
      title, body, news_maker,
      event_date, release_date, release_time,
      photo_url, photo_caption, division_tag,
      slug, created_by: actor
    }]).select().single()

    if (error) throw error
    await writePrAudit(supabase, { pr_id: data.id, pr_number: data.pr_number, action: 'CREATE', performed_by: actor })
    return res.status(201).json({ success: true, data })
  }

  // PUT
  if (req.method === 'PUT') {
    const {
      id, pr_number, headline_type, news_type, title, body,
      news_maker, event_date, release_date, release_time,
      photo_url_direct, photo_base64, photo_caption, division_tag
    } = req.body

    if (!id) return res.status(400).json({ error: 'ID is required for update' })
    const { data: oldData } = await supabase.from(PR_TABLE).select('*').eq('id', id).single()
    const photo_url = photo_base64
      ? await uploadPhoto(supabase, photo_base64, oldData?.photo_url)
      : (photo_url_direct || oldData?.photo_url || null)

    const payload = { pr_number, headline_type, news_type, title, body, news_maker, event_date, release_date, release_time, photo_url, photo_caption, division_tag }
    const { data, error } = await supabase.from(PR_TABLE).update(payload).eq('id', id).select().single()
    if (error) throw error

    const prFields = ['title','body','news_type','news_maker','event_date','release_date','headline_type','photo_url','photo_caption','division_tag']
    const diff = computeDiff(oldData, data, prFields)
    await writePrAudit(supabase, { pr_id: data.id, pr_number: data.pr_number, action: 'UPDATE', performed_by: actor, changes: diff })
    return res.status(200).json({ success: true, data })
  }

  // DELETE
  if (req.method === 'DELETE') {
    const { id } = req.query
    const { reason } = req.body || {}
    if (!id) return res.status(400).json({ error: 'ID is required for delete' })
    const { data: pr } = await supabase.from(PR_TABLE).select('id, pr_number').eq('id', id).single()
    const { error } = await supabase.from(PR_TABLE).update({
      is_deleted: true, deleted_by: actor, deleted_at: new Date().toISOString()
    }).eq('id', id)
    if (error) throw error
    await writePrAudit(supabase, { pr_id: pr?.id, pr_number: pr?.pr_number, action: 'DELETE', performed_by: actor, reason: reason || null })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ══════════════════════════════════════════════════════════════
//  WANTED LIST handler
// ══════════════════════════════════════════════════════════════
async function handleWanted(req, res, supabase) {

  // GET — public
  if (req.method === 'GET') {
    const { id } = req.query
    if (id) {
      const { data, error } = await supabase
        .from(MW_TABLE).select('*').eq('id', id).eq('is_deleted', false).single()
      if (error) return res.status(404).json({ error: 'Not found' })
      return res.status(200).json({ success: true, data })
    }
    const { data, error } = await supabase
      .from(MW_TABLE).select('*').eq('is_deleted', false)
      .order('wanted_since', { ascending: false })
      .order('created_at',   { ascending: false })
    if (error) throw error
    return res.status(200).json({ success: true, data })
  }

  const session = await requireSession(req, res)
  if (!session) return
  const actor = getActor(req, session)

  // POST — create
  if (req.method === 'POST') {
    const {
      case_number, alias, full_name, suspect_id, dob, nationality,
      threat_level, bounty_amount, bounty_note,
      last_known_loc, affiliation, status,
      debrief, charges,
      detective_initials, detective_name, detective_rank, detective_division,
      photo_url_direct, photo_base64, photo_caption, wanted_since
    } = req.body

    if (!case_number) return res.status(400).json({ error: 'Case number is required' })
    if (!full_name)   return res.status(400).json({ error: 'Name / charge label is required' })

    const photo_url = photo_base64
      ? await uploadPhoto(supabase, photo_base64, null)
      : (photo_url_direct || null)

    const { data, error } = await supabase.from(MW_TABLE).insert([{
      case_number, alias, full_name, suspect_id, dob, nationality,
      threat_level: threat_level || 'high',
      bounty_amount, bounty_note,
      last_known_loc, affiliation,
      status: status || 'at_large',
      debrief,
      charges: charges || [],
      detective_initials, detective_name, detective_rank, detective_division,
      photo_url, photo_caption,
      wanted_since: wanted_since || new Date().toISOString().split('T')[0],
      created_by: actor
    }]).select().single()

    if (error) throw error
    await writeMwAudit(supabase, { wanted_id: data.id, case_number: data.case_number, action: 'CREATE', performed_by: actor })
    return res.status(201).json({ success: true, data })
  }

  // PUT — update
  if (req.method === 'PUT') {
    const {
      id, case_number, alias, full_name, suspect_id, dob, nationality,
      threat_level, bounty_amount, bounty_note,
      last_known_loc, affiliation, status,
      debrief, charges,
      detective_initials, detective_name, detective_rank, detective_division,
      photo_url_direct, photo_base64, photo_caption, wanted_since
    } = req.body

    if (!id) return res.status(400).json({ error: 'ID is required for update' })

    const { data: oldData } = await supabase.from(MW_TABLE).select('*').eq('id', id).single()
    const photo_url = photo_base64
      ? await uploadPhoto(supabase, photo_base64, oldData?.photo_url)
      : (photo_url_direct || oldData?.photo_url || null)

    const payload = {
      case_number, alias, full_name, suspect_id, dob, nationality,
      threat_level, bounty_amount, bounty_note,
      last_known_loc, affiliation, status,
      debrief, charges: charges || [],
      detective_initials, detective_name, detective_rank, detective_division,
      photo_url, photo_caption, wanted_since
    }

    const { data, error } = await supabase.from(MW_TABLE).update(payload).eq('id', id).select().single()
    if (error) throw error

    const mwFields = ['full_name','alias','threat_level','bounty_amount','status','last_known_loc','affiliation','debrief','charges','photo_url']
    const diff = computeDiff(oldData, data, mwFields)
    await writeMwAudit(supabase, { wanted_id: data.id, case_number: data.case_number, action: 'UPDATE', performed_by: actor, changes: diff })
    return res.status(200).json({ success: true, data })
  }

  // DELETE — soft
  if (req.method === 'DELETE') {
    const { id } = req.query
    const { reason } = req.body || {}
    if (!id) return res.status(400).json({ error: 'ID is required for delete' })
    const { data: entry } = await supabase.from(MW_TABLE).select('id, case_number').eq('id', id).single()
    const { error } = await supabase.from(MW_TABLE).update({
      is_deleted: true, deleted_by: actor, deleted_at: new Date().toISOString()
    }).eq('id', id)
    if (error) throw error
    await writeMwAudit(supabase, { wanted_id: entry?.id, case_number: entry?.case_number, action: 'DELETE', performed_by: actor, reason: reason || null })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
