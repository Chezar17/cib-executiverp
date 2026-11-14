// ============================================================
//  CIB NEXUS — Detective Case Board (kanban) API
//  Rides inside api/reports.js (Vercel Hobby: 12-function limit).
//  Every request is /api/reports?board=<action>
//
//  GET    ?board=cases              → all cases on the board
//  GET    ?board=case&id=<uuid>     → one case + comments/activity
//  GET    ?board=people             → detectives that can be assigned
//  POST   ?board=cases              → create a case
//  PUT    ?board=case&id=<uuid>     → update any fields (partial)
//  DELETE ?board=case&id=<uuid>     → delete (creator or Top Secret)
//  POST   ?board=comment&id=<uuid>  → add a comment to a case
//  DELETE ?board=comment&id=<uuid>  → delete own comment (id = comment id)
//
//  Tables: cb_cases, cb_case_activity  (docs/sql/case-board.sql)
// ============================================================
import { allowMethods } from './http.js'
import { requireSession } from './session.js'
import { getSupabaseService } from './supabase.js'
import { jsonApiError } from './api-error.js'

export const CB_STATUSES = ['todo', 'in_progress', 'in_review', 'blocker', 'completed']
export const CB_PRIORITIES = ['low', 'medium', 'high', 'critical']
export const CB_DIVISIONS = ['CID', 'GRD', 'JOINT']

const STATUS_LABEL = {
  todo: 'To Do', in_progress: 'In Progress', in_review: 'In Review',
  blocker: 'Blocker', completed: 'Completed',
}
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }

const CASE_COLUMNS =
  'id,case_no,title,description,status,priority,division,tags,assignees,checklist,' +
  'start_date,due_date,linked_report_id,linked_report_number,sort_order,comment_count,' +
  'created_by,created_by_name,created_at,updated_by,updated_at,completed_at'

const LIMITS = { title: 200, description: 20000, tag: 30, tags: 12, checklist: 60, checkText: 300, comment: 5000, assignees: 20 }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ── Small helpers ─────────────────────────────────────────────
function cleanText(v, max) {
  if (v == null) return ''
  return String(v).replace(/\u0000/g, '').trim().slice(0, max)
}
function cleanDate(v) {
  if (v == null || v === '') return null
  const s = String(v).slice(0, 10)
  return DATE_RE.test(s) && !isNaN(Date.parse(s)) ? s : undefined // undefined = invalid
}
function cleanTags(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const t of v) {
    const s = cleanText(t, LIMITS.tag)
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s)
    if (out.length >= LIMITS.tags) break
  }
  return out
}
function cleanChecklist(v) {
  if (!Array.isArray(v)) return []
  return v.slice(0, LIMITS.checklist).map((it, i) => ({
    id: cleanText(it?.id, 40) || `c${Date.now().toString(36)}${i}`,
    text: cleanText(it?.text, LIMITS.checkText),
    done: !!it?.done,
  })).filter((it) => it.text)
}
function sameList(a, b) {
  const x = [...(a || [])].sort().join('\u0001')
  const y = [...(b || [])].sort().join('\u0001')
  return x === y
}
function caseCode(no) {
  return 'CASE-' + String(no || 0).padStart(4, '0')
}

function dbError(res, err, message, context) {
  const msg = String(err?.message || '')
  let hint
  if (err?.code === '42P01' || /relation .* does not exist|Could not find the table/i.test(msg)) {
    hint = 'The Case Board tables are missing. Run docs/sql/case-board.sql in the Supabase SQL Editor.'
  } else if (err?.code === '42501' || /row-level security/i.test(msg)) {
    hint = 'Set SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables, then redeploy.'
  }
  return jsonApiError(res, 500, message, { supabase: err, context, hint })
}

async function logEvents(sb, caseId, session, lines) {
  if (!lines.length) return
  const rows = lines.map((body) => ({
    case_id: caseId, kind: 'event',
    actor_badge: session.badge, actor_name: session.name || session.badge,
    body,
  }))
  await sb.from('cb_case_activity').insert(rows)
}

/** Keep only badges that belong to real users. Returns { badges, names } */
async function validAssignees(sb, list) {
  const wanted = [...new Set((Array.isArray(list) ? list : []).map((b) => cleanText(b, 40)).filter(Boolean))]
    .slice(0, LIMITS.assignees)
  if (!wanted.length) return { badges: [], names: {} }
  const { data, error } = await sb.from('users').select('badge,name').in('badge', wanted)
  if (error) throw error
  const names = {}
  ;(data || []).forEach((u) => { names[u.badge] = u.name || u.badge })
  return { badges: wanted.filter((b) => names[b]), names }
}

