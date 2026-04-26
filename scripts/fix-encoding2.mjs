import fs from 'fs';

// All HTML files that might have garbled characters
const files = [
  'public/Page_Login.html',
  'public/Page_About.html',
  'public/Page_Divisions.html',
  'public/Page_OurLeaders.html',
  'public/Page_OurMission.html',
  'public/Page_Press.html',
  'public/Page_Recruitment.html',
  'public/Page_Wanted.html',
  'public/index.html',
  'public/nexus.html',
  'public/Page_Nexus.html',
  'public/targets/hvc.html',
  'public/budget/finance.html',
  'public/gangintel/gang.html',
  'public/informantregistry/informant.html',
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, 'utf8');
  const orig = c;

  // PS-script artifacts: "  (ASCII quote + &rdquo;) → &ndash;
  c = c.replace(/"&rdquo;/g, '&ndash;');
  c = c.replace(/&rdquo;"/g, '&ndash;');

  // Leftover single " from PS replace next to &ndash;
  // e.g. â&ndash;  → ► &ndash; (only for surv-acquire-header context)
  c = c.replace(/\u00e2(&ndash;|&mdash;)/g, '&#9654;');  // â + entity → ►

  // C1 control char U+008F (leftover from mdash encoding)
  c = c.replace(/\u008f/g, '');

  // Copyright: Â© → &copy;
  c = c.replace(/\u00c2\u00a9/g, '&copy;');
  // Also fix if PS already garbled it as Â©
  c = c.replace(/Â©/g, '&copy;');

  // Non-breaking space artifact
  c = c.replace(/\u00c2\u00a0/g, '&nbsp;');

  if (c !== orig) {
    fs.writeFileSync(f, c, 'utf8');
    console.log('Fixed:', f);
  }
}
console.log('Done.');
