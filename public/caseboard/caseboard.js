/* ============================================================
   caseboard.js — NEXUS Detective Case Board (kanban)
   Talks to /api/reports?board=…  (see api/_lib/case-board.js)
   ============================================================ */
;(function () {
  'use strict'

  // ── Constants ────────────────────────────────────────────
  const STATUSES = [
    { id: 'todo',        label: 'To Do',       color: 'var(--cb-todo)' },
    { id: 'in_progress', label: 'In Progress', color: 'var(--cb-progress)' },
    { id: 'in_review',   label: 'In Review',   color: 'var(--cb-review)' },
    { id: 'blocker',     label: 'Blocker',     color: 'var(--cb-blocker)' },
    { id: 'completed',   label: 'Completed',   color: 'var(--cb-done)' },
  ]
  const PRIORITIES = [
    { id: 'critical', label: 'Critical' },
    { id: 'high',     label: 'High' },
    { id: 'medium',   label: 'Medium' },
    { id: 'low',      label: 'Low' },
  ]
  const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]))
  const PRIORITY_BY_ID = Object.fromEntries(PRIORITIES.map((p) => [p.id, p]))
  const REFRESH_MS = 60 * 1000

  // ── State ────────────────────────────────────────────────
  let me = { badge: '', name: '', classification: '' }
  let cases = []
  let people = []
  let peopleByBadge = {}
  let reports = []
  let mode = null          // 'create' | 'edit' | null
  let current = null       // case object shown in the modal
  let activity = []
  let dragId = null
  let pendingDeleteId = null

  const $ = (id) => document.getElementById(id)

  // ── Boot ─────────────────────────────────────────────────
  PortalAuth.init({
    loginHref: '/Page_Login.html',
    badgeEls: ['badgeDisplay'],
    clockEl: 'liveClock',
    onReady: function (_badge, s) {
      me = { badge: s.badge, name: s.name || s.badge, classification: String(s.classification || '').toLowerCase().replace(/\s+/g, '_') }
      $('portalContent').style.display = 'block'
      buildStaticUi()
      bindUi()
      loadAll().then(openFromUrl)
      Notif.init()
      setInterval(autoRefresh, REFRESH_MS)
    },
  })

  // ── API helper ───────────────────────────────────────────
  async function api(method, params, body) {
    const qs = new URLSearchParams(params).toString()
    const opts = {
      method,
      headers: { 'x-session-token': sessionStorage.getItem('cib_token') || '' },
    }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    const res = await fetch('/api/reports?' + qs, opts)
    let json = {}
    try { json = await res.json() } catch (_) {}
    if (res.status === 401) { PortalAuth.logout(); throw new Error('Session expired') }
    if (!res.ok) {
      const msg = (json.error || ('HTTP ' + res.status)) + (json.hint ? ' — ' + json.hint : '')
      throw new Error(msg)
    }
    return json
  }

  function toast(msg, type) { PortalAuth.showToast(msg, type || 'success', 'toast-container') }

  let savingEl = null
  function saving(on) {
    if (!savingEl) { savingEl = document.createElement('div'); savingEl.className = 'cb-saving'; savingEl.textContent = 'SAVING…'; document.body.appendChild(savingEl) }
    savingEl.classList.toggle('show', !!on)
  }

  // ── Loading ──────────────────────────────────────────────
  async function loadAll() {
    $('board').innerHTML = '<div class="cb-empty" style="grid-column:1/-1">LOADING CASE BOARD…</div>'
    const [pRes, cRes] = await Promise.allSettled([api('GET', { board: 'people' }), api('GET', { board: 'cases' })])
    if (pRes.status === 'fulfilled') {
      people = pRes.value.people || []
      peopleByBadge = Object.fromEntries(people.map((p) => [p.badge, p]))
      fillAssigneeFilter()
    }
    if (cRes.status === 'fulfilled') {
      cases = cRes.value.cases || []
      renderBoard()
    } else {
      $('board').innerHTML = '<div class="cb-empty" style="grid-column:1/-1;color:#ff7b6b">Could not load the board.<br>' + esc(cRes.reason.message) + '</div>'
    }
    loadReports()
  }

  async function loadReports() {
    try {
      const res = await fetch('/api/reports', { headers: { 'x-session-token': sessionStorage.getItem('cib_token') || '' } })
      if (!res.ok) return
      const json = await res.json()
      reports = json.reports || []
      fillReportSelect()
    } catch (_) {}
  }

  async function refreshCases() {
    try {
      const json = await api('GET', { board: 'cases' })
      cases = json.cases || []
      renderBoard()
    } catch (e) { toast('Refresh failed: ' + e.message, 'error') }
  }

  function autoRefresh() {
    if (document.hidden || dragId || !$('caseModal').hidden) return
    refreshCases()
  }

  function openFromUrl() {
    const id = new URLSearchParams(location.search).get('case')
    if (id) openCase(id)
  }

  // ── Static UI pieces ─────────────────────────────────────
  function buildStaticUi() {
    $('mStatus').innerHTML = STATUSES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')
    $('mPriority').innerHTML = PRIORITIES.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')
  }

  function fillAssigneeFilter() {
    const sel = $('fAssignee')
    const keep = sel.value
    sel.innerHTML = '<option value="">All detectives</option>' +
      people.map((p) => `<option value="${esc(p.badge)}">${esc(p.name || p.badge)}</option>`).join('')
    sel.value = keep
  }

  function fillReportSelect() {
    const sel = $('mReport')
    const keep = sel.value
    sel.innerHTML = '<option value="">— No linked investigation report —</option>' +
      reports.map((r) => `<option value="${esc(r.id)}">${esc(r.case_number || '—')} · ${esc(r.case_title || 'Untitled')}</option>`).join('')
    sel.value = keep
    if (current) setReportField(current)
  }

  // ── Board rendering ──────────────────────────────────────
  function filtered() {
    const q = $('fSearch').value.trim().toLowerCase()
    const div = $('fDivision').value
    const pri = $('fPriority').value
    const who = $('fAssignee').value
    const mine = $('fMine').checked
    return cases.filter((c) => {
      if (div && c.division !== div) return false
      if (pri && c.priority !== pri) return false
      if (who && !(c.assignees || []).includes(who)) return false
      if (mine && !(c.assignees || []).includes(me.badge) && c.created_by !== me.badge) return false
      if (q) {
        const hay = [
          code(c), c.title, toEdit(c.description), (c.tags || []).join(' '), c.linked_report_number,
          (c.assignees || []).map(nameOf).join(' '),
        ].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }

  function renderBoard() {
    const list = filtered()
    $('board').innerHTML = STATUSES.map((s) => {
      const items = list.filter((c) => c.status === s.id).sort((a, b) => a.sort_order - b.sort_order)
      return `
        <section class="cb-col" style="--col:${s.color}" data-status="${s.id}">
          <div class="cb-col-h">
            <span class="cb-col-dot"></span>
            <span class="cb-col-name">${s.label}</span>
            <span class="cb-col-count">${items.length}</span>
          </div>
          <div class="cb-col-list" data-status="${s.id}">
            ${items.length ? items.map(cardHtml).join('') : '<div class="cb-empty">NO CASES</div>'}
          </div>
          <button class="cb-col-add" data-add="${s.id}">+ Add case</button>
        </section>`
    }).join('')
  }

  function cardHtml(c) {
    const pri = PRIORITY_BY_ID[c.priority] || PRIORITY_BY_ID.medium
    const checks = c.checklist || []
    const done = checks.filter((x) => x.done).length
    const late = c.due_date && c.status !== 'completed' && c.due_date < todayStr()
    const foot = []
    if (c.due_date) foot.push(`<span class="${late ? 'late' : ''}" title="Due date">&#128197; ${esc(shortDate(c.due_date))}</span>`)
    if (checks.length) foot.push(`<span title="Checklist">&#9745; ${done}/${checks.length}</span>`)
    if (c.comment_count) foot.push(`<span title="Comments">&#128172; ${c.comment_count}</span>`)
    if (c.linked_report_number) foot.push(`<span title="Linked report">&#128206;</span>`)
    return `
      <article class="cb-card p-${pri.id}" draggable="true" tabindex="0" data-id="${esc(c.id)}">
        <div class="cb-card-top">
          <span class="cb-code">${esc(code(c))}</span>
          <span class="cb-div">${esc(c.division)}</span>
          <span class="cb-flag p-${pri.id}" style="margin-left:auto">&#9873; ${pri.label}</span>
        </div>
        <div class="cb-card-title">${esc(c.title)}</div>
        ${(c.tags || []).length ? `<div class="cb-card-tags">${c.tags.map((t) => `<span class="cb-chip">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="cb-card-foot">${foot.join('')}<span class="cb-avatars">${(c.assignees || []).slice(0, 4).map(avatar).join('')}${(c.assignees || []).length > 4 ? `<span class="cb-av" style="background:#334">+${c.assignees.length - 4}</span>` : ''}</span></div>
      </article>`
  }

  // ── Board events (click, keyboard, drag & drop) ──────────
  function bindUi() {
    ;['fSearch', 'fDivision', 'fPriority', 'fAssignee', 'fMine'].forEach((id) => $(id).addEventListener('input', renderBoard))
    $('refreshBtn').addEventListener('click', refreshCases)
    $('newCaseBtn').addEventListener('click', () => openNew('todo'))

    const board = $('board')
    board.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]')
      if (add) return openNew(add.dataset.add)
      const card = e.target.closest('.cb-card')
      if (card) openCase(card.dataset.id)
    })
    board.addEventListener('keydown', (e) => {
      const card = e.target.closest('.cb-card')
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCase(card.dataset.id) }
    })

    board.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.cb-card')
      if (!card) return
      dragId = card.dataset.id
      e.dataTransfer.effectAllowed = 'move'
      try { e.dataTransfer.setData('text/plain', dragId) } catch (_) {}
      requestAnimationFrame(() => card.classList.add('dragging'))
    })
    board.addEventListener('dragover', (e) => {
      if (!dragId) return
      const list = e.target.closest('.cb-col-list') || e.target.closest('.cb-col')?.querySelector('.cb-col-list')
      if (!list) return
      e.preventDefault()
      document.querySelectorAll('.cb-col.drag-over').forEach((c) => c !== list.parentElement && c.classList.remove('drag-over'))
      list.parentElement.classList.add('drag-over')
      const dragging = board.querySelector('.cb-card.dragging')
      if (!dragging) return
      list.querySelector('.cb-empty')?.remove()
      const after = cardAfter(list, e.clientY)
      if (after == null) list.appendChild(dragging)
      else if (after !== dragging) list.insertBefore(dragging, after)
    })
    board.addEventListener('drop', (e) => {
      if (!dragId) return
      e.preventDefault()
      const card = board.querySelector('.cb-card.dragging')
      const list = card && card.parentElement
      if (list && list.dataset.status) dropCard(dragId, list)
    })
    board.addEventListener('dragend', () => {
      const wasDragging = dragId
      dragId = null
      document.querySelectorAll('.cb-col.drag-over').forEach((c) => c.classList.remove('drag-over'))
      // If dropped outside a column, put everything back
      if (wasDragging && board.querySelector('.cb-card.dragging')) renderBoard()
    })

    bindModal()
  }

  function cardAfter(list, y) {
    const cards = [...list.querySelectorAll('.cb-card:not(.dragging)')]
    for (const c of cards) {
      const r = c.getBoundingClientRect()
      if (y < r.top + r.height / 2) return c
    }
    return null
  }

  async function dropCard(id, list) {
    const c = cases.find((x) => x.id === id)
    if (!c) return
    const status = list.dataset.status
    const el = list.querySelector(`.cb-card[data-id="${cssEsc(id)}"]`)
    const prevId = el?.previousElementSibling?.dataset?.id
    const nextId = el?.nextElementSibling?.dataset?.id
    const prev = cases.find((x) => x.id === prevId)
    const next = cases.find((x) => x.id === nextId)
    let sort
    if (prev && next) sort = (prev.sort_order + next.sort_order) / 2
    else if (prev) sort = prev.sort_order + 1024
    else if (next) sort = next.sort_order - 1024
    else sort = 1024

    if (status === c.status && sort === c.sort_order) { renderBoard(); return }
    const before = { status: c.status, sort_order: c.sort_order }
    Object.assign(c, { status, sort_order: sort })
    renderBoard()
    try {
      const json = await api('PUT', { board: 'case', id }, { status, sort_order: sort })
      Object.assign(c, json.case)
      if (before.status !== status) toast(`${code(c)} moved to ${STATUS_BY_ID[status].label}`)
      renderBoard()
    } catch (e) {
      Object.assign(c, before)
      renderBoard()
      toast('Could not move case: ' + e.message, 'error')
    }
  }

  // ── Modal ────────────────────────────────────────────────
  function bindModal() {
    $('mClose').addEventListener('click', closeModal)
    $('mCancel').addEventListener('click', closeModal)
    $('caseModal').addEventListener('mousedown', (e) => { if (e.target === $('caseModal')) closeModal() })
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      if (!$('cbNotifPanel').hidden) { Notif.close(); return }
      if (document.querySelector('.cb-picker')) { closePicker(); return }
      if (!$('confirmModal').hidden) { $('confirmModal').hidden = true; return }
      if (!$('caseModal').hidden) closeModal()
    })

    // Title: Enter saves, no line breaks
    const t = $('mTitle')
    t.addEventListener('input', () => { autoGrow(t); if (mode === 'create') current.title = t.value })
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); t.blur() } })
    t.addEventListener('blur', () => {
      if (mode !== 'edit') return
      const v = t.value.trim()
      if (!v) { t.value = current.title; autoGrow(t); toast('Case title cannot be empty', 'error'); return }
      if (v !== current.title) change({ title: v })
    })

    // Case notes: shown with highlighted @mentions; click to edit, leaves edit mode on blur (saves)
    const d = $('mDesc')
    const view = $('mDescView')
    view.addEventListener('click', (e) => { if (!e.target.closest('a')) startDescEdit() })
    view.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startDescEdit() } })
    d.addEventListener('input', () => autoGrow(d, 180))
    d.addEventListener('blur', () => {
      if (!current) return
      const val = toStore(d.value).trim()
      d.hidden = true
      view.hidden = false
      if (mode === 'create') { current.description = val; renderDescView() }
      else if (mode === 'edit' && val !== (current.description || '')) change({ description: val })
      else renderDescView()
    })

    attachMentions($('mComment'))
    attachMentions(d)
    attachMentions($('mCheckInput'))

    $('mStatus').addEventListener('change', (e) => { paintStatus(e.target.value); change({ status: e.target.value }) })
    $('mPriority').addEventListener('change', (e) => change({ priority: e.target.value }))
    $('mDivision').addEventListener('change', (e) => change({ division: e.target.value }))
    $('mReport').addEventListener('change', (e) => change({ linked_report_id: e.target.value }))
    $('mStart').addEventListener('change', onDates)
    $('mDue').addEventListener('change', onDates)

    $('mCheckForm').addEventListener('submit', (e) => {
      e.preventDefault()
      const v = $('mCheckInput').value.trim()
      if (!v) return
      $('mCheckInput').value = ''
      const list = (current.checklist || []).concat([{ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: toStore(v), done: false }])
      change({ checklist: list })
    })
    $('mChecklist').addEventListener('change', (e) => {
      const li = e.target.closest('li')
      if (!li) return
      const list = (current.checklist || []).map((it) => it.id === li.dataset.id ? Object.assign({}, it, { done: e.target.checked }) : it)
      change({ checklist: list })
    })
    $('mChecklist').addEventListener('click', (e) => {
      const x = e.target.closest('.cb-x')
      if (!x) return
      const id = x.closest('li').dataset.id
      change({ checklist: (current.checklist || []).filter((it) => it.id !== id) })
    })

    $('mCommentForm').addEventListener('submit', (e) => { e.preventDefault(); sendComment() })
    $('mComment').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendComment() } })
    $('mFeed').addEventListener('click', (e) => {
      const x = e.target.closest('[data-del-comment]')
      if (x) deleteComment(x.dataset.delComment)
    })

    $('mCreate').addEventListener('click', createCase)
    $('mDelete').addEventListener('click', () => { pendingDeleteId = current?.id; $('confirmModal').hidden = false })
    $('cNo').addEventListener('click', () => { $('confirmModal').hidden = true })
    $('cYes').addEventListener('click', deleteCase)
  }

  function onDates() {
    const s = $('mStart').value || null
    const d = $('mDue').value || null
    if (s && d && d < s) {
      toast('Due date cannot be before the start date', 'error')
      $('mStart').value = current.start_date || ''
      $('mDue').value = current.due_date || ''
      return
    }
    change({ start_date: s, due_date: d })
  }

  function openNew(status) {
    mode = 'create'
    current = {
      id: null, title: '', description: '', status: status || 'todo', priority: 'medium',
      division: guessDivision(), tags: [], assignees: me.badge ? [me.badge] : [], checklist: [],
      start_date: todayStr(), due_date: null, linked_report_id: null,
    }
    activity = []
    showModal()
    setTimeout(() => $('mTitle').focus(), 50)
  }

  async function openCase(id) {
    mode = 'edit'
    const local = cases.find((c) => c.id === id)
    current = local ? Object.assign({}, local) : null
    activity = []
    if (current) showModal()
    try {
      const json = await api('GET', { board: 'case', id })
      if (mode !== 'edit' || (current && current.id !== id)) return
      current = json.case
      activity = json.activity || []
      showModal()
      history.replaceState(null, '', '?case=' + encodeURIComponent(id))
      Notif.markCaseRead(id)
    } catch (e) {
      toast('Could not open case: ' + e.message, 'error')
      if (!local) closeModal()
    }
  }

  function showModal() {
    const c = current
    $('caseModal').hidden = false
    document.body.style.overflow = 'hidden'
    $('mCode').textContent = mode === 'create' ? 'New Case' : code(c)
    if (document.activeElement !== $('mTitle')) { $('mTitle').value = c.title || ''; autoGrow($('mTitle')) }
    $('mStatus').value = c.status
    paintStatus(c.status)
    $('mPriority').value = c.priority
    $('mDivision').value = c.division
    $('mStart').value = c.start_date || ''
    $('mDue').value = c.due_date || ''
    if ($('mDesc').hidden) renderDescView()
    setReportField(c)
    renderAssignees()
    renderTags()
    renderChecklist()
    renderMeta()
    renderFeed()
    $('mCreateBar').hidden = mode !== 'create'
    const canDelete = mode === 'edit' && (c.created_by === me.badge || me.classification === 'top_secret')
    $('mDelete').hidden = !canDelete
    $('mCommentForm').classList.toggle('disabled', mode !== 'edit')
  }

  function closeModal() {
    if (document.activeElement && $('caseModal').contains(document.activeElement)) document.activeElement.blur()
    closePicker()
    closeMentionBox()
    $('mDesc').hidden = true
    $('mDescView').hidden = false
    $('caseModal').hidden = true
    document.body.style.overflow = ''
    mode = null
    current = null
    if (location.search) history.replaceState(null, '', location.pathname)
  }

  function paintStatus(s) {
    const st = STATUS_BY_ID[s] || STATUSES[0]
    const el = $('mStatus')
    el.style.background = `color-mix(in srgb, ${st.color} 28%, #0e1525)`
    el.style.borderColor = st.color
  }

  function setReportField(c) {
    const sel = $('mReport')
    const id = c.linked_report_id || ''
    if (id && !sel.querySelector(`option[value="${cssEsc(id)}"]`)) {
      const o = document.createElement('option')
      o.value = id
      o.textContent = (c.linked_report_number || 'Linked report') + ' · (not in list)'
      sel.appendChild(o)
    }
    sel.value = id
    const a = $('mReportOpen')
    a.hidden = !id
    if (id) a.href = '/reports/form/report-form.html?id=' + encodeURIComponent(id)
  }

  // Apply a change: draft-only in create mode, saved straight away in edit mode
  async function change(fields) {
    if (!current) return
    if (mode === 'create') {
      Object.assign(current, fields)
      showModal()
      return
    }
    const id = current.id
    const before = Object.assign({}, current)
    Object.assign(current, fields)
    showModal()
    saving(true)
    try {
      const json = await api('PUT', { board: 'case', id }, fields)
      const idx = cases.findIndex((c) => c.id === id)
      if (idx >= 0) cases[idx] = json.case
      renderBoard()
      if (current && current.id === id) {
        current = json.case
        const fresh = await api('GET', { board: 'case', id })
        if (current && current.id === id) { current = fresh.case; activity = fresh.activity || []; showModal() }
      }
    } catch (e) {
      if (current && current.id === id) { current = before; showModal() }
      toast('Not saved: ' + e.message, 'error')
    } finally {
      saving(false)
    }
  }

  async function createCase() {
    current.title = $('mTitle').value.trim()
    if (!$('mDesc').hidden) current.description = toStore($('mDesc').value).trim()
    if (!current.title) { toast('Give the case a title first', 'error'); $('mTitle').focus(); return }
    const btn = $('mCreate')
    btn.disabled = true
    try {
      const json = await api('POST', { board: 'cases' }, current)
      cases.push(json.case)
      renderBoard()
      toast(code(json.case) + ' created')
      openCase(json.case.id)
    } catch (e) {
      toast('Could not create case: ' + e.message, 'error')
    } finally {
      btn.disabled = false
    }
  }

  async function deleteCase() {
    const id = pendingDeleteId
    $('confirmModal').hidden = true
    if (!id) return
    try {
      await api('DELETE', { board: 'case', id })
      cases = cases.filter((c) => c.id !== id)
      closeModal()
      renderBoard()
      toast('Case deleted')
    } catch (e) { toast('Delete failed: ' + e.message, 'error') }
  }

  // ── Assignees ────────────────────────────────────────────
  function renderAssignees() {
    const wrap = $('mAssignees')
    const list = current.assignees || []
    wrap.innerHTML = list.map((b) => `
      <span class="cb-person">${avatar(b)}${esc(nameOf(b))}<button class="cb-x" data-rm="${esc(b)}" title="Remove">&times;</button></span>`).join('') +
      '<button class="cb-add-btn" id="mAddPerson">+ Add</button>'
    wrap.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', () => {
      change({ assignees: (current.assignees || []).filter((b) => b !== x.dataset.rm) })
    }))
    $('mAddPerson').addEventListener('click', (e) => { e.stopPropagation(); openPicker(wrap.parentElement) })
  }

  function openPicker(anchor) {
    closePicker()
    const box = document.createElement('div')
    box.className = 'cb-picker'
    box.innerHTML = '<input class="cb-input" placeholder="Search detective…"/><div class="cb-picker-list"></div>'
    anchor.appendChild(box)
    const input = box.querySelector('input')
    const listEl = box.querySelector('.cb-picker-list')
    function draw() {
      const q = input.value.trim().toLowerCase()
      const sel = current.assignees || []
      const rows = people.filter((p) => !q || (p.name || '').toLowerCase().includes(q) || p.badge.toLowerCase().includes(q) || (p.rank || '').toLowerCase().includes(q))
      listEl.innerHTML = rows.length ? rows.map((p) => `
        <div class="cb-picker-row ${sel.includes(p.badge) ? 'on' : ''}" data-b="${esc(p.badge)}">
          <span class="tick">${sel.includes(p.badge) ? '&#10003;' : ''}</span>${avatar(p.badge)}
          <span>${esc(p.name || p.badge)}</span><small>${esc(p.division || p.badge)}</small>
        </div>`).join('') : '<div class="cb-empty">No detectives found</div>'
    }
    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('[data-b]')
      if (!row) return
      const b = row.dataset.b
      const sel = current.assignees || []
      const next = sel.includes(b) ? sel.filter((x) => x !== b) : sel.concat([b])
      change({ assignees: next }).then(() => { if (document.body.contains(box)) draw() })
      draw()
    })
    input.addEventListener('input', draw)
    box.addEventListener('click', (e) => e.stopPropagation())
    draw()
    input.focus()
    setTimeout(() => document.addEventListener('click', closePicker, { once: true }), 0)
  }
  function closePicker() {
    document.querySelectorAll('.cb-picker').forEach((p) => p.remove())
  }

  // ── Tags ─────────────────────────────────────────────────
  function renderTags() {
    const wrap = $('mTags')
    const tags = current.tags || []
    wrap.innerHTML = tags.map((t, i) => `<span class="cb-chip">${esc(t)}<button class="cb-x" data-i="${i}" title="Remove">&times;</button></span>`).join('') +
      '<input class="cb-tag-input" id="mTagInput" maxlength="30" placeholder="+ Add tag"/>'
    wrap.querySelectorAll('[data-i]').forEach((x) => x.addEventListener('click', () => {
      change({ tags: tags.filter((_, i) => i !== Number(x.dataset.i)) })
    }))
    const input = $('mTagInput')
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault()
        const v = input.value.trim().replace(/,/g, '')
        if (!v) return
        if (tags.some((t) => t.toLowerCase() === v.toLowerCase())) { input.value = ''; return }
        if (tags.length >= 12) { toast('Maximum 12 tags', 'error'); return }
        change({ tags: tags.concat([v]) }).then(() => $('mTagInput')?.focus())
      } else if (e.key === 'Backspace' && !input.value && tags.length) {
        change({ tags: tags.slice(0, -1) })
      }
    })
  }

  // ── Checklist ────────────────────────────────────────────
  function renderChecklist() {
    const list = current.checklist || []
    const done = list.filter((x) => x.done).length
    $('mCheckCount').textContent = list.length ? `${done}/${list.length}` : ''
    $('mCheckBar').style.width = list.length ? (done / list.length * 100) + '%' : '0'
    $('mChecklist').innerHTML = list.map((it) => `
      <li class="${it.done ? 'done' : ''}" data-id="${esc(it.id)}">
        <input type="checkbox" ${it.done ? 'checked' : ''} aria-label="Done"/>
        <span>${rich(it.text)}</span>
        <button type="button" class="cb-x" title="Remove">&times;</button>
      </li>`).join('')
  }

  // ── Meta + feed ──────────────────────────────────────────
  function renderMeta() {
    if (mode !== 'edit') { $('mMeta').innerHTML = ''; return }
    const c = current
    const lines = []
    if (c.created_at) lines.push(`Created by ${esc(c.created_by_name || nameOf(c.created_by))} · ${esc(fmtDateTime(c.created_at))}`)
    if (c.updated_at && c.updated_by) lines.push(`Last updated by ${esc(nameOf(c.updated_by))} · ${esc(fmtDateTime(c.updated_at))}`)
    if (c.completed_at) lines.push(`Completed · ${esc(fmtDateTime(c.completed_at))}`)
    $('mMeta').innerHTML = lines.join('<br>')
  }

  function renderFeed() {
    const feed = $('mFeed')
    if (mode === 'create') {
      feed.innerHTML = '<div class="cb-side-note">Comments and the activity log appear here once the case is created.</div>'
      return
    }
    if (!activity.length) { feed.innerHTML = '<div class="cb-side-note">Loading…</div>'; return }
    let lastDay = ''
    feed.innerHTML = activity.map((a) => {
      const day = fmtDay(a.created_at)
      const sep = day !== lastDay ? `<div class="cb-day">${esc(day)}</div>` : ''
      lastDay = day
      if (a.kind === 'comment') {
        return sep + `
          <div class="cb-cm">
            <div class="cb-cm-h">${avatar(a.actor_badge)}<b>${esc(a.actor_name || a.actor_badge)}</b><time>${esc(fmtTime(a.created_at))}</time>
              ${a.actor_badge === me.badge ? `<button class="cb-x" data-del-comment="${esc(a.id)}" title="Delete comment">Delete</button>` : ''}
            </div>
            <div class="cb-cm-b">${rich(a.body)}</div>
          </div>`
      }
      return sep + `<div class="cb-ev"><span><b>${esc(a.actor_name || a.actor_badge)}</b> ${esc(a.body)}</span><time>${esc(fmtTime(a.created_at))}</time></div>`
    }).join('')
    feed.scrollTop = feed.scrollHeight
  }

  async function sendComment() {
    if (mode !== 'edit') return
    const box = $('mComment')
    const text = toStore(box.value).trim()
    if (!text) return
    const id = current.id
    box.disabled = true
    try {
      const json = await api('POST', { board: 'comment', id }, { body: text })
      box.value = ''
      activity.push(json.comment)
      const c = cases.find((x) => x.id === id)
      if (c) c.comment_count = (c.comment_count || 0) + 1
      if (current && current.id === id) renderFeed()
      renderBoard()
    } catch (e) { toast('Comment not sent: ' + e.message, 'error') }
    finally { box.disabled = false; box.focus() }
  }

  async function deleteComment(commentId) {
    try {
      await api('DELETE', { board: 'comment', id: commentId })
      activity = activity.filter((a) => a.id !== commentId)
      const c = cases.find((x) => x.id === current?.id)
      if (c) c.comment_count = Math.max(0, (c.comment_count || 0) - 1)
      renderFeed()
      renderBoard()
    } catch (e) { toast('Could not delete comment: ' + e.message, 'error') }
  }

  // ── Case notes view / edit ───────────────────────────────
  function renderDescView() {
    const v = $('mDescView')
    const txt = current && current.description
    v.classList.toggle('empty', !txt)
    v.innerHTML = txt ? rich(txt) : 'Click to add case notes… Type @ to mention a detective.'
  }
  function startDescEdit() {
    if (!current) return
    const d = $('mDesc')
    d.value = toEdit(current.description)
    $('mDescView').hidden = true
    d.hidden = false
    autoGrow(d, 180)
    d.focus()
    d.setSelectionRange(d.value.length, d.value.length)
  }

  // ── @mentions ────────────────────────────────────────────
  //  Stored as @[Display Name](BADGE); typed/edited as @Display Name
  const MENTION_RE = /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9._-]{1,40})\)/g
  function toEdit(t) { return String(t || '').replace(MENTION_RE, '@$1') }
  function toStore(t) {
    let s = String(t || '')
    const list = people.filter((p) => p.name).slice().sort((a, b) => b.name.length - a.name.length)
    for (const p of list) {
      const re = new RegExp('@' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_])', 'gi')
      s = s.replace(re, () => '@[' + p.name.replace(/[\]\n]/g, '') + '](' + p.badge + ')')
    }
    return s
  }
  /** Escaped text with mentions turned into gold name chips */
  function rich(t) {
    return esc(t).replace(MENTION_RE, (m, n, b) => peopleByBadge[b]
      ? `<span class="cb-mention${b === me.badge ? ' me' : ''}" title="${esc(b)}">@${n}</span>`
      : '@' + n)
  }

  let mBox = null
  function closeMentionBox() { if (mBox) { mBox.el.remove(); mBox = null } }
  function attachMentions(el) {
    function update() {
      const pos = el.selectionStart
      const before = el.value.slice(0, pos)
      const m = /(^|[\s(])@([^\s@\[\]]{0,25})$/.exec(before)
      if (!m) { closeMentionBox(); return }
      const q = m[2].toLowerCase()
      const items = people.filter((p) => {
        const n = (p.name || '').toLowerCase()
        return !q || n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q)) || String(p.badge).toLowerCase().startsWith(q)
      }).slice(0, 7)
      if (!items.length) { closeMentionBox(); return }
      const start = pos - m[2].length - 1
      if (!mBox || mBox.input !== el) { closeMentionBox(); mBox = { el: document.createElement('div'), input: el, idx: 0 }; mBox.el.className = 'cb-mention-box'; document.body.appendChild(mBox.el) }
      mBox.items = items; mBox.start = start; mBox.end = pos
      if (mBox.idx >= items.length) mBox.idx = 0
      drawBox()
    }
    function drawBox() {
      const b = mBox
      b.el.innerHTML = '<div class="cb-mention-hint">MENTION A DETECTIVE</div>' + b.items.map((p, i) => `
        <div class="cb-picker-row ${i === b.idx ? 'on' : ''}" data-i="${i}">${avatar(p.badge)}<span>${esc(p.name || p.badge)}</span><small>${esc(p.badge)}</small></div>`).join('')
      const r = el.getBoundingClientRect()
      const h = Math.min(260, 30 + b.items.length * 36)
      const below = r.bottom + 4 + h < window.innerHeight
      b.el.style.left = Math.min(r.left, window.innerWidth - 270) + 'px'
      b.el.style.top = (below ? r.bottom + 4 : Math.max(8, r.top - 4 - h)) + 'px'
      b.el.onmousedown = (e) => {
        e.preventDefault() // keep focus in the text box
        const row = e.target.closest('[data-i]')
        if (row) pick(b.items[Number(row.dataset.i)])
      }
    }
    function pick(p) {
      if (!mBox || !p) return
      const ins = '@' + (p.name || p.badge) + ' '
      el.value = el.value.slice(0, mBox.start) + ins + el.value.slice(mBox.end)
      const caret = mBox.start + ins.length
      el.setSelectionRange(caret, caret)
      closeMentionBox()
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    el.addEventListener('input', update)
    el.addEventListener('click', update)
    el.addEventListener('blur', () => setTimeout(() => { if (mBox && mBox.input === el) closeMentionBox() }, 150))
    el.addEventListener('keydown', (e) => {
      if (!mBox || mBox.input !== el) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopImmediatePropagation()
        mBox.idx = (mBox.idx + (e.key === 'ArrowDown' ? 1 : -1) + mBox.items.length) % mBox.items.length
        drawBox()
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopImmediatePropagation()
        pick(mBox.items[mBox.idx])
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation()
        closeMentionBox()
      }
    }, true)
  }

  // ── Personal notifications (bell) ────────────────────────
  const Notif = (function () {
    const POLL_MS = 60 * 1000
    const ICON = { mention: '@', assigned: '&#9823;', status: '&#9873;', comment: '&#128172;' }
    let list = []
    function unreadCount() { return list.filter((n) => !n.is_read).length }
    async function load() {
      try {
        const json = await api('GET', { board: 'notifications' })
        list = json.notifications || []
        draw()
      } catch (_) { /* stay quiet; the board still works */ }
    }
    function title(n) {
      if ((n.count || 1) > 1) return `${n.count} updates on this case`
      const last = (n.lines || [])[n.lines.length - 1]
      return last ? last.text : 'Case update'
    }
    function draw() {
      const c = unreadCount()
      const badge = $('cbBellCount')
      badge.hidden = !c
      badge.textContent = c > 9 ? '9+' : String(c)
      $('cbBell').classList.toggle('has-new', c > 0)
      const el = $('cbNotifList')
      if (!list.length) { el.innerHTML = '<div class="cb-np-empty">You\'re all caught up.<br>You\'ll be told when you are assigned, mentioned, or a case you follow gets a comment or moves to In Review, Blocker or Completed.</div>'; return }
      el.innerHTML = list.map((n) => {
        const lines = n.lines || []
        const sub = (n.count || 1) > 1 ? lines.slice(-2).map((l) => l.text).join(' · ') : (n.case_title || '')
        return `<div class="cb-np-item ${n.is_read ? '' : 'unread'}" data-n="${esc(n.id)}" data-case="${esc(n.case_id)}">
          <div class="cb-np-ico k-${esc(n.kind)}">${ICON[n.kind] || '&#9679;'}</div>
          <div class="cb-np-body">
            <div class="cb-np-code">${esc(code({ case_no: n.case_no }))}${(n.count || 1) > 1 ? '' : ''}</div>
            <div class="cb-np-title">${esc(title(n))}</div>
            <div class="cb-np-line">${esc(sub)}</div>
            <div class="cb-np-time">${esc(timeAgo(n.updated_at))}</div>
          </div>
        </div>`
      }).join('')
    }
    function open() { $('cbNotifPanel').hidden = false; $('cbBell').setAttribute('aria-expanded', 'true'); load() }
    function close() { $('cbNotifPanel').hidden = true; $('cbBell').setAttribute('aria-expanded', 'false') }
    async function markCaseRead(caseId) {
      if (!list.some((n) => n.case_id === caseId && !n.is_read)) return
      list.forEach((n) => { if (n.case_id === caseId) n.is_read = true })
      draw()
      try { await api('PUT', { board: 'notifications' }, { case_id: caseId }) } catch (_) {}
    }
    async function markAll() {
      list.forEach((n) => { n.is_read = true })
      draw()
      try { await api('PUT', { board: 'notifications' }, { all: true }) } catch (_) {}
    }
    function init() {
      $('cbBell').addEventListener('click', (e) => { e.stopPropagation(); $('cbNotifPanel').hidden ? open() : close() })
      $('cbNotifPanel').addEventListener('click', (e) => {
        e.stopPropagation()
        if (e.target.closest('#cbMarkAll')) { markAll(); return }
        const it = e.target.closest('[data-case]')
        if (!it) return
        close()
        openCase(it.dataset.case)
        markCaseRead(it.dataset.case)
      })
      document.addEventListener('click', () => { if (!$('cbNotifPanel').hidden) close() })
      load()
      setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    }
    return { init, load, close, markCaseRead }
  })()

  function timeAgo(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return Math.floor(s / 60) + 'm ago'
    if (s < 86400) return Math.floor(s / 3600) + 'h ago'
    return Math.floor(s / 86400) + 'd ago'
  }

  // ── Helpers ──────────────────────────────────────────────
  function code(c) { return 'CASE-' + String(c?.case_no || 0).padStart(4, '0') }
  function nameOf(b) { return (peopleByBadge[b] && peopleByBadge[b].name) || b || '—' }
  function guessDivision() {
    const d = String(sessionStorage.getItem('cib_division') || '').toUpperCase()
    return d.includes('GRD') || d.includes('GANG') ? 'GRD' : 'CID'
  }
  function initials(b) {
    const n = nameOf(b)
    const parts = String(n).trim().split(/\s+/)
    return ((parts[0] || '')[0] || '?').toUpperCase() + ((parts[1] || '')[0] || '').toUpperCase()
  }
  function hue(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h }
  function avatar(b) {
    return `<span class="cb-av" style="background:hsl(${hue(b)},55%,68%)" title="${esc(nameOf(b))}">${esc(initials(b))}</span>`
  }
  function todayStr() {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  function shortDate(s) {
    const d = new Date(s + 'T00:00:00')
    return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  function fmtDateTime(iso) {
    const d = new Date(iso)
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  function fmtDay(iso) {
    const d = new Date(iso)
    if (isNaN(d)) return ''
    const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1)
    if (d.toDateString() === t.toDateString()) return 'TODAY'
    if (d.toDateString() === y.toDateString()) return 'YESTERDAY'
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
  }
  function fmtTime(iso) {
    const d = new Date(iso)
    return isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  function autoGrow(t, min) { t.style.height = 'auto'; t.style.height = Math.max(min || 0, t.scrollHeight + 2) + 'px' }
  function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g, '\\"') }
  function esc(s) {
    if (s === null || s === undefined) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }
})()
