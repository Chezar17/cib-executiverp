SiteUi.initPageFadeTransitions({ transitionMs: 400 });

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  DEPARTMENT DATA
  //  Edit any field here to update what appears in the modal.
  //  logo:  path to the department logo image
  //  office: path to the office/HQ photo
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const DEPTS = {
    sast: {
      eyebrow:  'State Agency Â· San Andreas',
      name:     'San Andreas State Trooper',
      abbr:     'SAST',
      logo:     'images/SAST_Logo.png',
      office:   'images/SAST_Logo.png',
      caption:  'SAST State Headquarters â€” San Andreas',
      badges:   ['State Authority','Statewide Patrol','Highway Division','Criminal Investigation'],
      about:    'The San Andreas State Police (SASP) is the premier statewide law enforcement body, established under executive authority of the Governor of San Andreas. The agency holds supreme command authority over all SAPD-affiliated departments and maintains jurisdiction across every county, municipality, and unincorporated territory within state borders. SAST is responsible for statewide highway patrol, criminal investigations of federal and interstate nature, and command-level coordination during major incidents or civil emergencies.',
      info: [
        { lbl: 'Founded',       val: 'San Andreas State Legislature' },
        { lbl: 'Commanding',    val: 'Commissioner Andrew Gunner' },
        { lbl: 'Personnel',     val: 'Statewide Deployment' },
        { lbl: 'HQ',            val: 'San Andreas State Capital' },
        { lbl: 'Oversight',     val: 'Governor of San Andreas' },
      ],
      jur: [
        { strong: 'Statewide Jurisdiction', text: ' â€” Full authority across all counties, municipalities, and territories within the State of San Andreas.' },
        { strong: 'Highway Patrol',         text: ' â€” Primary authority over all state highways, interstates, and rural road networks.' },
        { strong: 'Criminal Investigation', text: ' â€” Conducts state-level investigations into organized crime, corruption, and cross-jurisdictional offenses.' },
        { strong: 'Command Authority',      text: ' â€” Holds supreme operational authority over LSPD and LCSO in joint operations and state emergencies.' },
        { strong: 'CIB Oversight',          text: ' â€” The Commissioner serves as the highest authority overseeing CIB operations and strategic direction.' },
        { strong: 'Federal Coordination',   text: ' â€” Acts as the state liaison for federal law enforcement agencies operating within San Andreas.' },
      ],
    },
    lcso: {
      eyebrow:  'County Agency Â· Los Santos',
      name:     'Los Santos County Sheriff',
      abbr:     'LCSO',
      logo:     'images/LSCS_Logo.png',
      office:   'images/LSCS_Logo.png',
      caption:  'LCSO County Sheriff Headquarters â€” Los Santos',
      badges:   ['County Authority','Civil Enforcement','Corrections','Court Security'],
      about:    'The Los Santos County Sheriff\'s Department (LCSO) is the primary law enforcement authority for Los Santos County and Blaine County. Headed by the elected Sheriff, the department operates patrol divisions across both urban and rural county territories, manages the county correctional system, and provides court security and civil enforcement services. LSCS plays a critical role in CIB operations as a significant source of detective personnel and maintains concurrent jurisdiction with LSPD in overlapping areas.',
      info: [
        { lbl: 'Founded',       val: 'Los Santos County Government' },
        { lbl: 'Commanding',    val: 'Sheriff Kevin Wesley' },
        { lbl: 'Personnel',     val: 'County-Wide Deployment' },
        { lbl: 'HQ',            val: 'Los Santos County Sheriff\'s Office' },
        { lbl: 'Oversight',     val: 'Los Santos County Board of Supervisors' },
      ],
      jur: [
        { strong: 'Los Santos County',  text: ' â€” Full patrol and investigative authority across all unincorporated areas of Los Santos County.' },
        { strong: 'Blaine County',      text: ' â€” Primary law enforcement jurisdiction for the rural Blaine County area including Sandy Shores and Paleto Bay.' },
        { strong: 'Concurrent City',    text: ' â€” May operate within the City of Los Santos in coordination with or in the absence of LSPD personnel.' },
        { strong: 'Corrections',        text: ' â€” Operates and manages the county jail and detention facilities for all arrested individuals awaiting trial.' },
        { strong: 'Court Security',     text: ' â€” Responsible for security of county court facilities and execution of civil court orders.' },
        { strong: 'CIB Contribution',   text: ' â€” A primary source of CIB detective personnel; multiple LSCS deputies hold active CIB assignments.' },
      ],
    },
    lspd: {
      eyebrow:  'Municipal Agency Â· City of Los Santos',
      name:     'Los Santos Police Department',
      abbr:     'LSPD',
      logo:     'images/LSPD_Logo.png',
      office:   'images/LSPD_Logo.png',
      caption:  'LSPD Mission Row Headquarters â€” Los Santos',
      badges:   ['City Authority','Urban Patrol','Homicide','Narcotics','SWAT'],
      about:    'The Los Santos Police Department (LSPD) is the municipal police force of the City of Los Santos and the largest single law enforcement agency in San Andreas by personnel count. Operating from Mission Row headquarters and multiple district stations, LSPD provides 24-hour urban patrol coverage, homicide investigation, narcotics enforcement, and specialized units including SWAT and K-9. The department contributes the largest proportion of personnel to CIB operations and maintains a close operational relationship with both the Bureau and the County Sheriff.',
      info: [
        { lbl: 'Founded',       val: 'City of Los Santos Municipal Authority' },
        { lbl: 'Commanding',    val: 'Chief of Police Luke Osborne' },
        { lbl: 'Personnel',     val: 'Largest Dept in San Andreas' },
        { lbl: 'HQ',            val: 'Mission Row, Los Santos' },
        { lbl: 'Oversight',     val: 'Los Santos City Council' },
      ],
      jur: [
        { strong: 'City of Los Santos',   text: ' â€” Primary jurisdiction over all criminal activity within the incorporated boundaries of Los Santos.' },
        { strong: 'Urban Districts',      text: ' â€” Operates multiple precinct stations covering Vinewood, East LS, South LS, Davis, Strawberry, and all other city districts.' },
        { strong: 'Special Operations',   text: ' â€” Deploys SWAT, K-9, Air Support, and Undercover Units for high-risk and specialized operations.' },
        { strong: 'Narcotics Division',   text: ' â€” Operates a dedicated narcotics enforcement unit with authority to conduct undercover buy operations and raids.' },
        { strong: 'Homicide & Major Crimes', text: ' â€” Investigates all homicides and serious felonies occurring within city limits.' },
        { strong: 'CIB Contribution',     text: ' â€” LSPD is the primary source of sworn CIB detective personnel across both GRD and CID divisions.' },
      ],
    },
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  OPEN / CLOSE MODAL
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  function openDept(key) {
    const d = DEPTS[key];
    if (!d) return;

    const box = document.getElementById('modal-box');
    box.dataset.dept = key;

    // Header
    document.getElementById('modal-eyebrow').textContent = d.eyebrow;
    document.getElementById('modal-name').textContent    = d.name;

    // Badges
    const badgeContainer = document.getElementById('modal-badges');
    badgeContainer.innerHTML = d.badges.map(b => `<span class="modal-badge">${b}</span>`).join('');

    // Logo
    const logoImg = document.getElementById('modal-logo-img');
    const logoFb  = document.getElementById('modal-logo-fallback');
    logoImg.src = d.logo;
    logoImg.alt = d.name;
    logoFb.textContent = d.abbr;
    logoImg.style.display = 'block';
    logoFb.style.display = 'none';

    // Office photo
    const offImg = document.getElementById('modal-office-img');
    const offPh  = document.getElementById('modal-office-placeholder');
    offImg.src = d.office;
    offImg.style.display = 'block';
    offPh.style.display  = 'none';
    document.getElementById('modal-office-caption').textContent = d.caption;

    // About text
    document.getElementById('modal-about-text').textContent = d.about;

    // Info rows
    document.getElementById('modal-info-rows').innerHTML = d.info.map(r =>
      `<div class="modal-info-row">
        <div class="modal-info-lbl">${r.lbl}</div>
        <div class="modal-info-val">${r.val}</div>
      </div>`
    ).join('');

    // Jurisdiction list
    document.getElementById('modal-jur-list').innerHTML = d.jur.map(j =>
      `<div class="jur-item">
        <div class="jur-dot"></div>
        <div class="jur-text"><strong>${j.strong}</strong>${j.text}</div>
      </div>`
    ).join('');

    // Open
    document.getElementById('dept-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDept() {
    document.getElementById('dept-modal').classList.remove('open');
    document.body.style.overflow = '';
  }

  function handleModalBackdrop(e) {
    if (e.target === document.getElementById('dept-modal')) closeDept();
  }

  // Close on Escape key
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDept(); });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  SCROLL-TRIGGERED REVEAL
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        revealObs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
    requestAnimationFrame(() => document.body.classList.add('page-visible'));
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ BIOGRAPHY DATA â€” Edit text here â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const BIOS = {
  gunner:{
    rank:'Commissioner Â· Highest Rank',name:'Andrew Gunner',dept:'San Andreas State Trooper',
    badge:'SAST Â· Commissioner',initials:'AG',img:'images/SAST_Gunner1.jpg',
    bio1:'Commissioner Andrew Gunner serves as the supreme commanding officer of all law enforcement agencies operating within the State of San Andreas, including the San Andreas State Trooper, the Los Santos County Sheriff\'s Office, and the Los Santos Police Department. He holds ultimate strategic authority over the Central Investigation Bureau and its sub-divisions.',
    bio2:'Commissioner Gunner is known for his uncompromising stance on organized crime and his instrumental role in the formation of the CIB as a dedicated intelligence and investigation division within the SAPD structure. Under his directive, the Bureau has significantly expanded its operational capacity since its founding in 2026.',
    service:[{year:'2026 â€“ Present',role:'Commissioner, San Andreas State Trooper'},{year:'2024 â€“ 2026',role:'Deputy Commissioner, SAST'},{year:'2020 â€“ 2024',role:'Director of State Law Enforcement Operations'},{year:'2015 â€“ 2020',role:'Senior Commander, SAST Northern Division'}],
    info:[{lbl:'Full Name',val:'Andrew Gunner'},{lbl:'Rank',val:'Commissioner'},{lbl:'Department',val:'San Andreas State Trooper'},{lbl:'Authority',val:'Statewide â€” Supreme Command'},{lbl:'Jurisdiction',val:'State of San Andreas'},{lbl:'CIB Relation',val:'Direct Oversight'},{lbl:'Status',val:'Active Duty'}]
  },
  wesley:{
    rank:'Sheriff Â· County Commander',name:'Kevin Wesley',dept:'Los Santos County Sheriff\'s Office',
    badge:'LCSO Â· Sheriff',initials:'KW',img:'images/LSCS_Kevin1.jpg',
    bio1:'Sheriff Kevin Wesley commands the Los Santos County Sheriff\'s Office, overseeing law enforcement operations across Los Santos County and Blaine County. He is responsible for county-wide civil authority, rural law enforcement, and coordination with state and city departments on joint operations.',
    bio2:'Sheriff Wesley has been a longstanding partner of the Central Investigation Bureau, providing jurisdictional support across Blaine County regions and rural San Andreas â€” areas critical to CIB Gang Recon Division field operations targeting narcotics routes and gang activity outside city limits.',
    service:[{year:'2023 â€“ Present',role:'Sheriff, Los Santos County Sheriff\'s Office'},{year:'2019 â€“ 2023',role:'Undersheriff, LCSO'},{year:'2014 â€“ 2019',role:'Captain, LCSO Blaine County Division'},{year:'2009 â€“ 2014',role:'Lieutenant, LCSO Patrol Division'}],
    info:[{lbl:'Full Name',val:'Kevin Wesley'},{lbl:'Rank',val:'Sheriff'},{lbl:'Department',val:'Los Santos County Sheriff'},{lbl:'Authority',val:'County-Wide Â· Civil Command'},{lbl:'Jurisdiction',val:'LS County Â· Blaine County'},{lbl:'CIB Relation',val:'CID Partner Â· Field Support'},{lbl:'Status',val:'Active Duty'}]
  },
  osborne:{
    rank:'Chief of Police Â· City Command',name:'Luke Osborne',dept:'Los Santos Police Department',
    badge:'LSPD Â· Chief of Police',initials:'LO',img:'images/LSPD_Luke1.jpg',
    bio1:'Chief of Police Luke Osborne commands the Los Santos Police Department, the primary metropolitan law enforcement body for the City of Los Santos. His jurisdiction encompasses all LSPD precincts, specialized units, and tactical divisions operating within city limits, including SWAT, Narcotics, and the Homicide Division.',
    bio2:'Chief Osborne has been a strong institutional supporter of the CIB since its establishment, facilitating inter-agency cooperation between LSPD units and CIB detectives during joint investigations and emergency response situations. He has publicly championed intelligence-led policing as the future of urban law enforcement in San Andreas.',
    service:[{year:'2022 â€“ Present',role:'Chief of Police, LSPD'},{year:'2018 â€“ 2022',role:'Assistant Chief, LSPD'},{year:'2013 â€“ 2018',role:'Commander, LSPD Organized Crime Division'},{year:'2007 â€“ 2013',role:'Captain, LSPD Central Division'}],
    info:[{lbl:'Full Name',val:'Luke Osborne'},{lbl:'Rank',val:'Chief of Police'},{lbl:'Department',val:'Los Santos Police Department'},{lbl:'Authority',val:'Metropolitan Â· City Command'},{lbl:'Jurisdiction',val:'City of Los Santos'},{lbl:'CIB Relation',val:'CIB Partner Â· Joint Operations'},{lbl:'Status',val:'Active Duty'}]
  }
};

