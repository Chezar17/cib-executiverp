// NEXUS Mail — Gmail-style internal DM (secured by /api/nexus-mail).
;(function () {
  'use strict'

  /** @typedef {{ id:string, peer_badge:string, peer_name:string, subject:string, updated_at:string, last_sender?:string|null, last_snippet?:string, unread_count:number }} NxThread */
  /** @typedef {{ id:string, sender_badge:string, body:string, image_url:string|null, image_urls:string[], created_at:string }} NxMessage */

  /** @returns {Record<string,string>} */
  function hdr() {
    const t = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('cib_token') : ''
    return {
      'Content-Type': 'application/json',
      ...(t ? { 'x-session-token': t } : {}),
    }
  }

  function myBadgeFromStorage() {
    try {
      const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('cib_session') : ''
      if (!raw) return ''
      return String(JSON.parse(raw).badge || '').trim()
    } catch (_) {
      return ''
    }
  }

  async function fetchJson(method, url, body) {
    const opt = { method, headers: hdr() }
    if (body !== undefined && body !== null) opt.body = JSON.stringify(body)
    const r = await fetch(url, opt)
    const ct = r.headers.get('content-type') || ''
    let j = null
    if (ct.includes('application/json'))
      try {
        j = await r.json()
      } catch (_) {
        /* empty */
      }
    if (!r.ok) throw new Error((j && j.error) || r.statusText || String(r.status))
    return j || {}
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /** Default domain suffix for autocomplete from directory (`users.badge`). To-field accepts any *.gov hostname. */
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
    if (!h || h.includes('..') || h.includes('/') || h.includes('\\') || h.includes(':'))
      return false
    const labels = h.split('.').filter(Boolean)
    if (labels.length < 2) return false
    for (let i = 0; i < labels.length; i++)
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(labels[i])) return false
    return labels[labels.length - 1] === 'gov'
  }

  /** Local badge part with optional `badge@host.gov`; casing preserved — server resolves to `users.badge`. */
  function parseRecipientBadge(raw) {
    let s = String(raw == null ? '' : raw).trim()
    if (!s) return ''
    const at = s.indexOf('@')
    if (at >= 0) {
      const dom = s.slice(at + 1)
      if (!isGovernmentMailHostname(dom)) return ''
      s = s.slice(0, at).trim()
    }
    return s
  }

  /** Display line for picker: `badge@defaultGov` — default host is Nexus convenience only. */
  function badgeToDefaultGovMail(badge) {
    var b = String(badge ?? '').trim()
    if (!b) return ''
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

  /** Max 15 matches API; parses lines and comma-separated HTTPS/HTTP URLs. */
  function parseHttpsUrlLines(raw) {
    /** @type {string[]} */
    var out = []
    var rawStr = String(raw == null ? '' : raw)
    var lines = rawStr.split(/\r?\n/)
    for (var li = 0; li < lines.length; li++) {
      var parts = lines[li].split(','),
        pi,
        cand
      for (pi = 0; pi < parts.length; pi++) {
        cand = parts[pi].trim()
        if (!cand) continue
        try {
          var url = new URL(cand)
          if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
          var s = url.toString()
          if (out.indexOf(s) < 0) {
            out.push(s)
            if (out.length >= 15) return out
          }
        } catch (_) {
          /* skip invalid */
        }
      }
    }
    return out
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

  function renderAttachmentPreviewChunks(urls, wrapCls, imgCls) {
    if (!urls || !urls.length) return ''
    return urls
      .map(function (u) {
        return (
          `<div class="${wrapCls}"><img class="${imgCls}" src="${escapeHtml(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"/></div>`
        )
      })
      .join('')
  }

  function syncComposeAttachmentPreview() {
    var ta = el('nxMailComposeImg'),
      box = el('nxMailComposeImgPreview')
    if (!box) return
    var urls = parseHttpsUrlLines(ta ? ta.value : '')
    box.innerHTML = renderAttachmentPreviewChunks(urls, 'nx-mail-compose-thumb-wrap', 'nx-mail-compose-thumb')
    box.style.display = urls.length ? 'flex' : 'none'
    box.setAttribute('aria-hidden', urls.length ? 'false' : 'true')
  }

  function syncReplyAttachmentPreview() {
    var ta = el('nxMailReplyImg'),
      box = el('nxMailReplyImgPreview')
    if (!box) return
    var urls = parseHttpsUrlLines(ta ? ta.value : '')
    box.innerHTML = renderAttachmentPreviewChunks(urls, 'nx-mail-reply-thumb-wrap', 'nx-mail-reply-thumb')
    box.style.display = urls.length ? 'flex' : 'none'
    box.setAttribute('aria-hidden', urls.length ? 'false' : 'true')
  }

  function nxMailToast(message, typ) {
    var t = typ || 'error'
    if (typeof PortalAuth !== 'undefined' && PortalAuth.showToast)
      PortalAuth.showToast(message, t, 'inf-toast')
  }

  function fmtTime(iso) {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch (_) {
      return iso
    }
  }

  /** @type {NxThread[]} */
  let threads = []
  /** @type {NxThread[]} */
  let dirCache = []

  /** @type {{ meta: Partial<NxThread> & { peer_badge?: string, peer_name?: string, subject?: string } | null, msgs: NxMessage[] }} */
  let openThread = null
  /** @type {ReturnType<typeof setInterval>|null} */
  let unreadTimer = null
  /** @type {{to:string}} */
  let pendingCompose = null

  function el(id) {
    return document.getElementById(id)
  }

  function updateUnreadBell() {
    const n = threads.reduce((a, t) => a + (t.unread_count || 0), 0)
    const b = el('nxMailUnreadBadge')
    if (!b) return
    if (n > 0) {
      b.style.display = 'flex'
      b.textContent = n > 99 ? '99+' : String(n)
    } else {
      b.style.display = 'none'
    }
  }

  async function loadInbox() {
    try {
      const data = await fetchJson('GET', '/api/nexus-mail')
      threads = data.threads || []
      renderThreadRows()
      updateUnreadBell()
    } catch (e) {
      nxMailToast('Nexus Mail: ' + (e?.message || e), 'error')
    }
  }

  function renderEmptyState(txt) {
    var right = el('nxMailMsgs')
    if (!right) return
    right.innerHTML = `<div class="nx-mail-empty">${escapeHtml(txt)}</div>`
  }

  function renderThreadRows() {
    const tb = el('nxMailThreadList')
    if (!tb) return
    if (!threads.length) {
      tb.innerHTML = '<div class="nx-mail-thread-empty">No conversations yet.<br/><span>Use Compose to reach another officer.</span></div>'
      return
    }
    tb.innerHTML = threads
      .map(function (t) {
        const un = Number(t.unread_count) > 0
        const who = escapeHtml(t.peer_name || t.peer_badge)
        const sub = escapeHtml(t.subject || '(No subject)')
        const sn =
          escapeHtml(String(t.last_snippet || '').slice(0, 90)) ||
          '&nbsp;' /* keep row height stable */
        return (
          `<button type="button" data-tid="${escapeHtml(t.id)}" class="nx-mail-thread-row ${un ? 'is-unread' : ''}">
            <span class="nx-mail-row-from">${who}</span>
            <span class="nx-mail-row-sub">${sub}</span>
            <span class="nx-mail-row-sn">${sn}</span>
            <span class="nx-mail-row-time">${escapeHtml(fmtTime(t.updated_at))}</span>
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
        `<div class="nx-mail-h-left"><span class="nx-mail-h-peer">Conversation</span><span class="nx-mail-h-tip">Tap a sender on the left or compose new mail</span></div>`
      return
    }
    const nm = escapeHtml(meta.peer_name || meta.peer_badge || '')
    const bd = escapeHtml(badgeToDefaultGovMail(meta.peer_badge || ''))
    const sub = escapeHtml(meta.subject || '')
    h.innerHTML =
      `<div class="nx-mail-h-left">
          <span class="nx-mail-h-peer">${nm}</span>
          <span class="nx-mail-h-badge">${bd}</span>
          <span class="nx-mail-h-sub">${sub}</span>
       </div>
       <div class="nx-mail-h-right">
          <span class="nx-mail-h-tip">HTTPS image URL attaches like CID reports · Top Secret compartment</span>
       </div>`
  }

  function renderMessages(meta, msgs, meBadge) {
    const host = el('nxMailMsgs')
    if (!host) return
    if (!msgs || !msgs.length) {
      host.innerHTML =
        `<div class="nx-mail-msg-cells"><div class="nx-mail-msg-cell nx-mail-msg-system">${escapeHtml('No messages.')}</div></div>`
      return
    }
    const peer = meta && meta.peer_badge ? meta.peer_badge : ''

    host.innerHTML =
      '<div class="nx-mail-msg-cells">' +
      msgs
        .map(function (m) {
          const mine = meBadge && badgesEquivalent(m.sender_badge, meBadge)
          const side = mine ? 'is-mine' : 'is-theirs'
          const who = escapeHtml(mine ? 'You' : m.sender_badge === peer ? (meta.peer_name || m.sender_badge) : m.sender_badge)
          const when = escapeHtml(fmtTime(m.created_at))
          const bodyHtml = renderMsgBodyMarkup(m.body)
          const htmlClass = /<[a-z]/i.test(String(m.body || '')) ? ' nx-mail-msg-body-html' : ''
          const attUrls = messageAttachmentUrls(m)
          let attHtml = ''
          if (attUrls.length) {
            attHtml =
              '<div class="nx-mail-msg-attachments">' +
              attUrls
                .map(function (u) {
                  return `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" class="nx-mail-msg-img-thumb-link"><img class="nx-mail-msg-img-thumb" src="${escapeHtml(u)}" alt="lampiran" loading="lazy" referrerpolicy="no-referrer"/></a>`
                })
                .join('') +
              '</div>'
          }
          return (
            `<article class="nx-mail-msg-cell ${side}">
               <header class="nx-mail-msg-meta"><span>${who}</span><time>${when}</time></header>
               <div class="nx-mail-msg-body${htmlClass}">${bodyHtml}${attHtml}</div>
             </article>`
          )
        })
        .join('') +
      '</div>'
    host.scrollTop = host.scrollHeight
  }

  async function openThreadFn(id) {
    if (!id) return
    try {
      const data = await fetchJson('GET', '/api/nexus-mail?thread=' + encodeURIComponent(id))
      /** @type {any} */
      const meta = data.thread || {}
      openThread = { meta, msgs: data.messages || [] }
      renderHeader(openThread.meta)
      renderMessages(openThread.meta, openThread.msgs, myBadgeFromStorage())
      const replyHdr = el('nxMailReplyMeta')
      if (replyHdr)
        replyHdr.innerHTML =
          'Reply to <strong>' +
          escapeHtml(badgeToDefaultGovMail(meta.peer_badge || '') || meta.peer_badge || '') +
          '</strong>'
      try {
        await fetchJson('PATCH', '/api/nexus-mail', { thread_id: id })
      } catch (_) {
        /* allow read failures */
      }
      await loadInbox()
      el('nxMailReplyBody') && (el('nxMailReplyBody').value = '')
      el('nxMailReplyImg') && (el('nxMailReplyImg').value = '')
      syncReplyAttachmentPreview()
      el('nxMailComposer') &&
        Object.assign(el('nxMailComposer').style, { display: 'flex' }) /* composer visible */
      document.querySelectorAll('.nx-mail-thread-row').forEach(function (btn) {
        btn.classList.toggle('is-selected', btn.getAttribute('data-tid') === id)
      })
    } catch (e) {
        nxMailToast(e.message || String(e), 'error')
    }
  }

  async function submitReply() {
    if (!openThread || !openThread.meta) return
    const body = ((el('nxMailReplyBody') && el('nxMailReplyBody').value) || '').trim()
    const attachmentUrls = parseHttpsUrlLines((el('nxMailReplyImg') && el('nxMailReplyImg').value) || '')
    const peer = openThread.meta.peer_badge || ''
    if (!peer || (!body && !attachmentUrls.length)) {
      nxMailToast('Tulis pesan atau tambahkan minimal satu URL gambar HTTPS', 'error')
      return
    }
    try {
      await fetchJson('POST', '/api/nexus-mail', {
        thread_id: openThread.meta.id,
        recipient_badge: peer,
        body,
        image_urls: attachmentUrls,
      })
      el('nxMailReplyBody').value = ''
      el('nxMailReplyImg').value = ''
      syncReplyAttachmentPreview()
      await openThreadFn(openThread.meta.id)
      await loadInbox()
    } catch (e) {
      nxMailToast(e.message || String(e), 'error')
    }
  }

  function composeShell() {
    return document.querySelector('.nx-mail-compose-modal.gmail-compose')
  }

  function resetComposeCcBccUi() {
    var ccRow = el('nxMailComposeCcRow')
    var bRow = el('nxMailComposeBccRow')
    var ccIn = el('nxMailComposeCc')
    var bIn = el('nxMailComposeBcc')
    if (ccRow) ccRow.classList.add('is-hidden')
    if (bRow) bRow.classList.add('is-hidden')
    if (ccIn) ccIn.value = ''
    if (bIn) bIn.value = ''
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
    var imgIn = el('nxMailComposeImg')
    var imgRow = el('nxMailComposeImgRow')
    if (toIn) toIn.value = ''
    if (subIn) subIn.value = ''
    if (bd) bd.innerHTML = ''
    if (imgIn) imgIn.value = ''
    if (imgRow) imgRow.classList.add('is-hidden')
    var sug = el('nxMailDirSuggest')
    if (sug) sug.innerHTML = ''
    resetComposeCcBccUi()
    syncComposeAttachmentPreview()

    if (bd) bd.focus()
    else if (toIn) toIn.focus()
  }

  function hideCompose() {
    var m = el('nxMailComposeModal')
    if (m) {
      m.classList.remove('is-open')
      m.setAttribute('aria-hidden', 'true')
    }
  }

  let dirDeb
  async function composeDirSuggest() {
    const q =
      (((el('nxMailComposeTo') && el('nxMailComposeTo').value) || '') + '').trim()
    const sug = el('nxMailDirSuggest')
    if (!sug) return
    clearTimeout(dirDeb)
    if (q.length < 1) {
      sug.innerHTML = ''
      return
    }
    dirDeb = setTimeout(async function () {
      try {
        const qLookup = parseRecipientBadge(q) || q.trim()
        const data = await fetchJson(
          'GET',
          '/api/nexus-mail?directory=1&q=' + encodeURIComponent(qLookup),
        )
        dirCache = data.directory || []
        sug.innerHTML = dirCache
          .slice(0, 24)
          .map(function (u) {
            var mail = badgeToDefaultGovMail(u.badge || '')
            return (
              `<button type="button" class="nx-mail-sug-it" data-mail="${escapeHtml(mail)}">${escapeHtml(
                u.name || u.badge || '',
              )}<span>${escapeHtml(mail)}</span></button>`
            )
          })
          .join('')
        sug.querySelectorAll('.nx-mail-sug-it').forEach(function (b) {
          b.onclick = function () {
            var mailAddr = (b.getAttribute('data-mail') || '').trim()
            var inp = el('nxMailComposeTo')
            if (inp) inp.value = mailAddr
            sug.innerHTML = ''
          }
        })
      } catch (_) {
        sug.innerHTML = ''
      }
    }, 240)
  }

  async function submitComposeNew() {
    var toEl = el('nxMailComposeTo')
    var recipient_badge = parseRecipientBadge((toEl && toEl.value) || '')
    var subject =
      ((el('nxMailComposeSub') && el('nxMailComposeSub').value) || '').trim()
    var bodyEl = el('nxMailComposeBody')
    var body = composeBodyFromEditor(bodyEl)
    var attachmentUrls = parseHttpsUrlLines((el('nxMailComposeImg') && el('nxMailComposeImg').value) || '')

    if (!recipient_badge || (!body && !attachmentUrls.length)) {
      nxMailToast(
        'Kepada (badge atau *.gov) dan isi pesan atau minimal satu URL gambar HTTPS wajib ada',
        'error',
      )
      return
    }
    try {
      var payload = {
        recipient_badge,
        subject,
        body,
        image_urls: attachmentUrls,
      }
      if (attachmentUrls.length) payload.image_url = attachmentUrls[0]

      var sent = await fetchJson('POST', '/api/nexus-mail', payload)
      hideCompose()
      await loadInbox()
      if (sent.thread_id) await openThreadFn(sent.thread_id)
    } catch (e) {
      var msg = e && e.message ? e.message : String(e)
      nxMailToast(msg, 'error')
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
        if (r) r.classList.toggle('is-hidden')
      }
    }
    var bccBtn = el('nxMailComposeBccBtn')
    if (bccBtn && !bccBtn._nxBound) {
      bccBtn._nxBound = true
      bccBtn.onclick = function () {
        var r = el('nxMailComposeBccRow')
        if (r) r.classList.toggle('is-hidden')
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
    function toggleImgRow() {
      var row = el('nxMailComposeImgRow')
      if (row) {
        row.classList.toggle('is-hidden')
        var i = el('nxMailComposeImg')
        if (i && !row.classList.contains('is-hidden')) {
          i.focus()
          syncComposeAttachmentPreview()
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
      sd.onclick = submitComposeNew
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
        sb.onclick = submitReply
      }
      var comp = el('nxMailComposeFab')
      if (comp && !comp._nxBound) {
        comp._nxBound = true
        comp.onclick = showCompose
      }
      var compSend = el('nxMailComposeSendBtn')
      if (compSend && !compSend._nxBound) {
        compSend._nxBound = true
        compSend.onclick = submitComposeNew
      }
      var compClose = el('nxMailComposeCloseBtn')
      if (compClose && !compClose._nxBound) {
        compClose._nxBound = true
        compClose.onclick = hideCompose
      }
      var cto = el('nxMailComposeTo')
      if (cto && !cto._nxBound) {
        cto._nxBound = true
        cto.oninput = composeDirSuggest
      }
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
      bindGmailCompose()
      ;(function bindNxAttachmentPreviewInputs() {
        var composeTa = el('nxMailComposeImg'),
          replyTa = el('nxMailReplyImg')
        if (composeTa && !composeTa._nxPrevBound) {
          composeTa._nxPrevBound = true
          composeTa.addEventListener('input', syncComposeAttachmentPreview)
        }
        if (replyTa && !replyTa._nxPrevBound) {
          replyTa._nxPrevBound = true
          replyTa.addEventListener('input', syncReplyAttachmentPreview)
        }
      })()
    },

    open: function () {
      el('nxMailOverlay').classList.remove('is-hidden')
      el('nxMailOverlay').setAttribute('aria-hidden', 'false')
      openThread = null
      renderHeader({ peer_name: '', peer_badge: '', subject: '', id: '', updated_at: '' })
      renderEmptyState('Select a thread or Compose a new encrypted notice.')
      const comp = el('nxMailComposer')
      if (comp) comp.style.display = 'none'
      loadInbox().then(updateUnreadBell)
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
