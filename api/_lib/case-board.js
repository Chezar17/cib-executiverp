// ============================================================
//  CIB NEXUS — Detective Case Board (kanban) API
//  Rides inside api/reports.js (Vercel Hobby: 12-function limit).
//  Every request is /api/reports?board=<action>
//
//  GET    ?board=cases              → all cases on the board
//  GET    ?board=case&id=<uuid>     → one case + comments/activity
//  GET    ?board=people             → detectives that can be assigned / mentioned
//  POST   ?board=cases              → create a case
//  PUT    ?board=case&id=<uuid>     → update any fields (partial)
//  DELETE ?board=case&id=<uuid>     → delete (creator or Top Secret)
//  POST   ?board=comment&id=<uuid>  → add a comment to a case
//  DELETE ?board=comment&id=<uuid>  → delete own comment (id = comment id)
//  GET    ?board=notifications      → my personal notifications (+ unread count)
//  PUT    ?board=notifications      → mark read: { id } | { case_id } | { all: true }
//
//  Mentions are stored inside text as  @[Display Name](BADGE)
//
//  Tables: cb_cases, cb_case_activity, cb_notifications
//          (docs/sql/case-board.sql + docs/sql/case-board-notifications.sql)
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

/** Status changes that are worth a notification (everything else stays quiet). */
const NOTIFY_STATUSES = ['in_review', 'blocker', 'completed']
/** When several updates are grouped, the most important kind is shown. */
const KIND_RANK = { mention: 4, assigned: 3, status: 2, comment: 1 }
const NOTIF_KEEP_DAYS = 30
const NOTIF_MAX_LINES = 6

const CASE_COLUMNS =
  'id,case_no,title,description,status,priority,division,tags,assignees,watchers,checklist,' +
  'start_date,due_date,linked_report_id,linked_report_number,sort_order,comment_count,' +
  'created_by,created_by_name,created_at,updated_by,updated_at,completed_at'
const NOTIF_COLUMNS = 'id,case_id,case_no,case_title,kind,count,lines,actor_name,is_read,created_at,updated_at'

const LIMITS = { title: 200, description: 20000, tag: 30, tags: 12, checklist: 60, checkText: 300, comment: 5000, assignees: 20 }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MENTION_RE = /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9._-]{1,40})\)/g

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

