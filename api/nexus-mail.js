// ============================================================
//  NEXUS Internal Mail API — Gmail-style DM between badges
//  GET  /api/nexus-mail                    → inbox (threads + last snippet)
//  GET  /api/nexus-mail?thread=<uuid>     → messages
//  GET  /api/nexus-mail?directory=1&q=…  → user picker (badge, name)
//  POST /api/nexus-mail                   → send (JSON)
//  PATCH /api/nexus-mail                  → mark thread read (JSON)
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

/** Postgres ILIKE exact match: escape `\`, `%`, `_` (no wildcards beyond literal). */
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

/** Local badge part only; casing preserved. With `@`, hostname must end in `.gov`. */
function stripGovernmentMailLocalPart(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return ''
  const at = s.indexOf('@')
  if (at >= 0) {
    const dom = s.slice(at + 1)
    if (!isGovernmentMailHostname(dom)) return ''
    s = s.slice(0, at).trim()
  }
  return s
}

async function resolveUserBadge(supabase, rawInput) {
  const t = trimBadge(rawInput)
  if (!t) return null

  const { data: hit } = await supabase.from('users').select('badge').eq('badge', t).maybeSingle()

  if (hit?.badge) return hit.badge

  /** `users.badge` may be stored as full `officer@agency.gov`; support typing local-part only. */
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

/** Merge inbox lists keyed by badge_low/badge_high participant (ILIKE insensitive). */
async function fetchThreadsForViewer(supabase, meCanon) {
  const mePat = escapeIlikeExact(trimBadge(meCanon))
  const cols = 'id,badge_low,badge_high,subject,updated_at,created_at'

  const [partLow, partHigh] = await Promise.all([
    supabase.from('nx_mail_threads').select(cols).ilike('badge_low', mePat).limit(500),
    supabase.from('nx_mail_threads').select(cols).ilike('badge_high', mePat).limit(500),
  ])

  if (partLow.error)
    return { error: partLow.error, rows: [] }
  if (partHigh.error)
    return { error: partHigh.error, rows: [] }

  const merged = new Map()
  ;(partLow.data || []).forEach((r) => merged.set(r.id, r))
  ;(partHigh.data || []).forEach((r) => merged.set(r.id, r))

  const rows = Array.from(merged.values())

  return { error: null, rows }
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

/** From POST JSON: image_urls[] and/or legacy image_url — dedupe, sanitize, capped. */
function collectPostedImageUrls(bodyObj) {
  const out = []
  /** @param {string} cand */
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

function formatMessagePayload(m) {
  const urls = normalizeStoredAttachmentUrls(m)
  return {
    ...m,
    image_urls: urls,
    image_url: urls[0] || null,
  }
}

function lastSnippet(last) {
  if (!last) return ''
  const txt = String(last.body || '')
    .replace(/<[^>]{1,240}>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (txt.length) return txt.length > 120 ? `${txt.slice(0, 120)}…` : txt
  const imgs = normalizeStoredAttachmentUrls(last)
  if (imgs.length > 1) return `[${imgs.length} gambar]`
  if (imgs.length === 1) return '[Gambar]'
  return ''
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

      const { data: thr, error: te } = await supabase
        .from('nx_mail_threads')
        .select('id,badge_low,badge_high,subject,updated_at,created_at')
        .eq('id', threadId)
        .single()

      if (te || !thr)
        return res.status(404).json({ error: 'Thread not found' })

      if (!badgesEquivalent(thr.badge_low, me) && !badgesEquivalent(thr.badge_high, me))
        return res.status(403).json({ error: 'Forbidden' })

      const { data: msgs, error: meErr } = await supabase
        .from('nx_mail_messages')
        .select('id,sender_badge,body,image_url,image_urls,created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })

      if (meErr)
        return jsonApiError(res, 500, 'Failed to load messages', {
          supabase: meErr,
          context: 'nexus-mail messages',
        })

      const peer = badgesEquivalent(thr.badge_low, me) ? thr.badge_high : thr.badge_low
      let peerName = peer
      const { data: urow } = await supabase.from('users').select('name').eq('badge', peer).maybeSingle()
      if (urow?.name) peerName = urow.name

      return res.status(200).json({
        thread: {
          ...thr,
          peer_badge: peer,
          peer_name: peerName,
          /** Badge pembaca sesi — sinkron dengan `sender_badge` di DB (beda dari kunci sesi kosong/lama di klien). */
          viewer_badge: me,
        },
        messages: (msgs || []).map(formatMessagePayload),
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
      /** @type { Record<string, { thread_id:string,body?:string|null,sender_badge:string,created_at:string,image_url?:string|null }>} */
      const lastMap = {}

      if (ids.length) {
        const { data: allMsgs, error: mErr } = await supabase
          .from('nx_mail_messages')
          .select('thread_id,body,sender_badge,created_at,image_url,image_urls')
          .in('thread_id', ids)
          .order('created_at', { ascending: false })

        if (!mErr && allMsgs) {
          for (const m of allMsgs) {
            if (!lastMap[m.thread_id]) lastMap[m.thread_id] = m
          }
        }
      }

      const badgesOfPeers = [...new Set(rows.map((t) => (badgesEquivalent(t.badge_low, me) ? t.badge_high : t.badge_low)))]

      let nameMap = {}
      if (badgesOfPeers.length) {
        const { data: profiles } = await supabase.from('users').select('badge,name').in('badge', badgesOfPeers)

        if (profiles) nameMap = Object.fromEntries(profiles.map((x) => [x.badge, x.name]))
      }

      /** @type { Record<string,string> } */
      let readMap = {}
      if (ids.length) {
        const { data: reads } = await supabase
          .from('nx_mail_thread_reads')
          .select('thread_id,last_read_at,reader_badge')
          .in('thread_id', ids)

        if (reads) {
          reads.forEach((r) => {
            if (!badgesEquivalent(r.reader_badge, me)) return
            const prev = readMap[r.thread_id]
            const ts = r.last_read_at
            if (!prev || new Date(ts).getTime() > new Date(prev).getTime()) readMap[r.thread_id] = ts
          })
        }
      }

      /** @type { Record<string, number> } */
      const unreadCounts = {}
      if (ids.length) {
        const { data: recentAll } = await supabase
          .from('nx_mail_messages')
          .select('thread_id,sender_badge,created_at')
          .in('thread_id', ids)

        for (const id of ids) {
          const lastRead = readMap[id] || '1970-01-01T00:00:00.000Z'
          const msgsFor = (recentAll || []).filter((m) => m.thread_id === id)
          unreadCounts[id] = msgsFor.filter(
            (m) =>
              !badgesEquivalent(m.sender_badge, me) &&
              new Date(m.created_at).getTime() > new Date(lastRead).getTime(),
          ).length
        }
      }

      const inbox = rows.map((t) => {
        const peerBadge = badgesEquivalent(t.badge_low, me) ? t.badge_high : t.badge_low
        const last = lastMap[t.id]
        const lastTs = last?.created_at
        /** Urutan kotak masuk: gunakan aktivitas percakapan terbaru */
        const sortMs = Number.isFinite(Date.parse(lastTs || ''))
          ? Math.max(threadSortKeyMs(t), Date.parse(lastTs))
          : threadSortKeyMs(t)
        return {
          id: t.id,
          peer_badge: peerBadge,
          peer_name: nameMap[peerBadge] || peerBadge,
          subject: t.subject || '(No subject)',
          updated_at: t.updated_at,
          created_at: t.created_at,
          last_message_at: lastTs || null,
          last_sender: last?.sender_badge || null,
          last_snippet: lastSnippet(last),
          unread_count: unreadCounts[t.id] || 0,
          /** @internal */
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

      const { data: thr, error: te } = await supabase
        .from('nx_mail_threads')
        .select('id,badge_low,badge_high')
        .eq('id', tid)
        .single()

      if (te || !thr) return res.status(404).json({ error: 'Thread not found' })
      if (!badgesEquivalent(thr.badge_low, me) && !badgesEquivalent(thr.badge_high, me))
        return res.status(403).json({ error: 'Forbidden' })

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
      const typedRecipient = trimBadge(body.recipient_badge)
      const recipientCanon = typedRecipient ? await resolveUserBadge(supabase, typedRecipient) : null
      const rawBody = typeof body.body === 'string' ? body.body.trim() : ''
      const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
      const postedUrls = collectPostedImageUrls(body)

      if (!recipientCanon) {
        return res.status(400).json({ error: 'Unknown recipient badge' })
      }

      const pair = canonicalBadges(me, recipientCanon)
      if (!pair) {
        return res.status(400).json({ error: 'invalid recipient_badge' })
      }
      if (!rawBody && !postedUrls.length) {
        return res.status(400).json({ error: 'body or image_urls required' })
      }

      let threadId =
        typeof body.thread_id === 'string' ? body.thread_id.trim() : ''

      if (threadId) {
        const { data: exist, error: exErr } = await supabase
          .from('nx_mail_threads')
          .select('*')
          .eq('id', threadId)
          .single()

        if (exErr || !exist) return res.status(404).json({ error: 'Thread not found' })
        const okPair =
          badgesEquivalent(exist.badge_low, pair[0]) && badgesEquivalent(exist.badge_high, pair[1])
        if (!okPair) {
          return res.status(400).json({ error: 'Recipient does not match thread' })
        }
      } else {
        /** Compose baru = selalu utas baru (layak Gmail). Balasan = POST dengan `thread_id`. */
        const lo = pair[0]
        const hi = pair[1]
        const sub = subject.slice(0, 200) || '(No subject)'
        const ins = await supabase
          .from('nx_mail_threads')
          .insert({
            badge_low: lo,
            badge_high: hi,
            subject: sub,
          })
          .select('id')
          .single()

        if (ins.error)
          return jsonApiError(res, 500, 'Failed to create thread', {
            supabase: ins.error,
            context: 'nexus-mail insert thread',
            hint: sendRlsHint(ins.error) ?? undefined,
          })

        threadId = ins.data.id
      }

      const nowIso = new Date().toISOString()
      const insMsg = await supabase.from('nx_mail_messages').insert({
        thread_id: threadId,
        sender_badge: me,
        body: rawBody.slice(0, 16000),
        image_url: postedUrls[0] || null,
        image_urls: postedUrls.length ? postedUrls : [],
      })

      if (insMsg.error)
        return jsonApiError(res, 500, 'Failed to send message', {
          supabase: insMsg.error,
          context: 'nexus-mail insert message',
          hint: sendRlsHint(insMsg.error) ?? undefined,
        })

      await supabase.from('nx_mail_threads').update({ updated_at: nowIso }).eq('id', threadId)

      return res.status(201).json({ ok: true, thread_id: threadId })
    }
  } catch (e) {
    return jsonApiError(res, 500, e?.message || 'nexus-mail failed', { cause: e, context: 'nexus-mail' })
  }
}
