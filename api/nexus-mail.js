// ============================================================
//  NEXUS Internal Mail API — Gmail-style (To / Cc / Bcc, multi-member threads)
//  GET  /api/nexus-mail                    → inbox
//  GET  /api/nexus-mail?thread=<uuid>      → messages + participants
//  GET  /api/nexus-mail?directory=1&q=…   → user picker
//  POST /api/nexus-mail                   → send (JSON: to[], cc[], bcc[] or recipient_badge)
//  PATCH /api/nexus-mail                  → mark thread read
//
//  DB: docs/sql/nexus-mail-gmail-migration.sql (+ docs/sql/nexus-mail-performance.sql for inbox speed)
// ============================================================

import { allowMethods } from './_lib/http.js'
import { requireSession } from './_lib/session.js'
import { SUPABASE_SERVICE_ROLE_KEY } from './_lib/config.js'
import { getSupabaseService } from './_lib/supabase.js'
import { jsonApiError } from './_lib/api-error.js'

function trimBadge(b) {
  return String(b || '').trim()
}

function badgesEquivalent(a, b) {
  const x = trimBadge(a)
  const y = trimBadge(b)
  return x.length > 0 && y.length > 0 && x.toLowerCase() === y.toLowerCase()
}

function escapeIlikeExact(term) {
  return String(term).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function isGovernmentMailHostname(host) {
  const h = String(host ?? '')
    .trim()
    .toLowerCase()
  if (!h || h.includes('@') || h.includes('..') || h.includes('/') || h.includes('\\') || h.includes(':'))
    return false
  const labels = h.split('.').filter(Boolean)
  if (labels.length < 2) return false
  for (const lbl of labels) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(lbl)) return false
  }
  return labels[labels.length - 1] === 'gov'
}

function stripGovernmentMailLocalPart(raw) {
  let s = String(raw ?? '').trim()
  if (s.indexOf('@') >= 0) {
    const dom = s.slice(s.indexOf('@') + 1)
    if (!isGovernmentMailHostname(dom)) return ''
    s = s.slice(0, s.indexOf('@')).trim()
  }
  return s
}

async function resolveUserBadge(supabase, rawInput) {
  const t = trimBadge(rawInput)
  if (!t) return null

  const { data: hit } = await supabase.from('users').select('badge').eq('badge', t).maybeSingle()

  if (hit?.badge) return hit.badge

  if (!t.includes('@')) {
    const prefix = `${escapeIlikeExact(t)}@%`
    const { data: cands } = await supabase.from('users').select('badge').ilike('badge', prefix).limit(48)
    if (cands?.length) {
      const low = t.toLowerCase()
      const matches = cands.filter(
        (r) => stripGovernmentMailLocalPart(r.badge).toLowerCase() === low,
      )
      if (matches.length === 1) return matches[0].badge
      if (matches.length > 1) return null
    }
  }

  const pat = escapeIlikeExact(t)
  const { data: rows } = await supabase.from('users').select('badge').ilike('badge', pat).limit(8)

  if (!rows?.length) return null
  const low = t.toLowerCase()
  const exactCi = rows.find((r) => r.badge.toLowerCase() === low)
  return (exactCi || rows[0]).badge
}

/** Resolve many tokens: batch exact `.in('badge')`, then fuzzy lookups in parallel. */
async function resolveUserBadgesParallel(supabase, tokens) {
  const uniq = dedupeBadges(tokens)
  if (!uniq.length) return new Map()

  /** @type {Map<string, string | null>} */
  const canonByNormalized = new Map()

  const { data: hitRows } = await supabase.from('users').select('badge').in('badge', uniq)
  const byCi = new Map()
  for (const row of hitRows || []) {
    const b = trimBadge(row?.badge)
    if (b) byCi.set(b.toLowerCase(), b)
  }

  const needResolve = dedupeBadges(uniq.filter((tok) => !byCi.has(trimBadge(tok).toLowerCase())))

  for (const tok of uniq) {
    const canon = byCi.get(trimBadge(tok).toLowerCase())
    if (canon) canonByNormalized.set(trimBadge(tok).toLowerCase(), canon)
  }

  await Promise.all(
    needResolve.map(async (tok) => {
      const canon = await resolveUserBadge(supabase, tok)
      canonByNormalized.set(trimBadge(tok).toLowerCase(), canon)
    }),
  )

  return canonByNormalized
}

