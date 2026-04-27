/* ============================================================
   report-form.js – Investigation Report CRUD + PDF Export
   ============================================================ */
;(function () {
  'use strict'

  // ── State ────────────────────────────────────────────────
  let reportId   = null  // null = new report
  let victims    = []    // { id_code, full_name, age, sex, race, telephone, welfare_occupation, notes, family, autopsy_by, autopsy_summary }
  let suspects   = []    // { id_code, full_name, description, dob, sex, age, race, telephone, welfare_occupation, family, interrogation_url, interrogation_summary, mugshot_url }
  let witnesses  = []    // { id_code, full_name, status, welfare, occupation, content }
  let evidences  = []    // { id_code, name, was_status, evidence_status, date_of_retrieval, image_url, summary }
  let debriefs   = []    // { title, date_of_incident, content }

  // ── Bootstrap ────────────────────────────────────────────
  PortalAuth.init({
    loginHref: '/login',
    badgeEls:  ['badgeDisplay'],
    clockEl:   'liveClock',
    onReady: function () {
      document.getElementById('portalContent').style.display = 'block'
      const params = new URLSearchParams(window.location.search)
      reportId = params.get('id') || null
      if (reportId) {
        document.getElementById('formPageTitle').textContent = 'EDIT INVESTIGATION REPORT'
        document.getElementById('exportBtn').style.display = 'inline-flex'
        loadReport(reportId)
      } else {
        renderVictimRows()
        renderSuspectRows()
        renderSuspectDetails()
        renderVictimDetails()
        renderDebriefList()
        renderWitnessList()
        renderEvidenceList()
      }
    }
  })

  // ── Tab switching ────────────────────────────────────────
  window.switchTab = function (btn, secId) {
    document.querySelectorAll('.sec-tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.form-section').forEach(s => s.style.display = 'none')
    btn.classList.add('active')
    document.getElementById(secId).style.display = 'block'
  }

  // ── Load existing report ─────────────────────────────────
  async function loadReport(id) {
    try {
      const token = sessionStorage.getItem('cib_token')
      const res   = await fetch('/api/reports/' + id, {
        headers: { 'x-session-token': token }
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const { report } = await res.json()
      populateForm(report)
    } catch (e) {
      PortalAuth.showToast('Failed to load report: ' + e.message, 'error', 'toast-container')
    }
  }

  function populateForm(r) {
    // Main fields
    setVal('case_title',           r.case_title)
    setVal('case_number',          r.case_number)
    setVal('offense_type',         r.offense_type)
    setVal('mdw_incident_number',  r.mdw_incident_number)
    setVal('building_number',      r.building_number)
    setVal('address',              r.address)
    setVal('bureau_name',          r.bureau_name)
    setVal('agency_code',          r.agency_code)
    setVal('specific_location',    r.specific_location)
    setVal('location_code',        r.location_code)
    setVal('date_of_offense',      r.date_of_offense)
    setVal('time_of_offense',      r.time_of_offense)
    setVal('day_of_offense',       r.day_of_offense)
    setVal('date_reported',        r.date_reported)
    setVal('day_reported',         r.day_reported)
    setVal('lead_investigators',   r.lead_investigators)
    setVal('prosecutor',           r.prosecutor)
    setVal('prosecutor_time_start',r.prosecutor_time_start)
    setVal('prosecutor_time_end',  r.prosecutor_time_end)
    setVal('suspect_status',       r.suspect_status)
    setVal('suspect_disposition',  r.suspect_disposition)
    setVal('suspect_notes',        r.suspect_notes)
    // Closure
    setVal('closure_summary',          r.closure_summary)
    setVal('closure_forensic',         r.closure_forensic)
    setVal('closure_suspect_id',       r.closure_suspect_id)
    setVal('closure_final_disposition',r.closure_final_disposition)
    setVal('closure_time_received',    r.closure_time_received)
    setVal('closure_time_arrived',     r.closure_time_arrived)
    setVal('closure_detective_name',   r.closure_detective_name)
    setVal('closure_date',             r.closure_date)
    setVal('closure_returned_to_service', r.closure_returned_to_service)
    setVal('case_referred_to',         r.case_referred_to)
    setVal('case_status',              r.case_status)
    setVal('prosecutor_final_name',    r.prosecutor_final_name)
    setVal('prosecutor_final_occupation', r.prosecutor_final_occupation)
    setVal('detective_how_closed',     r.detective_how_closed)
    setVal('detective_value_of_property', r.detective_value_of_property)
    setVal('detective_referred_to',    r.detective_referred_to)
    setVal('detective_date_referral',  r.detective_date_referral)
    // Radios
    setRadio('category',     r.category     || 'A')
    setRadio('closure_type', r.closure_type || 'CID')
    // Checkboxes
    setChk('jur_lspd',  r.jurisdiction_lspd)
    setChk('jur_sast',  r.jurisdiction_sast)
    setChk('jur_lscs',  r.jurisdiction_lscs)
    setChk('jur_state', r.jurisdiction_state)
    setChk('det_suspect_developed',  r.detective_suspect_developed)
    setChk('det_suspect_arrested',   r.detective_suspect_arrested)
    setChk('det_entered_forensics',  r.detective_entered_forensics)
    setChk('det_evidence_recovered', r.detective_evidence_recovered)
    setChk('det_cleared_forensics',  r.detective_cleared_forensics)

    // Sub-items
    victims   = r.victims          || []
    suspects  = r.suspects         || []
    witnesses = r.witnesses        || []
    evidences = r.evidences        || []
    debriefs  = r.debrief_entries  || []

    renderVictimRows()
    renderSuspectRows()
    renderSuspectDetails()
    renderVictimDetails()
    renderDebriefList()
    renderWitnessList()
    renderEvidenceList()
  }

  // ── Build payload from form ──────────────────────────────
  function buildPayload() {
    syncSubArraysFromDOM()
    return {
      case_title:              getVal('case_title'),
      case_number:             getVal('case_number'),
      category:                getRadio('category') || 'A',
      offense_type:            getVal('offense_type'),
      mdw_incident_number:     getVal('mdw_incident_number'),
      building_number:         getVal('building_number'),
      address:                 getVal('address'),
      bureau_name:             getVal('bureau_name'),
      agency_code:             getVal('agency_code'),
      specific_location:       getVal('specific_location'),
      location_code:           getVal('location_code'),
      date_of_offense:         getVal('date_of_offense')  || null,
      time_of_offense:         getVal('time_of_offense'),
      day_of_offense:          getVal('day_of_offense'),
      date_reported:           getVal('date_reported')    || null,
      day_reported:            getVal('day_reported'),
      jurisdiction_lspd:       getChk('jur_lspd'),
      jurisdiction_sast:       getChk('jur_sast'),
      jurisdiction_lscs:       getChk('jur_lscs'),
      jurisdiction_state:      getChk('jur_state'),
      lead_investigators:      getVal('lead_investigators'),
      prosecutor:              getVal('prosecutor'),
      prosecutor_time_start:   getVal('prosecutor_time_start') || null,
      prosecutor_time_end:     getVal('prosecutor_time_end')   || null,
      suspect_status:          getVal('suspect_status'),
      suspect_disposition:     getVal('suspect_disposition'),
      suspect_notes:           getVal('suspect_notes'),
      closure_summary:         getVal('closure_summary'),
      closure_forensic:        getVal('closure_forensic'),
      closure_suspect_id:      getVal('closure_suspect_id'),
      closure_final_disposition: getVal('closure_final_disposition'),
      closure_time_received:   getVal('closure_time_received')  || null,
      closure_time_arrived:    getVal('closure_time_arrived')   || null,
      closure_type:            getRadio('closure_type') || 'CID',
      closure_detective_name:  getVal('closure_detective_name'),
      closure_date:            getVal('closure_date')           || null,
      closure_returned_to_service: getVal('closure_returned_to_service') || null,
      case_referred_to:        getVal('case_referred_to'),
      case_status:             getVal('case_status') || 'OPEN',
      prosecutor_final_name:   getVal('prosecutor_final_name'),
      prosecutor_final_occupation: getVal('prosecutor_final_occupation'),
      detective_how_closed:    getVal('detective_how_closed'),
      detective_suspect_developed:  getChk('det_suspect_developed'),
      detective_suspect_arrested:   getChk('det_suspect_arrested'),
      detective_entered_forensics:  getChk('det_entered_forensics'),
      detective_evidence_recovered: getChk('det_evidence_recovered'),
      detective_value_of_property:  getVal('detective_value_of_property'),
      detective_cleared_forensics:  getChk('det_cleared_forensics'),
      detective_referred_to:   getVal('detective_referred_to'),
      detective_date_referral: getVal('detective_date_referral') || null,
      // Sub-arrays
      victims:          victims,
      suspects:         suspects,
      witnesses:        witnesses,
      evidences:        evidences,
      debrief_entries:  debriefs,
    }
  }

  // ── Field validation helper ──────────────────────────────
  function validateField(id, label, tabId) {
    const el = document.getElementById(id)
    if (!el || !el.value.trim()) {
      // Switch to the tab containing the field
      if (tabId) {
        const tabBtn = document.querySelector(`.sec-tab[data-sec="${tabId}"]`)
        if (tabBtn) switchTab(tabBtn, tabId)
      }
      // Highlight the invalid field
      if (el) {
        el.classList.add('field-error')
        el.focus()
        el.addEventListener('input', () => el.classList.remove('field-error'), { once: true })
      }
      PortalAuth.showToast(label + ' is required.', 'error', 'toast-container')
      return false
    }
    return true
  }

  // ── Save report ──────────────────────────────────────────
  window.saveReport = async function () {
    if (!validateField('case_number', 'Case Number', 'sec-a')) return
    if (!validateField('case_title',  'Case Title',  'sec-a')) return
    const btn = document.getElementById('saveBtn')
    btn.disabled = true; btn.textContent = 'Saving...'
    try {
      const token   = sessionStorage.getItem('cib_token')
      const payload = buildPayload()
      let url    = '/api/reports'
      let method = 'POST'
      if (reportId) { url = '/api/reports/' + reportId; method = 'PUT' }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type':  'application/json',
          'x-session-token': token
        },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'HTTP ' + res.status)
      }
      const json = await res.json()
      if (!reportId && json.report?.id) {
        reportId = json.report.id
        history.replaceState({}, '', '/portal/reports/form?id=' + reportId)
        document.getElementById('formPageTitle').textContent = 'EDIT INVESTIGATION REPORT'
        document.getElementById('exportBtn').style.display = 'inline-flex'
      }
      PortalAuth.showToast('Report saved successfully.', 'success', 'toast-container')
    } catch (e) {
      PortalAuth.showToast('Save failed: ' + e.message, 'error', 'toast-container')
    } finally {
      btn.disabled = false; btn.textContent = 'Save Report'
    }
  }

  // ─────────────────────────────────────────────────────────
  // VICTIM rows (Section A summary + Section D detail)
  // ─────────────────────────────────────────────────────────
  window.addVictimRow = function () {
    victims.push({ id_code: 'v.' + (victims.length + 1), full_name: '', age: '', sex: 'M', race: '', telephone: '-', welfare_occupation: '', notes: '-', family: '-', autopsy_by: '', autopsy_summary: '' })
    renderVictimRows(); renderVictimDetails()
  }

  function renderVictimRows() {
    const tb = document.getElementById('victimRows')
    if (!tb) return
    if (!victims.length) { tb.innerHTML = '<tr><td colspan="8" style="color:var(--muted);padding:12px;font-size:12px;text-align:center">No victims added yet.</td></tr>'; return }
    tb.innerHTML = victims.map((v, i) => `
      <tr>
        <td><input value="${esc(v.id_code)}" onchange="victims[${i}].id_code=this.value;renderSuspectDetails();renderVictimDetails()" style="width:60px"/></td>
        <td><input value="${esc(v.full_name)}" onchange="victims[${i}].full_name=this.value;renderVictimDetails()"/></td>
        <td><input value="${esc(v.age)}" onchange="victims[${i}].age=this.value" style="width:50px"/></td>
        <td><select onchange="victims[${i}].sex=this.value"><option ${v.sex==='M'?'selected':''}>M</option><option ${v.sex==='F'?'selected':''}>F</option></select></td>
        <td><input value="${esc(v.race)}" onchange="victims[${i}].race=this.value" style="width:60px"/></td>
        <td><input value="${esc(v.telephone)}" onchange="victims[${i}].telephone=this.value"/></td>
        <td><input value="${esc(v.welfare_occupation)}" onchange="victims[${i}].welfare_occupation=this.value"/></td>
        <td><button class="btn-row-del" onclick="removeVictim(${i})">&#10005;</button></td>
      </tr>`).join('')
  }

  window.removeVictim = function (i) { victims.splice(i, 1); renderVictimRows(); renderVictimDetails() }

  function renderVictimDetails() {
    const el = document.getElementById('victimDetailList')
    if (!el) return
    if (!victims.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px">No victims added. Add from Section A.</div>'; return }
    el.innerHTML = victims.map((v, i) => `
      <div class="entry-card" style="margin-bottom:20px">
        <div class="entry-card-header">
          <span class="entry-card-title">Victim ID: ${esc(v.id_code || 'v.' + (i+1))}</span>
        </div>
        <div class="entry-card-body">
          <div class="field-grid cols-3">
            <div class="field-group span-2">
              <label>Full Name, AKA</label>
              <input value="${esc(v.full_name)}" onchange="victims[${i}].full_name=this.value;renderVictimRows()"/>
            </div>
            <div class="field-group">
              <label>Welfare / Occupation</label>
              <input value="${esc(v.welfare_occupation)}" onchange="victims[${i}].welfare_occupation=this.value;renderVictimRows()"/>
            </div>
          </div>
          <div class="field-grid cols-4">
            <div class="field-group"><label>Age</label><input value="${esc(v.age)}" onchange="victims[${i}].age=this.value;renderVictimRows()"/></div>
            <div class="field-group"><label>Sex</label><select onchange="victims[${i}].sex=this.value;renderVictimRows()"><option ${v.sex==='M'?'selected':''}>M</option><option ${v.sex==='F'?'selected':''}>F</option></select></div>
            <div class="field-group"><label>Race</label><input value="${esc(v.race)}" onchange="victims[${i}].race=this.value;renderVictimRows()"/></div>
            <div class="field-group"><label>Telephone</label><input value="${esc(v.telephone)}" onchange="victims[${i}].telephone=this.value;renderVictimRows()"/></div>
          </div>
          <div class="field-grid cols-2">
            <div class="field-group"><label>Notes</label><textarea rows="2" onchange="victims[${i}].notes=this.value">${esc(v.notes)}</textarea></div>
            <div class="field-group"><label>Family</label><textarea rows="2" onchange="victims[${i}].family=this.value">${esc(v.family)}</textarea></div>
          </div>
          <div class="field-group" style="margin-top:12px"><label>Autopsy By</label><input value="${esc(v.autopsy_by)}" onchange="victims[${i}].autopsy_by=this.value"/></div>
          <div class="field-group" style="margin-top:12px"><label>Autopsy Summary (g)</label><textarea rows="6" onchange="victims[${i}].autopsy_summary=this.value">${esc(v.autopsy_summary)}</textarea></div>
        </div>
      </div>`).join('')
  }

  // ─────────────────────────────────────────────────────────
  // SUSPECT rows (Section A summary + Section C detail)
  // ─────────────────────────────────────────────────────────
  window.addSuspectRow = function () {
    suspects.push({ id_code: 's.' + (suspects.length + 1), full_name: '', age: '-', sex: 'M', race: '', telephone: '-', welfare_occupation: '', family: '-', description: '', dob: null, interrogation_url: '', interrogation_summary: '', mugshot_url: '' })
    renderSuspectRows(); renderSuspectDetails()
  }

  function renderSuspectRows() {
    const tb = document.getElementById('suspectRows')
    if (!tb) return
    if (!suspects.length) { tb.innerHTML = '<tr><td colspan="8" style="color:var(--muted);padding:12px;font-size:12px;text-align:center">No suspects added yet.</td></tr>'; return }
    tb.innerHTML = suspects.map((s, i) => `
      <tr>
        <td><input value="${esc(s.id_code)}" onchange="suspects[${i}].id_code=this.value;renderSuspectDetails()" style="width:60px"/></td>
        <td><input value="${esc(s.full_name)}" onchange="suspects[${i}].full_name=this.value;renderSuspectDetails()"/></td>
        <td><input value="${esc(s.age)}" onchange="suspects[${i}].age=this.value" style="width:50px"/></td>
        <td><select onchange="suspects[${i}].sex=this.value"><option ${s.sex==='M'?'selected':''}>M</option><option ${s.sex==='F'?'selected':''}>F</option></select></td>
        <td><input value="${esc(s.race)}" onchange="suspects[${i}].race=this.value" style="width:60px"/></td>
        <td><input value="${esc(s.telephone)}" onchange="suspects[${i}].telephone=this.value"/></td>
        <td><input value="${esc(s.welfare_occupation)}" onchange="suspects[${i}].welfare_occupation=this.value"/></td>
        <td><button class="btn-row-del" onclick="removeSuspect(${i})">&#10005;</button></td>
      </tr>`).join('')
  }

  window.removeSuspect = function (i) { suspects.splice(i, 1); renderSuspectRows(); renderSuspectDetails() }

  function renderSuspectDetails() {
    const el = document.getElementById('suspectDetailList')
    if (!el) return
    if (!suspects.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px">No suspects added. Add from Section A.</div>'; return }
    el.innerHTML = suspects.map((s, i) => `
      <div class="entry-card" style="margin-bottom:20px">
        <div class="entry-card-header">
          <span class="entry-card-title">Suspect ID: ${esc(s.id_code || 's.' + (i+1))}</span>
        </div>
        <div class="entry-card-body">
          <div class="field-grid cols-2">
            <div class="field-group">
              <label>A. Name</label>
              <input value="${esc(s.full_name)}" onchange="suspects[${i}].full_name=this.value;renderSuspectRows()"/>
            </div>
            <div class="field-group">
              <label>B. Description</label>
              <input value="${esc(s.description)}" onchange="suspects[${i}].description=this.value"/>
            </div>
          </div>
          <div class="field-grid cols-4">
            <div class="field-group"><label>C. DOB</label><input type="date" value="${s.dob||''}" onchange="suspects[${i}].dob=this.value||null"/></div>
            <div class="field-group"><label>D. Sex</label><select onchange="suspects[${i}].sex=this.value;renderSuspectRows()"><option ${s.sex==='M'?'selected':''}>M</option><option ${s.sex==='F'?'selected':''}>F</option></select></div>
            <div class="field-group"><label>Age</label><input value="${esc(s.age)}" onchange="suspects[${i}].age=this.value;renderSuspectRows()"/></div>
            <div class="field-group"><label>Race</label><input value="${esc(s.race)}" onchange="suspects[${i}].race=this.value;renderSuspectRows()"/></div>
          </div>
          <div class="field-grid cols-2">
            <div class="field-group"><label>Status / Occupation</label><input value="${esc(s.welfare_occupation)}" onchange="suspects[${i}].welfare_occupation=this.value;renderSuspectRows()"/></div>
            <div class="field-group"><label>Family</label><input value="${esc(s.family)}" onchange="suspects[${i}].family=this.value"/></div>
          </div>
          <div class="field-group" style="margin-top:12px"><label>Mugshot URL (optional)</label><input type="url" value="${esc(s.mugshot_url)}" onchange="suspects[${i}].mugshot_url=this.value" placeholder="https://..."/></div>
          <div class="field-group" style="margin-top:12px"><label>E. Interrogation URL</label><input type="url" value="${esc(s.interrogation_url)}" onchange="suspects[${i}].interrogation_url=this.value" placeholder="https://..."/></div>
          <div class="field-group" style="margin-top:12px"><label>Interrogation Summary</label><textarea rows="4" onchange="suspects[${i}].interrogation_summary=this.value">${esc(s.interrogation_summary)}</textarea></div>
        </div>
      </div>`).join('')
  }

  // ─────────────────────────────────────────────────────────
  // DEBRIEF entries (Section B)
  // ─────────────────────────────────────────────────────────
  window.addDebriefEntry = function () {
    debriefs.push({ title: '', date_of_incident: null, content: '' })
    renderDebriefList()
  }
  window.removeDebrief = function (i) { debriefs.splice(i, 1); renderDebriefList() }

  function renderDebriefList() {
    const el = document.getElementById('debriefList')
    if (!el) return
    if (!debriefs.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px">No timeline entries yet.</div>'; return }
    el.innerHTML = debriefs.map((d, i) => `
      <div class="entry-card">
        <div class="entry-card-header">
          <span class="entry-card-title">${i+1}. ${d.title ? esc(d.title) : 'Timeline Entry'}</span>
          <button class="btn-row-del" onclick="removeDebrief(${i})">&#10005; Remove</button>
        </div>
        <div class="entry-card-body">
          <div class="field-grid cols-2">
            <div class="field-group"><label>${i+1}a. Title</label><input value="${esc(d.title)}" onchange="debriefs[${i}].title=this.value;renderDebriefList()" placeholder='"Victim found at scene"'/></div>
            <div class="field-group"><label>b. Date of Incident</label><input type="date" value="${d.date_of_incident||''}" onchange="debriefs[${i}].date_of_incident=this.value||null"/></div>
          </div>
          <div class="field-group" style="margin-top:12px"><label>Narrative</label><textarea rows="6" onchange="debriefs[${i}].content=this.value">${esc(d.content)}</textarea></div>
        </div>
      </div>`).join('')
  }

  // ─────────────────────────────────────────────────────────
  // WITNESS entries (Section E)
  // ─────────────────────────────────────────────────────────
  window.addWitnessEntry = function () {
    witnesses.push({ id_code: 'w.' + (witnesses.length + 1), full_name: '', status: '', welfare: 'Alive', occupation: '', content: '' })
    renderWitnessList()
  }
  window.removeWitness = function (i) { witnesses.splice(i, 1); renderWitnessList() }

  function renderWitnessList() {
    const el = document.getElementById('witnessList')
    if (!el) return
    if (!witnesses.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px">No witnesses added yet.</div>'; return }
    el.innerHTML = witnesses.map((w, i) => `
      <div class="entry-card">
        <div class="entry-card-header">
          <span class="entry-card-title">No. ${esc(w.id_code || 'w.'+(i+1))} &mdash; ${w.full_name ? esc(w.full_name) : 'Witness'}</span>
          <button class="btn-row-del" onclick="removeWitness(${i})">&#10005; Remove</button>
        </div>
        <div class="entry-card-body">
          <div class="field-grid cols-4">
            <div class="field-group"><label>Witness ID Code</label><input value="${esc(w.id_code)}" onchange="witnesses[${i}].id_code=this.value;renderWitnessList()"/></div>
            <div class="field-group"><label>a. Name</label><input value="${esc(w.full_name)}" onchange="witnesses[${i}].full_name=this.value;renderWitnessList()"/></div>
            <div class="field-group"><label>c. Status</label><input value="${esc(w.status)}" onchange="witnesses[${i}].status=this.value" placeholder="Witness of motives"/></div>
            <div class="field-group"><label>d. Welfare</label><input value="${esc(w.welfare)}" onchange="witnesses[${i}].welfare=this.value" placeholder="Alive"/></div>
          </div>
          <div class="field-group" style="margin-top:12px"><label>e. Occupation</label><input value="${esc(w.occupation)}" onchange="witnesses[${i}].occupation=this.value" placeholder="Detective of CIB"/></div>
          <div class="field-group" style="margin-top:12px"><label>c. Affidavit Content</label><textarea rows="8" onchange="witnesses[${i}].content=this.value" placeholder="According to the testimony...">${esc(w.content)}</textarea></div>
        </div>
      </div>`).join('')
  }

  // ─────────────────────────────────────────────────────────
  // EVIDENCE entries (Section F)
  // ─────────────────────────────────────────────────────────
  window.addEvidenceEntry = function () {
    evidences.push({ id_code: 'e.' + (evidences.length + 1), name: '', was_status: 'Secured', evidence_status: 'Recovered', date_of_retrieval: null, image_url: '', summary: '' })
    renderEvidenceList()
  }
  window.removeEvidence = function (i) { evidences.splice(i, 1); renderEvidenceList() }

  function renderEvidenceList() {
    const el = document.getElementById('evidenceList')
    if (!el) return
    if (!evidences.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px">No evidences added yet.</div>'; return }
    el.innerHTML = evidences.map((e, i) => `
      <div class="entry-card">
        <div class="entry-card-header">
          <span class="entry-card-title">Evidence ID: ${esc(e.id_code || 'e.'+(i+1))} &mdash; ${e.name ? esc(e.name) : 'Evidence Item'}</span>
          <button class="btn-row-del" onclick="removeEvidence(${i})">&#10005; Remove</button>
        </div>
        <div class="entry-card-body">
          <div class="field-grid cols-4">
            <div class="field-group"><label>Evidence ID Code</label><input value="${esc(e.id_code)}" onchange="evidences[${i}].id_code=this.value;renderEvidenceList()"/></div>
            <div class="field-group span-2"><label>a. Name of Evidence</label><input value="${esc(e.name)}" onchange="evidences[${i}].name=this.value;renderEvidenceList()"/></div>
            <div class="field-group"><label>d. Date of Retrieval</label><input type="date" value="${e.date_of_retrieval||''}" onchange="evidences[${i}].date_of_retrieval=this.value||null"/></div>
          </div>
          <div class="field-grid cols-4">
            <div class="field-group"><label>b. Evidence Was</label><input value="${esc(e.was_status)}" onchange="evidences[${i}].was_status=this.value" placeholder="Secured"/></div>
            <div class="field-group"><label>c. Status of Evidence</label><input value="${esc(e.evidence_status)}" onchange="evidences[${i}].evidence_status=this.value" placeholder="Recovered"/></div>
            <div class="field-group span-2"><label>l. Image / Exhibit URL (optional)</label><input type="url" value="${esc(e.image_url)}" onchange="evidences[${i}].image_url=this.value" placeholder="https://..."/></div>
          </div>
          <div class="field-group" style="margin-top:12px"><label>Summary of Evidence</label><textarea rows="4" onchange="evidences[${i}].summary=this.value">${esc(e.summary)}</textarea></div>
        </div>
      </div>`).join('')
  }

  // ─────────────────────────────────────────────────────────
  // Sync sub-arrays from DOM before save
  // ─────────────────────────────────────────────────────────
  function syncSubArraysFromDOM() {
    // All changes are already synced via onchange handlers,
    // but we make one final pass for textareas (they may need trim)
    victims   = victims.map(sanitizeTrim)
    suspects  = suspects.map(sanitizeTrim)
    witnesses = witnesses.map(sanitizeTrim)
    evidences = evidences.map(sanitizeTrim)
    debriefs  = debriefs.map(sanitizeTrim)
  }
  function sanitizeTrim(obj) {
    const out = {}
    for (const k in obj) {
      out[k] = typeof obj[k] === 'string' ? obj[k].trim() : obj[k]
    }
    return out
  }

  // ─────────────────────────────────────────────────────────
  // PDF EXPORT
  // ─────────────────────────────────────────────────────────
  window.exportPDF = function () {
    const payload = buildPayload()
    const html    = buildPDFHtml(payload)
    const root    = document.getElementById('pdf-template-root')
    root.innerHTML = html
    root.style.display = 'block'

    const opt = {
      margin:      [10, 15, 10, 15],
      filename:    'CID-IR-' + (payload.case_number || 'DRAFT') + '.pdf',
      image:       { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:   { mode: ['avoid-all', 'css', 'legacy'] }
    }
    html2pdf().set(opt).from(root).save().then(function () {
      root.style.display = 'none'
      root.innerHTML = ''
    })
  }

  function buildPDFHtml(r) {
    const formDate = r.case_number ? fmtDate(r.date_of_offense) : 'DD/MM/YYYY'
    const formId   = 'FORM 0001 (CID/' + (r.date_of_offense ? r.date_of_offense.replace(/-/g,'').slice(4) + r.date_of_offense.slice(0,4).slice(-2) : 'DDMMYY') + ')'

    const pageHeader = (pg) => `
      <div class="pdf-page-header">
        <span>CRIMINAL INVESTIGATION DIVISION &ndash; STATE OF SAN ANDREAS</span>
        <span>${formId}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:9pt">
        <div><strong>CENTRAL INVESTIGATION BUREAU</strong><br/>STATE OF SAN ANDREAS</div>
        <div style="text-align:right"><strong>${pg}</strong></div>
      </div>`

    const chkBox = (checked) => `<span class="pdf-checkbox${checked?'pdf-checked':''}">${checked?'&#10004;':''}</span>`
    const jurs   = [['LSPD',r.jurisdiction_lspd],['SAST',r.jurisdiction_sast],['LSCS',r.jurisdiction_lscs],['STATE',r.jurisdiction_state]]
      .map(([j,v]) => `${chkBox(v)}${j}`).join(' &nbsp; ')

    // ── COVER PAGE ──────────────────────────────────────────
    let html = `<div class="pdf-doc">
      <div style="text-align:center;padding:60px 0 40px">
        <div style="font-size:16pt;font-weight:bold;letter-spacing:3px;margin-bottom:8px">CENTRAL INVESTIGATION BUREAU</div>
        <div style="font-size:11pt;letter-spacing:2px;margin-bottom:32px">STATE OF SAN ANDREAS</div>
        <div style="font-size:20pt;font-weight:bold;letter-spacing:4px;border:3px solid #000;padding:16px 32px;display:inline-block;margin-bottom:32px">INVESTIGATION REPORT</div>
        <div style="font-size:12pt;margin-top:24px">Case: &ldquo;${esc(r.case_title||'Untitled')}&rdquo;</div>
      </div>`

    // ── PAGE 1: CLASSIFICATION ─────────────────────────────
    html += `<div class="pdf-page-break">${pageHeader('1')}`
    html += `<div class="pdf-section-title">CASE CLASSIFICATION: CRIME AGAINST PERSON</div>`

    // Row 1: Category | Case No | Offense
    html += `<table class="pdf-table"><tr>
      <td style="width:30%"><div class="pdf-field-label">1. CATEGORY</div>
        ${chkBox(r.category==='A')} a.&nbsp;CATEGORY A &nbsp;
        ${chkBox(r.category==='B')} b.&nbsp;CATEGORY B &nbsp;
        ${chkBox(r.category==='C')} c.&nbsp;CATEGORY C
      </td>
      <td style="width:15%"><div class="pdf-field-label">2. CASE NO.</div>${esc(r.case_number||'')}</td>
      <td><div class="pdf-field-label">3. HIGHEST TYPE OF OFFENSE OR INCIDENT</div>${esc(r.offense_type||'')}</td>
    </tr></table>`

    html += `<table class="pdf-table"><tr>
      <td style="width:20%"><div class="pdf-field-label">4. MDW INCIDENT NUMBER</div>${esc(r.mdw_incident_number||'')}</td>
      <td style="width:20%"><div class="pdf-field-label">5. BUILDING NUMBER</div>${esc(r.building_number||'')}</td>
      <td><div class="pdf-field-label">6. ADDRESS</div>${esc(r.address||'')}</td>
    </tr></table>`

    html += `<table class="pdf-table"><tr>
      <td style="width:15%"><div class="pdf-field-label">7. NAME OF BUREAU</div>${esc(r.bureau_name||'CID')}</td>
      <td style="width:15%"><div class="pdf-field-label">8. AGENCY/BUREAU CODE</div>${esc(r.agency_code||'')}</td>
      <td><div class="pdf-field-label">9. SPECIFIC LOCATION</div>${esc(r.specific_location||'')}</td>
    </tr></table>`

    html += `<table class="pdf-table"><tr>
      <td style="width:20%"><div class="pdf-field-label">10. LOCATION CODE</div>${esc(r.location_code||'')}</td>
      <td style="width:20%"><div class="pdf-field-label">11a. DATE OF OFFENSE</div>${fmtDate(r.date_of_offense)}</td>
      <td style="width:20%"><div class="pdf-field-label">11b. TIME OF OFFENSE</div>${esc(r.time_of_offense||'')}</td>
      <td style="width:15%"><div class="pdf-field-label">12. DAY</div>${esc(r.day_of_offense||'')}</td>
    </tr></table>`

    html += `<table class="pdf-table"><tr>
      <td style="width:25%"><div class="pdf-field-label">13a. DATE REPORTED</div>${fmtDate(r.date_reported)}</td>
      <td style="width:20%"><div class="pdf-field-label">13b. DAY</div>${esc(r.day_reported||'')}</td>
      <td><div class="pdf-field-label">14. JURISDICTION</div>${jurs}</td>
    </tr></table>`

    html += `<table class="pdf-table"><tr>
      <td><div class="pdf-field-label">15. LEAD INVESTIGATORS</div>${esc(r.lead_investigators||'')}</td>
      <td><div class="pdf-field-label">16a. PROSECUTOR</div>${esc(r.prosecutor||'TBA')}</td>
      <td style="width:18%"><div class="pdf-field-label">16b. TIME START</div>${fmtDate(r.prosecutor_time_start)}</td>
      <td style="width:18%"><div class="pdf-field-label">16c. TIME END</div>${fmtDate(r.prosecutor_time_end)}</td>
    </tr></table>`

    // Victims summary table
    if (r.victims && r.victims.length) {
      html += `<br/><div class="pdf-field-label" style="font-size:9pt">17. VICTIM(S)</div>
      <table class="pdf-table"><thead><tr><th>ID</th><th>Full Name, AKA</th><th>Age</th><th>Sex</th><th>Race</th><th>Telephone</th><th>Welfare / Occupation</th></tr></thead><tbody>`
      r.victims.forEach(v => {
        html += `<tr><td>${esc(v.id_code||'')}</td><td>${esc(v.full_name||'')}</td><td>${esc(v.age||'')}</td><td>${esc(v.sex||'')}</td><td>${esc(v.race||'')}</td><td>${esc(v.telephone||'-')}</td><td>${esc(v.welfare_occupation||'')}</td></tr>`
        if (v.notes) html += `<tr><td colspan="2" style="font-size:8pt;color:#555">Notes: ${esc(v.notes)}</td><td colspan="5" style="font-size:8pt;color:#555">Family: ${esc(v.family||'-')}</td></tr>`
      })
      html += `</tbody></table>`
    }

    // Suspects summary table
    if (r.suspects && r.suspects.length) {
      html += `<br/><div class="pdf-field-label" style="font-size:9pt">18. SUSPECT(S)</div>
      <table class="pdf-table"><thead><tr><th>ID</th><th>Full Name, AKA</th><th>Age</th><th>Sex</th><th>Race</th><th>Telephone</th><th>Status / Occupation</th></tr></thead><tbody>`
      r.suspects.forEach(s => {
        html += `<tr><td>${esc(s.id_code||'')}</td><td>${esc(s.full_name||'')}</td><td>${esc(s.age||'')}</td><td>${esc(s.sex||'')}</td><td>${esc(s.race||'')}</td><td>${esc(s.telephone||'-')}</td><td>${esc(s.welfare_occupation||'')}</td></tr>`
        if (s.welfare_occupation||s.family) html += `<tr><td colspan="7" style="font-size:8pt;color:#555">Family: ${esc(s.family||'-')}</td></tr>`
      })
      html += `</tbody></table>`
    }

    // Suspect status
    const statusMap = { NOT_IDENTIFIED:'a. Not Identified', GOVT_EMPLOYEE:'b. Government Employee', GOVT_CONTRACT:'c. Government Contract', CITATION:'d. Citation Issued', NON_GOVT:'d. Non-Government Employee', NA:'e. N/A' }
    const dispMap   = { ARRESTED:'a. Arrested', NOT_ARRESTED:'b. Not Arrested', RELEASED:'c. Released', NA:'d. N/A' }
    html += `<table class="pdf-table" style="margin-top:8px"><tr>
      <td><div class="pdf-field-label">19. SUSPECT STATUS</div>${esc(statusMap[r.suspect_status]||r.suspect_status||'')}<br/>${r.suspect_notes?`<small>${esc(r.suspect_notes)}</small>`:''}</td>
      <td><div class="pdf-field-label">20. DISPOSITION OF SUSPECT</div>${esc(dispMap[r.suspect_disposition]||r.suspect_disposition||'')}</td>
    </tr></table>`
    html += `</div>` // end page 1

    // ── SECTION B: DEBRIEF ─────────────────────────────────
    if (r.debrief_entries && r.debrief_entries.length) {
      html += `<div class="pdf-page-break">${pageHeader('2')}`
      html += `<div class="pdf-section-title">B. DEBRIEF OF INCIDENT</div>`
      r.debrief_entries.forEach((d, i) => {
        html += `<table class="pdf-table"><tr>
          <td style="width:30%"><div class="pdf-field-label">${i+1}a. TITLE</div>${esc(d.title||'')}</td>
          <td><div class="pdf-field-label">b. DATE OF INCIDENT</div>${fmtDate(d.date_of_incident)}</td>
        </tr></table>`
        html += `<div class="pdf-narrative">${esc(d.content||'').replace(/\n/g,'<br/>')}</div><br/>`
      })
      html += `</div>`
    }

    // ── SECTION C: SUSPECTS ────────────────────────────────
    if (r.suspects && r.suspects.length) {
      r.suspects.forEach((s, i) => {
        html += `<div class="pdf-page-break">${pageHeader((i+3).toString())}`
        html += `<div class="pdf-section-title">C. SUSPECTS &ndash; Suspect ID: ${esc(s.id_code||'s.'+(i+1))}</div>`
        html += `<table class="pdf-table"><tr>
          <td style="width:60%">
            <table class="pdf-table"><tr>
              <td><div class="pdf-field-label">A. Name / F. Name</div>${esc(s.full_name||'')}</td>
              <td><div class="pdf-field-label">B/G. Description</div>${esc(s.description||'')}</td>
            </tr><tr>
              <td><div class="pdf-field-label">C/H. DOB</div>${fmtDate(s.dob)}</td>
              <td><div class="pdf-field-label">D/I. SEX</div>${esc(s.sex||'')}</td>
            </tr></table>
          </td>
          <td style="width:40%;vertical-align:top;text-align:center">
            ${s.mugshot_url ? `<img src="${esc(s.mugshot_url)}" style="max-width:120px;max-height:140px;border:1px solid #ccc"/>` : '<div style="width:120px;height:140px;border:1px solid #ccc;margin:auto;display:flex;align-items:center;justify-content:center;font-size:8pt;color:#888">MUGSHOT</div>'}
          </td>
        </tr></table>`
        html += `<div class="pdf-field-label" style="margin-top:8px">E/J/O. Interrogation</div>`
        if (s.interrogation_url) html += `<div style="font-size:8pt;margin-bottom:4px">URL: <a href="${esc(s.interrogation_url)}">${esc(s.interrogation_url)}</a></div>`
        html += `<div class="pdf-narrative">${esc(s.interrogation_summary||'').replace(/\n/g,'<br/>')}</div>`
        html += `</div>`
      })
    }

    // ── SECTION D: VICTIMS ─────────────────────────────────
    if (r.victims && r.victims.length) {
      r.victims.forEach((v, i) => {
        html += `<div class="pdf-page-break">${pageHeader((r.suspects?.length + 3 + i).toString())}`
        html += `<div class="pdf-section-title">D. VICTIM &ndash; Victim ID: ${esc(v.id_code||'v.'+(i+1))}</div>`
        html += `<table class="pdf-table"><tr>
          <td><div class="pdf-field-label">IDENTIFICATION (a)</div>${esc(v.full_name||'')}</td>
          <td style="width:10%"><div class="pdf-field-label">AGE (c)</div>${esc(v.age||'')}</td>
          <td style="width:8%"><div class="pdf-field-label">SEX (d)</div>${esc(v.sex||'')}</td>
          <td style="width:10%"><div class="pdf-field-label">RACE (e)</div>${esc(v.race||'')}</td>
          <td style="width:15%"><div class="pdf-field-label">TELEPHONE (f)</div>${esc(v.telephone||'-')}</td>
        </tr><tr>
          <td colspan="2"><div class="pdf-field-label">Welfare, Occupation</div>${esc(v.welfare_occupation||'')}</td>
          <td colspan="3"><div class="pdf-field-label">Notes</div>${esc(v.notes||'-')}</td>
        </tr><tr>
          <td colspan="5"><div class="pdf-field-label">FAMILY</div>${esc(v.family||'-')}</td>
        </tr></table>`
        if (v.autopsy_by || v.autopsy_summary) {
          html += `<div class="pdf-field-label" style="margin-top:10px">AUTOPSY (g)</div>`
          html += `<table class="pdf-table"><tr><td><div class="pdf-field-label">Autopsy Report &ndash; By</div>${esc(v.autopsy_by||'')}</td></tr></table>`
          html += `<div class="pdf-narrative">${esc(v.autopsy_summary||'').replace(/\n/g,'<br/>')}</div>`
        }
        html += `</div>`
      })
    }

    // ── SECTION E: WITNESSES ───────────────────────────────
    if (r.witnesses && r.witnesses.length) {
      html += `<div class="pdf-page-break">${pageHeader('E')}`
      html += `<div class="pdf-section-title">E. WITNESSES</div>`
      r.witnesses.forEach(w => {
        html += `<table class="pdf-table"><tr>
          <td style="width:8%"><div class="pdf-field-label">No.</div>${esc(w.id_code||'')}</td>
          <td colspan="3"><div style="font-weight:bold;font-size:10pt">AFFIDAVIT</div></td>
        </tr><tr>
          <td></td>
          <td style="width:25%"><div class="pdf-field-label">a. Name</div>${esc(w.full_name||'')}</td>
          <td style="width:20%"><div class="pdf-field-label">b. Witness ID Code</div>${esc(w.id_code||'')}</td>
          <td style="width:25%"><div class="pdf-field-label">c. Status</div>${esc(w.status||'')}</td>
        </tr><tr>
          <td></td>
          <td><div class="pdf-field-label">d. Welfare</div>${esc(w.welfare||'')}</td>
          <td colspan="2"><div class="pdf-field-label">e. Occupation</div>${esc(w.occupation||'')}</td>
        </tr></table>`
        html += `<div class="pdf-field-label" style="margin-top:4px">c. Content / Affidavit</div>`
        html += `<div class="pdf-narrative">${esc(w.content||'').replace(/\n/g,'<br/>')}</div>`
        html += `<div class="pdf-sign-line">[${esc(w.full_name||'')}]</div><br/>`
      })
      html += `</div>`
    }

    // ── SECTION F: EVIDENCES ──────────────────────────────
    if (r.evidences && r.evidences.length) {
      html += `<div class="pdf-page-break">${pageHeader('F')}`
      html += `<div class="pdf-section-title">F. EVIDENCES</div>`
      r.evidences.forEach(e => {
        html += `<table class="pdf-table"><tr>
          <td style="width:8%"><div class="pdf-field-label">Evidence ID</div>${esc(e.id_code||'')}</td>
          <td><div class="pdf-field-label">a. NAME OF EVIDENCE</div>${esc(e.name||'')}</td>
          <td style="width:15%"><div class="pdf-field-label">b. EVIDENCE WAS</div>${esc(e.was_status||'')}</td>
          <td style="width:15%"><div class="pdf-field-label">c. STATUS OF EVIDENCE</div>${esc(e.evidence_status||'')}</td>
          <td style="width:18%"><div class="pdf-field-label">d. DATE OF RETRIEVAL</div>${fmtDate(e.date_of_retrieval)}</td>
        </tr></table>`
        if (e.image_url) {
          html += `<div class="pdf-field-label" style="margin-top:4px">l. IMAGE / EXHIBIT</div>
          <img src="${esc(e.image_url)}" style="max-width:180px;max-height:120px;border:1px solid #ccc;margin:4px 0;display:block" crossorigin="anonymous"/>`
        } else {
          html += `<div style="width:180px;height:90px;border:1px solid #ccc;margin:4px 0;display:flex;align-items:center;justify-content:center;font-size:8pt;color:#888">Exhibit</div>`
        }
        html += `<div class="pdf-field-label">Summary of evidences</div>`
        html += `<div class="pdf-narrative">${esc(e.summary||'').replace(/\n/g,'<br/>')}</div><br/>`
      })
      html += `</div>`
    }

    // ── SECTION G: CLOSURE ────────────────────────────────
    html += `<div class="pdf-page-break">${pageHeader('G')}`
    html += `<div class="pdf-section-title">INVESTIGATION CLOSURE</div>`
    if (r.closure_summary)          html += `<div class="pdf-field-label">I. Summary of Investigation</div><div class="pdf-narrative">${esc(r.closure_summary).replace(/\n/g,'<br/>')}</div><br/>`
    if (r.closure_forensic)         html += `<div class="pdf-field-label">II. Forensic Findings and Cause of Death</div><div class="pdf-narrative">${esc(r.closure_forensic).replace(/\n/g,'<br/>')}</div><br/>`
    if (r.closure_suspect_id)       html += `<div class="pdf-field-label">III. Suspect Identification and Culpability</div><div class="pdf-narrative">${esc(r.closure_suspect_id).replace(/\n/g,'<br/>')}</div><br/>`
    if (r.closure_final_disposition)html += `<div class="pdf-field-label">IV. Final Disposition</div><div class="pdf-narrative">${esc(r.closure_final_disposition).replace(/\n/g,'<br/>')}</div>`

    const typeMap = { CID: chkBox(r.closure_type==='CID')+' CID &nbsp; '+chkBox(r.closure_type==='GRD')+' GRD', GRD: chkBox(false)+' CID &nbsp; '+chkBox(true)+' GRD' }
    const caseRefMap = { LSPD:'a.LSPD', LSCS:'b.LSCS', SAST:'c.SAST', DOJ:'d.DOJ', DOC:'e.DOC', NA:'f.N/A' }
    const caseStatusMap = { OPEN:'a.OPEN', CLOSED:'b.CLOSED', COLD:'c.COLD' }

    html += `<table class="pdf-table" style="margin-top:12px"><tr>
      <td><div class="pdf-field-label">24a. TIME RECEIVED</div>${fmtDate(r.closure_time_received)}</td>
      <td><div class="pdf-field-label">24b. TIME ARRIVED</div>${fmtDate(r.closure_time_arrived)}</td>
      <td><div class="pdf-field-label">a. TYPE</div>${typeMap[r.closure_type]||typeMap.CID}</td>
      <td><div class="pdf-field-label">b. SIGNATURE / d. DATE</div>${fmtDate(r.closure_date)}</td>
      <td><div class="pdf-field-label">c. RETURNED TO SERVICE</div>${fmtDate(r.closure_returned_to_service)}</td>
    </tr><tr>
      <td colspan="2"><div class="pdf-field-label">c. NAME</div>${esc(r.closure_detective_name||'')}</td>
      <td colspan="3"></td>
    </tr></table>`

    html += `<table class="pdf-table" style="margin-top:8px"><tr>
      <td><div class="pdf-field-label">26. CASE REFERRED TO</div>${esc(caseRefMap[r.case_referred_to]||'')}</td>
      <td><div class="pdf-field-label">27. CASE STATUS</div>${esc(caseStatusMap[r.case_status]||r.case_status||'')}</td>
      <td><div class="pdf-field-label">28. PROSECUTOR</div>a. Name: ${esc(r.prosecutor_final_name||'')}<br/>c. Occupation: ${esc(r.prosecutor_final_occupation||'')}</td>
    </tr></table>`

    const howClosedMap = { INACTIVE:'Inactive', ARREST:'Arrest', OTHER:'Other Means' }
    html += `<table class="pdf-table" style="margin-top:8px"><tr>
      <td colspan="3"><div class="pdf-field-label">29. DETECTIVE STATUS</div></td>
    </tr><tr>
      <td><div class="pdf-field-label">b. HOW CLOSED</div>${esc(howClosedMap[r.detective_how_closed]||r.detective_how_closed||'')}</td>
      <td>
        ${chkBox(r.detective_suspect_developed)} Suspect Developed &nbsp;
        ${chkBox(r.detective_suspect_arrested)} Suspect Arrested<br/>
        ${chkBox(r.detective_entered_forensics)} Entered Forensics &nbsp;
        ${chkBox(r.detective_evidence_recovered)} Evidence Recovered<br/>
        ${chkBox(r.detective_cleared_forensics)} Cleared Forensics
      </td>
      <td>
        <div class="pdf-field-label">f. Value of Property</div>${esc(r.detective_value_of_property||'N/A')}<br/>
        <div class="pdf-field-label" style="margin-top:4px">h. Referred To</div>${esc(r.detective_referred_to||'')}<br/>
        <div class="pdf-field-label" style="margin-top:4px">i. Date Referral Accepted</div>${fmtDate(r.detective_date_referral)}
      </td>
    </tr></table>`
    html += `</div>` // end closure section

    html += `</div>` // end pdf-doc
    return html
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────
  function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : '' }
  function setVal(id, v) { const el = document.getElementById(id); if (el && v != null) el.value = v }
  function getChk(id) { const el = document.getElementById(id); return el ? el.checked : false }
  function setChk(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v }
  function getRadio(name) { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : null }
  function setRadio(name, val) { const el = document.querySelector(`input[name="${name}"][value="${val}"]`); if (el) el.checked = true }

  function fmtDate(d) {
    if (!d) return 'DD/MM/YYYY'
    const parts = String(d).split('-')
    if (parts.length !== 3) return d
    return parts[2] + '/' + parts[1] + '/' + parts[0]
  }
  function esc(s) {
    if (s === null || s === undefined) return ''
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  // Expose sub-array references globally so inline onchange can reach them
  window.victims   = victims
  window.suspects  = suspects
  window.witnesses = witnesses
  window.evidences = evidences
  window.debriefs  = debriefs
  window.renderVictimRows     = renderVictimRows
  window.renderVictimDetails  = renderVictimDetails
  window.renderSuspectRows    = renderSuspectRows
  window.renderSuspectDetails = renderSuspectDetails
  window.renderDebriefList    = renderDebriefList
  window.renderWitnessList    = renderWitnessList
  window.renderEvidenceList   = renderEvidenceList

})()