/** Badges mentioned in a piece of text */
function mentionsIn(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(MENTION_RE)) out.add(m[2])
  return out
}
function checklistMentions(list) {
  return mentionsIn((list || []).map((it) => it.text).join('\n'))
}
/** Turn @[Name](BADGE) into plain @Name (for notification previews) */
function plainText(text) {
  return String(text || '').replace(MENTION_RE, '@$1')
}
function preview(text, n = 90) {
  const s = plainText(text).replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function dbError(res, err, message, context) {
  const msg = String(err?.message || '')
  let hint
  if (err?.code === '42P01' || /relation .* does not exist|Could not find the table/i.test(msg)) {
    hint = 'A Case Board table is missing. Run docs/sql/case-board.sql and docs/sql/case-board-notifications.sql in the Supabase SQL Editor.'
  } else if (err?.code === '42703' || /column .* does not exist/i.test(msg)) {
    hint = 'The Case Board update script has not been run. Run docs/sql/case-board-notifications.sql in the Supabase SQL Editor.'
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
async function validUsers(sb, list, max = LIMITS.assignees) {
  const wanted = [...new Set((Array.isArray(list) ? list : [...(list || [])]).map((b) => cleanText(b, 40)).filter(Boolean))]
    .slice(0, max)
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

// ── Notifications ─────────────────────────────────────────────
/**
 * Collects who should hear about what during ONE request, then writes
 * at most one notification row per person (grouped with any unread one
 * for the same case). The person doing the action is never notified.
 */
function makeOutbox(actorBadge) {
  const box = new Map() // badge → [{ kind, text }]
  return {
    add(badges, kind, text) {
      for (const b of badges) {
        if (!b || b === actorBadge) continue
        const list = box.get(b) || []
        // a mention/assignment already covers a plain comment/status line for the same person
        if (kind === 'comment' && list.some((x) => x.kind === 'mention')) continue
        if (kind === 'mention' && list.some((x) => x.kind === 'comment')) {
          box.set(b, list.filter((x) => x.kind !== 'comment'))
        }
        ;(box.get(b) || box.set(b, []).get(b)).push({ kind, text })
      }
    },
    entries() { return [...box.entries()].filter(([, l]) => l.length) },
  }
}

async function flushOutbox(sb, outbox, c, session) {
  const now = new Date().toISOString()
  for (const [badge, items] of outbox.entries()) {
    try {
      const kind = items.reduce((k, it) => (KIND_RANK[it.kind] > KIND_RANK[k] ? it.kind : k), items[0].kind)
      const newLines = items.map((it) => ({ text: it.text, at: now }))
      const { data: ex } = await sb
        .from('cb_notifications').select('id,kind,count,lines')
        .eq('recipient_badge', badge).eq('case_id', c.id).eq('is_read', false)
        .maybeSingle()
      if (ex) {
        await sb.from('cb_notifications').update({
          kind: KIND_RANK[kind] > KIND_RANK[ex.kind] ? kind : ex.kind,
          count: (ex.count || 1) + items.length,
          lines: [...(ex.lines || []), ...newLines].slice(-NOTIF_MAX_LINES),
          actor_name: session.name || session.badge,
          case_no: c.case_no, case_title: c.title,
          updated_at: now,
        }).eq('id', ex.id)
      } else {
        await sb.from('cb_notifications').insert({
          recipient_badge: badge, case_id: c.id, case_no: c.case_no, case_title: c.title,
          kind, count: items.length, lines: newLines,
          actor_name: session.name || session.badge,
          is_read: false, created_at: now, updated_at: now,
        })
      }
    } catch (e) {
      // A notification problem must never block the actual case update
      console.error('[caseboard] notification failed for', badge, e?.message || e)
    }
  }
}

/** Everyone who follows a case: creator + assignees + people mentioned in it */
function caseTeam(c) {
  return [...new Set([c.created_by, ...(c.assignees || []), ...(c.watchers || [])].filter(Boolean))]
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
    const actorName = session.name || session.badge

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

    // ── Notifications ───────────────────────────────────────
    if (action === 'notifications' && req.method === 'GET') {
      const cutoff = new Date(Date.now() - NOTIF_KEEP_DAYS * 864e5).toISOString()
      await sb.from('cb_notifications').delete().eq('recipient_badge', session.badge).lt('updated_at', cutoff)
      const { data, error } = await sb
        .from('cb_notifications').select(NOTIF_COLUMNS)
        .eq('recipient_badge', session.badge)
        .order('updated_at', { ascending: false }).limit(40)
      if (error) return dbError(res, error, 'Failed to load notifications', 'caseboard notifications')
      const list = data || []
      return res.status(200).json({ notifications: list, unread: list.filter((n) => !n.is_read).length })
    }
    if (action === 'notifications' && req.method === 'PUT') {
      let q = sb.from('cb_notifications').update({ is_read: true })
        .eq('recipient_badge', session.badge).eq('is_read', false)
      if (body.all === true) { /* all of mine */ }
      else if (UUID_RE.test(String(body.id || ''))) q = q.eq('id', String(body.id))
      else if (UUID_RE.test(String(body.case_id || ''))) q = q.eq('case_id', String(body.case_id))
      else return res.status(400).json({ error: 'Send id, case_id or all:true' })
      const { error } = await q
      if (error) return dbError(res, error, 'Failed to update notifications', 'caseboard notifications read')
      return res.status(200).json({ ok: true })
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

      const { badges } = await validUsers(sb, body.assignees)
      const description = cleanText(body.description, LIMITS.description)
      const checklist = cleanChecklist(body.checklist)
      const descMent = await validUsers(sb, mentionsIn(description), 50)
      const checkMent = await validUsers(sb, checklistMentions(checklist), 50)

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
        title, description, status, priority, division,
        tags: cleanTags(body.tags),
        assignees: badges,
        watchers: [...new Set([...descMent.badges, ...checkMent.badges])],
        checklist,
        start_date, due_date,
        linked_report_id: report.id,
        linked_report_number: report.number,
        sort_order,
        created_by: session.badge,
        created_by_name: actorName,
        updated_by: session.badge,
        updated_at: now,
        completed_at: status === 'completed' ? now : null,
      }
      const { data, error } = await sb.from('cb_cases').insert(row).select(CASE_COLUMNS).single()
      if (error) return dbError(res, error, 'Failed to create case', 'caseboard create')

      const events = [`created this case in ${STATUS_LABEL[status]}`]
      const allMent = { ...descMent.names, ...checkMent.names }
      const mentionedOthers = Object.keys(allMent).filter((b) => b !== session.badge)
      if (mentionedOthers.length) events.push(`mentioned ${mentionedOthers.map((b) => allMent[b]).join(', ')}`)
      await logEvents(sb, data.id, session, events)

      const out = makeOutbox(session.badge)
      out.add(badges, 'assigned', `${actorName} assigned you to this case`)
      out.add(descMent.badges, 'mention', `${actorName} mentioned you in the case notes`)
      out.add(checkMent.badges, 'mention', `${actorName} mentioned you in the checklist`)
      await flushOutbox(sb, out, data, session)

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
      const out = makeOutbox(session.badge)
      const newWatchers = new Set(old.watchers || [])
      let statusNote = null
      let addedAssignees = []

      if (has('title')) {
        const t = cleanText(body.title, LIMITS.title)
        if (!t) return res.status(400).json({ error: 'Case title cannot be empty' })
        if (t !== old.title) { patch.title = t; events.push(`renamed the case to "${t}"`) }
      }
      if (has('description')) {
        const d = cleanText(body.description, LIMITS.description)
        if (d !== (old.description || '')) {
          patch.description = d
          events.push('updated the case notes')
          const before = mentionsIn(old.description)
          const fresh = [...mentionsIn(d)].filter((b) => !before.has(b))
          const { badges, names } = await validUsers(sb, fresh, 50)
          if (badges.length) {
            badges.forEach((b) => newWatchers.add(b))
            const others = badges.filter((b) => b !== session.badge)
            if (others.length) events.push(`mentioned ${others.map((b) => names[b]).join(', ')} in the case notes`)
            out.add(badges, 'mention', `${actorName} mentioned you in the case notes`)
          }
        }
      }
      if (has('status')) {
        if (!CB_STATUSES.includes(body.status)) return res.status(400).json({ error: 'Invalid status' })
        if (body.status !== old.status) {
          patch.status = body.status
          patch.completed_at = body.status === 'completed' ? new Date().toISOString() : null
          events.push(`changed status from ${STATUS_LABEL[old.status]} to ${STATUS_LABEL[body.status]}`)
          if (NOTIFY_STATUSES.includes(body.status)) statusNote = `${actorName} moved it to ${STATUS_LABEL[body.status]}`
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
        const { badges, names } = await validUsers(sb, body.assignees)
        if (!sameList(badges, old.assignees)) {
          patch.assignees = badges
          addedAssignees = badges.filter((b) => !(old.assignees || []).includes(b))
          const removed = (old.assignees || []).filter((b) => !badges.includes(b))
          const oldNames = removed.length ? await nameMap(sb, removed) : {}
          if (addedAssignees.length) events.push(`assigned ${addedAssignees.map((b) => names[b] || b).join(', ')}`)
          if (removed.length) events.push(`unassigned ${removed.map((b) => oldNames[b] || b).join(', ')}`)
          out.add(addedAssignees, 'assigned', `${actorName} assigned you to this case`)
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
        if (JSON.stringify(list) !== JSON.stringify(old.checklist || [])) {
          patch.checklist = list
          const oldById = {}
          ;(old.checklist || []).forEach((it) => { oldById[it.id] = it })
          const ticked = list.filter((it) => oldById[it.id] && !oldById[it.id].done && it.done)
          const added = list.filter((it) => !oldById[it.id])
          if (ticked.length) events.push(`completed checklist item "${ticked.map((t) => plainText(t.text)).join('", "')}"`)
          if (added.length) events.push(`added checklist item "${added.map((t) => plainText(t.text)).join('", "')}"`)
          if (!ticked.length && !added.length) events.push('updated the checklist')

          const before = checklistMentions(old.checklist)
          const fresh = [...checklistMentions(list)].filter((b) => !before.has(b))
          const { badges } = await validUsers(sb, fresh, 50)
          if (badges.length) {
            badges.forEach((b) => newWatchers.add(b))
            out.add(badges, 'mention', `${actorName} mentioned you in the checklist`)
          }
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

      if (!sameList([...newWatchers], old.watchers)) patch.watchers = [...newWatchers]
      patch.updated_by = session.badge
      patch.updated_at = new Date().toISOString()
      const { data, error } = await sb
        .from('cb_cases').update(patch).eq('id', id).select(CASE_COLUMNS).single()
      if (error) return dbError(res, error, 'Failed to update case', 'caseboard update')

      await logEvents(sb, id, session, events)
      if (statusNote) out.add(caseTeam(data).filter((b) => !addedAssignees.includes(b)), 'status', statusNote)
      await flushOutbox(sb, out, data, session)
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
      await sb.from('cb_notifications').update({ is_read: true }).eq('case_id', id).eq('is_read', false)
      return res.status(200).json({ ok: true })
    }

    // ── POST comment ────────────────────────────────────────
    if (action === 'comment' && req.method === 'POST') {
      const text = cleanText(body.body, LIMITS.comment)
      if (!text) return res.status(400).json({ error: 'Comment cannot be empty' })
      const { data: c } = await sb
        .from('cb_cases').select(CASE_COLUMNS).eq('id', id).eq('is_deleted', false).maybeSingle()
      if (!c) return res.status(404).json({ error: 'Case not found' })

      const { data, error } = await sb
        .from('cb_case_activity')
        .insert({ case_id: id, kind: 'comment', actor_badge: session.badge, actor_name: actorName, body: text })
        .select('id,kind,actor_badge,actor_name,body,created_at').single()
      if (error) return dbError(res, error, 'Failed to add comment', 'caseboard comment')

      const { badges: mentioned } = await validUsers(sb, mentionsIn(text), 50)
      const watchers = [...new Set([...(c.watchers || []), ...mentioned])]
      const casePatch = { comment_count: (c.comment_count || 0) + 1 }
      if (!sameList(watchers, c.watchers)) casePatch.watchers = watchers
      await sb.from('cb_cases').update(casePatch).eq('id', id)

      const out = makeOutbox(session.badge)
      out.add(mentioned, 'mention', `${actorName} mentioned you: "${preview(text)}"`)
      out.add(caseTeam(c), 'comment', `${actorName} commented: "${preview(text)}"`)
      await flushOutbox(sb, out, c, session)
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