function canonicalBadges(me, peer) {
  const a = trimBadge(me)
  const p = trimBadge(peer)
  if (!p || !a) return null
  if (badgesEquivalent(a, p)) return null
  return a < p ? [a, p] : [p, a]
}

function threadSortKeyMs(row) {
  let ms = Date.parse(row?.updated_at ?? '')
  if (Number.isFinite(ms)) return ms
  ms = Date.parse(row?.created_at ?? '')
  if (Number.isFinite(ms)) return ms
  return 0
}

/** Split comma/semicolon/newline-separated addresses */
function parseAddressTokens(input) {
  if (input == null) return []
  if (Array.isArray(input))
    return input.flatMap((x) => parseAddressTokens(typeof x === 'string' ? x : ''))
  const s = String(input).trim()
  if (!s) return []
  return s
    .split(/[,;\n\r]+/)
    .map((x) => trimBadge(x))
    .filter(Boolean)
}

function sanitizeImageUrl(u) {
  const s = (u ?? '').trim()
  if (!s) return null
  if (s.length > 2048) return null
  try {
    const url = new URL(s)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.toString()
  } catch (_) {
    return null
  }
}

const MAX_MAIL_ATTACHMENT_URLS = 15

function coerceJsonUrlArray(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw)
      return Array.isArray(p) ? p : []
    } catch (_) {
      return []
    }
  }
  return []
}

function normalizeStoredAttachmentUrls(row) {
  const fromDb = coerceJsonUrlArray(row?.image_urls)
  const out = []
  for (const item of fromDb) {
    const u = sanitizeImageUrl(typeof item === 'string' ? item : '')
    if (u && !out.includes(u)) out.push(u)
  }
  if (out.length) return out
  const single = sanitizeImageUrl(row?.image_url)
  return single ? [single] : []
}

function collectPostedImageUrls(bodyObj) {
  const out = []
  function pushOne(cand) {
    const s = sanitizeImageUrl(cand)
    if (!s || out.includes(s)) return
    if (out.length >= MAX_MAIL_ATTACHMENT_URLS) return
    out.push(s)
  }
  if (Array.isArray(bodyObj?.image_urls))
    for (const x of bodyObj.image_urls) pushOne(typeof x === 'string' ? x : '')
  if (typeof bodyObj?.image_url === 'string' && bodyObj.image_url.trim()) pushOne(bodyObj.image_url)
  return out
}

/** Dedupe resolved badges preserving first occurrence order */
function dedupeBadges(list) {
  const seen = new Set()
  const out = []
  for (const b of list) {
    const k = trimBadge(b).toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(trimBadge(b))
  }
  return out
}

