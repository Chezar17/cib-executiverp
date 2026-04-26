import fs from 'fs';

const OLD = `<link rel="stylesheet" href="shared/styles/site-header.css"/>


<link rel='stylesheet' href='shared/styles/site-header.css'/>
<script type='module' src='shared/components/site-header.js'></script>`;

const NEW = `<link rel="stylesheet" href="shared/styles/site-header.css"/>
<script type="module" src="shared/components/site-header.js"></script>`;

const files = [
  'public/Page_About.html',
  'public/Page_Divisions.html',
  'public/Page_OurLeaders.html',
  'public/Page_OurMission.html',
  'public/Page_Press.html',
  'public/Page_Recruitment.html',
  'public/Page_Wanted.html',
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, 'utf8');
  const orig = c;
  c = c.replace(
    /<link rel="stylesheet" href="shared\/styles\/site-header\.css"\/>[\r\n]+[\r\n]+<link rel='stylesheet' href='shared\/styles\/site-header\.css'\/>[\r\n]+<script type='module' src='shared\/components\/site-header\.js'><\/script>/,
    NEW
  );
  if (c !== orig) {
    fs.writeFileSync(f, c, 'utf8');
    console.log('Fixed:', f);
  } else {
    console.log('No match:', f);
  }
}
console.log('Done.');
