// NMAIL — Gmail-style internal DM (secured by /api/nexus-mail).
;(function () {
  'use strict'

  /** @typedef {{ id:string, peer_badge:string, peer_name:string, subject:string, updated_at:string, last_sender?:string|null, last_snippet?:string, unread_count:number }} NxThread */
  /** @typedef {{ download_url:string|null, filename:string, mime:string|null, size_bytes?:number, path?:string|null, legacy_url?:string|null }} NxOutgoingAttachment */
  /** @typedef {{ id:string, sender_badge:string, body:string, image_url:string|null, image_urls:string[], attachments?:NxOutgoingAttachment[], created_at:string }} NxMessage */

  /** @returns {Record<string,string>} */
  function hdr() {
    const t = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('cib_token') : ''
    return {
      'Content-Type': 'application/json',
      ...(t ? { 'x-session-token': t } : {}),
    }
  }

  /** Headers for multipart upload (leave Content-Type unset for boundary). */
  function hdrMultipart() {
    const t = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('cib_token') : ''
    return t ? { 'x-session-token': t } : {}
  }

  /** Sama seperti PortalAuth (`cib_badge`); beberapa halaman juga pakai JSON `cib_session`. */
  function myBadgeFromStorage() {
    try {
      if (typeof sessionStorage === 'undefined') return ''
      const flat = sessionStorage.getItem('cib_badge')
      if (flat != null && String(flat).trim()) return String(flat).trim()
      const raw = sessionStorage.getItem('cib_session')
      if (raw)
        try {
          const b = JSON.parse(raw).badge
          if (b != null && String(b).trim()) return String(b).trim()
        } catch (_) {}
      if (typeof PortalAuth !== 'undefined' && PortalAuth.getSession) {
        var s = PortalAuth.getSession()
        if (s && s.badge != null && String(s.badge).trim()) return String(s.badge).trim()
      }
      return ''
    } catch (_) {
      return ''
    }
  }

  async function fetchJson(method, url, body) {
    const opt = { method, headers: hdr() }
    if (body !== undefined && body !== null) opt.body = JSON.stringify(body)
    const r = await fetch(url, opt)
    const ct = (r.headers.get('content-type') || '').toLowerCase()
    const txt = await r.text()
    const trimmed = txt.trim()
    const tryParse =
      ct.includes('application/json') ||
      ct.includes('text/json') ||
      ct.includes('+json') ||
      (trimmed.length > 0 && (trimmed[0] === '{' || trimmed[0] === '['))
    let j = null
    if (tryParse && trimmed) {
      try {
        j = JSON.parse(txt)
      } catch (_) {
        j = null
      }
    }
    if (!r.ok) {
      var em = (j && j.error) || r.statusText || String(r.status)
      if (j && j.hint) em = em + ' — ' + j.hint
      throw new Error(em)
    }
    return j && typeof j === 'object' ? j : {}
  }

  /** Aligned with `NMAIL_MULTIPART_SAFE_MAX_BYTES` (Vercel ~4.5MB serverless body cap). Larger files upload via signed Storage URL — not through Vercel. */
  var NMAIL_MULTIPART_SAFE_MAX_BYTES = 4 * 1024 * 1024

  /** @returns {Promise<{ path: string, filename: string, mime: string, size_bytes: number }>} */
  async function nmailUploadFileViaSupabaseSignedPut(file) {
    var mime = file.type ? String(file.type) : 'application/octet-stream'
    var prep = await fetchJson('POST', '/api/nexus-mail', {
      nmail_attachment_direct_prepare: true,
      filename: file.name,
      mime: mime,
      size_bytes: file.size,
    })
    var du = prep && prep.direct_upload
    if (!du || typeof du.signed_url !== 'string') throw new Error('Missing signed upload URL')
    var att = prep && prep.attachment
    if (!att || typeof att !== 'object' || typeof att.path !== 'string')
      throw new Error('Malformed prepare response')

    var fdPut = new FormData()
    fdPut.append('cacheControl', '3600')
    fdPut.append('', file)

    var putRes = await fetch(du.signed_url, {
      method: 'PUT',
      headers: { 'x-upsert': 'false' },
      body: fdPut,
    })
    if (!putRes.ok) {
      var putTxt = ''
      try {
        putTxt = await putRes.text()
      } catch (_) {}
      var putHint = ''
      if (prep && prep.hint) putHint = ' — ' + prep.hint
      throw new Error(
        ('Upload to storage failed: ' + putRes.status + ' ' + (putTxt || putRes.statusText)).trim() + putHint,
      )
    }

    return {
      path: att.path,
      filename: att.filename,
      mime: att.mime || mime,
      size_bytes: file.size,
    }
  }

  /**
   * @param {File} file
   * @returns {Promise<{ path: string, filename: string, mime: string, size_bytes: number }>}
   */
  async function nmailUploadFile(file) {
    if (file.size >= NMAIL_MULTIPART_SAFE_MAX_BYTES) return nmailUploadFileViaSupabaseSignedPut(file)

    var fd = new FormData()
    fd.append('file', file)
    var r = await fetch('/api/nexus-mail', {
      method: 'POST',
      headers: hdrMultipart(),
      body: fd,
    })
    var ct = (r.headers.get('content-type') || '').toLowerCase()
    var txt = await r.text()
    var trimmed = txt.trim()
    var j = null
    var looksJson =
      ct.includes('application/json') ||
      (trimmed.length > 0 && (trimmed[0] === '{' || trimmed[0] === '['))
    if (looksJson && trimmed) {
      try {
        j = JSON.parse(trimmed)
      } catch (_) {
        j = null
      }
    }
    if (!r.ok) {
      var em = (j && j.error) || txt || String(r.status)
      if (j && j.hint) em = em + ' — ' + j.hint
      throw new Error(em)
    }
    var att = j && j.attachment ? j.attachment : null
    if (!att || typeof att !== 'object' || typeof att.path !== 'string')
      throw new Error('Malformed upload response')
    return att
  }

  /** Inbox GET: beberapa proxy tidak mengirim Content-Type JSON — tetap parse isi `{ threads }`. */
  function coerceInboxThreads(data) {
    if (!data || typeof data !== 'object') return []
    const t = /** @type {{ threads?: unknown }} */ (data).threads
    if (Array.isArray(t)) return t
    if (Array.isArray(data)) return data
    return []
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /** Default gov host only when `users.badge` is a bare slug (legacy); otherwise show badge as stored. */
  const DEFAULT_GOV_MAIL_HOST = 'cib.gov'
  const DEFAULT_GOV_MAIL_SUFFIX = '@' + DEFAULT_GOV_MAIL_HOST

  function badgesEquivalent(a, b) {
    const x = String(a ?? '').trim()
    const y = String(b ?? '').trim()
    return x.length && y.length && x.toLowerCase() === y.toLowerCase()
  }

  function isGovernmentMailHostname(host) {
    const h = String(host || '')
      .trim()
      .toLowerCase()
    if (!h || h.includes('@') || h.includes('..') || h.includes('/') || h.includes('\\') || h.includes(':'))
      return false
    const labels = h.split('.').filter(Boolean)
    if (labels.length < 2) return false
    for (let i = 0; i < labels.length; i++)
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(labels[i])) return false
    return labels[labels.length - 1] === 'gov'
  }

  /** Normalized mailbox / badge key for NMAIL (`users.badge` is typically full `user@agency.gov`). */
  function parseRecipientBadge(raw) {
    let s = String(raw == null ? '' : raw).trim()
    if (!s) return ''
    if (s.indexOf('@') < 0) return s
    const parts = s
      .split('@')
      .map(function (p) {
        return p.trim()
      })
      .filter(function (p) {
        return p.length > 0
      })
    if (parts.length < 2) return ''
    const local = parts[0]
    const tailHost = parts[parts.length - 1]
    if (!isGovernmentMailHostname(tailHost)) return ''
    return local + '@' + tailHost
  }

  /** Label for compose list / headers — never append `@cib.gov` if badge already ends with valid `*.gov`. */
  function badgeMailboxLabel(badge) {
    var b = String(badge ?? '').trim()
    if (!b) return ''
    var at = b.indexOf('@')
    if (at > 0) {
      var dom = b.slice(at + 1)
      if (isGovernmentMailHostname(dom)) return b
    }
    if (at === 0) return ''
    return b + DEFAULT_GOV_MAIL_SUFFIX
  }

  /** Whitelist subset of HTML from compose body for thread bubbles. */
  function sanitizeMailBodyHtml(html) {
    var wrap = document.createElement('div')
    wrap.innerHTML = html || ''
    var allowed = ['BR', 'P', 'DIV', 'SPAN', 'B', 'I', 'U', 'STRONG', 'EM', 'UL', 'OL', 'LI', 'BLOCKQUOTE']
    function cleanse(node) {
      Array.from(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 8) {
          node.removeChild(ch)
          return
        }
        if (ch.nodeType === 1) {
          var up = ch.tagName.toUpperCase()
          if (!allowed.includes(up)) {
            while (ch.firstChild) node.insertBefore(ch.firstChild, ch)
            node.removeChild(ch)
            cleanse(node)
          } else {
            Array.from(ch.attributes).forEach(function (a) {
              ch.removeAttribute(a.name)
            })
            cleanse(ch)
          }
        }
      })
    }
    cleanse(wrap)
    return wrap.innerHTML
  }

  function composeBodyFromEditor(bodyEl) {
    if (!bodyEl) return ''
    var txt = (bodyEl.innerText || '').replace(/\u00a0/g, ' ').trim()
    if (!txt && !bodyEl.querySelector('img')) return ''
    var html = (bodyEl.innerHTML || '').trim()
    var looksMarkup = /<[a-z!?/[\]]/i.test(html)
    if (!looksMarkup) return txt || ''
    return sanitizeMailBodyHtml(html)
  }

  function renderMsgBodyMarkup(rawBody) {
    var s = String(rawBody == null ? '' : rawBody)
    if (!s.trim()) return ''
    var looksMarkup = /<[a-z!?/[\]]/i.test(s)
    if (!looksMarkup) return escapeHtml(s).replace(/\n/g, '<br/>')
    return sanitizeMailBodyHtml(s)
  }

  /** Max matches API cap. */
  const NX_MAX_MAIL_ATTACH = 15

  /** @param {NxMessage | Record<string, unknown> | null} msg */
  function nxMailRenderableAttachments(msg) {
    if (!msg) return []
    var att = /** @type {unknown} */ (msg.attachments)
    if (Array.isArray(att) && att.length)
      return att
        .filter(function (x) {
          return x && typeof x === 'object'
        })
        .map(function (x) {
          return /** @type {NxOutgoingAttachment} */ (x)
        })
        .slice(0, NX_MAX_MAIL_ATTACH)
    var urls = messageAttachmentUrls(/** @type {NxMessage} */ (msg))
    var list = []
    for (var i = 0; i < urls.length; i++)
      list.push({
        download_url: urls[i],
        filename: 'Image',
        mime: 'image/jpeg',
        legacy_url: null,
        path: null,
      })
    return list
  }

  function messageAttachmentUrls(m) {
    if (!m) return []
    if (Array.isArray(m.image_urls) && m.image_urls.length)
      return m.image_urls
        .filter(function (x) {
          return typeof x === 'string' && String(x).trim()
        })
        .slice(0, 24)
    if (m.image_url && typeof m.image_url === 'string') return [m.image_url]
    return []
  }

  function nxMailToast(message, typ) {
    var t = typ || 'error'
    var msg = String(message == null ? '' : message)
    if (typeof PortalAuth !== 'undefined' && PortalAuth.showToast) {
      PortalAuth.showToast(msg, t, 'inf-toast')
      return
    }
    if (t === 'error' && typeof console !== 'undefined' && console.warn) console.warn('[NMAIL]', msg)
  }

  /** @param {HTMLElement | null} btn @param {boolean} busy @param {{ text?: string }} [opts] */
  function nxMailButtonBusy(btn, busy, opts) {
    opts = opts || {}
    if (!btn || !(btn instanceof HTMLElement)) return
    if (busy) {
      if (btn.dataset.nxBusyOrig == null) btn.dataset.nxBusyOrig = btn.innerHTML
      btn.disabled = true
      btn.classList.add('nx-mail-btn-busy')
      btn.setAttribute('aria-busy', 'true')
      if (opts.text != null) btn.textContent = opts.text
    } else {
      btn.disabled = false
      btn.classList.remove('nx-mail-btn-busy')
      btn.removeAttribute('aria-busy')
      if (btn.dataset.nxBusyOrig != null) {
        btn.innerHTML = btn.dataset.nxBusyOrig
        delete btn.dataset.nxBusyOrig
      }
    }
  }

  function nxMailSetMailPaneLoading(on) {
    var conv = el('nxMailConvScroll')
    var tl = el('nxMailThreadList')
    if (conv) conv.classList.toggle('is-nx-mail-loading', !!on)
    if (tl) tl.classList.toggle('is-nx-mail-loading', !!on)
  }

  function fmtClockId(iso) {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    } catch (_) {
      return ''
    }
  }

  function fmtRelativeId(iso) {
    if (!iso) return ''
    try {
      var d = new Date(iso).getTime()
      var diff = Math.max(0, Date.now() - d)
      var mins = Math.floor(diff / 60000)
      if (mins < 1) return 'just now'
      if (mins < 60) return mins + ' min ago'
      var hrs = Math.floor(mins / 60)
      if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago')
      var days = Math.floor(hrs / 24)
      return days + (days === 1 ? ' day ago' : ' days ago')
    } catch (_) {
      return ''
    }
  }

  /** Waktu singkat untuk baris kotak masuk dan label pesan (relatif atau jam). */
  function fmtTime(iso) {
    if (!iso) return ''
    return fmtRelativeId(iso) || fmtClockId(iso)
  }

  function fmtOnDateEn(iso) {
    if (!iso) return ''
    try {
      var d = new Date(iso)
      return d.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch (_) {
      return ''
    }
  }

  function nxMailSnippetPlain(body, maxLen) {
    var t = String(body == null ? '' : body)
      .replace(/<[^>]{1,200}>/gi, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    var n = typeof maxLen === 'number' ? maxLen : 120
    if (t.length <= n) return t
    return t.slice(0, n).trimEnd() + '…'
  }

  /** Satu atau dua karakter untuk lingkaran avatar (layak Gmail). */
  function nxAvatarLetters(displaySeed) {
    var s = String(displaySeed ?? '')
      .trim()
      .replace(/\s+/g, ' ')
    if (!s) return '?'
    var parts = s.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      var a = (parts[0].charAt(0) || '').toUpperCase()
      var b = (parts[1].charAt(0) || '').toUpperCase()
      var pair = (a + b).slice(0, 2)
      return pair || '?'
    }
    var c = (parts[0].charAt(0) || '').toUpperCase()
    return c || '?'
  }

  /** @type {NxThread[]} */
  let threads = []
  /** @type {NxThread[]} */
  let dirCache = []

  let nxNextLocalAttId = 1
  /**
   * Like Gmail web: uploads start when files are picked/dropped. `_previewUrl` holds a blob URL for thumbnails until removed.
   * @type {{ _id:number, path?:string, filename:string, mime:string, size_bytes:number, _uploading?:boolean, _previewUrl?:string }[]}
   */
  let nxComposeAttachments = []
  /** @type {{ _id:number, path?:string, filename:string, mime:string, size_bytes:number, _uploading?:boolean, _previewUrl?:string }[]} */
  let nxReplyAttachments = []

  /** @type {{ meta: Partial<NxThread> & { peer_badge?: string, peer_name?: string, subject?: string } | null, msgs: NxMessage[] }} */
  let openThread = null
  /** @type {ReturnType<typeof setInterval>|null} */
  let unreadTimer = null
  /** @type {{to:string}} */
  let pendingCompose = null

  /** @type {{ to: string[], cc: string[], bcc: string[] }} */
  let nxComposeRecipients = { to: [], cc: [], bcc: [] }
  let dirDeb = null
  let nxMailSendBusy = false
  let nxMailReplyBusy = false
  let nxMailOpenThreadBusy = false
  let nxMailInboxBusy = false

  function el(id) {
    return document.getElementById(id)
  }

  function nxMailConvScrollEl() {
    return el('nxMailConvScroll')
  }

  /** Scroll conversation rail to newest content (reply area / latest message). */
  function nxMailScrollConvToEnd() {
    var rail = nxMailConvScrollEl()
    if (!rail) return
    requestAnimationFrame(function () {
      try {
        rail.scrollTop = rail.scrollHeight
      } catch (_) {
        /* IE / older */
      }
    })
  }

  function nxMailComposerSetOpen(show) {
    var c = el('nxMailComposer')
    var rail = nxMailConvScrollEl()
    if (c) Object.assign(c.style, { display: show ? 'flex' : 'none' })
    if (rail) rail.classList.toggle('nx-gmail-conv--reply-open', !!show)
  }

  function nxFocusReplyComposer() {
    nxMailComposerSetOpen(true)
    var ta = el('nxMailReplyBody')
    requestAnimationFrame(function () {
      if (ta) {
        ta.focus({ preventScroll: false })
        try {
          ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        } catch (_) {
          ta.scrollIntoView(true)
        }
      }
      nxMailScrollConvToEnd()
    })
  }

  function bindGmailReadQuickReplyOnce() {
    var cs = nxMailConvScrollEl()
    if (!cs || cs._nxQrBound) return
    cs._nxQrBound = true
    cs.addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('#nxMailQuickReply')) nxFocusReplyComposer()
    })
  }

  function setNxComposeErr(message) {
    var n = el('nxMailComposeErr')
    if (!n) return
    var msg = String(message == null ? '' : message)
    if (!msg) {
      n.textContent = ''
      n.classList.add('is-hidden')
      return
    }
    n.textContent = msg
    n.classList.remove('is-hidden')
  }

  function normalizeComposeDraft(inp) {
    if (!inp) return
    var canon = parseRecipientBadge(inp.value)
    if (!canon) return
    var v = inp.value.replace(/\u00a0/g, ' ').trim()
    if (v.toLowerCase() !== canon.toLowerCase()) inp.value = canon
  }

  function badgeKey(b) {
    return String(b == null ? '' : b)
      .trim()
      .toLowerCase()
  }

  /** @returns {{ inp: HTMLInputElement|null, sug: HTMLElement|null, chips: HTMLElement|null }} */
  function getRecipCfg(kind) {
    if (kind === 'to')
      return {
        inp: /** @type {HTMLInputElement|null} */ (el('nxMailComposeTo')),
        sug: el('nxMailDirSuggestTo'),
        chips: el('nxMailComposeToChips'),
      }
    if (kind === 'cc')
      return {
        inp: /** @type {HTMLInputElement|null} */ (el('nxMailComposeCcInp')),
        sug: el('nxMailDirSuggestCc'),
        chips: el('nxMailComposeCcChips'),
      }
    return {
      inp: /** @type {HTMLInputElement|null} */ (el('nxMailComposeBccInp')),
      sug: el('nxMailDirSuggestBcc'),
      chips: el('nxMailComposeBccChips'),
    }
  }

  function recipientListedInKind(kind, badge) {
    var k = badgeKey(badge)
    return nxComposeRecipients[kind].some(function (b) {
      return badgeKey(b) === k
    })
  }

  function clearAllSuggestDropdowns() {
    ;['to', 'cc', 'bcc'].forEach(function (kind) {
      var s = getRecipCfg(kind).sug
      if (s) s.innerHTML = ''
    })
  }

  function renderComposeChips(kind) {
    var chipsEl = getRecipCfg(kind).chips
    if (!chipsEl) return
    var arr = nxComposeRecipients[kind] || []
    chipsEl.innerHTML = arr
      .map(function (badge, idx) {
        var label = badgeMailboxLabel(badge)
        return (
          '<span class="gmail-cm-chip" data-kind="' +
          kind +
          '" data-i="' +
          idx +
          '"><span class="gmail-cm-chip-txt">' +
          escapeHtml(label) +
          '</span><button type="button" class="gmail-cm-chip-x" aria-label="Remove recipient">&times;</button></span>'
        )
      })
      .join('')
  }

  function renderAllComposeChips() {
    renderComposeChips('to')
    renderComposeChips('cc')
    renderComposeChips('bcc')
  }

  /** @param {'to'|'cc'|'bcc'} kind @param {string} [rawFromSuggestion] */
  function tryAddRecipient(kind, rawFromSuggestion) {
    var cfg = getRecipCfg(kind)
    var raw =
      rawFromSuggestion != null && String(rawFromSuggestion).trim() !== ''
        ? String(rawFromSuggestion).trim()
        : ((cfg.inp && cfg.inp.value) || '').trim()
    if (!raw) return
    var token = parseRecipientBadge(raw) || raw.trim()
    if (!token) {
      nxMailToast('Enter a valid mailbox or badge.', 'error')
      return
    }
    var me = myBadgeFromStorage()
    if (me && badgesEquivalent(token, me)) {
      nxMailToast('You cannot add yourself as a recipient.', 'error')
      return
    }
    if (recipientListedInKind(kind, token)) {
      nxMailToast('That recipient is already in this row.', 'error')
      return
    }
    ;['to', 'cc', 'bcc'].forEach(function (knd) {
      nxComposeRecipients[knd] = nxComposeRecipients[knd].filter(function (b) {
        return badgeKey(b) !== badgeKey(token)
      })
    })
    nxComposeRecipients[kind].push(token)
    if (cfg.inp) cfg.inp.value = ''
    clearAllSuggestDropdowns()
    renderAllComposeChips()
  }

  function composeDirSuggestRun(kind) {
    var cfg = getRecipCfg(kind)
    var inp = cfg.inp
    var sug = cfg.sug
    if (!inp || !sug) return
    var q = (inp.value || '').trim()
    if (q.length < 1) {
      sug.innerHTML = ''
      return
    }
    var qLookup = parseRecipientBadge(q) || q
    fetchJson('GET', '/api/nexus-mail?directory=1&q=' + encodeURIComponent(qLookup))
      .then(function (data) {
        dirCache = data.directory || []
        sug.innerHTML = dirCache
          .slice(0, 24)
          .map(function (u) {
            var mail = badgeMailboxLabel(u.badge || '')
            return (
              '<button type="button" class="nx-mail-sug-it" data-mail="' +
              escapeHtml(mail) +
              '">' +
              escapeHtml(u.name || u.badge || '') +
              '<span>' +
              escapeHtml(mail) +
              '</span></button>'
            )
          })
          .join('')
        sug.querySelectorAll('.nx-mail-sug-it').forEach(function (b) {
          b.onmousedown = function (ev) {
            ev.preventDefault()
          }
          b.onclick = function (ev) {
            ev.preventDefault()
            var mailAddr = (b.getAttribute('data-mail') || '').trim()
            tryAddRecipient(kind, mailAddr)
          }
        })
      })
      .catch(function () {
        sug.innerHTML = ''
      })
  }

  function scheduleComposeSuggest(kind) {
    ;['to', 'cc', 'bcc'].forEach(function (k) {
      if (k !== kind) {
        var o = getRecipCfg(k).sug
        if (o) o.innerHTML = ''
      }
    })
    clearTimeout(dirDeb)
    dirDeb = /** @type {unknown} */ (
      setTimeout(function () {
        composeDirSuggestRun(kind)
      }, 240)
    )
  }

  var nxComposeRecipWired = false
  function wireComposeRecipientUi() {
    if (nxComposeRecipWired) return
    nxComposeRecipWired = true
    ;['to', 'cc', 'bcc'].forEach(function (kind) {
      var cfg = getRecipCfg(kind)
      if (cfg.inp) {
        cfg.inp.addEventListener('input', function () {
          scheduleComposeSuggest(kind)
        })
        cfg.inp.addEventListener('focus', function () {
          scheduleComposeSuggest(kind)
        })
        cfg.inp.addEventListener('blur', function () {
          normalizeComposeDraft(cfg.inp)
        })
        cfg.inp.addEventListener('keydown', function (ev) {
          if (ev.key !== 'Enter') return
          ev.preventDefault()
          tryAddRecipient(kind)
        })
      }
    })
    var modal = el('nxMailComposeModal')
    if (modal) {
      modal.addEventListener('click', function (ev) {
        var x = typeof ev.target.closest === 'function' ? ev.target.closest('.gmail-cm-chip-x') : null
        if (!x || !modal.contains(x)) return
        var chip = x.closest('.gmail-cm-chip')
        if (!chip) return
        var k = chip.getAttribute('data-kind')
        var idx = parseInt(chip.getAttribute('data-i') || '-1', 10)
        if (k !== 'to' && k !== 'cc' && k !== 'bcc') return
        var arr = nxComposeRecipients[k]
        if (idx >= 0 && arr) {
          arr.splice(idx, 1)
          renderComposeChips(k)
        }
      })
    }
  }

  /** @param {unknown} mime @param {unknown} filename */
  function nxMailMimeIsBrowserImageThumb(mime, filename) {
    var m = String(mime || '').toLowerCase()
    if (m === 'image/jpg') m = 'image/jpeg'
    if (/^image\/(jpeg|png|gif|webp)$/.test(m)) return true
    return /\.(jpe?g|png|gif|webp)$/i.test(String(filename || ''))
  }

  /** @param {{ _previewUrl?: string } | null | undefined} row */
  function nxMailRevokeAttachmentRowPreview(row) {
    if (!row || typeof row._previewUrl !== 'string') return
    try {
      URL.revokeObjectURL(row._previewUrl)
    } catch (_) {}
    delete row._previewUrl
  }

  /** Badge text for non-image preview tiles */
  function nxMailAttachmentTypeBadge(filename, mime) {
    var fn = String(filename || 'file')
    var ext = /\.([a-zA-Z0-9]{1,8})$/i.exec(fn)
    if (ext && ext[1]) return ext[1].toUpperCase()
    var tail = String(mime || '').split('/')[1]
    if (tail) return tail.replace(/[^\w]/g, '').slice(0, 6).toUpperCase() || 'FILE'
    return 'FILE'
  }

  /**
   * Thumbnail row: image blob URL when available; otherwise type badge placeholder.
   * @param {{ filename?: string, mime?: string, _previewUrl?: string }} att
   * @param {boolean} forReply
   */
  function nxMailComposePreviewMarkup(att, forReply) {
    var fnEsc = escapeHtml(String(att.filename || 'file'))
    var urlRaw = typeof att._previewUrl === 'string' ? att._previewUrl : ''
    var isBlobImg =
      urlRaw && /^blob:/i.test(urlRaw) && nxMailMimeIsBrowserImageThumb(att.mime, att.filename)

    var wrapCls = forReply ? 'nx-mail-reply-thumb-wrap' : 'gmail-compose-att-thumb-wrap'
    if (isBlobImg)
      return (
        '<div class="' +
        wrapCls +
        ' nx-mail-att-preview-shell">' +
        '<img class="gmail-compose-att-thumb ' +
        (forReply ? 'nx-mail-reply-att-local-thumb' : 'gmail-compose-att-local-thumb') +
        '" src="' +
        escapeHtml(urlRaw) +
        '" alt="' +
        fnEsc +
        '" loading="lazy"/></div>'
      )

    var badge = nxMailAttachmentTypeBadge(att.filename, att.mime)
    var ph =
      wrapCls +
      ' nx-mail-att-preview-placeholder' +
      (forReply ? ' nx-mail-att-preview-ph-reply' : '')
    return (
      '<div class="' + ph + '" title="' + fnEsc + '">' + escapeHtml(badge) + '</div>'
    )
  }

  function nxMailDrainBucketAttachments(bucket) {
    for (var i = 0; i < bucket.length; i++) nxMailRevokeAttachmentRowPreview(bucket[i])
    bucket.length = 0
  }

  function nxMailAttachmentUploadingPending(bucket) {
    return bucket.some(function (a) {
      return a && a._uploading
    })
  }

  /** Server-ready attachment rows only (omit in-flight stubs). */
  function nxMailAttachmentsReadyPayload(bucket) {
    return bucket
      .filter(function (a) {
        return a && !a._uploading && typeof a.path === 'string' && a.path.length > 0
      })
      .map(function (a) {
        return {
          path: a.path,
          filename: a.filename,
          mime: a.mime,
          size_bytes: typeof a.size_bytes === 'number' ? a.size_bytes : 0,
        }
      })
  }

  /**
   * Upload files to Nexus Storage as soon as they are chosen (parallel, Gmail-like).
   * @param {'compose' | 'reply'} scope
   * @param {FileList | File[] | null} rawFiles
   */
  async function handleMailboxFileSelection(scope, rawFiles) {
    var bucket = scope === 'reply' ? nxReplyAttachments : nxComposeAttachments
    /** @type {File[]} */
    var files = []
    if (rawFiles && typeof rawFiles.length === 'number') {
      for (var jj = 0; jj < rawFiles.length; jj++) {
        var item = rawFiles[jj]
        if (item instanceof File) files.push(item)
      }
    }
    if (!files.length) return

    if (scope === 'compose') {
      var ir0 = el('nxMailComposeImgRow')
      if (ir0) ir0.classList.remove('is-hidden')
    }

    /** @type {{ _id:number, file:File }[]} */
    var jobs = []
    for (var i = 0; i < files.length; i++) {
      var f = files[i]
      if (!(f instanceof File) || !f.name) continue
      if (bucket.length >= NX_MAX_MAIL_ATTACH) {
        nxMailToast('Maximum ' + NX_MAX_MAIL_ATTACH + ' attachments.', 'error')
        break
      }
      var id = nxNextLocalAttId++
      var row = {
        _id: id,
        _uploading: true,
        filename: String(f.name || 'file'),
        mime: f.type ? String(f.type) : 'application/octet-stream',
        size_bytes: typeof f.size === 'number' ? f.size : 0,
      }
      if (nxMailMimeIsBrowserImageThumb(row.mime, row.filename))
        row._previewUrl = URL.createObjectURL(f)
      bucket.push(row)
      jobs.push({ _id: id, file: f })
    }
    if (!jobs.length) return
    if (scope === 'reply') renderNxReplyAttachments()
    else renderNxComposeAttachments()

    function renderAtt() {
      if (scope === 'reply') renderNxReplyAttachments()
      else renderNxComposeAttachments()
    }

    await Promise.all(
      jobs.map(function (job) {
        return nmailUploadFile(job.file)
          .then(function (uploaded) {
            var found = bucket.find(function (x) {
              return x && x._id === job._id
            })
            if (found && found._uploading) {
              found.path = uploaded.path
              found.filename = uploaded.filename
              found.mime = uploaded.mime
              found.size_bytes =
                typeof uploaded.size_bytes === 'number' ? uploaded.size_bytes : job.file.size || 0
              delete found._uploading
            }
            renderAtt()
          })
          .catch(function (err) {
            var j = bucket.findIndex(function (x) {
              return x && x._id === job._id
            })
            if (j >= 0) {
              nxMailRevokeAttachmentRowPreview(bucket[j])
              bucket.splice(j, 1)
            }
            nxMailToast('Upload failed: ' + ((err && err.message) || err), 'error')
            renderAtt()
          })
      }),
    )
  }

  function formatBytesShort(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return ''
    if (n < 1024) return n + ' B'
    var kb = n / 1024
    if (kb < 1024) return (kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)) + ' KB'
    var mb = kb / 1024
    return (mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)) + ' MB'
  }

  function renderNxComposeAttachments() {
    var listEl = el('nxMailComposeImgList')
    if (!listEl) return
    listEl.innerHTML = nxComposeAttachments
      .map(function (a, idx) {
        var sz =
          typeof a.size_bytes === 'number' && a.size_bytes > 0 ? formatBytesShort(a.size_bytes) : ''
        var mi = escapeHtml(String(a.mime || '').slice(0, 80))
        var uploading = !!a._uploading
        var up = uploading
          ? '<span class="gmail-compose-att-progress">Uploading…</span>'
          : '<span class="gmail-compose-att-done">Uploaded</span>'
        var rmDis = uploading ? ' disabled' : ''
        return (
          '<div class="gmail-compose-att-item gmail-compose-att-item--preview">' +
          '<button type="button" class="gmail-compose-att-remove"' +
          rmDis +
          ' data-scope="compose" data-i="' +
          idx +
          '" aria-label="Remove attachment">&times;</button>' +
          nxMailComposePreviewMarkup(a, false) +
          '<div class="gmail-compose-att-file-row"><div class="gmail-compose-att-meta">' +
          escapeHtml(String(a.filename || 'file')) +
          '<br/><span style="opacity:.82;font-size:11px">' +
          mi +
          (sz ? ' · ' + escapeHtml(sz) : '') +
          ' · ' +
          up +
          '</span></div></div>' +
          '</div>'
        )
      })
      .join('')
  }

  function renderNxReplyAttachments() {
    var listEl = el('nxMailReplyImgList')
    if (!listEl) return
    listEl.innerHTML = nxReplyAttachments
      .map(function (a, idx) {
        var sz =
          typeof a.size_bytes === 'number' && a.size_bytes > 0 ? formatBytesShort(a.size_bytes) : ''
        var mi = escapeHtml(String(a.mime || '').slice(0, 80))
        var repUp = !!a._uploading
        var up = repUp
          ? '<span class="nx-mail-att-progress">Uploading…</span>'
          : '<span class="nx-mail-att-done">Uploaded</span>'
        var rmDis = repUp ? ' disabled' : ''
        return (
          '<div class="nx-mail-reply-att-item nx-mail-reply-att--preview">' +
          '<button type="button" class="nx-mail-reply-att-remove"' +
          rmDis +
          ' data-scope="reply" data-i="' +
          idx +
          '" aria-label="Remove attachment">&times;</button>' +
          nxMailComposePreviewMarkup(a, true) +
          '<div class="nx-mail-reply-att-file-row"><div class="gmail-compose-att-meta">' +
          escapeHtml(String(a.filename || 'file')) +
          '<br/><span style="opacity:.82;font-size:11px">' +
          mi +
          (sz ? ' · ' + escapeHtml(sz) : '') +
          ' · ' +
          up +
          '</span></div></div>' +
          '</div>'
        )
      })
      .join('')
  }

  /**
   * Drag-and-drop files onto compose sheet or reply (capture phase avoids contenteditable swallowing drops).
   * @param {'compose' | 'reply'} scope
   * @param {HTMLElement | null} zone
   */
  function bindAttachmentDropZone(scope, zone) {
    if (!zone || zone._nxMailDropBound) return
    zone._nxMailDropBound = true

    /** @param {DragEvent} ev */
    function hasFiles(ev) {
      var dt = ev.dataTransfer
      if (!dt || !dt.types) return false
      var ts = dt.types
      for (var i = 0; i < ts.length; i++) if (ts[i] === 'Files') return true
      return false
    }

    var depth = 0
    zone.addEventListener('dragenter', function (ev) {
      if (!hasFiles(ev)) return
      ev.preventDefault()
      depth++
      if (depth === 1) zone.classList.add('is-nx-mail-drop-hover')
    })
    zone.addEventListener('dragleave', function (ev) {
      if (!hasFiles(ev)) return
      ev.preventDefault()
      depth = Math.max(0, depth - 1)
      if (depth === 0) zone.classList.remove('is-nx-mail-drop-hover')
    })
    zone.addEventListener(
      'dragover',
      function (ev) {
        if (!hasFiles(ev)) return
        ev.preventDefault()
        try {
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
        } catch (_) {}
      },
      true,
    )
    zone.addEventListener(
      'drop',
      function (ev) {
        if (!hasFiles(ev)) return
        ev.preventDefault()
        ev.stopPropagation()
        depth = 0
        zone.classList.remove('is-nx-mail-drop-hover')
        var fl = ev.dataTransfer && ev.dataTransfer.files
        if (fl && fl.length) {
          void handleMailboxFileSelection(scope, fl)
        }
      },
      true,
    )
  }

  /** One-time delegated handlers for compose/reply attachment UI. */
  var nxMailAttachmentsWired = false
  function nxWireMailAttachmentsOnce() {
    if (nxMailAttachmentsWired) return
    nxMailAttachmentsWired = true

    var nxRoot = el('nxMailOverlay') || document
    nxRoot.addEventListener('click', function (ev) {
      var tgt = typeof ev.target.closest === 'function' ? ev.target.closest('.gmail-compose-att-remove, .nx-mail-reply-att-remove') : null
      if (!tgt || tgt.disabled) return
      var sc = tgt.getAttribute('data-scope')
      var i = parseInt(tgt.getAttribute('data-i') || '-1', 10)
      if (sc === 'compose' && i >= 0 && i < nxComposeAttachments.length) {
        ev.preventDefault()
        nxMailRevokeAttachmentRowPreview(nxComposeAttachments[i])
        nxComposeAttachments.splice(i, 1)
        renderNxComposeAttachments()
      } else if (sc === 'reply' && i >= 0 && i < nxReplyAttachments.length) {
        ev.preventDefault()
        nxMailRevokeAttachmentRowPreview(nxReplyAttachments[i])
        nxReplyAttachments.splice(i, 1)
        renderNxReplyAttachments()
      }
    })

    var cPick = el('nxMailComposeAttachPickBtn')
    var cInp = el('nxMailComposeFileInp')
    if (cPick && cInp) {
      cPick.addEventListener('click', function (ev) {
        ev.preventDefault()
        cInp.click()
      })
      cInp.addEventListener('change', function () {
        void handleMailboxFileSelection('compose', cInp.files)
        cInp.value = ''
      })
    }

    var rPick = el('nxMailReplyAttachPickBtn')
    var rInp = el('nxMailReplyFileInp')
    if (rPick && rInp) {
      rPick.addEventListener('click', function (ev) {
        ev.preventDefault()
        rInp.click()
      })
      rInp.addEventListener('change', function () {
        void handleMailboxFileSelection('reply', rInp.files)
        rInp.value = ''
      })
    }

    bindAttachmentDropZone('compose', el('nxMailComposeDropZone'))
    bindAttachmentDropZone('reply', el('nxMailReplyDropZone'))
  }

  function updateUnreadBell() {
    const n = threads.reduce((a, t) => a + (t.unread_count || 0), 0)
    const b = el('nxMailUnreadBadge')
    const navB = el('nxMailNavUnreadBadge')
    if (b) {
      if (n > 0) {
        b.style.display = 'flex'
        b.textContent = n > 99 ? '99+' : String(n)
      } else {
        b.style.display = 'none'
      }
    }
    if (navB) {
      if (n > 0) {
        navB.textContent = n > 99 ? '99+' : String(n)
        navB.classList.remove('is-empty')
      } else {
        navB.textContent = ''
        navB.classList.add('is-empty')
      }
    }
  }

  async function loadInbox(opt) {
    opt = opt || {}
    var refreshBtn = opt.refreshBtn
    var listBusy = opt.listBusy
    if (refreshBtn && nxMailInboxBusy) return
    if (refreshBtn) nxMailInboxBusy = true
    if (refreshBtn) nxMailButtonBusy(refreshBtn, true, { text: '…' })
    if (listBusy) {
      var tl0 = el('nxMailThreadList')
      if (tl0) tl0.classList.add('is-nx-mail-loading')
    }
    try {
      const data = await fetchJson('GET', '/api/nexus-mail')
      threads = coerceInboxThreads(data)
      renderThreadRows()
      updateUnreadBell()
    } catch (e) {
      nxMailToast('NMAIL: ' + (e?.message || e), 'error')
    } finally {
      if (listBusy) {
        var tl1 = el('nxMailThreadList')
        if (tl1) tl1.classList.remove('is-nx-mail-loading')
      }
      if (refreshBtn) {
        nxMailButtonBusy(refreshBtn, false)
        nxMailInboxBusy = false
      }
    }
  }

  /** After PATCH mark-read succeeds: sidebar unread without a full inbox GET */
  function markThreadUnreadClearedLocally(threadId) {
    var id = String(threadId || '')
    var changed = false
    threads = threads.map(function (t) {
      if (t.id !== id) return t
      var uc = Number(t.unread_count) || 0
      if (!uc) return t
      changed = true
      return Object.assign({}, t, { unread_count: 0 })
    })
    if (changed) renderThreadRows()
    updateUnreadBell()
    document.querySelectorAll('.nx-mail-thread-row').forEach(function (btn) {
      btn.classList.toggle('is-selected', btn.getAttribute('data-tid') === id)
    })
  }

  function renderEmptyState(txt) {
    var right = el('nxMailMsgs')
    if (!right) return
    right.classList.remove('nx-mail-msgs-has-shell')
    right.innerHTML = `<div class="nx-mail-empty nx-gmail-reading-empty">${escapeHtml(txt)}</div>`
  }

  function nxInboxSortMs(t) {
    var keys = ['updated_at', 'created_at', 'last_message_at']
    var best = 0
    for (var i = 0; i < keys.length; i++) {
      var ms = Date.parse(t[keys[i]] || '')
      if (Number.isFinite(ms) && ms > best) best = ms
    }
    return best
  }

  function renderThreadRows() {
    const tb = el('nxMailThreadList')
    if (!tb) return
    if (!threads.length) {
      tb.innerHTML = '<div class="nx-mail-thread-empty nx-gmail-thread-empty">No conversations yet.<br/><span>Use <strong>Compose</strong> to send to another officer.</span></div>'
      return
    }
    const sorted = threads.slice().sort(function (a, b) {
      var d = nxInboxSortMs(b) - nxInboxSortMs(a)
      if (d !== 0) return d
      return String(b.id || '').localeCompare(String(a.id || ''))
    })
    tb.innerHTML = sorted
      .map(function (t) {
        const un = Number(t.unread_count) > 0
        const who = escapeHtml(t.peer_name || t.peer_badge)
        const sub = escapeHtml(t.subject || '(No subject)')
        const sn =
          escapeHtml(String(t.last_snippet || '').slice(0, 90)) ||
          '&nbsp;' /* keep row height stable */
        return (
          `<button type="button" data-tid="${escapeHtml(t.id)}" class="nx-mail-thread-row nx-gmail-thread-row ${un ? 'is-unread' : ''}">
            <span class="nx-gmail-list-star" aria-hidden="true">☆</span>
            <span class="nx-gmail-row-pad" aria-hidden="true"></span>
            <div class="nx-gmail-thread-row-inner">
              <div class="nx-gmail-thread-line1">
                <span class="nx-mail-row-from">${who}</span>
                <span class="nx-mail-row-sub">${sub}</span>
                <span class="nx-mail-row-time">${escapeHtml(fmtTime(t.updated_at))}</span>
              </div>
              <div class="nx-mail-row-sn nx-gmail-thread-sn">${sn}</div>
            </div>
          </button>`
        )
      })
      .join('')

    tb.querySelectorAll('.nx-mail-thread-row').forEach(function (btn) {
      btn.onclick = function () {
        openThreadFn(btn.getAttribute('data-tid') || '')
      }
    })
  }

  function renderHeader(meta) {
    const h = el('nxMailThreadHeader')
    if (!h) return
    if (!meta || !meta.peer_badge) {
      h.innerHTML =
        `<div class="nx-gmail-subject-slot-inner nx-gmail-subject-slot-empty"><p class="nx-gmail-thread-title-muted">Conversation</p><span class="nx-gmail-slot-hint">Pick a thread in the list or tap Compose</span></div>`
      return
    }
    const sub = escapeHtml(meta.subject || '(No subject)')
    h.innerHTML =
      `<div class="nx-gmail-subject-slot-inner">
          <div class="nx-gmail-thread-head-gmail">
            <h1 class="nx-gmail-thread-title">${sub}</h1>
            <span class="nx-gmail-inbox-folder-chip">Inbox</span>
          </div>
       </div>`
  }

  function renderMessages(meta, msgs, meBadge) {
    const host = el('nxMailMsgs')
    if (!host) return
    if (!msgs || !msgs.length) {
      host.innerHTML =
        `<div class="nx-mail-msg-cells nx-msg-cells"><div class="nx-mail-msg-email nx-mail-msg-system nx-gmail-reading-empty">${escapeHtml('No messages yet.')}</div></div>`
      host.classList.remove('nx-mail-msgs-has-shell')
      nxMailScrollConvToEnd()
      return
    }

    const peer = meta && meta.peer_badge ? meta.peer_badge : ''
    const peerAddr = escapeHtml(badgeMailboxLabel(peer) || peer || '—')
    const selfAddr = escapeHtml(badgeMailboxLabel(meBadge) || String(meBadge || '').trim() || '—')
    const peerLabel = escapeHtml(meta.peer_name || peer || '')
    var lastIx = msgs.length - 1

    function labelAddr(badgeRaw) {
      return escapeHtml(badgeMailboxLabel(badgeRaw || '') || String(badgeRaw || '').trim() || '—')
    }

    function buildRecipientHtml(m, mine) {
      var recs = m.recipients || []
      if (!recs.length) {
        if (mine)
          return (
            '<div class="nx-gmail-rcpt-block"><div class="nx-gmail-rcpt-row"><span class="nx-gmail-rcpt-k">To</span><span class="nx-gmail-rcpt-v">' +
            (peerLabel || peerAddr) +
            '</span></div></div>'
          )
        return (
          '<div class="nx-gmail-rcpt-block"><div class="nx-gmail-rcpt-row"><span class="nx-gmail-rcpt-k">To</span><span class="nx-gmail-rcpt-v nx-gmail-kepada-me">me</span></div></div>'
        )
      }
      var showBcc = mine
      var toL = []
      var ccL = []
      var bccL = []
      recs.forEach(function (r) {
        var lab = labelAddr(r.recipient_badge)
        if (r.kind === 'to') toL.push(lab)
        else if (r.kind === 'cc') ccL.push(lab)
        else if (r.kind === 'bcc') bccL.push(lab)
      })
      var parts = ''
      if (toL.length)
        parts +=
          '<div class="nx-gmail-rcpt-row"><span class="nx-gmail-rcpt-k">To</span><span class="nx-gmail-rcpt-v">' +
          toL.join(', ') +
          '</span></div>'
      if (ccL.length)
        parts +=
          '<div class="nx-gmail-rcpt-row"><span class="nx-gmail-rcpt-k">Cc</span><span class="nx-gmail-rcpt-v">' +
          ccL.join(', ') +
          '</span></div>'
      if (showBcc && bccL.length)
        parts +=
          '<div class="nx-gmail-rcpt-row"><span class="nx-gmail-rcpt-k">Bcc</span><span class="nx-gmail-rcpt-v">' +
          bccL.join(', ') +
          '</span></div>'
      return '<div class="nx-gmail-rcpt-block">' + parts + '</div>'
    }

    function pieceForSender(m, prevRowForQuote) {
      const mine = meBadge && badgesEquivalent(m.sender_badge, meBadge)
      const fromName = mine
        ? 'You'
        : escapeHtml(m.sender_badge === peer ? (meta.peer_name || m.sender_badge) : m.sender_badge)
      const fromAddr = mine
        ? selfAddr
        : escapeHtml(badgeMailboxLabel(m.sender_badge || '') || String(m.sender_badge || '').trim() || '')
      var recipientHtml = buildRecipientHtml(m, mine)
      const avatarSeed = mine
        ? String(meBadge || 'You').trim()
        : m.sender_badge === peer
          ? meta.peer_name || peer || ''
          : String(m.sender_badge || '')
      const letters = nxAvatarLetters(avatarSeed || '—')
      const when = escapeHtml(fmtTime(m.created_at))
      const clockRel =
        `${escapeHtml(fmtClockId(String(m.created_at || '')))}${
          fmtRelativeId(m.created_at) ? ` (${escapeHtml(fmtRelativeId(m.created_at))})` : ''
        }`
      const bodyHtml = renderMsgBodyMarkup(m.body)
      const htmlClass = /<[a-z]/i.test(String(m.body || '')) ? ' nx-mail-msg-body-html' : ''
      const attachments = nxMailRenderableAttachments(m)
      let attHtml = ''
      if (attachments.length) {
        attHtml =
          '<div class="nx-mail-msg-attachments">' +
          attachments
            .map(function (a) {
              var fname = escapeHtml(String(a.filename || 'file'))
              var url = typeof a.download_url === 'string' ? a.download_url.trim() : ''
              var mime = String(a.mime || '').toLowerCase()
              var isImg = url && mime.indexOf('image/') === 0
              if (!url)
                return (
                  '<span class="nx-mail-msg-file-chip" title="Unavailable">' +
                  fname +
                  ' <span style="opacity:.7">(refresh thread)</span></span>'
                )
              const uEsc = escapeHtml(url)
              if (isImg)
                return `<a href="${uEsc}" target="_blank" rel="noopener noreferrer" class="nx-mail-msg-img-thumb-link"><img class="nx-mail-msg-img-thumb" src="${uEsc}" alt="${fname}" loading="lazy" referrerpolicy="no-referrer"/></a>`
              return (
                `<a href="${uEsc}" target="_blank" rel="noopener noreferrer" class="nx-mail-msg-file-chip" download>` +
                fname +
                `</a>`
              )
            })
            .join('') +
          '</div>'
      }
      var roleCls = mine ? ' is-sent' : ' is-received'
      var fromEmailSpan = fromAddr ? `<span class="nx-gmail-msg-from-email">&lt;${fromAddr}&gt;</span>` : ''

      var quoteTail = ''
      if (prevRowForQuote && msgs.length >= 2) {
        var pm = prevRowForQuote
        var pmMine = meBadge && badgesEquivalent(pm.sender_badge, meBadge)
        var qName = pmMine
          ? 'You'
          : escapeHtml(pm.sender_badge === peer ? (meta.peer_name || pm.sender_badge) : pm.sender_badge)
        var qAddr = escapeHtml(
          badgeMailboxLabel(pm.sender_badge || '') || String(pm.sender_badge || '').trim() || '',
        )
        var cuando = escapeHtml(fmtOnDateEn(pm.created_at))
        var qp = nxMailSnippetPlain(pm.body, 600)
        var qBody = qp ? escapeHtml(qp).replace(/\n/g, '<br/>') : ''
        quoteTail =
          '<div class="nx-gmail-thread-quote">' +
          '<span class="nx-gmail-quote-line">' +
          'On ' +
          cuando +
          ', <strong>' +
          qName +
          '</strong> &lt;' +
          qAddr +
          '&gt; wrote:</span>' +
          (qBody ? '<blockquote class="nx-gmail-quote-block">' + qBody + '</blockquote>' : '') +
          '</div>'
      }

      return {
        fromName,
        letters,
        fromEmailSpan,
        recipientHtml,
        when,
        clockRel,
        roleCls,
        bodyHtml,
        htmlClass,
        attHtml,
        quoteTail,
        isoAttr: escapeHtml(String(m.created_at || '')),
      }
    }

    host.innerHTML =
      '<div class="nx-msgs-conv-shell" role="presentation">' +
      '<div class="nx-mail-msg-cells nx-msg-cells nx-msg-cells--conv nx-msg-cells--gmail-open">' +
      msgs
        .map(function (m, idx) {
          var foldOlder = msgs.length >= 2 && idx < lastIx
          var prevQuote = foldOlder ? null : idx > 0 ? msgs[idx - 1] : null
          var p = pieceForSender(m, prevQuote)
          var fromEmailSpan = p.fromEmailSpan

          if (foldOlder) {
            var snRaw = nxMailSnippetPlain(m.body, 64)
            var snText = snRaw.trim() ? snRaw : ''
            if (!snText) {
              var attN = nxMailRenderableAttachments(m).length
              if (attN > 1) snText = '[' + attN + ' attachments]'
              else if (attN === 1) snText = '[Attachment]'
              else snText = '…'
            }
            return (
              `<details class="nx-gmail-msg-fold">` +
              `<summary class="nx-gmail-msg-fold-sum"><span class="nx-gmail-fold-sum-inner">` +
              `<span class="nx-gmail-msg-avatar nx-gmail-msg-avatar--fold" aria-hidden="true">${escapeHtml(
                p.letters,
              )}</span>` +
              `<span class="nx-gmail-fold-name">${p.fromName}</span>` +
              `<span class="nx-gmail-fold-sn">${escapeHtml(snText)}</span>` +
              `<span class="nx-gmail-fold-time">${p.clockRel}</span>` +
              `</span></summary>` +
              `<div class="nx-gmail-fold-body">` +
              `<article class="nx-mail-msg-email nx-gmail-msg nx-gmail-msg-read-open nx-gmail-msg--in-fold ${p.roleCls}">` +
              `<header class="nx-gmail-msg-read-meta"><div class="nx-gmail-msg-avatar">` +
              escapeHtml(p.letters) +
              `</div><div class="nx-gmail-msg-ident"><div class="nx-gmail-msg-ident-top">` +
              `<span class="nx-gmail-msg-from-name">${p.fromName}</span>` +
              `${fromEmailSpan}<time class="nx-gmail-msg-open-time" datetime="${p.isoAttr}">${p.when}</time></div>` +
              `<div class="nx-gmail-msg-rcpt-wrap">${p.recipientHtml}</div></div></header>` +
              `<div class="nx-mail-msg-body nx-mail-msg-email-body nx-gmail-read-msg-body${p.htmlClass}">` +
              `${p.bodyHtml}${p.attHtml}</div>` +
              `</article>` +
              `</div>` +
              `</details>`
            )
          }

          return (
            `<article class="nx-mail-msg-email nx-gmail-msg nx-gmail-msg-read-open ${p.roleCls}">` +
            `<header class="nx-gmail-msg-read-meta">` +
            `<div class="nx-gmail-msg-avatar">${escapeHtml(p.letters)}</div>` +
            `<div class="nx-gmail-msg-ident">` +
            `<div class="nx-gmail-msg-ident-top">` +
            `<span class="nx-gmail-msg-from-name">${p.fromName}</span>` +
            `${fromEmailSpan}<time class="nx-gmail-msg-open-time" datetime="${p.isoAttr}">${p.when}</time></div>` +
            `<div class="nx-gmail-msg-rcpt-wrap">${p.recipientHtml}</div>` +
            `</div>` +
            `</header>` +
            `<div class="nx-mail-msg-body nx-mail-msg-email-body nx-gmail-read-msg-body${p.htmlClass}">` +
            `${p.bodyHtml}${p.attHtml}${p.quoteTail}</div>` +
            `</article>`
          )
        })
        .join('') +
      '<div class="nx-gmail-msg-quick-bar" role="toolbar" aria-label="Quick actions">' +
      '<button type="button" class="nx-gmail-pill-btn nx-gmail-pill-reply" id="nxMailQuickReply">' +
      '<span class="nx-gmail-pill-glyph" aria-hidden="true">↩</span> Reply</button>' +
      '<button type="button" class="nx-gmail-pill-btn nx-gmail-pill-fwd" disabled title="Not available">' +
      '<span class="nx-gmail-pill-glyph" aria-hidden="true">↪</span> Forward</button>' +
      '</div>' +
      '</div></div>'
    host.classList.add('nx-mail-msgs-has-shell')
    nxMailScrollConvToEnd()
  }

  async function openThreadFn(id) {
    if (!id) return
    if (nxMailOpenThreadBusy) return
    nxMailOpenThreadBusy = true
    nxMailSetMailPaneLoading(true)
    try {
      const data = await fetchJson('GET', '/api/nexus-mail?thread=' + encodeURIComponent(id))
      /** @type {any} */
      const meta = data.thread || {}
      openThread = { meta, msgs: data.messages || [] }
      renderHeader(openThread.meta)
      renderMessages(
        openThread.meta,
        openThread.msgs,
        String(openThread.meta.viewer_badge || '').trim() || myBadgeFromStorage(),
      )
      const replyHdr = el('nxMailReplyMeta')
      if (replyHdr) {
        var vb = String(openThread.meta.viewer_badge || '').trim() || myBadgeFromStorage()
        var plist = openThread.meta.participants
        var line = ''
        if (plist && plist.length) {
          var others = plist.filter(function (p) {
            return !badgesEquivalent(p.badge, vb)
          })
          line = others
            .map(function (p) {
              return badgeMailboxLabel(p.badge || '') || p.badge || ''
            })
            .filter(Boolean)
            .join(', ')
        }
        if (!line) line = badgeMailboxLabel(meta.peer_badge || '') || meta.peer_badge || ''
        replyHdr.innerHTML =
          '<strong class="nx-gmail-reply-to-name">' + escapeHtml(line || '—') + '</strong>'
      }
      try {
        await fetchJson('PATCH', '/api/nexus-mail', { thread_id: id })
        markThreadUnreadClearedLocally(id)
      } catch (_) {
        /* allow read failures — still refresh list from server */
        await loadInbox()
      }
      el('nxMailReplyBody') && (el('nxMailReplyBody').value = '')
      nxMailDrainBucketAttachments(nxReplyAttachments)
      renderNxReplyAttachments()
      nxMailComposerSetOpen(true)
      document.querySelectorAll('.nx-mail-thread-row').forEach(function (btn) {
        btn.classList.toggle('is-selected', btn.getAttribute('data-tid') === id)
      })
      nxMailScrollConvToEnd()
    } catch (e) {
      nxMailToast((e && e.message) || String(e), 'error')
    } finally {
      nxMailSetMailPaneLoading(false)
      nxMailOpenThreadBusy = false
    }
  }

  async function submitReply() {
    if (!openThread || !openThread.meta) return
    if (nxMailReplyBusy) return
    const body = ((el('nxMailReplyBody') && el('nxMailReplyBody').value) || '').trim()
    if (nxMailAttachmentUploadingPending(nxReplyAttachments)) {
      nxMailToast('Wait for attachments to finish uploading.', 'error')
      return
    }
    var attaches = nxMailAttachmentsReadyPayload(nxReplyAttachments)
    if (!body && !attaches.length) {
      nxMailToast('Write a message or attach at least one file.', 'error')
      return
    }
    var replyBtn = el('nxMailSendReplyBtn')
    nxMailReplyBusy = true
    nxMailButtonBusy(replyBtn, true, { text: 'Sending…' })
    try {
      await fetchJson('POST', '/api/nexus-mail', {
        thread_id: openThread.meta.id,
        body,
        attachments: attaches,
      })
      el('nxMailReplyBody').value = ''
      nxMailDrainBucketAttachments(nxReplyAttachments)
      renderNxReplyAttachments()
      await openThreadFn(openThread.meta.id)
      await loadInbox()
    } catch (e) {
      nxMailToast(e.message || String(e), 'error')
    } finally {
      nxMailButtonBusy(replyBtn, false)
      nxMailReplyBusy = false
    }
  }

  function composeShell() {
    return document.querySelector('.nx-mail-compose-modal.gmail-compose')
  }

  function resetComposeCcBccUi() {
    var ccRow = el('nxMailComposeCcRow')
    var bRow = el('nxMailComposeBccRow')
    if (ccRow) ccRow.classList.add('is-hidden')
    if (bRow) bRow.classList.add('is-hidden')
    nxComposeRecipients = { to: [], cc: [], bcc: [] }
    ;['to', 'cc', 'bcc'].forEach(function (kind) {
      var cfg = getRecipCfg(kind)
      if (cfg.inp) cfg.inp.value = ''
      if (cfg.sug) cfg.sug.innerHTML = ''
    })
    renderAllComposeChips()
  }

  function showCompose() {
    const m = el('nxMailComposeModal')
    if (!m) return
    pendingCompose = { to: '' }
    m.classList.add('is-open')
    m.setAttribute('aria-hidden', 'false')
    var shell = composeShell()
    if (shell) shell.classList.remove('is-minimized', 'is-maximized', 'is-toolbar-collapsed')

    var toIn = el('nxMailComposeTo')
    var subIn = el('nxMailComposeSub')
    var bd = el('nxMailComposeBody')
    var imgRow = el('nxMailComposeImgRow')
    if (subIn) subIn.value = ''
    if (bd) bd.innerHTML = ''
    nxMailDrainBucketAttachments(nxComposeAttachments)
    if (imgRow) imgRow.classList.add('is-hidden')
    resetComposeCcBccUi()
    if (toIn) toIn.value = ''
    clearAllSuggestDropdowns()
    renderNxComposeAttachments()
    setNxComposeErr('')

    if (bd) bd.focus()
    else if (toIn) toIn.focus()
  }

  function hideCompose() {
    var m = el('nxMailComposeModal')
    if (m) {
      m.classList.remove('is-open')
      m.setAttribute('aria-hidden', 'true')
    }
    setNxComposeErr('')
  }

  async function submitComposeNew() {
    if (nxMailSendBusy) return
    var toA = nxComposeRecipients.to.slice()
    var ccA = nxComposeRecipients.cc.slice()
    var bccA = nxComposeRecipients.bcc.slice()
    var subject = ((el('nxMailComposeSub') && el('nxMailComposeSub').value) || '').trim()
    var bodyEl = el('nxMailComposeBody')
    var body = composeBodyFromEditor(bodyEl)
    if (nxMailAttachmentUploadingPending(nxComposeAttachments)) {
      var uw = 'Wait for attachments to finish uploading.'
      setNxComposeErr(uw)
      nxMailToast(uw, 'error')
      return
    }
    var attaches = nxMailAttachmentsReadyPayload(nxComposeAttachments)

    if (!toA.length && !ccA.length && !bccA.length) {
      var errTo =
        'Add at least one recipient to To, Cc, or Bcc — pick from the directory list or type a badge and press Enter.'
      setNxComposeErr(errTo)
      nxMailToast(errTo, 'error')
      return
    }
    if (!body && !attaches.length) {
      var errBody = 'Type a message or attach at least one file.'
      setNxComposeErr(errBody)
      nxMailToast(errBody, 'error')
      return
    }
    setNxComposeErr('')
    var sendBtn = el('nxMailComposeSendBtn')
    var sendCaret = el('nxMailComposeSendMenuBtn')
    nxMailSendBusy = true
    nxMailButtonBusy(sendBtn, true, { text: 'Sending…' })
    nxMailButtonBusy(sendCaret, true, {})
    try {
      var payload = {
        to: toA,
        cc: ccA,
        bcc: bccA,
        subject,
        body,
        attachments: attaches,
      }

      var sent = await fetchJson('POST', '/api/nexus-mail', payload)
      nxMailDrainBucketAttachments(nxComposeAttachments)
      renderNxComposeAttachments()
      hideCompose()
      await loadInbox()
      if (sent.thread_id) await openThreadFn(sent.thread_id)
    } catch (e) {
      var msg = e && e.message ? e.message : String(e)
      setNxComposeErr(msg)
      nxMailToast(msg, 'error')
    } finally {
      nxMailButtonBusy(sendBtn, false)
      nxMailButtonBusy(sendCaret, false)
      nxMailSendBusy = false
    }
  }

  function runComposeExec(cmd, val) {
    var bd = el('nxMailComposeBody')
    if (!bd) return
    bd.focus()
    try {
      if (cmd === 'formatBlock') document.execCommand('formatBlock', false, val || 'blockquote')
      else {
        var v = val === '' || val == null ? undefined : val
        document.execCommand(cmd, false, v)
      }
    } catch (_) {
      /* empty */
    }
  }

  function bindGmailCompose() {
    var minB = el('nxMailComposeMinBtn')
    if (minB && !minB._nxBound) {
      minB._nxBound = true
      minB.onclick = function () {
        var s = composeShell()
        if (s) s.classList.toggle('is-minimized')
      }
    }
    var maxB = el('nxMailComposeMaxBtn')
    if (maxB && !maxB._nxBound) {
      maxB._nxBound = true
      maxB.onclick = function () {
        var s = composeShell()
        if (s) s.classList.toggle('is-maximized')
      }
    }
    var ccBtn = el('nxMailComposeCcBtn')
    if (ccBtn && !ccBtn._nxBound) {
      ccBtn._nxBound = true
      ccBtn.onclick = function () {
        var r = el('nxMailComposeCcRow')
        if (!r) return
        r.classList.toggle('is-hidden')
        if (!r.classList.contains('is-hidden')) {
          var ci = el('nxMailComposeCcInp')
          if (ci)
            setTimeout(function () {
              ci.focus()
            }, 0)
        }
      }
    }
    var bccBtn = el('nxMailComposeBccBtn')
    if (bccBtn && !bccBtn._nxBound) {
      bccBtn._nxBound = true
      bccBtn.onclick = function () {
        var r = el('nxMailComposeBccRow')
        if (!r) return
        r.classList.toggle('is-hidden')
        if (!r.classList.contains('is-hidden')) {
          var bi = el('nxMailComposeBccInp')
          if (bi)
            setTimeout(function () {
              bi.focus()
            }, 0)
        }
      }
    }
    var tbAa = el('nxMailComposeToolbarToggle')
    if (tbAa && !tbAa._nxBound) {
      tbAa._nxBound = true
      tbAa.onclick = function () {
        var s = composeShell()
        if (s) s.classList.toggle('is-toolbar-collapsed')
      }
    }
    function toggleImgRow(ev) {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault()
      var row = el('nxMailComposeImgRow')
      if (row) {
        row.classList.toggle('is-hidden')
        if (!row.classList.contains('is-hidden')) {
          renderNxComposeAttachments()
          var pick = el('nxMailComposeAttachPickBtn')
          if (pick) pick.focus()
        }
      }
    }
    var att = el('nxMailComposeAttachBtn')
    if (att && !att._nxBound) {
      att._nxBound = true
      att.onclick = toggleImgRow
    }
    var imgBtn = el('nxMailComposeImgBtn')
    if (imgBtn && !imgBtn._nxBound) {
      imgBtn._nxBound = true
      imgBtn.onclick = toggleImgRow
    }
    var linkB = el('nxMailComposeLinkBtn')
    if (linkB && !linkB._nxBound) {
      linkB._nxBound = true
      linkB.onclick = function () {
        var raw = typeof prompt === 'function' ? prompt('URL tautan:', 'https://') : ''
        var u = (raw || '').trim()
        if (u) runComposeExec('createLink', u)
      }
    }
    var toolbar = el('nxMailComposeToolbar')
    if (toolbar && !toolbar._nxBound) {
      toolbar._nxBound = true
      toolbar.onclick = function (ev) {
        var btn = typeof ev.target.closest === 'function' ? ev.target.closest('button[data-cmd]') : null
        if (!btn) return
        ev.preventDefault()
        var cmd = btn.getAttribute('data-cmd') || ''
        var vl = btn.getAttribute('data-val')
        runComposeExec(cmd, vl || '')
      }
    }
    var fontSel = el('nxMailComposeFont')
    if (fontSel && !fontSel._nxBound) {
      fontSel._nxBound = true
      fontSel.onchange = function () {
        var bd = el('nxMailComposeBody')
        if (bd) bd.focus()
        var map = {
          'sans-serif': 'Arial',
          serif: 'Times New Roman',
          monospace: 'Courier New',
        }
        document.execCommand('fontName', false, map[fontSel.value] || 'Arial')
      }
    }
    var sizeSel = el('nxMailComposeSize')
    if (sizeSel && !sizeSel._nxBound) {
      sizeSel._nxBound = true
      sizeSel.onchange = function () {
        var bd = el('nxMailComposeBody')
        if (bd) bd.focus()
        document.execCommand('fontSize', false, sizeSel.value || '3')
      }
    }
    var sd = el('nxMailComposeSendMenuBtn')
    if (sd && !sd._nxBound) {
      sd._nxBound = true
      sd.addEventListener('click', function (ev) {
        ev.preventDefault()
        ev.stopPropagation()
        submitComposeNew()
      })
    }
  }

  const NxMail = {
    init: function () {
      if (window._nxMailInit) return
      window._nxMailInit = true
      loadInbox().then(updateUnreadBell)
      if (!unreadTimer)
        unreadTimer = setInterval(function () {
          if (el('nxMailOverlay') && !el('nxMailOverlay').classList.contains('is-hidden')) return
          loadInbox().catch(() => {})
        }, 45000)

      var sb = el('nxMailSendReplyBtn')
      if (sb && !sb._nxBound) {
        sb._nxBound = true
        sb.addEventListener('click', function (ev) {
          ev.preventDefault()
          ev.stopPropagation()
          submitReply()
        })
      }
      var comp = el('nxMailComposeFab')
      if (comp && !comp._nxBound) {
        comp._nxBound = true
        comp.onclick = showCompose
      }
      var compSend = el('nxMailComposeSendBtn')
      if (compSend && !compSend._nxBound) {
        compSend._nxBound = true
        compSend.addEventListener('click', function (ev) {
          ev.preventDefault()
          ev.stopPropagation()
          submitComposeNew()
        })
      }
      var compClose = el('nxMailComposeCloseBtn')
      if (compClose && !compClose._nxBound) {
        compClose._nxBound = true
        compClose.onclick = hideCompose
      }
      wireComposeRecipientUi()
      var cDisc = el('nxMailComposeDiscard')
      if (cDisc && !cDisc._nxBound) {
        cDisc._nxBound = true
        cDisc.onclick = hideCompose
      }
      var cob = el('nxMailComposeModal')
      if (cob && !cob._nxBackdrop) {
        cob._nxBackdrop = true
        cob.onclick = function (ev) {
          if (ev.target === cob) hideCompose()
        }
      }
      var rf = el('nxMailRefreshList')
      if (rf && !rf._nxBound) {
        rf._nxBound = true
        rf.addEventListener('click', function () {
          loadInbox({ refreshBtn: rf }).catch(function () {})
        })
      }
      bindGmailCompose()
      nxWireMailAttachmentsOnce()
      bindGmailReadQuickReplyOnce()
    },

    open: function () {
      el('nxMailOverlay').classList.remove('is-hidden')
      el('nxMailOverlay').setAttribute('aria-hidden', 'false')
      openThread = null
      renderHeader({ peer_name: '', peer_badge: '', subject: '', id: '', updated_at: '' })
      renderEmptyState('Select a conversation on the left or tap Compose.')
      nxMailComposerSetOpen(false)
      loadInbox({ listBusy: true }).then(updateUnreadBell)
    },

    close: function () {
      el('nxMailOverlay').classList.add('is-hidden')
      el('nxMailOverlay').setAttribute('aria-hidden', 'true')
      hideCompose()
    },

    compose: showCompose,
    closeCompose: hideCompose,
  }

  window.NxMail = NxMail
})()