function lastSnippet(last) {
  if (!last) return ''
  const txt = String(last.body || '')
    .replace(/<[^>]{1,240}>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (txt.length) return txt.length > 120 ? `${txt.slice(0, 120)}…` : txt
  const imgs = normalizeStoredAttachmentUrls(last)
  if (imgs.length > 1) return `[${imgs.length} images]`
  if (imgs.length === 1) return '[Image]'
  return ''
}

/** Legacy 2-party thread: infer "To" when no recipient rows */
function syntheticRecipientsLegacy(thr, msg) {
  if (!thr?.badge_low || !thr?.badge_high) return []
  const o = badgesEquivalent(msg.sender_badge, thr.badge_low) ? thr.badge_high : thr.badge_low
  return [{ recipient_badge: o, kind: 'to' }]
}

function filterRecipientsForViewer(rows, viewerMe, senderBadge, isSender) {
  if (isSender) return rows
  return rows.filter((r) => r.kind !== 'bcc')
}

async function fetchThreadsForViewer(supabase, meCanon) {
  const mePat = escapeIlikeExact(trimBadge(meCanon))

  const { data: mems, error: eMem } = await supabase
    .from('nx_mail_thread_members')
    .select('thread_id')
    .ilike('member_badge', mePat)
    .limit(500)

  if (eMem || !(mems ?? []).length) {
    if (eMem) return { error: eMem, rows: [] }
    /** table missing (migration not run) — fall back to legacy dyad */
    const cols = 'id,badge_low,badge_high,subject,updated_at,created_at'
    const [partLow, partHigh] = await Promise.all([
      supabase.from('nx_mail_threads').select(cols).ilike('badge_low', mePat).limit(500),
      supabase.from('nx_mail_threads').select(cols).ilike('badge_high', mePat).limit(500),
    ])
    if (partLow.error) return { error: partLow.error, rows: [] }
    if (partHigh.error) return { error: partHigh.error, rows: [] }
    const merged = new Map()
    ;(partLow.data || []).forEach((r) => merged.set(r.id, r))
    ;(partHigh.data || []).forEach((r) => merged.set(r.id, r))
    return { error: null, rows: Array.from(merged.values()) }
  }

  const threadIds = [...new Set(mems.map((m) => m.thread_id))]
  const { data: rows, error: eRows } = await supabase
    .from('nx_mail_threads')
    .select('id,badge_low,badge_high,subject,updated_at,created_at')
    .in('id', threadIds)

  if (eRows) return { error: eRows, rows: [] }
  return { error: null, rows: rows || [] }
}

/**
 * Fallback when Postgres RPC `nx_mail_inbox_agg` is not deployed: loads every message (slow).
 * @returns { Promise<{ error: unknown|null, lastMap: Record<string, unknown>, unreadCounts: Record<string, number>}> }
 */
async function fetchInboxMessageFallback(supabase, me, ids) {
  /** @type { Record<string, any> } */
  const lastMap = {}
  /** @type { Record<string, number> } */
  const unreadCounts = {}
  /** @type { Record<string, string> } */
  const readMap = {}

  const [msgsRes, readsRes] = await Promise.all([
    supabase
      .from('nx_mail_messages')
      .select('thread_id,body,sender_badge,created_at,image_url,image_urls')
      .in('thread_id', ids),
    supabase.from('nx_mail_thread_reads').select('thread_id,last_read_at,reader_badge').in('thread_id', ids),
  ])

  const allMsgs = msgsRes?.data || []
  if (msgsRes.error) return { error: msgsRes.error, lastMap, unreadCounts }

  if (readsRes?.data) {
    for (const r of readsRes.data) {
      if (!badgesEquivalent(r.reader_badge, me)) continue
      const prev = readMap[r.thread_id]
      const ts = r.last_read_at
      if (!prev || new Date(ts).getTime() > new Date(prev).getTime()) readMap[r.thread_id] = ts
    }
  }

  /** @type { Record<string, any[]> } */
  const msgsByThread = {}
  for (const m of allMsgs) {
    const tid = m.thread_id
    const cur = lastMap[tid]
    if (!cur || new Date(m.created_at).getTime() > new Date(cur.created_at || 0).getTime()) lastMap[tid] = m
    if (!msgsByThread[tid]) msgsByThread[tid] = []
    msgsByThread[tid].push(m)
  }

  const meNorm = trimBadge(me).toLowerCase()
  for (const id of ids) unreadCounts[id] = 0
  for (const id of ids) {
    const lrMs = new Date(readMap[id] || '1970-01-01T00:00:00.000Z').getTime()
    for (const m of msgsByThread[id] || []) {
      const sb = trimBadge(m.sender_badge || '').toLowerCase()
      if (sb === meNorm) continue
      if (new Date(m.created_at).getTime() <= lrMs) continue
      unreadCounts[id] = (unreadCounts[id] || 0) + 1
    }
  }

  return { error: null, lastMap, unreadCounts }
}

/** Apply rows from nx_mail_inbox_agg RPC — one row per thread id. */
function inboxAggFromRpcRows(rows, ids) {
  /** @type { Record<string, any> } */
  const lastMap = {}
  /** @type { Record<string, number> } */
  const unreadCounts = {}

  const seen = new Set()
  for (const raw of rows || []) {
    const tid = raw?.thread_id != null ? String(raw.thread_id) : ''
    if (!tid) continue
    seen.add(tid)
    if (raw.last_created_at != null || raw.last_body || raw.last_sender_badge || raw.last_image_url) {
      lastMap[tid] = {
        thread_id: tid,
        body: raw.last_body ?? null,
        sender_badge: raw.last_sender_badge ?? null,
        created_at: raw.last_created_at ?? null,
        image_url: raw.last_image_url ?? null,
        image_urls: raw.last_image_urls ?? null,
      }
    }
    unreadCounts[tid] = Number(raw.unread_count) || 0
  }

  /** RPC must return exactly one row per id; if mismatch, caller should fall back. */
  const ok =
    ids.length === 0 || (seen.size === ids.length && ids.every((id) => seen.has(String(id))))
  return { lastMap, unreadCounts, rowCountOk: ok }
}

function viewerMayAccessThread(memberHit, me, thrRow) {
  const rows = memberHit || []
  if (rows.length)
    return rows.some((x) => badgesEquivalent(x.member_badge, me))

  if (thrRow?.badge_low && thrRow?.badge_high)
    return badgesEquivalent(thrRow.badge_low, me) || badgesEquivalent(thrRow.badge_high, me)

  return false
}

async function upsertThreadMembers(supabase, threadId, badges) {
  const unique = dedupeBadges(badges)
  if (!unique.length) return null
  const rows = unique.map((member_badge) => ({ thread_id: threadId, member_badge }))
  const { error } = await supabase
    .from('nx_mail_thread_members')
    .upsert(rows, { onConflict: 'thread_id,member_badge' })
  return error
}

export default async function handler(req, res) {
  try {
    if (!allowMethods(req, res, ['GET', 'POST', 'PATCH', 'OPTIONS'])) return

    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }

    const session = await requireSession(req, res)
    if (!session) return

    const supabase = getSupabaseService()

    const serviceKeyUnset = !String(SUPABASE_SERVICE_ROLE_KEY || '').trim()

    const sendRlsHint = (insError) => {
      if (!insError || !serviceKeyUnset) return null
      const msg = String(insError.message || '')
      if (!/row-level security|42501/i.test(msg)) return null
      return 'Set env SUPABASE_SERVICE_ROLE_KEY (server only) for Nexus Mail, or relax RLS on nx_mail_* tables.'
    }

    const meResolved = await resolveUserBadge(supabase, session.badge)
    const me = meResolved ?? trimBadge(session.badge)
    if (!me) {
      res.status(400).json({ error: 'Missing badge on session' })
      return
    }

    if (req.method === 'GET' && req.query?.directory === '1') {
      const q = typeof req.query?.q === 'string' ? req.query.q.trim() : ''
      let query = supabase.from('users').select('badge, name').order('name', { ascending: true }).limit(400)

      if (q.length >= 1) {
        const esc = q.replace(/[%_]/g, '')
        query = query.or(`badge.ilike.%${esc}%,name.ilike.%${esc}%`)
      }

      const { data, error } = await query
      if (error)
        return jsonApiError(res, 500, 'Directory lookup failed', { supabase: error, context: 'nexus-mail directory' })

      const directory = (data || []).filter((u) => !badgesEquivalent(u.badge, me)).slice(0, 200)
      return res.status(200).json({ directory })
    }

    if (req.method === 'GET' && req.query?.thread) {
      const threadId = String(req.query.thread || '').trim()
      if (!threadId) return res.status(400).json({ error: 'Missing thread id' })

      const [{ data: thr, error: te }, membRes] = await Promise.all([
        supabase
          .from('nx_mail_threads')
          .select('id,badge_low,badge_high,subject,updated_at,created_at')
          .eq('id', threadId)
          .single(),
        supabase.from('nx_mail_thread_members').select('member_badge').eq('thread_id', threadId),
      ])

      if (te || !thr) return res.status(404).json({ error: 'Thread not found' })

      const memberPrefetch = membRes?.data || []

      if (!viewerMayAccessThread(memberPrefetch, me, thr)) return res.status(403).json({ error: 'Forbidden' })

      const memberBadges = dedupeBadges([...memberPrefetch.map((r) => r.member_badge)])

      const [{ data: msgs, error: meErr }, profilesRes] = await Promise.all([
        supabase
          .from('nx_mail_messages')
          .select('id,sender_badge,body,image_url,image_urls,created_at')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: true }),
        memberBadges.length
          ? supabase.from('users').select('badge,name').in('badge', memberBadges)
          : Promise.resolve({ data: [] }),
      ])

      const mlistEarly = msgs || []
      const msgIds = mlistEarly.map((m) => m.id).filter(Boolean)

      let recipientsRows = []
      if (msgIds.length) {
        const { data: rrows } = await supabase
          .from('nx_mail_message_recipients')
          .select('message_id,recipient_badge,kind')
          .in('message_id', msgIds)
        recipientsRows = rrows || []
      }

      if (meErr)
        return jsonApiError(res, 500, 'Failed to load messages', {
          supabase: meErr,
          context: 'nexus-mail messages',
        })

      const profiles = profilesRes?.data || []
      const nameMap = Object.fromEntries(profiles.map((x) => [x.badge, x.name]))

      const participants = memberBadges.map((b) => ({
        badge: b,
        name: nameMap[b] || b,
      }))

      const others = memberBadges.filter((b) => !badgesEquivalent(b, me))
      let peerBadge = others[0] || ''
      let peerName = peerBadge ? nameMap[peerBadge] || peerBadge : ''
      if (!peerBadge && thr.badge_low && thr.badge_high) {
        peerBadge = badgesEquivalent(thr.badge_low, me) ? thr.badge_high : thr.badge_low
        peerName = nameMap[peerBadge] || peerBadge
      }

      /** @type { Record<string, { recipient_badge: string, kind: string }[]> } */
      const recByMsg = {}
      if (msgIds.length) {
        for (const r of recipientsRows) {
          if (!recByMsg[r.message_id]) recByMsg[r.message_id] = []
          recByMsg[r.message_id].push({ recipient_badge: r.recipient_badge, kind: r.kind })
        }
      }

      const formatted = mlistEarly.map((m) => {
        const base = {
          ...m,
          image_urls: normalizeStoredAttachmentUrls(m),
          image_url: normalizeStoredAttachmentUrls(m)[0] || null,
        }
        let recs = recByMsg[m.id] || syntheticRecipientsLegacy(thr, m)
        const isSender = badgesEquivalent(m.sender_badge, me)
        recs = filterRecipientsForViewer(recs, me, m.sender_badge, isSender)
        return { ...base, recipients: recs }
      })

      return res.status(200).json({
        thread: {
          ...thr,
          peer_badge: peerBadge,
          peer_name: peerName,
          viewer_badge: me,
          participants,
        },
        messages: formatted,
      })
    }

    if (req.method === 'GET') {
      const { rows, error: threadsErr } = await fetchThreadsForViewer(supabase, me)

      if (threadsErr)
        return jsonApiError(res, 500, 'Failed to list threads', {
          supabase: threadsErr,
          context: 'nexus-mail inbox',
        })

      const ids = rows.map((t) => t.id)
      /** @type { Record<string, any> } */
      let lastMap = {}
      const membByThread = {}
      let nameMap = {}
      /** @type { Record<string, number> } */
      let unreadCounts = {}

      if (ids.length) {
        const [{ data: rpcRows, error: rpcErr }, membRes] = await Promise.all([
          supabase.rpc('nx_mail_inbox_agg', {
            p_viewer: me,
            p_thread_ids: ids,
          }),
          supabase.from('nx_mail_thread_members').select('thread_id,member_badge').in('thread_id', ids),
        ])

        if (membRes.error)
          return jsonApiError(res, 500, 'Failed to load thread members for inbox', {
            supabase: membRes.error,
            context: 'nexus-mail inbox members',
          })

        for (const r of membRes?.data || []) {
          if (!membByThread[r.thread_id]) membByThread[r.thread_id] = []
          membByThread[r.thread_id].push(r.member_badge)
        }

        let usedRpcAgg = false
        if (!rpcErr && Array.isArray(rpcRows)) {
          const agg = inboxAggFromRpcRows(rpcRows, ids)
          if (agg.rowCountOk) {
            lastMap = agg.lastMap
            unreadCounts = agg.unreadCounts
            usedRpcAgg = true
          }
        }

        if (!usedRpcAgg) {
          const fb = await fetchInboxMessageFallback(supabase, me, ids)
          if (fb.error)
            return jsonApiError(res, 500, 'Failed to load messages for inbox', {
              supabase: fb.error,
              context: 'nexus-mail inbox messages',
              fallback_recommended: 'deploy docs/sql/nexus-mail-performance.sql',
            })
          lastMap = fb.lastMap
          unreadCounts = fb.unreadCounts
        }

        const allPeerBadges = new Set()
        for (const tid of ids) {
          const mb = membByThread[tid]
          if (mb?.length) {
            for (const b of mb) {
              if (!badgesEquivalent(b, me)) allPeerBadges.add(b)
            }
          } else {
            const t = rows.find((x) => x.id === tid)
            if (t) {
              const pb = badgesEquivalent(t.badge_low, me) ? t.badge_high : t.badge_low
              if (pb) allPeerBadges.add(pb)
            }
          }
        }

        if (allPeerBadges.size) {
          const { data: profiles } = await supabase
            .from('users')
            .select('badge,name')
            .in('badge', [...allPeerBadges])
          nameMap =
            profiles && profiles.length ? Object.fromEntries(profiles.map((x) => [x.badge, x.name])) : {}
        }
      }

      function inboxLabel(tid, thrRow) {
        const mb = membByThread[tid]
        if (mb?.length) {
          const others = dedupeBadges(mb.filter((b) => !badgesEquivalent(b, me)))
          if (others.length === 0) return nameMap[me] || me
          if (others.length === 1) return nameMap[others[0]] || others[0]
          const first = others.slice(0, 2).map((b) => nameMap[b] || b)
          const rest = others.length - 2
          return rest > 0 ? `${first.join(', ')} +${rest}` : first.join(', ')
        }
        const peerBadge = badgesEquivalent(thrRow.badge_low, me) ? thrRow.badge_high : thrRow.badge_low
        return nameMap[peerBadge] || peerBadge
      }

      function peerBadgeForRow(tid, thrRow) {
        const mb = membByThread[tid]
        if (mb?.length) {
          const others = mb.filter((b) => !badgesEquivalent(b, me))
          return others[0] || ''
        }
        return badgesEquivalent(thrRow.badge_low, me) ? thrRow.badge_high : thrRow.badge_low
      }

      const inbox = rows.map((t) => {
        const last = lastMap[t.id]
        const lastTs = last?.created_at
        const sortMs = Number.isFinite(Date.parse(lastTs || ''))
          ? Math.max(threadSortKeyMs(t), Date.parse(lastTs))
          : threadSortKeyMs(t)

        const peerBadge = peerBadgeForRow(t.id, t)
        return {
          id: t.id,
          peer_badge: peerBadge,
          peer_name: inboxLabel(t.id, t),
          subject: t.subject || '(No subject)',
          updated_at: t.updated_at,
          created_at: t.created_at,
          last_message_at: lastTs || null,
          last_sender: last?.sender_badge || null,
          last_snippet: lastSnippet(last),
          unread_count: unreadCounts[t.id] || 0,
          _nx_sort_ts: sortMs,
        }
      })

      inbox.sort((a, b) => {
        const d = (b._nx_sort_ts ?? 0) - (a._nx_sort_ts ?? 0)
        if (d !== 0) return d
        return String(b.id || '').localeCompare(String(a.id || ''))
      })

      for (const row of inbox) delete row._nx_sort_ts

      return res.status(200).json({ threads: inbox })
    }

    if (req.method === 'PATCH') {
      const { thread_id: threadId } = req.body || {}
      const tid = String(threadId || '').trim()
      if (!tid) return res.status(400).json({ error: 'thread_id required' })

      const [{ data: thr, error: te }, membR] = await Promise.all([
        supabase.from('nx_mail_threads').select('id,badge_low,badge_high').eq('id', tid).single(),
        supabase.from('nx_mail_thread_members').select('member_badge').eq('thread_id', tid),
      ])

      if (te || !thr) return res.status(404).json({ error: 'Thread not found' })
      if (!viewerMayAccessThread(membR.data || [], me, thr)) return res.status(403).json({ error: 'Forbidden' })

      const ts = new Date().toISOString()
      await supabase.from('nx_mail_thread_reads').upsert(
        {
          thread_id: tid,
          reader_badge: me,
          last_read_at: ts,
        },
        { onConflict: 'thread_id,reader_badge' },
      )

      return res.status(200).json({ ok: true })
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'object' && req.body ? req.body : {}
      const rawBody = typeof body.body === 'string' ? body.body.trim() : ''
      const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
      const postedUrls = collectPostedImageUrls(body)

      const toTokens = [
        ...parseAddressTokens(body.to),
        ...parseAddressTokens(body.recipient_badge),
      ]
      const ccTokens = parseAddressTokens(body.cc)
      const bccTokens = parseAddressTokens(body.bcc)

      if (!rawBody && !postedUrls.length) {
        return res.status(400).json({ error: 'body or image_urls required' })
      }

      const threadIdIn = typeof body.thread_id === 'string' ? body.thread_id.trim() : ''

      /** ---------- Reply ---------- */
      if (threadIdIn) {
        const [{ data: exist, error: exErr }, membR] = await Promise.all([
          supabase.from('nx_mail_threads').select('*').eq('id', threadIdIn).single(),
          supabase.from('nx_mail_thread_members').select('member_badge').eq('thread_id', threadIdIn),
        ])

        const mems = membR.data || []

        if (exErr || !exist) return res.status(404).json({ error: 'Thread not found' })
        if (!viewerMayAccessThread(mems, me, exist)) return res.status(403).json({ error: 'Forbidden' })

        let toResolved = []
        let ccResolved = []
        let bccResolved = []

        const hasExplicit =
          toTokens.length > 0 || ccTokens.length > 0 || bccTokens.length > 0

        if (hasExplicit) {
          const resMap = await resolveUserBadgesParallel(supabase, [
            ...toTokens,
            ...ccTokens,
            ...bccTokens,
          ])
          for (const t of toTokens) {
            const r = resMap.get(trimBadge(t).toLowerCase()) ?? null
            if (!r) return res.status(400).json({ error: `Unknown recipient: ${t}` })
            if (!badgesEquivalent(r, me)) toResolved.push(r)
          }
          for (const t of ccTokens) {
            const r = resMap.get(trimBadge(t).toLowerCase()) ?? null
            if (!r) return res.status(400).json({ error: `Unknown Cc: ${t}` })
            if (!badgesEquivalent(r, me)) ccResolved.push(r)
          }
          for (const t of bccTokens) {
            const r = resMap.get(trimBadge(t).toLowerCase()) ?? null
            if (!r) return res.status(400).json({ error: `Unknown Bcc: ${t}` })
            if (!badgesEquivalent(r, me)) bccResolved.push(r)
          }
        } else {
          /** Reply-all: everyone in thread except sender */
          if (mems.length) {
            toResolved = dedupeBadges(
              mems.map((x) => x.member_badge).filter((b) => !badgesEquivalent(b, me)),
            )
          } else if (exist.badge_low && exist.badge_high) {
            const other = badgesEquivalent(me, exist.badge_low) ? exist.badge_high : exist.badge_low
            toResolved = [other]
          } else {
            return res.status(400).json({ error: 'No recipients for reply' })
          }
        }

        toResolved = dedupeBadges(toResolved)
        ccResolved = dedupeBadges(ccResolved.filter((b) => !toResolved.some((x) => badgesEquivalent(x, b))))
        bccResolved = dedupeBadges(
          bccResolved.filter(
            (b) =>
              !toResolved.some((x) => badgesEquivalent(x, b)) &&
              !ccResolved.some((x) => badgesEquivalent(x, b)),
          ),
        )

        if (toResolved.length + ccResolved.length + bccResolved.length < 1)
          return res.status(400).json({ error: 'At least one recipient required' })

        const allInvolved = dedupeBadges([me, ...toResolved, ...ccResolved, ...bccResolved])
        const memErr = await upsertThreadMembers(supabase, threadIdIn, allInvolved)
        if (memErr)
          return jsonApiError(res, 500, 'Failed to update thread members', {
            supabase: memErr,
            context: 'nexus-mail members',
          })

        const nowIso = new Date().toISOString()
        const { data: insMsgRow, error: insMsgErr } = await supabase
          .from('nx_mail_messages')
          .insert({
            thread_id: threadIdIn,
            sender_badge: me,
            body: rawBody.slice(0, 16000),
            image_url: postedUrls[0] || null,
            image_urls: postedUrls.length ? postedUrls : [],
          })
          .select('id')
          .single()

        if (insMsgErr || !insMsgRow)
          return jsonApiError(res, 500, 'Failed to send message', {
            supabase: insMsgErr,
            context: 'nexus-mail insert message',
            hint: sendRlsHint(insMsgErr) ?? undefined,
          })

        const mid = insMsgRow.id
        const recRows = [
          ...toResolved.map((recipient_badge) => ({ message_id: mid, recipient_badge, kind: 'to' })),
          ...ccResolved.map((recipient_badge) => ({ message_id: mid, recipient_badge, kind: 'cc' })),
          ...bccResolved.map((recipient_badge) => ({ message_id: mid, recipient_badge, kind: 'bcc' })),
        ]

        if (recRows.length) {
          const { error: rErr } = await supabase.from('nx_mail_message_recipients').insert(recRows)
          if (rErr)
            return jsonApiError(res, 500, 'Failed to save recipients', {
              supabase: rErr,
              context: 'nexus-mail recipients',
            })
        }

        await supabase.from('nx_mail_threads').update({ updated_at: nowIso }).eq('id', threadIdIn)
        return res.status(201).json({ ok: true, thread_id: threadIdIn })
      }

      /** ---------- New thread ---------- */
      const resMapNew = await resolveUserBadgesParallel(supabase, [...toTokens, ...ccTokens, ...bccTokens])
      const toR = []
      const ccR = []
      const bccR = []

      for (const t of toTokens) {
        const r = resMapNew.get(trimBadge(t).toLowerCase()) ?? null
        if (!r) return res.status(400).json({ error: `Unknown recipient: ${t}` })
        if (!badgesEquivalent(r, me)) toR.push(r)
      }
      for (const t of ccTokens) {
        const r = resMapNew.get(trimBadge(t).toLowerCase()) ?? null
        if (!r) return res.status(400).json({ error: `Unknown Cc: ${t}` })
        if (!badgesEquivalent(r, me)) ccR.push(r)
      }
      for (const t of bccTokens) {
        const r = resMapNew.get(trimBadge(t).toLowerCase()) ?? null
        if (!r) return res.status(400).json({ error: `Unknown Bcc: ${t}` })
        if (!badgesEquivalent(r, me)) bccR.push(r)
      }

      let toResolved = dedupeBadges(toR)
      let ccResolved = dedupeBadges(ccR.filter((b) => !toResolved.some((x) => badgesEquivalent(x, b))))
      let bccResolved = dedupeBadges(
        bccR.filter(
          (b) =>
            !toResolved.some((x) => badgesEquivalent(x, b)) &&
            !ccResolved.some((x) => badgesEquivalent(x, b)),
        ),
      )

      if (toResolved.length + ccResolved.length + bccResolved.length < 1) {
        return res.status(400).json({ error: 'At least one recipient (To, Cc, or Bcc) required' })
      }

      const sub = subject.slice(0, 200) || '(No subject)'

      /** Prefer nullable dyad for “group” threads; keep pair columns when exactly 2 others + implicit DM */
      const allRec = dedupeBadges([...toResolved, ...ccResolved, ...bccResolved])
      const pair =
        allRec.length === 1 ? canonicalBadges(me, allRec[0]) : null

      const insertPayload = pair
        ? { badge_low: pair[0], badge_high: pair[1], subject: sub }
        : { badge_low: null, badge_high: null, subject: sub }

      const ins = await supabase.from('nx_mail_threads').insert(insertPayload).select('id').single()

      if (ins.error)
        return jsonApiError(res, 500, 'Failed to create thread', {
          supabase: ins.error,
          context: 'nexus-mail insert thread',
          hint: sendRlsHint(ins.error) ?? undefined,
        })

      const newTid = ins.data.id
      const everyone = dedupeBadges([me, ...allRec])
      const memErr2 = await upsertThreadMembers(supabase, newTid, everyone)
      if (memErr2)
        return jsonApiError(res, 500, 'Failed to add thread members', {
          supabase: memErr2,
          context: 'nexus-mail members',
        })

      const nowIso = new Date().toISOString()
      const { data: insMsgRow2, error: insMsgErr2 } = await supabase
        .from('nx_mail_messages')
        .insert({
          thread_id: newTid,
          sender_badge: me,
          body: rawBody.slice(0, 16000),
          image_url: postedUrls[0] || null,
          image_urls: postedUrls.length ? postedUrls : [],
        })
        .select('id')
        .single()

      if (insMsgErr2 || !insMsgRow2)
        return jsonApiError(res, 500, 'Failed to send message', {
          supabase: insMsgErr2,
          context: 'nexus-mail insert message',
          hint: sendRlsHint(insMsgErr2) ?? undefined,
        })

      const mid2 = insMsgRow2.id
      const recRows2 = [
        ...toResolved.map((recipient_badge) => ({ message_id: mid2, recipient_badge, kind: 'to' })),
        ...ccResolved.map((recipient_badge) => ({ message_id: mid2, recipient_badge, kind: 'cc' })),
        ...bccResolved.map((recipient_badge) => ({ message_id: mid2, recipient_badge, kind: 'bcc' })),
      ]

      if (recRows2.length) {
        const { error: rErr2 } = await supabase.from('nx_mail_message_recipients').insert(recRows2)
        if (rErr2)
          return jsonApiError(res, 500, 'Failed to save recipients', {
            supabase: rErr2,
            context: 'nexus-mail recipients',
          })
      }

      await supabase.from('nx_mail_threads').update({ updated_at: nowIso }).eq('id', newTid)
      return res.status(201).json({ ok: true, thread_id: newTid })
    }
  } catch (e) {
    return jsonApiError(res, 500, e?.message || 'nexus-mail failed', { cause: e, context: 'nexus-mail' })
  }
}
