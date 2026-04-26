// ── Navigation ────────────────────────────────────────────────
export const PRIMARY_NAV_ROUTES = [
  { id: 'home',        label: 'Home',        href: 'index.html'           },
  { id: 'about',       label: 'About',       href: 'Page_About.html'      },
  { id: 'mission',     label: 'Our Mission', href: 'Page_OurMission.html' },
  { id: 'divisions',   label: 'Detectives',  href: 'Page_Divisions.html'  },
  { id: 'leaders',     label: 'Our Leaders', href: 'Page_OurLeaders.html' },
  { id: 'wanted',      label: 'Most Wanted', href: 'Page_Wanted.html'     },
  { id: 'press',       label: 'Press Room',  href: 'Page_Press.html'      },
  { id: 'recruitment', label: 'Recruitment', href: 'Page_Recruitment.html'},
]

export const LOGIN_ROUTE = { label: 'PERSONNEL LOGIN', href: 'Page_Login.html' }

// ── Ticker ────────────────────────────────────────────────────
export const TICKER_ITEMS = [
  '<b>BOLO:</b> Killer of Chief Ankoow Alrex still on the Loose, Be Aware!',
  '<b>ADVISORY:</b> Increased Gang activity reported in East Side of Los Santos, residents advised to stay indoors',
  '<b>ALERT:</b> Anyone who do Sells gun illegaly will arrested accordingly - The LEO Will watch you!',
  '<b>PRESS RELEASE:</b> CIB Commander commends all division to be aware of criminal activities at all time',
]

// ── Footer ────────────────────────────────────────────────────
export const FOOTER_COLUMNS = [
  {
    heading: 'Divisions',
    links: [
      { label: 'Gang Recon Division',       href: 'Page_Divisions.html' },
      { label: 'Criminal Investigation',    href: 'Page_Divisions.html' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Press Room',   href: 'Page_Press.html'       },
      { label: 'Cases',        href: 'Page_Cases.html'        },
      { label: 'Recruitment',  href: 'Page_Recruitment.html' },
    ],
  },
  {
    heading: 'Contact',
    links: [
      { label: 'CIB Headquarters',  href: 'index.html'       },
      { label: 'Tip Hotline',       href: 'Page_Press.html'  },
      { label: 'Personnel Login',   href: 'Page_Login.html'  },
    ],
  },
]

export const FOOTER_LEGAL =
  '&copy; 2026 Central Investigation Bureau &ndash; San Andreas Law Enforcement Officer. ' +
  'All Rights Reserved. This is a fictional organization in the world of Executive Roleplay.'
