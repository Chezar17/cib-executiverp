import fs from 'fs'

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
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, 'utf8');
  const orig = c;

  // Fix double-encoded UTF-8 → correct HTML entities
  c = c.replace(/\u00c2\u00b7/g, '&middot;');
  c = c.replace(/\u00e2\u0080\u0093/g, '&ndash;');
  c = c.replace(/\u00e2\u0080\u0094/g, '&mdash;');
  c = c.replace(/\u00e2\u0080\u0099/g, '&rsquo;');
  c = c.replace(/\u00e2\u0080\u009d/g, '&rdquo;');
  c = c.replace(/\u00e2\u0080\u009c/g, '&ldquo;');
  c = c.replace(/\u00c2\u00a0/g, '&nbsp;');
  // Also fix already-replaced curly quotes from the PS fix attempt
  c = c.replace(/\u201c/g, '&ldquo;');
  c = c.replace(/\u201d/g, '&rdquo;');
  c = c.replace(/\u2013/g, '&ndash;');
  c = c.replace(/\u2014/g, '&mdash;');

  // Fix dev-notice icon
  c = c.replace(/<span class="dev-notice-icon">[^<]*<\/span>/g,
                '<span class="dev-notice-icon">&#9888;</span>');

  if (c !== orig) {
    fs.writeFileSync(f, c, 'utf8');
    console.log('Fixed:', f);
  }
}
console.log('Done.');
