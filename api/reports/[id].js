// ============================================================
//  CIB – Investigation Reports API (single record)
//  GET    /api/reports/[id] → full report with all sub-items
//  PUT    /api/reports/[id] → full update (replaces sub-items)
//  DELETE /api/reports/[id] → soft-delete
// ============================================================
import { allowMethods }   from '../_lib/http.js'
import { requireSession } from '../_lib/session.js'
import { getSupabase }    from '../_lib/supabase.js'
import { insertSubItems } from '../reports.js'

const SUB_TABLES = ['ir_victims','ir_suspects','ir_witnesses','ir_evidences','ir_debrief_entries']

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'PUT', 'DELETE', 'OPTIONS'])) return
  const session = await requireSession(req, res)
  if (!session) return

  const supabase = getSupabase()
  const id = req.query?.id || req.url?.split('/').pop()?.split('?')[0]
  if (!id) return res.status(400).json({ error: 'Missing report id' })

  // ── GET single ───────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: report, error } = await supabase
      .from('investigation_reports')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single()

    if (error || !report) return res.status(404).json({ error: 'Not found' })

    // Fetch all sub-items
    const [victims, suspects, witnesses, evidences, debrief] = await Promise.all([
      supabase.from('ir_victims').select('*').eq('report_id', id).order('sort_order'),
      supabase.from('ir_suspects').select('*').eq('report_id', id).order('sort_order'),
      supabase.from('ir_witnesses').select('*').eq('report_id', id).order('sort_order'),
      supabase.from('ir_evidences').select('*').eq('report_id', id).order('sort_order'),
      supabase.from('ir_debrief_entries').select('*').eq('report_id', id).order('sort_order'),
    ])

    return res.status(200).json({
      report: {
        ...report,
        victims:          victims.data    || [],
        suspects:         suspects.data   || [],
        witnesses:        witnesses.data  || [],
        evidences:        evidences.data  || [],
        debrief_entries:  debrief.data    || [],
      }
    })
  }

  // ── PUT update ───────────────────────────────────────────
  if (req.method === 'PUT') {
    const { victims = [], suspects = [], witnesses = [],
            evidences = [], debrief_entries = [], ...main } = req.body || {}

    // Remove read-only cols before update (case_number assigned at create; do not change)
    const { id: _id, case_number, created_at, updated_at, is_deleted, created_by, ...updateFields } = main

    const { error: upErr } = await supabase
      .from('investigation_reports')
      .update({ ...updateFields, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (upErr) return res.status(500).json({ error: upErr.message })

    // Replace all sub-items: delete old then insert new
    await Promise.all(SUB_TABLES.map(t =>
      supabase.from(t).delete().eq('report_id', id)
    ))
    await insertSubItems(supabase, id, { victims, suspects, witnesses, evidences, debrief_entries })

    return res.status(200).json({ success: true })
  }

  // ── DELETE soft-delete ───────────────────────────────────
  if (req.method === 'DELETE') {
    const actor = req.headers['x-actor'] || session.badge || 'Unknown'
    const { error } = await supabase
      .from('investigation_reports')
      .update({ is_deleted: true, deleted_by: actor, deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }
}
