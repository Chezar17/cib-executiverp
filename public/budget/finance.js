// ── STATE ──────────────────────────────────────────────────────
let currentUser = { badge: null, classification: null, name: null }
let mainBalance = null
let expenseCards = []
let currentDetailCardId = null
let pendingExpenseCardId = null
// Ledger state
let _ledgerAllExpenses = []
let _ledgerSearch = ''
let _ledgerSortCol = 'expense_date'
let _ledgerSortDir = 'desc'
// Detail table state
let _detailSearch = ''
let _detailSortCol = 'expense_date'
let _detailSortDir = 'desc'
let _detailExpenses = []

const TOKEN = () => sessionStorage.getItem('cib_token')
const BADGE  = () => sessionStorage.getItem('cib_badge')
const CLASS  = () => sessionStorage.getItem('cib_classification') || 'confidential'

const ALLOWED_CLASSES = ['top_secret','secret','confidential']
const TS_ONLY = ['top_secret']

function fmt(n) {
  if (n == null || isNaN(n)) return '0'
  return Number(n).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
}

// ── MODAL ────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open')
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open')
}

// ── VIEWS ────────────────────────────────────────────────────
const VIEWS = {
  overview: { bc:'NEXUS · BUDGET LEDGER', title:'Overview',        sub:'Department budget · Personal expense cards' },
  mycards:  { bc:'NEXUS · BUDGET LEDGER', title:'My Expense Card', sub:'Your personal allocated budget' },
  mainbal:  { bc:'NEXUS · BUDGET LEDGER', title:'Main Balance',    sub:'Top Secret · Budget administration' },
  detail:   { bc:'NEXUS · BUDGET LEDGER', title:'Expense Detail',  sub:'Transaction log · Personal card' },
  ledger:   { bc:'NEXUS · BUDGET LEDGER', title:'Full Ledger',     sub:'All expense transactions across all cards' },
}
function showView(name, navEl) {
  document.querySelectorAll('.fin-panel').forEach(p => p.classList.remove('active'))
  document.getElementById('view-' + name).classList.add('active')
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'))
  if (navEl) navEl.classList.add('active')
  const m = VIEWS[name]
  document.getElementById('panelBreadcrumb').textContent = m.bc
  document.getElementById('panelTitle').textContent = m.title
  document.getElementById('panelSub').textContent = m.sub
  document.getElementById('panelActions').innerHTML = ''

  if (name === 'overview') loadOverview()
  if (name === 'mycards')  renderMyCard()
  if (name === 'mainbal')  renderMainBalance()
  if (name === 'ledger')   loadLedger()
}

// ── API HELPER ────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type':'application/json', 'x-session-token': TOKEN() }
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(path, opts)
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

// ── LOAD DATA ─────────────────────────────────────────────────
async function loadData() {
  try {
    const [balRes, cardsRes] = await Promise.all([
      api('GET', '/api/finance-balance'),
      api('GET', '/api/finance-cards')
    ])
    if (balRes.ok)   mainBalance  = balRes.data.data
    if (cardsRes.ok) expenseCards = cardsRes.data.data || []
  } catch(e) {
    showToast('Failed to load finance data', 'error')
  }
}

// ── OVERVIEW ──────────────────────────────────────────────────
async function loadOverview() {
  await loadData()

  // Main balance card
  const avail = mainBalance ? mainBalance.available : 0
  document.getElementById('ovw-main-balance').textContent = fmt(avail)
  document.getElementById('stat-main').textContent = fmt(avail)

  if (mainBalance) {
    const start = new Date(mainBalance.period_start)
    const end   = new Date(mainBalance.period_end)
    const now   = new Date()
    const total = end - start
    const elapsed = Math.max(0, Math.min(total, now - start))
    const pct = total > 0 ? Math.round((elapsed/total)*100) : 0

    document.getElementById('ovw-period-label').textContent =
      `Budget Period: ${fmtDate(mainBalance.period_start)} – ${fmtDate(mainBalance.period_end)}`
    document.getElementById('ovw-period-sub').textContent = mainBalance.notes || ''
    document.getElementById('ovw-period-bar').style.width = pct + '%'
    document.getElementById('ovw-period-start').textContent = fmtDate(mainBalance.period_start)
    document.getElementById('ovw-period-end').textContent   = fmtDate(mainBalance.period_end)
  }

  if (TS_ONLY.includes(CLASS())) {
    document.getElementById('ovw-ts-note').textContent = '◆ Top Secret: You can edit main balance from the sidebar'
  }

  // Stats
  const allocated = expenseCards.reduce((s,c) => s + (c.personal_balance||0), 0)
  const spent     = expenseCards.reduce((s,c) => s + (c.total_spent||0), 0)
  document.getElementById('stat-allocated').textContent = fmt(allocated)
  document.getElementById('stat-spent').textContent     = fmt(spent)

  // Cards
  document.getElementById('ovw-cards-sub').textContent =
    `${expenseCards.length} card(s) · $${fmt(allocated)} allocated · $${fmt(spent)} spent`

  renderCards()
}

