// ============================================================
//  CIB — Vercel Serverless CRUD for Press Releases
//  File location: api/press-releases.js
//
//  Handles all 4 operations:
//  GET    /api/press-releases           → fetch all active press releases
//  POST   /api/press-releases           → create new press release
//  PUT    /api/press-releases           → update existing press release
//  DELETE /api/press-releases?id=xxx    → soft-delete press release
//
//  Supabase tables: press_releases, press_audit_log
//
//  ── Supabase table DDL (run once in Supabase SQL editor) ──
//
//  CREATE TABLE press_releases (
//    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//    pr_number        TEXT NOT NULL,               -- e.g. PR-2026-005
//    headline_type    TEXT NOT NULL DEFAULT 'sub', -- 'main' | 'sub'
//    news_type        TEXT NOT NULL,               -- 'Official Statement' | 'Public Advisory' | etc.
//    title            TEXT NOT NULL,
//    body             TEXT NOT NULL,
//    news_maker       TEXT NOT NULL,               -- name of person making the news
//    event_date       DATE NOT NULL,               -- date event occurred
//    release_date     DATE NOT NULL,               -- date news was released
//    release_time     TEXT,                        -- e.g. "06:00 HRS"
//    photo_url        TEXT,                        -- Supabase Storage or external URL
//    photo_caption    TEXT,
//    division_tag     TEXT,                        -- e.g. "CID" | "GRD" | "PAO"
//    slug             TEXT UNIQUE NOT NULL,        -- URL-friendly unique ID for direct links
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
//    action         TEXT NOT NULL,   -- 'CREATE' | 'UPDATE' | 'DELETE'
//    performed_by   TEXT,
//    changes        JSONB,
//    reason         TEXT,
//    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
//  );
//
//  -- Auto-update updated_at
//  CREATE OR REPLACE FUNCTION update_pr_updated_at()
//  RETURNS TRIGGER AS $$
//  BEGIN NEW.updated_at = now(); RETURN NEW; END;
//  $$ language 'plpgsql';
//
//  CREATE TRIGGER trg_pr_updated_at
//    BEFORE UPDATE ON press_releases
//    FOR EACH ROW EXECUTE PROCEDURE update_pr_updated_at();
//
//  ── Supabase Storage (for press photos) ────────────────────
//  Create a public bucket named: press-photos
//  Run: UPDATE storage.buckets SET public = true WHERE name = 'press-photos';
// ============================================================

import { allowMethods } from './_lib/http.js'
import { requireSession } from './_lib/session.js'
import { getSupabase }    from './_lib/supabase.js'

const PHOTO_BUCKET = 'press-photos'
const TABLE        = 'press_releases'
const AUDIT_TABLE  = 'press_audit_log'

// ── Allowed classifications for write access ─────────────────
const WRITE_CLEARANCES = ['top_secret', 'secret']

function getActor(req, session) {
  return req.headers['x-actor'] || req.body?.performed_by || session?.badge || 'Unknown'
}

// ── Generate a URL-safe slug from title + timestamp ──────────
function generateSlug(title) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return base + '-' + Date.now().toString(36)
}

// ── Upload base64 photo to Supabase Storage ───────────────────
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

async function writeAuditLog(supabase, { pr_id, pr_number, action, performed_by, changes, reason }) {
  try {
    await supabase.from(AUDIT_TABLE).insert([{
      pr_id, pr_number, action,
      performed_by: performed_by || 'Unknown',
      changes:      changes      || null,
      reason:       reason       || null,
    }])
  } catch (err) {
    console.error('Audit log write failed:', err)
  }
}

