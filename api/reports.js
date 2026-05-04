// ============================================================
//  CIB – Investigation Reports API
//  GET  /api/reports       → list all reports (summary rows)
//  POST /api/reports       → create new report + all sub-items
// ============================================================
import { allowMethods }   from './_lib/http.js'
import { requireSession } from './_lib/session.js'
import { getSupabase }    from './_lib/supabase.js'
import { getNextCaseNumber } from './_lib/ir-case-number.js'
import { jsonApiError } from './_lib/api-error.js'

function actorFrom(req, session) {
  return req.headers['x-actor'] || session.badge || null
}

/** Server-owned audit fields for ir_* child rows (never trust client). */
function irSubRowAudit(actor) {
  const now = new Date().toISOString()
  return {
    created_by: actor,
    modified_at: now,
    modified_by: actor,
    updated_at: now,
    is_deleted: false,
  }
}

export default async function handler(req, res) {
  try {
    if (!allowMethods(req, res, ['GET', 'POST', 'OPTIONS'])) return
    const session = await requireSession(req, res)
    if (!session) return

    const supabase = getSupabase()

    // ── GET: next case number (preview for new form) ─────────
    if (req.method === 'GET' && (req.query?.nextCaseNumber === '1' || req.query?.next === '1')) {
      try {
        const next_case_number = await getNextCaseNumber(supabase)
        return res.status(200).json({ next_case_number })
      } catch (e) {
        return jsonApiError(res, 500, e?.message || 'Next case number failed', {
          cause: e,
          context: 'reports GET nextCaseNumber',
        })
      }
    }

    // ── GET: list reports ────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('investigation_reports')
        .select(
          'id,case_number,case_title,category,offense_type,date_of_offense,case_status,lead_investigators,created_at,created_by,updated_at,modified_at,modified_by,is_deleted',
        )
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })

      if (error) {
        return jsonApiError(res, 500, 'Failed to list investigation reports', {
          supabase: error,
          context: 'reports GET list',
        })
      }
      return res.status(200).json({ reports: data || [] })
    }

    // ── POST: create new report ──────────────────────────────
    if (req.method === 'POST') {
      const {
        victims = [], suspects = [], witnesses = [],
        evidences = [], debrief_entries = [],
        ...main
      } = req.body || {}

      const nextCase = await getNextCaseNumber(supabase)
      const actor = actorFrom(req, session)
      const nowIso = new Date().toISOString()
      const row = {
      case_number:              nextCase,
      case_title:               main.case_title               || null,
      category:                 main.category                 || 'A',
      offense_type:             main.offense_type             || null,
      mdw_incident_number:      main.mdw_incident_number      || null,
      building_number:          main.building_number          || null,
      address:                  main.address                  || null,
      bureau_name:              main.bureau_name              || 'CID',
      agency_code:              main.agency_code              || null,
      specific_location:        main.specific_location        || null,
      location_code:            main.location_code            || null,
      date_of_offense:          main.date_of_offense          || null,
      time_of_offense:          main.time_of_offense          || null,
      day_of_offense:           main.day_of_offense           || null,
      date_reported:            main.date_reported            || null,
      day_reported:             main.day_reported             || null,
      jurisdiction_lspd:        !!main.jurisdiction_lspd,
      jurisdiction_sast:        !!main.jurisdiction_sast,
      jurisdiction_lscs:        !!main.jurisdiction_lscs,
      jurisdiction_state:       !!main.jurisdiction_state,
      lead_investigators:       main.lead_investigators       || null,
      prosecutor:               main.prosecutor               || null,
      prosecutor_time_start:    main.prosecutor_time_start    || null,
      prosecutor_time_end:      main.prosecutor_time_end      || null,
      suspect_status:           main.suspect_status           || null,
      suspect_disposition:      main.suspect_disposition      || null,
      suspect_notes:            main.suspect_notes            || null,
      closure_summary:          main.closure_summary          || null,
      closure_forensic:         main.closure_forensic         || null,
      closure_suspect_id:       main.closure_suspect_id       || null,
      closure_final_disposition:main.closure_final_disposition|| null,
      closure_time_received:    main.closure_time_received    || null,
      closure_time_arrived:     main.closure_time_arrived     || null,
      closure_type:             main.closure_type             || 'CID',
      closure_detective_name:   main.closure_detective_name   || null,
      closure_date:             main.closure_date             || null,
      closure_returned_to_service: main.closure_returned_to_service || null,
      case_referred_to:         main.case_referred_to         || null,
      case_status:              main.case_status              || 'OPEN',
      prosecutor_final_name:    main.prosecutor_final_name    || null,
      prosecutor_final_occupation: main.prosecutor_final_occupation || null,
      detective_how_closed:     main.detective_how_closed     || null,
      detective_suspect_developed: !!main.detective_suspect_developed,
      detective_suspect_arrested:  !!main.detective_suspect_arrested,
      detective_entered_forensics: !!main.detective_entered_forensics,
      detective_evidence_recovered:!!main.detective_evidence_recovered,
      detective_value_of_property: main.detective_value_of_property || null,
      detective_cleared_forensics: !!main.detective_cleared_forensics,
      detective_referred_to:    main.detective_referred_to    || null,
      detective_date_referral:  main.detective_date_referral  || null,
      is_deleted:               false,
      created_by:               actor,
      modified_at:              nowIso,
      modified_by:              actor,
    }

      const { data: report, error: mainErr } = await supabase
        .from('investigation_reports')
        .insert(row)
        .select()
        .single()

      if (mainErr) {
        return jsonApiError(res, 500, 'Failed to insert investigation report', {
          supabase: mainErr,
          context: 'reports POST insert main',
        })
      }
      const reportId = report.id

      try {
        await insertSubItems(
          supabase,
          reportId,
          { victims, suspects, witnesses, evidences, debrief_entries },
          actor,
        )
      } catch (e) {
        return jsonApiError(res, 500, e?.message || 'Failed to save related rows (victims/suspects/etc.)', {
          cause: e,
          context: 'reports POST insertSubItems',
          ...(e?.supabase && { supabase: e.supabase }),
        })
      }

      return res.status(201).json({ report })
    }
  } catch (e) {
    return jsonApiError(res, 500, e?.message || 'Unexpected error in reports handler', {
      cause: e,
      context: 'reports handler',
    })
  }
}