function renderCards() {
  const container = document.getElementById('cards-container')
  if (!expenseCards.length) {
    container.innerHTML = `<div style="grid-column:1/-1;">
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24"><path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>
        <div class="empty-state-text">No expense cards yet</div>
        <div class="empty-state-sub">Create the first personal expense card</div>
      </div></div>`
    return
  }

  container.innerHTML = expenseCards.map(card => {
    const isMine = card.owner_badge === BADGE()
    const bal = card.remaining_balance || 0
    const initial = card.personal_balance || 1
    const pct = Math.max(0, Math.min(100, Math.round((bal/initial)*100)))
    const balClass = pct > 50 ? 'ok' : pct > 20 ? 'warn' : 'danger'
    const spent = card.total_spent || 0

    return `<div class="expense-card ${isMine?'mine':''}">
      <div class="ec-header">
        <div>
          <div class="ec-owner">${card.label || card.owner_badge}</div>
          <div class="ec-name">${card.label || card.owner_badge}</div>
        </div>
        ${isMine ? '<span class="ec-badge-mine">MY CARD</span>' : ''}
      </div>
      <div class="ec-body">
        <div class="ec-balance-row">
          <div>
            <div class="ec-balance-label">Remaining</div>
            <div class="ec-balance-val ${balClass}">$${fmt(bal)}</div>
          </div>
          <div style="text-align:right">
            <div class="ec-balance-label">Initial</div>
            <div style="font-family:'Roboto Mono',monospace;font-size:11px;color:var(--muted);">$${fmt(initial)}</div>
          </div>
        </div>
        <div class="ec-bar-track"><div class="ec-bar-fill ${balClass}" style="width:${pct}%"></div></div>
        <div class="ec-meta">
          <div class="ec-meta-item"><b>$${fmt(spent)}</b>Spent</div>
          <div class="ec-meta-item"><b>${pct}%</b>Remaining</div>
          <div class="ec-meta-item"><b>${fmtDate(card.date_retrieved)}</b>Retrieved</div>
        </div>
        <div class="ec-footer">
          <button class="ec-btn ec-btn-view" onclick="openDetail('${card.id}')">View Expenses</button>
          ${isMine ? `<button class="ec-btn ec-btn-add" onclick="openAddExpense('${card.id}')">+ Add Expense</button>` : ''}
          ${isMine ? `<button class="ec-btn ec-btn-del" onclick="confirmDeleteCard('${card.id}')">✕</button>` : ''}
        </div>
      </div>
    </div>`
  }).join('')
}

// ── MY CARD ───────────────────────────────────────────────────
function renderMyCard() {
  const myCard = expenseCards.find(c => c.owner_badge === BADGE())
  const el = document.getElementById('mycard-content')
  if (!myCard) {
    el.innerHTML = `<div class="empty-state" style="margin-top:40px;">
      <svg class="empty-state-icon" viewBox="0 0 24 24"><path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>
      <div class="empty-state-text">No personal expense card</div>
      <div class="empty-state-sub" style="margin-bottom:20px;">You have not created an expense card yet</div>
      <button class="btn-action btn-green" onclick="openNewCardModal()" style="margin:0 auto;">Create My Card</button>
    </div>`
    return
  }
  // Just redirect to detail view
  openDetail(myCard.id)
}

// ── DETAIL VIEW ───────────────────────────────────────────────
async function openDetail(cardId) {
  currentDetailCardId = cardId
  _detailSearch = ''
  _detailSortCol = 'expense_date'
  _detailSortDir = 'desc'
  showView('detail', null)
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'))

  await loadData()
  const card = expenseCards.find(c => c.id === cardId)
  if (!card) return

  const res = await api('GET', `/api/finance-expenses?card_id=${cardId}`)
  _detailExpenses = res.ok ? (res.data.data || []) : []
  renderDetail(card)
}