function computeDiff(oldRec, newRec) {
  const fields = ['title','body','news_type','news_maker','event_date','release_date','headline_type','photo_url','photo_caption','division_tag']
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

  // GET is public (Page_Press.html reads it without auth)
  // All writes require secret+ clearance
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

  try {

    // ── GET: fetch all active press releases ──────────────────
    if (req.method === 'GET') {
      const { slug } = req.query

      // Optional: fetch single release by slug (for direct share links)
      if (slug) {
        const { data, error } = await supabase
          .from(TABLE)
          .select('*')
          .eq('slug', slug)
          .eq('is_deleted', false)
          .single()
        if (error) return res.status(404).json({ error: 'Not found' })
        return res.status(200).json({ success: true, data })
      }

      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('is_deleted', false)
        .order('release_date', { ascending: false })
        .order('created_at',   { ascending: false })

      if (error) throw error
      return res.status(200).json({ success: true, data })
    }

    // Session required for all writes — re-read from header
    const session = await requireSession(req, res)
    if (!session) return
    const actor = getActor(req, session)

    // ── POST: create new press release ────────────────────────
    if (req.method === 'POST') {
      const {
        pr_number, headline_type, news_type, title, body,
        news_maker, event_date, release_date, release_time,
        photo_url_direct, photo_base64,
        photo_caption, division_tag
      } = req.body

      if (!title)       return res.status(400).json({ error: 'Title is required' })
      if (!body)        return res.status(400).json({ error: 'Body is required' })
      if (!pr_number)   return res.status(400).json({ error: 'PR number is required' })
      if (!news_maker)  return res.status(400).json({ error: 'News maker is required' })
      if (!event_date)  return res.status(400).json({ error: 'Event date is required' })
      if (!release_date)return res.status(400).json({ error: 'Release date is required' })

      // Photo: prefer uploaded base64, fall back to direct URL
      const photo_url = photo_base64
        ? await uploadPhoto(supabase, photo_base64, null)
        : (photo_url_direct || null)

      const slug = generateSlug(title)

      const { data, error } = await supabase
        .from(TABLE)
        .insert([{
          pr_number, headline_type: headline_type || 'sub',
          news_type: news_type || 'Official Statement',
          title, body, news_maker,
          event_date, release_date, release_time,
          photo_url, photo_caption, division_tag,
          slug, created_by: actor
        }])
        .select()
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        pr_id: data.id, pr_number: data.pr_number,
        action: 'CREATE', performed_by: actor,
      })

      return res.status(201).json({ success: true, data })
    }

    // ── PUT: update existing press release ────────────────────
    if (req.method === 'PUT') {
      const {
        id, pr_number, headline_type, news_type, title, body,
        news_maker, event_date, release_date, release_time,
        photo_url_direct, photo_base64,
        photo_caption, division_tag
      } = req.body

      if (!id) return res.status(400).json({ error: 'ID is required for update' })

      const { data: oldData } = await supabase.from(TABLE).select('*').eq('id', id).single()

      const photo_url = photo_base64
        ? await uploadPhoto(supabase, photo_base64, oldData?.photo_url)
        : (photo_url_direct || oldData?.photo_url || null)

      const payload = {
        pr_number, headline_type, news_type, title, body,
        news_maker, event_date, release_date, release_time,
        photo_url, photo_caption, division_tag
      }

      const { data, error } = await supabase
        .from(TABLE).update(payload).eq('id', id).select().single()

      if (error) throw error

      const diff = computeDiff(oldData, data)
      await writeAuditLog(supabase, {
        pr_id: data.id, pr_number: data.pr_number,
        action: 'UPDATE', performed_by: actor, changes: diff,
      })

      return res.status(200).json({ success: true, data })
    }

    // ── DELETE: soft delete ───────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query
      const { reason } = req.body || {}

      if (!id) return res.status(400).json({ error: 'ID is required for delete' })

      const { data: pr } = await supabase.from(TABLE).select('id, pr_number').eq('id', id).single()

      const { error } = await supabase.from(TABLE).update({
        is_deleted: true, deleted_by: actor,
        deleted_at: new Date().toISOString()
      }).eq('id', id)

      if (error) throw error

      await writeAuditLog(supabase, {
        pr_id: pr?.id || null, pr_number: pr?.pr_number || null,
        action: 'DELETE', performed_by: actor, reason: reason || null,
      })

      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch (err) {
    console.error('Press releases API error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
