// ============================================================
//  CIB – Investigation Reports API (single record)
//  GET    /api/reports/[id] → full report with all sub-items
//  PUT    /api/reports/[id] → full update (replaces sub-items)
//  DELETE /api/reports/[id] → soft-delete (is_deleted)
// ============================================================
import { allowMethods }   from '../_lib/http.js'
import { requireSession } from '../_lib/session.js'
import { getSupabase }    from '../_lib/supabase.js'
import { insertSubItems } from '../reports.js'
import { jsonApiError } from '../_lib/api-error.js'

const SUB_TABLES = ['ir_victims','ir_suspects','ir_witnesses','ir_evidences','ir_debrief_entries']

function actorFrom(req, session) {
  return req.headers['x-actor'] || session.badge || null
}

export default async function handler(req, res) {
  try {
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

      if (error || !report) {
        return jsonApiError(res, 404, 'Report not found or deleted', {
          supabase: error || undefined,
          context: 'reports/[id] GET main',
        })
      }

      const [victims, suspects, witnesses, evidences, debrief] = await Promise.all([
        supabase.from('ir_victims').select('*').eq('report_id', id).eq('is_deleted', false).order('sort_order'),
        supabase.from('ir_suspects').select('*').eq('report_id', id).eq('is_deleted', false).order('sort_order'),
        supabase.from('ir_witnesses').select('*').eq('report_id', id).eq('is_deleted', false).order('sort_order'),
        supabase.from('ir_evidences').select('*').eq('report_id', id).eq('is_deleted', false).order('sort_order'),
        supabase.from('ir_debrief_entries').select('*').eq('report_id', id).eq('is_deleted', false).order('sort_order'),
      ])

      const subErrors = [victims, suspects, witnesses, evidences, debrief]
        .map((x, i) => (x.error ? { table: ['ir_victims','ir_suspects','ir_witnesses','ir_evidences','ir_debrief_entries'][i], error: x.error } : null))
        .filter(Boolean)
      if (subErrors.length) {
        return jsonApiError(res, 500, 'Failed to load related rows for this report', {
          cause: new Error(JSON.stringify(subErrors.map((s) => s.error.message))),
          context: 'reports/[id] GET sub-items',
          supabase: subErrors[0].error,
        })
      }

      return res.status(200).json({
        report: {
          ...report,
          victims:          victims.data    || [],
          suspects:         suspects.data   || [],
          witnesses:        witnesses.data  || [],
          evidences:        evidences.data  || [],
          debrief_entries:  debrief.data    || [],
        },
      })
    }

    // ── PUT update ───────────────────────────────────────────
    if (req.method === 'PUT') {
      const { victims = [], suspects = [], witnesses = [],
            evidences = [], debrief_entries = [], ...main } = req.body || {}

      const {
        id: _id,
        case_number,
        created_at,
        updated_at,
        modified_at: _modified_at,
        modified_by: _modified_by_client,
        is_deleted,
        created_by,
        deleted_at,
        deleted_by,
        ...updateFields
      } = main

      const now = new Date().toISOString()
      const actor = actorFrom(req, session)

      const { error: upErr } = await supabase
        .from('investigation_reports')
        .update({
          ...updateFields,
          updated_at: now,
          modified_at: now,
          modified_by: actor,
        })
        .eq('id', id)
        .eq('is_deleted', false)

      if (upErr) {
        return jsonApiError(res, 500, 'Failed to update investigation report', {
          supabase: upErr,
          context: 'reports/[id] PUT main',
        })
      }

      const deleteResults = await Promise.all(SUB_TABLES.map((t) =>
        supabase.from(t).delete().eq('report_id', id),
      ))
      const badDel = deleteResults.find((r) => r?.error)
      if (badDel?.error) {
        return jsonApiError(res, 500, 'Failed to clear old related rows before save', {
          supabase: badDel.error,
          context: 'reports/[id] PUT delete sub-items',
        })
      }

      try {
        await insertSubItems(
          supabase,
          id,
          { victims, suspects, witnesses, evidences, debrief_entries },
          actor,
        )
      } catch (e) {
        return jsonApiError(res, 500, e?.message || 'Failed to insert related rows after update', {
          cause: e,
          context: 'reports/[id] PUT insertSubItems',
          ...(e?.supabase && { supabase: e.supabase }),
        })
      }

      return res.status(200).json({ success: true })
    }

    // ── DELETE soft-delete ───────────────────────────────────
    if (req.method === 'DELETE') {
      const actor = actorFrom(req, session) || 'Unknown'
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('investigation_reports')
        .update({
          is_deleted: true,
          deleted_by: actor,
          deleted_at: now,
          modified_at: now,
          modified_by: actor,
        })
        .eq('id', id)
        .eq('is_deleted', false)

      if (error) {
        return jsonApiError(res, 500, 'Failed to soft-delete report', {
          supabase: error,
          context: 'reports/[id] DELETE',
        })
      }
      return res.status(200).json({ success: true })
    }
  } catch (e) {
    return jsonApiError(res, 500, e?.message || 'Unexpected error in reports/[id] handler', {
      cause: e,
      context: 'reports/[id] handler',
    })
  }
}