function renderDetail(card) {
  const isMine     = card.owner_badge === BADGE()
  const bal        = card.remaining_balance || 0
  const initial    = card.personal_balance || 0
  const totalSpent = _detailExpenses.reduce((s, e) => s + (e.amount||0), 0)

  // Filter + sort
  const q = _detailSearch.toLowerCase()
  let rows = _detailExpenses.filter(e =>
    !q || e.description.toLowerCase().includes(q) ||
    fmtDate(e.expense_date).toLowerCase().includes(q) ||
    String(e.amount).includes(q)
  )
  rows = rows.slice().sort((a, b) => {
    let av = a[_detailSortCol], bv = b[_detailSortCol]
    if (_detailSortCol === 'amount') { av = +av; bv = +bv }
    else { av = av || ''; bv = bv || '' }
    if (av < bv) return _detailSortDir === 'asc' ? -1 : 1
    if (av > bv) return _detailSortDir === 'asc' ? 1 : -1
    return 0
  })

  function sortIcon(col) {
    if (_detailSortCol !== col) return '<span style="opacity:0.3;margin-left:4px;">↕</span>'
    return _detailSortDir === 'asc'
      ? '<span style="color:var(--finance-light);margin-left:4px;">↑</span>'
      : '<span style="color:var(--finance-light);margin-left:4px;">↓</span>'
  }
  function sortable(col, label) {
    return `<th style="cursor:pointer;user-select:none;" onclick="detailSort('${col}')">${label}${sortIcon(col)}</th>`
  }

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-back" onclick="showView('overview', document.getElementById('nav-overview'))">
      <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      Back to Overview
    </div>
    <div class="detail-hero">
      <div class="detail-hero-left">
        <div class="detail-hero-name">${card.label || card.owner_badge}</div>
        <div class="detail-hero-owner">${card.owner_badge} · Retrieved ${fmtDate(card.date_retrieved)}</div>
      </div>
      <div class="detail-hero-right">
        <div class="detail-balance">$${fmt(bal)}</div>
        <div class="detail-balance-label">Remaining Balance</div>
      </div>
    </div>
    <div class="detail-stats">
      <div class="detail-stat">
        <div class="detail-stat-label">Initial Balance</div>
        <div class="detail-stat-value" style="color:var(--finance-light);">$${fmt(initial)}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">Total Expenses</div>
        <div class="detail-stat-value" style="color:var(--red-alert);">$${fmt(totalSpent)}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">Transactions</div>
        <div class="detail-stat-value">${_detailExpenses.length}</div>
      </div>
    </div>
    <div class="exp-table-wrap">
      <div class="exp-table-head" style="flex-wrap:wrap;gap:10px;">
        <div class="exp-table-title">Expense Transactions</div>
        <div style="display:flex;gap:8px;align-items:center;flex:1;justify-content:flex-end;">
          <div class="tbl-search-wrap">
            <svg viewBox="0 0 24 24" class="tbl-search-icon"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            <input class="tbl-search-input" id="detail-search" type="text" placeholder="Search expenses..." value="${_detailSearch.replace(/"/g,'&quot;')}" oninput="detailSearchChange(this.value)"/>
          </div>
          ${isMine ? `<button class="btn-action btn-red btn-sm" onclick="openAddExpense('${card.id}')">+ Add Expense</button>` : ''}
        </div>
      </div>
      ${rows.length ? `
      <table class="exp-table">
        <thead><tr>
          <th>#</th>
          ${sortable('description','Description')}
          ${sortable('expense_date','Date')}
          ${sortable('amount','Amount')}
          ${isMine ? '<th>Actions</th>' : ''}
        </tr></thead>
        <tbody>
          ${rows.map((e, i) => `<tr
            data-exp-id="${e.id}"
            data-desc="${e.description.replace(/"/g,'&quot;')}"
            data-date="${e.expense_date?.split('T')[0]||''}"
            data-amount="${e.amount}">
            <td style="color:var(--muted);">${i+1}</td>
            <td>${e.description}</td>
            <td style="color:var(--muted);">${fmtDate(e.expense_date)}</td>
            <td class="amount-col">- $${fmt(e.amount)}</td>
            ${isMine ? `<td class="actions-col">
              <button class="tbl-btn tbl-btn-edit" onclick="openEditExpense('${e.id}','${card.id}')">Edit</button>
              <button class="tbl-btn tbl-btn-del" onclick="confirmDeleteExpense('${e.id}','${card.id}')">Delete</button>
            </td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="exp-total-row">
        ${q ? `<span style="font-family:'Roboto Mono',monospace;font-size:9px;letter-spacing:1px;color:var(--muted);">${rows.length} of ${_detailExpenses.length} shown</span>` : ''}
        <span class="exp-total-label">Total Expenses</span>
        <span class="exp-total-value">- $${fmt(totalSpent)}</span>
      </div>
      ` : `<div class="exp-table-empty">${_detailExpenses.length ? 'No results match your search' : 'No expenses recorded yet'}</div>`}
    </div>
  `
}

function detailSort(col) {
  if (_detailSortCol === col) {
    _detailSortDir = _detailSortDir === 'asc' ? 'desc' : 'asc'
  } else {
    _detailSortCol = col
    _detailSortDir = col === 'amount' ? 'desc' : 'desc'
  }
  const card = expenseCards.find(c => c.id === currentDetailCardId)
  if (card) renderDetail(card)
}

function detailSearchChange(val) {
  _detailSearch = val
  const card = expenseCards.find(c => c.id === currentDetailCardId)
  if (card) renderDetail(card)
}

// ── FULL LEDGER ───────────────────────────────────────────────
async function loadLedger() {
  await loadData()
  // Fetch expenses from all cards in parallel
  const fetches = expenseCards.map(card =>
    api('GET', `/api/finance-expenses?card_id=${card.id}`).then(res => {
      const expenses = res.ok ? (res.data.data || []) : []
      return expenses.map(e => ({
        ...e,
        card_label: card.label || card.owner_badge,
        card_owner: card.owner_badge
      }))
    })
  )
  const results = await Promise.all(fetches)
  _ledgerAllExpenses = results.flat()
  _ledgerSearch = ''
  _ledgerSortCol = 'expense_date'
  _ledgerSortDir = 'desc'
  renderLedger()
}

function renderLedger() {
  const total = _ledgerAllExpenses.reduce((s, e) => s + (e.amount||0), 0)
  const q = _ledgerSearch.toLowerCase()
  let rows = _ledgerAllExpenses.filter(e =>
    !q || e.description.toLowerCase().includes(q) ||
    (e.card_label || '').toLowerCase().includes(q) ||
    (e.card_owner || '').toLowerCase().includes(q) ||
    fmtDate(e.expense_date).toLowerCase().includes(q) ||
    String(e.amount).includes(q)
  )
  rows = rows.slice().sort((a, b) => {
    let av = a[_ledgerSortCol], bv = b[_ledgerSortCol]
    if (_ledgerSortCol === 'amount') { av = +av; bv = +bv }
    else if (_ledgerSortCol === 'card_label') { av = av || ''; bv = bv || '' }
    else { av = av || ''; bv = bv || '' }
    if (av < bv) return _ledgerSortDir === 'asc' ? -1 : 1
    if (av > bv) return _ledgerSortDir === 'asc' ? 1 : -1
    return 0
  })

  function sortIcon(col) {
    if (_ledgerSortCol !== col) return '<span style="opacity:0.3;margin-left:4px;">↕</span>'
    return _ledgerSortDir === 'asc'
      ? '<span style="color:var(--finance-light);margin-left:4px;">↑</span>'
      : '<span style="color:var(--finance-light);margin-left:4px;">↓</span>'
  }
  function sortable(col, label) {
    return `<th style="cursor:pointer;user-select:none;" onclick="ledgerSort('${col}')">${label}${sortIcon(col)}</th>`
  }

  const el = document.getElementById('ledger-content')
  if (!el) return

  el.innerHTML = `
    <div class="detail-stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px;">
      <div class="detail-stat">
        <div class="detail-stat-label">Total Entries</div>
        <div class="detail-stat-value">${_ledgerAllExpenses.length}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">Cards Active</div>
        <div class="detail-stat-value" style="color:var(--gold);">${expenseCards.length}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">Total Spent</div>
        <div class="detail-stat-value" style="color:var(--red-alert);">$${fmt(total)}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">Showing</div>
        <div class="detail-stat-value" style="color:var(--muted);font-size:14px;">${rows.length} / ${_ledgerAllExpenses.length}</div>
      </div>
    </div>
    <div class="exp-table-wrap">
      <div class="exp-table-head" style="flex-wrap:wrap;gap:10px;">
        <div class="exp-table-title">All Expense Transactions</div>
        <div style="display:flex;gap:8px;align-items:center;flex:1;justify-content:flex-end;">
          <div class="tbl-search-wrap">
            <svg viewBox="0 0 24 24" class="tbl-search-icon"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            <input class="tbl-search-input" id="ledger-search" type="text" placeholder="Search by card, description, date..." value="${_ledgerSearch.replace(/"/g,'&quot;')}" oninput="ledgerSearchChange(this.value)"/>
          </div>
          <button class="btn-action btn-outline btn-sm" onclick="exportLedgerDocx()" style="white-space:nowrap;display:flex;align-items:center;gap:6px;">
            <svg viewBox="0 0 24 24" style="width:11px;height:11px;fill:currentColor;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            Export Report
          </button>
        </div>
      </div>
      ${rows.length ? `
      <table class="exp-table">
        <thead><tr>
          <th>#</th>
          ${sortable('card_label','Card / Agent')}
          ${sortable('description','Description')}
          ${sortable('expense_date','Date')}
          ${sortable('amount','Amount')}
        </tr></thead>
        <tbody>
          ${rows.map((e, i) => `<tr>
            <td style="color:var(--muted);">${i+1}</td>
            <td>
              <div style="color:var(--white);font-size:10px;">${e.card_label}</div>
              <div style="color:var(--muted);font-size:9px;letter-spacing:1px;">${e.card_owner}</div>
            </td>
            <td>${e.description}</td>
            <td style="color:var(--muted);">${fmtDate(e.expense_date)}</td>
            <td class="amount-col">- $${fmt(e.amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="exp-total-row">
        ${q ? `<span style="font-family:'Roboto Mono',monospace;font-size:9px;letter-spacing:1px;color:var(--muted);">${rows.length} of ${_ledgerAllExpenses.length} shown</span>` : ''}
        <span class="exp-total-label">Grand Total</span>
        <span class="exp-total-value">- $${fmt(total)}</span>
      </div>
      ` : `<div class="exp-table-empty">${_ledgerAllExpenses.length ? 'No results match your search' : 'No expenses recorded yet'}</div>`}
    </div>
  `
}

function ledgerSort(col) {
  if (_ledgerSortCol === col) {
    _ledgerSortDir = _ledgerSortDir === 'asc' ? 'desc' : 'asc'
  } else {
    _ledgerSortCol = col
    _ledgerSortDir = 'desc'
  }
  renderLedger()
}

function ledgerSearchChange(val) {
  _ledgerSearch = val
  renderLedger()
}

// ── MAIN BALANCE PANEL (TS only) ──────────────────────────────
function renderMainBalance() {
  if (!TS_ONLY.includes(CLASS())) {
    document.getElementById('mainbal-content').innerHTML = `
      <div class="access-denied">
        <svg class="access-denied-icon" viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
        <div class="access-denied-title">Access Denied</div>
        <div class="access-denied-sub">This section requires Top Secret clearance</div>
      </div>`
    return
  }

  const bal = mainBalance
  document.getElementById('mainbal-content').innerHTML = `
    <div class="main-balance-card" style="max-width:600px;margin-bottom:20px;">
      <div class="mb-eyebrow">■ Current Main Balance</div>
      <div class="mb-amount"><span>$</span>${fmt(bal?.available)}</div>
      <div class="mb-label">Available · Original: $${fmt(bal?.total_amount)}</div>
      ${bal ? `
      <div class="mb-period-row">
        <div class="mb-period-icon"><svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg></div>
        <div class="mb-period-text"><b>Period: ${fmtDate(bal.period_start)} – ${fmtDate(bal.period_end)}</b>${bal.notes || ''}</div>
      </div>` : ''}
      <div class="mb-actions">
        <button class="mb-btn mb-btn-primary" onclick="openEditBalance()">Edit Balance & Period</button>
      </div>
    </div>
    <div style="max-width:600px;">
      <div class="section-header"><div class="section-title">Balance History</div></div>
      <div id="bal-history-container"><div class="empty-state" style="padding:30px;"><div class="empty-state-text" style="font-size:11px;">History coming soon</div></div></div>
    </div>
  `
}

// ── NEW CARD MODAL ────────────────────────────────────────────
function openNewCardModal() {
  document.getElementById('nc-balance').value = ''
  document.getElementById('nc-date').value = new Date().toISOString().split('T')[0]
  document.getElementById('nc-label').value = ''
  document.getElementById('newcard-alert').classList.remove('show')
  document.getElementById('nc-balance-err').classList.remove('show')
  openModal('modal-newcard')
}

async function submitNewCard() {
  const amount = parseFloat(document.getElementById('nc-balance').value)
  const date   = document.getElementById('nc-date').value
  const label  = document.getElementById('nc-label').value.trim()

  const alertEl = document.getElementById('newcard-alert')
  const errEl   = document.getElementById('nc-balance-err')
  alertEl.classList.remove('show')
  errEl.classList.remove('show')

  if (!amount || amount <= 0) { alertEl.textContent = 'Please enter a valid amount'; alertEl.classList.add('show'); return }
  if (!date) { alertEl.textContent = 'Please select a date'; alertEl.classList.add('show'); return }

  const avail = mainBalance?.available || 0
  if (amount > avail) { errEl.classList.add('show'); return }

  const res = await api('POST', '/api/finance-cards', {
    owner_badge:      BADGE(),
    personal_balance: amount,
    date_retrieved:   date,
    label:            label || currentUser.name || BADGE()
  })

  if (res.ok) {
    closeModal('modal-newcard')
    showToast('Expense card created', 'success')
    await loadData()
    renderCards()
    // Update stats
    const allocated = expenseCards.reduce((s,c) => s + (c.personal_balance||0), 0)
    document.getElementById('stat-main').textContent      = fmt(mainBalance?.available || 0)
    document.getElementById('ovw-main-balance').textContent = fmt(mainBalance?.available || 0)
    document.getElementById('stat-allocated').textContent = fmt(allocated)
  } else {
    alertEl.textContent = res.data.error || 'Failed to create card'
    alertEl.classList.add('show')
  }
}

// ── ADD EXPENSE ───────────────────────────────────────────────
function openAddExpense(cardId) {
  pendingExpenseCardId = cardId
  document.getElementById('exp-desc').value   = ''
  document.getElementById('exp-date').value   = new Date().toISOString().split('T')[0]
  document.getElementById('exp-amount').value = ''
  document.getElementById('addexp-alert').classList.remove('show')
  document.getElementById('exp-amount-err').classList.remove('show')
  openModal('modal-addexp')
}

async function submitExpense() {
  const desc   = document.getElementById('exp-desc').value.trim()
  const date   = document.getElementById('exp-date').value
  const amount = parseFloat(document.getElementById('exp-amount').value)
  const alertEl = document.getElementById('addexp-alert')
  const errEl   = document.getElementById('exp-amount-err')
  alertEl.classList.remove('show')
  errEl.classList.remove('show')

  if (!desc)   { alertEl.textContent = 'Please describe the expense'; alertEl.classList.add('show'); return }
  if (!date)   { alertEl.textContent = 'Please select a date'; alertEl.classList.add('show'); return }
  if (!amount || amount <= 0) { alertEl.textContent = 'Please enter a valid amount'; alertEl.classList.add('show'); return }

  const card = expenseCards.find(c => c.id === pendingExpenseCardId)
  if (card && amount > (card.remaining_balance || 0)) { errEl.classList.add('show'); return }

  const res = await api('POST', '/api/finance-expenses', {
    card_id:      pendingExpenseCardId,
    description:  desc,
    expense_date: date,
    amount
  })

  if (res.ok) {
    closeModal('modal-addexp')
    showToast('Expense recorded', 'success')
    await loadData()
    // Re-render wherever we are
    if (document.getElementById('view-detail').classList.contains('active')) {
      const expRes = await api('GET', `/api/finance-expenses?card_id=${currentDetailCardId}`)
      _detailExpenses = expRes.ok ? (expRes.data.data || []) : []
      const card = expenseCards.find(c => c.id === currentDetailCardId)
      if (card) renderDetail(card)
    } else {
      renderCards()
    }
  } else {
    alertEl.textContent = res.data.error || 'Failed to record expense'
    alertEl.classList.add('show')
  }
}

// ── EDIT MAIN BALANCE ─────────────────────────────────────────
function openEditBalance() {
  document.getElementById('eb-amount').value = mainBalance?.total_amount || ''
  document.getElementById('eb-start').value  = mainBalance?.period_start?.split('T')[0] || ''
  document.getElementById('eb-end').value    = mainBalance?.period_end?.split('T')[0] || ''
  document.getElementById('eb-notes').value  = mainBalance?.notes || ''
  openModal('modal-editbal')
}

async function submitEditBalance() {
  const amount = parseFloat(document.getElementById('eb-amount').value)
  const start  = document.getElementById('eb-start').value
  const end    = document.getElementById('eb-end').value
  const notes  = document.getElementById('eb-notes').value.trim()

  const res = await api('POST', '/api/finance-balance', {
    total_amount:   amount,
    period_start:   start,
    period_end:     end,
    notes
  })

  if (res.ok) {
    closeModal('modal-editbal')
    showToast('Balance updated', 'success')
    await loadData()
    renderMainBalance()
    loadOverview()
  } else {
    showToast(res.data.error || 'Failed to update balance', 'error')
  }
}

// ── DELETE CARD ───────────────────────────────────────────────
function confirmDeleteCard(cardId) {
  const card = expenseCards.find(c => c.id === cardId)
  document.getElementById('confirm-title').textContent = 'Delete Expense Card'
  document.getElementById('confirm-body').textContent  =
    `Delete the expense card "${card?.label || card?.owner_badge}"? The personal balance will be returned to the main budget. All expenses will remain in the log.`
  document.getElementById('confirm-ok-btn').onclick = () => deleteCard(cardId)
  openModal('modal-confirm')
}

async function deleteCard(cardId) {
  const res = await api('DELETE', `/api/finance-cards?id=${cardId}`)
  closeModal('modal-confirm')
  if (res.ok) {
    showToast('Card deleted · Balance returned to main budget', 'success')
    await loadData()
    renderCards()
  } else {
    showToast('Failed to delete card', 'error')
  }
}

// ── EDIT EXPENSE ─────────────────────────────────────────────
let _editExpenseId   = null
let _editExpenseCardId = null

function openEditExpense(expId, cardId) {
  // Find the expense in the current detail view expenses list
  // We store a lightweight reference — the table row has all we need
  _editExpenseId     = expId
  _editExpenseCardId = cardId

  // Grab values from the rendered row (avoids extra API call)
  const row = document.querySelector(`[data-exp-id="${expId}"]`)
  if (row) {
    document.getElementById('edit-exp-desc').value   = row.dataset.desc   || ''
    document.getElementById('edit-exp-date').value   = row.dataset.date   || ''
    document.getElementById('edit-exp-amount').value = row.dataset.amount || ''
  } else {
    // Fallback: clear fields
    document.getElementById('edit-exp-desc').value   = ''
    document.getElementById('edit-exp-date').value   = new Date().toISOString().split('T')[0]
    document.getElementById('edit-exp-amount').value = ''
  }
  document.getElementById('editexp-alert').classList.remove('show')
  document.getElementById('edit-exp-amount-err').classList.remove('show')
  openModal('modal-editexp')
}

async function submitEditExpense() {
  const desc   = document.getElementById('edit-exp-desc').value.trim()
  const date   = document.getElementById('edit-exp-date').value
  const amount = parseFloat(document.getElementById('edit-exp-amount').value)
  const alertEl = document.getElementById('editexp-alert')
  const errEl   = document.getElementById('edit-exp-amount-err')
  alertEl.classList.remove('show')
  errEl.classList.remove('show')

  if (!desc)   { alertEl.textContent = 'Please describe the expense'; alertEl.classList.add('show'); return }
  if (!date)   { alertEl.textContent = 'Please select a date'; alertEl.classList.add('show'); return }
  if (!amount || amount <= 0) { alertEl.textContent = 'Please enter a valid amount'; alertEl.classList.add('show'); return }

  // Validate against card balance
  // remaining = current remaining + this expense's original amount (since we're replacing it)
  const card = expenseCards.find(c => c.id === _editExpenseCardId)
  if (card) {
    const origRow = document.querySelector(`[data-exp-id="${_editExpenseId}"]`)
    const origAmt = origRow ? parseFloat(origRow.dataset.amount || 0) : 0
    const maxAllowed = (card.remaining_balance || 0) + origAmt
    if (amount > maxAllowed) { errEl.classList.add('show'); return }
  }

  const res = await api('PATCH', `/api/finance-expenses?id=${_editExpenseId}`, {
    description:  desc,
    expense_date: date,
    amount
  })

  if (res.ok) {
    closeModal('modal-editexp')
    showToast('Expense updated', 'success')
    await loadData()
    const expRes = await api('GET', `/api/finance-expenses?card_id=${_editExpenseCardId}`)
    _detailExpenses = expRes.ok ? (expRes.data.data || []) : []
    const card = expenseCards.find(c => c.id === _editExpenseCardId)
    if (card) renderDetail(card)
  } else {
    alertEl.textContent = res.data.error || 'Failed to update expense'
    alertEl.classList.add('show')
  }
}

// ── DELETE EXPENSE ────────────────────────────────────────────
function confirmDeleteExpense(expId, cardId) {
  document.getElementById('confirm-title').textContent = 'Delete Expense'
  document.getElementById('confirm-body').textContent  = 'Delete this expense record? The amount will be returned to your personal balance.'
  document.getElementById('confirm-ok-btn').onclick = () => deleteExpense(expId, cardId)
  openModal('modal-confirm')
}

async function deleteExpense(expId, cardId) {
  const res = await api('DELETE', `/api/finance-expenses?id=${expId}`)
  closeModal('modal-confirm')
  if (res.ok) {
    showToast('Expense deleted · Balance restored', 'success')
    await loadData()
    _detailExpenses = _detailExpenses.filter(e => e.id !== expId)
    const card = expenseCards.find(c => c.id === cardId)
    if (card) renderDetail(card)
  } else {
    showToast('Failed to delete expense', 'error')
  }
}

// ── EXPORT LEDGER TO DOCX ─────────────────────────────────────
async function exportLedgerDocx() {
  if (!_ledgerAllExpenses.length) {
    showToast('No data to export', 'error')
    return
  }

  showToast('Generating report...', 'info')

  try {
    const now     = new Date()
    const fmtNow  = now.toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })
    const fmtTime = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })
    const fmtAmt  = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits:0 })
    const xmlEsc  = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

    const sorted = _ledgerAllExpenses.slice().sort((a,b) =>
      (b.expense_date||'').localeCompare(a.expense_date||''))
    const grandTotal = sorted.reduce((s,e) => s+(e.amount||0), 0)

    // Card summary
    const byCard = {}
    sorted.forEach(e => {
      const k = e.card_label || e.card_owner
      if (!byCard[k]) byCard[k] = { label:k, owner:e.card_owner, total:0, count:0 }
      byCard[k].total += e.amount||0
      byCard[k].count++
    })

    // ── XML helpers ──────────────────────────────────────────
    const run = (text, opts={}) => {
      const rpr = [
        opts.bold   ? '<w:b/>'                                : '',
        opts.size   ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : '',
        opts.color  ? `<w:color w:val="${opts.color}"/>`      : '',
        opts.font   ? `<w:rFonts w:ascii="${opts.font}" w:hAnsi="${opts.font}"/>` : '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>',
        opts.caps   ? '<w:caps/>'                             : '',
      ].join('')
      return `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`
    }

    const para = (children, opts={}) => {
      const ppr = [
        opts.align  ? `<w:jc w:val="${opts.align}"/>`          : '',
        opts.space  ? `<w:spacing w:before="${opts.space.before||0}" w:after="${opts.space.after||0}"/>` : '',
        opts.borderBottom ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="${opts.borderBottom}"/></w:pBdr>` : '',
        opts.borderTop    ? `<w:pBdr><w:top    w:val="single" w:sz="4" w:space="6" w:color="${opts.borderTop}"/></w:pBdr>`    : '',
      ].join('')
      return `<w:p><w:pPr>${ppr}</w:pPr>${children}</w:p>`
    }

    const tcPr = (w, shade='') =>
      `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${shade?`<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`:''}` +
      `<w:tcMar><w:top w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:left w:w="130" w:type="dxa"/><w:right w:w="130" w:type="dxa"/></w:tcMar></w:tcPr>`

    const tc = (content, w, shade='') =>
      `<w:tc>${tcPr(w,shade)}${content}</w:tc>`

    const borderXml = `<w:tblBorders>
      <w:top    w:val="single" w:sz="2" w:space="0" w:color="C8C8C8"/>
      <w:left   w:val="single" w:sz="2" w:space="0" w:color="C8C8C8"/>
      <w:bottom w:val="single" w:sz="2" w:space="0" w:color="C8C8C8"/>
      <w:right  w:val="single" w:sz="2" w:space="0" w:color="C8C8C8"/>
      <w:insideH w:val="single" w:sz="2" w:space="0" w:color="C8C8C8"/>
      <w:insideV w:val="single" w:sz="2" w:space="0" w:color="C8C8C8"/>
    </w:tblBorders>`

    // ── Summary table ────────────────────────────────────────
    // Content width landscape A4 with 800 DXA margins = 16838 - 1600 = 15238
    // Summary cols: 5000, 3000, 2119, 3000 = 13119 (centered-ish)
    const summaryHeader = `<w:tr>
      ${tc(para(run('Card / Agent', {bold:true,color:'FFFFFF',size:17})), 5000, '1C3A2A')}
      ${tc(para(run('Badge',        {bold:true,color:'FFFFFF',size:17})), 3000, '1C3A2A')}
      ${tc(para(run('Transactions', {bold:true,color:'FFFFFF',size:17}),'align:center'), 2119, '1C3A2A')}
      ${tc(para(run('Total Spent',  {bold:true,color:'FFFFFF',size:17})), 3000, '1C3A2A')}
    </w:tr>`

    const summaryRows = Object.values(byCard).map(c => `<w:tr>
      ${tc(para(run(c.label, {bold:true,size:18})), 5000)}
      ${tc(para(run(c.owner, {color:'555555',size:17})), 3000)}
      ${tc(para(run(c.count, {size:17}), {align:'center'}), 2119)}
      ${tc(para(run(fmtAmt(c.total), {bold:true,color:'C0392B',size:18}), {align:'right'}), 3000)}
    </w:tr>`).join('')

    const summaryTable = `<w:tbl>
      <w:tblPr><w:tblW w:w="13119" w:type="dxa"/>${borderXml}<w:tblLook w:val="0000"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="5000"/><w:gridCol w:w="3000"/><w:gridCol w:w="2119"/><w:gridCol w:w="3000"/></w:tblGrid>
      ${summaryHeader}${summaryRows}
    </w:tbl>`

    // ── Main transactions table ──────────────────────────────
    // cols: 600, 3100, 6338, 2100, 3100 = 15238
    const txHeader = `<w:tr>
      ${tc(para(run('#',           {bold:true,color:'FFFFFF',size:17}), {align:'center'}), 600,  '1C3A2A')}
      ${tc(para(run('Card / Agent',{bold:true,color:'FFFFFF',size:17})),                   3100, '1C3A2A')}
      ${tc(para(run('Description', {bold:true,color:'FFFFFF',size:17})),                   6338, '1C3A2A')}
      ${tc(para(run('Date',        {bold:true,color:'FFFFFF',size:17})),                   2100, '1C3A2A')}
      ${tc(para(run('Amount',      {bold:true,color:'FFFFFF',size:17}), {align:'right'}),  3100, '1C3A2A')}
    </w:tr>`

    const txRows = sorted.map((e,i) => `<w:tr>
      ${tc(para(run(i+1, {color:'888888',size:17}), {align:'center'}), 600)}
      ${tc(`${para(run(e.card_label||'—', {bold:true,size:18}))}${para(run(e.card_owner||'', {color:'888888',size:15}))}`, 3100)}
      ${tc(para(run(e.description||'—', {size:18})), 6338)}
      ${tc(para(run(fmtDate(e.expense_date), {color:'555555',size:17})), 2100)}
      ${tc(para(run(fmtAmt(e.amount), {bold:true,color:'C0392B',size:18}), {align:'right'}), 3100)}
    </w:tr>`).join('')

    const txTotalRow = `<w:tr>
      ${tc(para(''), 600,  'F5F5F5')}
      ${tc(para(''), 3100, 'F5F5F5')}
      ${tc(para(''), 6338, 'F5F5F5')}
      ${tc(para(run('GRAND TOTAL', {bold:true,size:17,caps:true}), {align:'right'}), 2100, 'F5F5F5')}
      ${tc(para(run(fmtAmt(grandTotal), {bold:true,color:'C0392B',size:20}), {align:'right'}), 3100, 'F5F5F5')}
    </w:tr>`

    const txTable = `<w:tbl>
      <w:tblPr><w:tblW w:w="15238" w:type="dxa"/>${borderXml}<w:tblLook w:val="0000"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="3100"/><w:gridCol w:w="6338"/><w:gridCol w:w="2100"/><w:gridCol w:w="3100"/></w:tblGrid>
      ${txHeader}${txRows}${txTotalRow}
    </w:tbl>`

    // ── Logo (optional) ──────────────────────────────────────
    let logoXml  = ''
    let logoRels = ''
    let logoBytes = null
    try {
      const resp = await fetch('/images/cib-logo.png')
      if (resp.ok) {
        const ab = await resp.arrayBuffer()
        logoBytes = ab
        // 48x48 px → EMU: 1px = 9144 EMU
        const cx = 48 * 9144, cy = 48 * 9144
        logoXml = `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="80"/></w:pPr>
          <w:r><w:rPr/><w:drawing>
            <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
              <wp:extent cx="${cx}" cy="${cy}"/>
              <wp:docPr id="1" name="logo"/>
              <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:nvPicPr><pic:cNvPr id="1" name="logo"/><pic:cNvPicPr/></pic:nvPicPr>
                    <pic:blipFill>
                      <a:blip r:embed="rIdLogo" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
                      <a:stretch><a:fillRect/></a:stretch>
                    </pic:blipFill>
                    <pic:spPr>
                      <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
                      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                    </pic:spPr>
                  </pic:pic>
                </a:graphicData>
              </a:graphic>
            </wp:inline>
          </w:drawing></w:r></w:p>`
        logoRels = `<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>`
      }
    } catch(_) {}

    // ── document.xml ────────────────────────────────────────
    const body = [
      logoXml,
      para(run('CENTRAL INVESTIGATION BUREAU', {bold:true,color:'1C3A2A',size:28,caps:true}), {align:'center', space:{before:0,after:60}}),
      para(run('BUDGET LEDGER · FULL EXPENSE REPORT', {color:'27AE60',size:22,caps:true}), {align:'center', space:{before:0,after:60}}),
      para(run(`Generated: ${fmtNow} at ${fmtTime}   ·   Prepared by: ${xmlEsc(currentUser.name||currentUser.badge||'—')}`, {color:'888888',size:17}),
           {align:'center', borderBottom:'CCCCCC', space:{before:0,after:60}}),
      para('', {space:{after:200}}),

      para(run('CARD SUMMARY', {bold:true,color:'1C3A2A',size:22,caps:true}), {space:{after:140}}),
      summaryTable,
      para('', {space:{after:300}}),

      para(run('ALL TRANSACTIONS', {bold:true,color:'1C3A2A',size:22,caps:true}), {space:{after:140}}),
      para(run(`${sorted.length} total expense record(s) across ${Object.keys(byCard).length} card(s)`, {color:'555555',size:17}), {space:{after:140}}),
      txTable,
      para('', {space:{after:300}}),

      para(run('CLASSIFIED · CIB INTERNAL USE ONLY · ALL TRANSACTIONS ARE LOGGED', {color:'AAAAAA',size:15,caps:true}),
           {align:'center', borderTop:'CCCCCC', space:{before:200,after:0}}),
    ].join('\n')

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  mc:Ignorable="w14">
<w:body>
${body}
<w:sectPr>
  <w:headerReference w:type="default" r:id="rIdHdr"/>
  <w:footerReference w:type="default" r:id="rIdFtr"/>
  <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
  <w:pgMar w:top="800" w:right="800" w:bottom="800" w:left="800" w:header="400" w:footer="400" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`

    const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="right"/>
      <w:pBdr><w:bottom w:val="single" w:sz="4" w:space="6" w:color="CCCCCC"/></w:pBdr>
    </w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="AAAAAA"/><w:caps/></w:rPr>
      <w:t>CIB · Budget Ledger · Confidential</w:t>
    </w:r>
  </w:p>
</w:hdr>`

    const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:p>
    <w:pPr><w:jc w:val="right"/>
      <w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="CCCCCC"/></w:pBdr>
    </w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="AAAAAA"/></w:rPr>
      <w:t xml:space="preserve">Page </w:t></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="AAAAAA"/></w:rPr>
      <w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="AAAAAA"/></w:rPr>
      <w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="AAAAAA"/></w:rPr>
      <w:fldChar w:fldCharType="end"/></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="AAAAAA"/></w:rPr>
      <w:t xml:space="preserve"> of </w:t></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="AAAAAA"/></w:rPr>
      <w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="AAAAAA"/></w:rPr>
      <w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="AAAAAA"/></w:rPr>
      <w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:ftr>`

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"  Target="styles.xml"/>
  <Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  ${logoRels}
</Relationships>`

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>
      <w:sz w:val="20"/><w:szCs w:val="20"/>
    </w:rPr></w:rPrDefault>
  </w:docDefaults>
</w:styles>`

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  ${logoBytes ? '<Default Extension="png" ContentType="image/png"/>' : ''}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml"   ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml"  ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml"  ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`

    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

    // ── Assemble ZIP ─────────────────────────────────────────
    const zip = new JSZip()
    zip.file('[Content_Types].xml',          contentTypesXml)
    zip.file('_rels/.rels',                  rootRelsXml)
    zip.file('word/document.xml',            documentXml)
    zip.file('word/styles.xml',              stylesXml)
    zip.file('word/header1.xml',             headerXml)
    zip.file('word/footer1.xml',             footerXml)
    zip.file('word/_rels/document.xml.rels', relsXml)
    if (logoBytes) zip.file('word/media/logo.png', logoBytes)

    const blob = await zip.generateAsync({ type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `CIB_Expense_Report_${now.toISOString().split('T')[0]}.docx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('Report exported successfully', 'success')

  } catch(err) {
    console.error('Export error:', err)
    showToast('Export failed: ' + err.message, 'error')
  }
}

// ── LOGOUT ───────────────────────────────────────────────────
function logout() { PortalAuth.logout() }

// ── TOAST ────────────────────────────────────────────────────
function showToast(msg, type) {
  PortalAuth.showToast(msg, type || 'success', 'fin-toast')
}

// ── AUTH + CLOCK + IDLE TIMEOUT ───────────────────────────────
PortalAuth.init({
  badgeEls: ['badgeDisplay', 'sidebarBadge'],
  clockEl:  'liveClock',
  onReady:  function(badge) {
    const cls = CLASS()

    // Classification clearance check
    if (!ALLOWED_CLASSES.includes(cls)) {
      const gate = document.getElementById('access-gate')
      gate.innerHTML = `
        <div style="text-align:center;">
          <div class="gate-text" style="color:var(--red-alert);margin-bottom:12px;">ACCESS DENIED</div>
          <div style="font-family:'Roboto Mono',monospace;font-size:10px;color:var(--muted);">Insufficient clearance level</div>
        </div>`
      gate.classList.remove('hidden')
      return
    }

    // Populate extra elements
    currentUser.badge = badge
    currentUser.classification = cls
    // Use 'name' column from users table if available
    const displayName = sessionStorage.getItem('cib_name') || badge
    currentUser.name  = displayName
    // Override the badge display elements to show name instead
    ;['badgeDisplay','sidebarBadge'].forEach(id => {
      const el = document.getElementById(id)
      if (el) el.textContent = displayName
    })

    const clsEl = document.getElementById('sidebarClassification')
    if (clsEl) clsEl.textContent = cls?.replace('_', ' ').toUpperCase() || '—'

    if (TS_ONLY.includes(cls)) {
      const tsSection = document.getElementById('ts-section')
      if (tsSection) tsSection.style.display = 'block'
    }

    loadOverview()
  }
})

SiteUi.initPageFadeTransitions({ transitionMs: 400 })
SiteUi.initScrollReveal()