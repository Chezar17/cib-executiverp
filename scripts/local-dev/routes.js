const STATIC_ROUTES = {
  '/':                      'index.html',
  '/login':                 'Page_Login.html',
  '/about':                 'Page_About.html',
  '/mission':               'Page_OurMission.html',
  '/divisions':             'Page_Divisions.html',
  '/leaders':               'Page_OurLeaders.html',
  '/wanted':                'Page_Wanted.html',
  '/press':                 'Page_Press.html',
  '/recruitment':           'Page_Recruitment.html',
  '/nexus':                 'nexus.html',
  '/portal':                'nexus.html',
  '/portal/gang':           'gangintel/gang.html',
  '/portal/informants':     'informantregistry/informant.html',
  '/portal/targets':        'targets/hvc.html',
  '/portal/finance':        'budget/finance.html',
  '/portal/reports':        'reports/reports.html',
  '/portal/reports/form':   'reports/form/report-form.html',
}

export function resolveRoute(pathname) {
  if (pathname.startsWith('/api/')) {
    return { kind: 'api' }
  }

  const mapped = STATIC_ROUTES[pathname]
  if (mapped) return { kind: 'static', mappedFile: mapped }

  const stripped = pathname.replace(/\/$/, '')
  if (stripped && STATIC_ROUTES[stripped]) {
    return { kind: 'static', mappedFile: STATIC_ROUTES[stripped] }
  }

  return { kind: 'static' }
}