function openBio(key){
  const d=BIOS[key];if(!d)return;
  const img=document.getElementById('bio-banner-img');
  img.src=d.img;img.style.display='block';img.onerror=()=>{img.style.display='none';};
  document.getElementById('bio-banner-initials').textContent=d.initials;
  document.getElementById('bio-banner-badge').textContent=d.badge;
  document.getElementById('bio-banner-dept').textContent=d.dept;
  document.getElementById('bio-rank').textContent=d.rank;
  document.getElementById('bio-name').textContent=d.name;
  document.getElementById('bio-dept-label').textContent=d.dept;
  document.getElementById('bio-p1').textContent=d.bio1;
  document.getElementById('bio-p2').textContent=d.bio2;
  document.getElementById('bio-service').innerHTML=d.service.map(s=>`<div><div class="bio-service-year">${s.year}</div><div class="bio-service-role">${s.role}</div></div>`).join('');
  document.getElementById('bio-info').innerHTML=d.info.map(r=>`<div class="bio-info-row"><div class="bio-info-lbl">${r.lbl}</div><div class="bio-info-val">${r.val}</div></div>`).join('');
  document.getElementById('bio-modal').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeBio(){document.getElementById('bio-modal').classList.remove('open');document.body.style.overflow='';}

// Floating particles
function spawnParticles(){
  const c=document.getElementById('comm-particles');if(!c)return;
  for(let i=0;i<14;i++){
    const p=document.createElement('div');p.className='comm-particle';
    p.style.left=Math.random()*100+'%';p.style.bottom='-8px';
    p.style.width=(Math.random()*2+1)+'px';p.style.height=p.style.width;
    p.style.animationDuration=(Math.random()*8+5)+'s';
    p.style.animationDelay=(Math.random()*6)+'s';
    p.style.opacity=Math.random()*0.35+0.1;
    c.appendChild(p);
  }
}

// Keydown
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeBio();}});

// Init
window.addEventListener('DOMContentLoaded',()=>{ spawnParticles(); });