async function lookupReport(sb, id) {
  if (!id) return { id: null, number: null }
  const { data } = await sb
    .from('investigation_reports')
    .select('id,case_number')
    .eq('id', id)
    .eq('is_deleted', false)
    .maybeSingle()
  if (!data) return null
  return { id: String(data.id), number: data.case_number || null }
}

async function nameMap(sb, badges) {
  const uniq = [...new Set(badges.filter(Boolean))]
  if (!uniq.length) return {}
  const { data } = await sb.from('users').select('badge,name').in('badge', uniq)
  const m = {}
  ;(data || []).forEach((u) => { m[u.badge] = u.name || u.badge })
  return m
}

// ── Main entry ────────────────────────────────────────────────
export async function handleCaseBoard(req, res) {
  try {
    if (!allowMethods(req, res, ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])) return
    if (req.method === 'OPTIONS') { res.status(204).end(); return }

    const session = await requireSession(req, res)
    if (!session) return

    const sb = getSupabaseService()
    const action = String(req.query?.board || '')
    const id = String(req.query?.id || '')
    const body = req.body && typeof req.body === 'object' ? req.body : {}

    if ((action === 'case' || action === 'comment') && !UUID_RE.test(id)) {
      return res.status(400).json({ error: 'Missing or invalid id' })
    }

    // ── GET people ──────────────────────────────────────────
    if (action === 'people' && req.method === 'GET') {
      const { data, error } = await sb
        .from('users').select('badge,name,rank,division')
        .order('name', { ascending: true }).limit(500)
      if (error) return dbError(res, error, 'Failed to load detectives', 'caseboard people')
      return res.status(200).json({ people: data || [] })
    }

    // ── GET all cases ───────────────────────────────────────
    if (action === 'cases' && req.method === 'GET') {
      const { data, error } = await sb
        .from('cb_cases').select(CASE_COLUMNS)
        .eq('is_deleted', false)
        .order('sort_order', { ascending: true })
        .limit(2000)
      if (error) return dbError(res, error, 'Failed to load the case board', 'caseboard list')
      return res.status(200).json({ cases: data || [] })
    }

    // ── POST create case ────────────────────────────────────
    if (action === 'cases' && req.method === 'POST') {
      const title = cleanText(body.title, LIMITS.title)
      if (!title) return res.status(400).json({ error: 'Case title is required' })

      const status = CB_STATUSES.includes(body.status) ? body.status : 'todo'
      const priority = CB_PRIORITIES.includes(body.priority) ? body.priority : 'medium'
      const division = CB_DIVISIONS.includes(body.division) ? body.division : 'CID'
      const start_date = cleanDate(body.start_date)
      const due_date = cleanDate(body.due_date)
      if (start_date === undefined || due_date === undefined) {
        return res.status(400).json({ error: 'Dates must look like YYYY-MM-DD' })
      }
      if (start_date && due_date && due_date < start_date) {
        return res.status(400).json({ error: 'Due date cannot be before the start date' })
      }

      const { badges } = await validAssignees(sb, body.assignees)

      let report = { id: null, number: null }
      if (body.linked_report_id) {
        report = await lookupReport(sb, cleanText(body.linked_report_id, 64))
        if (!report) return res.status(400).json({ error: 'Linked investigation report not found' })
      }

      // Put the new card at the bottom of its column
      const { data: last } = await sb
        .from('cb_cases').select('sort_order')
        .eq('is_deleted', false).eq('status', status)
        .order('sort_order', { ascending: false }).limit(1)
      const sort_order = ((last && last[0]?.sort_order) || 0) + 1024

      const now = new Date().toISOString()
      const row = {
        title,
        description: cleanText(body.description, LIMITS.description),
        status, priority, division,
        tags: cleanTags(body.tags),
        assignees: badges,
        checklist: cleanChecklist(body.checklist),
        start_date, due_date,
        linked_report_id: report.id,
        linked_report_number: report.number,
        sort_order,
        created_by: session.badge,
        created_by_name: session.name || session.badge,
        updated_by: session.badge,
        updated_at: now,
        completed_at: status === 'completed' ? now : null,
      }
      const { data, error } = await sb.from('cb_cases').insert(row).select(CASE_COLUMNS).single()
      if (error) return dbError(res, error, 'Failed to create case', 'caseboard create')

      await logEvents(sb, data.id, session, [`created this case in ${STATUS_LABEL[status]}`])
      return res.status(201).json({ case: data })
    }

    // ── GET one case + activity ─────────────────────────────
    if (action === 'case' && req.method === 'GET') {
      const { data: c, error } = await sb
        .from('cb_cases').select(CASE_COLUMNS)
        .eq('id', id).eq('is_deleted', false).maybeSingle()
      if (error) return dbError(res, error, 'Failed to load case', 'caseboard get')
      if (!c) return res.status(404).json({ error: 'Case not found' })

      const { data: act, error: aErr } = await sb
        .from('cb_case_activity')
        .select('id,kind,actor_badge,actor_name,body,created_at')
        .eq('case_id', id).eq('is_deleted', false)
        .order('created_at', { ascending: true }).limit(1000)
      if (aErr) return dbError(res, aErr, 'Failed to load case activity', 'caseboard activity')
      return res.status(200).json({ case: c, activity: act || [] })
    }

    // ── PUT update case (only fields that are sent) ─────────
    if (action === 'case' && req.method === 'PUT') {
      const { data: old, error: oErr } = await sb
        .from('cb_cases').select(CASE_COLUMNS)
        .eq('id', id).eq('is_deleted', false).maybeSingle()
      if (oErr) return dbError(res, oErr, 'Failed to load case', 'caseboard put load')
      if (!old) return res.status(404).json({ error: 'Case not found' })

      const has = (k) => Object.prototype.hasOwnProperty.call(body, k)
      const patch = {}
      const events = []

      if (has('title')) {
        const t = cleanText(body.title, LIMITS.title)
        if (!t) return res.status(400).json({ error: 'Case title cannot be empty' })
        if (t !== old.title) { patch.title = t; events.push(`renamed the case to "${t}"`) }
      }
      if (has('description')) {
        const d = cleanText(body.description, LIMITS.description)
        if (d !== (old.description || '')) { patch.description = d; events.push('updated the description') }
      }
      if (has('status')) {
        if (!CB_STATUSES.includes(body.status)) return res.status(400).json({ error: 'Invalid status' })
        if (body.status !== old.status) {
          patch.status = body.status
          patch.completed_at = body.status === 'completed' ? new Date().toISOString() : null
          events.push(`changed status from ${STATUS_LABEL[old.status]} to ${STATUS_LABEL[body.status]}`)
        }
      }
      if (has('sort_order')) {
        const n = Number(body.sort_order)
        if (Number.isFinite(n)) patch.sort_order = n
      }
      if (has('priority')) {
        if (!CB_PRIORITIES.includes(body.priority)) return res.status(400).json({ error: 'Invalid priority' })
        if (body.priority !== old.priority) {
          patch.priority = body.priority
          events.push(`set priority to ${PRIORITY_LABEL[body.priority]}`)
        }
      }
      if (has('division')) {
        if (!CB_DIVISIONS.includes(body.division)) return res.status(400).json({ error: 'Invalid division' })
        if (body.division !== old.division) { patch.division = body.division; events.push(`moved the case to ${body.division}`) }
      }
      if (has('tags')) {
        const t = cleanTags(body.tags)
        if (!sameList(t, old.tags)) { patch.tags = t; events.push(t.length ? `set tags: ${t.join(', ')}` : 'removed all tags') }
      }
      if (has('assignees')) {
        const { badges, names } = await validAssignees(sb, body.assignees)
        if (!sameList(badges, old.assignees)) {
          patch.assignees = badges
          const added = badges.filter((b) => !(old.assignees || []).includes(b))
          const removed = (old.assignees || []).filter((b) => !badges.includes(b))
          const oldNames = removed.length ? await nameMap(sb, removed) : {}
          if (added.length) events.push(`assigned ${added.map((b) => names[b] || b).join(', ')}`)
          if (removed.length) events.push(`unassigned ${removed.map((b) => oldNames[b] || b).join(', ')}`)
        }
      }
      if (has('start_date') || has('due_date')) {
        const s = has('start_date') ? cleanDate(body.start_date) : old.start_date
        const d = has('due_date') ? cleanDate(body.due_date) : old.due_date
        if (s === undefined || d === undefined) return res.status(400).json({ error: 'Dates must look like YYYY-MM-DD' })
        if (s && d && d < s) return res.status(400).json({ error: 'Due date cannot be before the start date' })
        if (s !== old.start_date) { patch.start_date = s; events.push(s ? `set the start date to ${s}` : 'removed the start date') }
        if (d !== old.due_date) { patch.due_date = d; events.push(d ? `set the due date to ${d}` : 'removed the due date') }
      }
      if (has('checklist')) {
        const list = cleanChecklist(body.checklist)
        const before = JSON.stringify(old.checklist || [])
        if (JSON.stringify(list) !== before) {
          patch.checklist = list
          const oldById = {}
          ;(old.checklist || []).forEach((it) => { oldById[it.id] = it })
          const ticked = list.filter((it) => oldById[it.id] && !oldById[it.id].done && it.done)
          const added = list.filter((it) => !oldById[it.id])
          if (ticked.length) events.push(`completed checklist item "${ticked.map((t) => t.text).join('", "')}"`)
          if (added.length) events.push(`added checklist item "${added.map((t) => t.text).join('", "')}"`)
          if (!ticked.length && !added.length) events.push('updated the checklist')
        }
      }
      if (has('linked_report_id')) {
        const rid = cleanText(body.linked_report_id, 64)
        if (rid !== (old.linked_report_id || '')) {
          if (!rid) {
            patch.linked_report_id = null; patch.linked_report_number = null
            events.push('removed the linked report')
          } else {
            const rep = await lookupReport(sb, rid)
            if (!rep) return res.status(400).json({ error: 'Linked investigation report not found' })
            patch.linked_report_id = rep.id; patch.linked_report_number = rep.number
            events.push(`linked report ${rep.number || ''}`.trim())
          }
        }
      }

      if (!Object.keys(patch).length) return res.status(200).json({ case: old })

      patch.updated_by = session.badge
      patch.updated_at = new Date().toISOString()
      const { data, error } = await sb
        .from('cb_cases').update(patch).eq('id', id).select(CASE_COLUMNS).single()
      if (error) return dbError(res, error, 'Failed to update case', 'caseboard update')

      await logEvents(sb, id, session, events)
      return res.status(200).json({ case: data })
    }

    // ── DELETE case ─────────────────────────────────────────
    if (action === 'case' && req.method === 'DELETE') {
      const { data: old } = await sb
        .from('cb_cases').select('id,created_by').eq('id', id).eq('is_deleted', false).maybeSingle()
      if (!old) return res.status(404).json({ error: 'Case not found' })
      if (old.created_by !== session.badge && session.classification !== 'top_secret') {
        return res.status(403).json({ error: 'Only the detective who created this case or Top Secret clearance can delete it' })
      }
      const { error } = await sb
        .from('cb_cases')
        .update({ is_deleted: true, updated_by: session.badge, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) return dbError(res, error, 'Failed to delete case', 'caseboard delete')
      return res.status(200).json({ ok: true })
    }

    // ── POST comment ────────────────────────────────────────
    if (action === 'comment' && req.method === 'POST') {
      const text = cleanText(body.body, LIMITS.comment)
      if (!text) return res.status(400).json({ error: 'Comment cannot be empty' })
      const { data: c } = await sb
        .from('cb_cases').select('id,comment_count').eq('id', id).eq('is_deleted', false).maybeSingle()
      if (!c) return res.status(404).json({ error: 'Case not found' })

      const { data, error } = await sb
        .from('cb_case_activity')
        .insert({ case_id: id, kind: 'comment', actor_badge: session.badge, actor_name: session.name || session.badge, body: text })
        .select('id,kind,actor_badge,actor_name,body,created_at').single()
      if (error) return dbError(res, error, 'Failed to add comment', 'caseboard comment')

      await sb.from('cb_cases').update({ comment_count: (c.comment_count || 0) + 1 }).eq('id', id)
      return res.status(201).json({ comment: data })
    }

    // ── DELETE own comment (id = comment id) ────────────────
    if (action === 'comment' && req.method === 'DELETE') {
      const { data: cm } = await sb
        .from('cb_case_activity').select('id,case_id,kind,actor_badge')
        .eq('id', id).eq('is_deleted', false).maybeSingle()
      if (!cm || cm.kind !== 'comment') return res.status(404).json({ error: 'Comment not found' })
      if (cm.actor_badge !== session.badge) return res.status(403).json({ error: 'You can only delete your own comments' })

      const { error } = await sb.from('cb_case_activity').update({ is_deleted: true }).eq('id', id)
      if (error) return dbError(res, error, 'Failed to delete comment', 'caseboard comment delete')
      const { data: c } = await sb.from('cb_cases').select('comment_count').eq('id', cm.case_id).maybeSingle()
      if (c) await sb.from('cb_cases').update({ comment_count: Math.max(0, (c.comment_count || 0) - 1) }).eq('id', cm.case_id)
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Unknown case board action' })
  } catch (e) {
    return jsonApiError(res, 500, e?.message || 'Unexpected error in case board', {
      cause: e, context: 'caseboard handler',
    })
  }
}

export { caseCode }