export async function insertSubItems(
  supabase,
  reportId,
  { victims, suspects, witnesses, evidences, debrief_entries },
  actor,
) {
  const audit = irSubRowAudit(actor)
  const inserts = []

  if (victims?.length)
    inserts.push(supabase.from('ir_victims').insert(
      victims.map((v, i) => ({ ...sanitizeVictim(v), ...audit, report_id: reportId, sort_order: i })),
    ))
  if (suspects?.length)
    inserts.push(supabase.from('ir_suspects').insert(
      suspects.map((s, i) => ({ ...sanitizeSuspect(s), ...audit, report_id: reportId, sort_order: i })),
    ))
  if (witnesses?.length)
    inserts.push(supabase.from('ir_witnesses').insert(
      witnesses.map((w, i) => ({ ...sanitizeWitness(w), ...audit, report_id: reportId, sort_order: i })),
    ))
  if (evidences?.length)
    inserts.push(supabase.from('ir_evidences').insert(
      evidences.map((e, i) => ({ ...sanitizeEvidence(e), ...audit, report_id: reportId, sort_order: i })),
    ))
  if (debrief_entries?.length)
    inserts.push(supabase.from('ir_debrief_entries').insert(
      debrief_entries.map((d, i) => ({ ...sanitizeDebrief(d), ...audit, report_id: reportId, sort_order: i })),
    ))

  if (inserts.length) {
    const results = await Promise.all(inserts)
    const bad = results.find((r) => r?.error)
    if (bad?.error) {
      const err = new Error(bad.error.message || bad.error.details || 'Database rejected sub-item insert')
      err.supabase = bad.error
      throw err
    }
  }
}

/** Normalized crop { nx, ny, nw, nh } ∈ [0,1]; optional for PDF/UI framing. */
function sanitizeNormCrop(c) {
  if (!c || typeof c !== 'object') return null
  const nx = Number(c.nx)
  const ny = Number(c.ny)
  const nw = Number(c.nw)
  const nh = Number(c.nh)
  if (![nx, ny, nw, nh].every((n) => Number.isFinite(n))) return null
  if (nw < 1e-4 || nh < 1e-4 || nx < 0 || ny < 0 || nx + nw > 1.0001 || ny + nh > 1.0001) return null
  return { nx, ny, nw, nh }
}

function sanitizePortraitLandscape(val, fallback) {
  const s = String(val || '').toLowerCase()
  if (s === 'landscape' || s === 'portrait') return s
  return fallback
}

function sanitizeVictim(v) {
  return {
    id_code: v.id_code || null, full_name: v.full_name || null,
    age: v.age || null, sex: v.sex || null, race: v.race || null,
    telephone: v.telephone || null, welfare_occupation: v.welfare_occupation || null,
    notes: v.notes || null, family: v.family || null,
    autopsy_by: v.autopsy_by || null, autopsy_summary: v.autopsy_summary || null,
    photo_url: v.photo_url || null,
    photo_orientation: sanitizePortraitLandscape(v.photo_orientation, 'portrait'),
    photo_crop: sanitizeNormCrop(v.photo_crop),
  }
}
function sanitizeSuspect(s) {
  return {
    id_code: s.id_code || null, full_name: s.full_name || null,
    description: s.description || null, dob: s.dob || null,
    sex: s.sex || null, age: s.age || null, race: s.race || null,
    telephone: s.telephone || null, welfare_occupation: s.welfare_occupation || null,
    family: s.family || null, interrogation_url: s.interrogation_url || null,
    interrogation_summary: s.interrogation_summary || null,
    mugshot_url: s.mugshot_url || null,
    mugshot_orientation: sanitizePortraitLandscape(s.mugshot_orientation, 'portrait'),
    mugshot_crop: sanitizeNormCrop(s.mugshot_crop),
  }
}
function sanitizeWitness(w) {
  return {
    id_code: w.id_code || null, full_name: w.full_name || null,
    status: w.status || null, welfare: w.welfare || null,
    occupation: w.welfare_occupation ?? w.occupation ?? null,
    content: w.content || null,
  }
}
function sanitizeEvidence(e) {
  return {
    id_code: e.id_code || null, name: e.name || null,
    was_status: e.was_status ?? e.evidence_was ?? null,
    evidence_status: e.evidence_status || null,
    date_of_retrieval: e.date_of_retrieval || null,
    image_url: e.image_url || null,
    image_orientation: sanitizePortraitLandscape(e.image_orientation, 'landscape'),
    image_crop: sanitizeNormCrop(e.image_crop),
    summary: e.summary || null,
  }
}
function sanitizeDebrief(d) {
  return {
    title: d.title || null, date_of_incident: d.date_of_incident || null,
    content: d.content || null,
  }
}
