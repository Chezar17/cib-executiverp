import fs from 'fs';
import path from 'path';

// Remove duplicate site-header.css links from marketing pages
const files = [
  'public/Page_Login.html',
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

  // Remove duplicate site-header.css link (keep only first occurrence)
  let count = 0;
  c = c.replace(/^.*site-header\.css.*\n/gm, (match) => {
    count++;
    return count === 1 ? match : '';
  });

  if (c !== orig) {
    fs.writeFileSync(f, c, 'utf8');
    console.log('Removed duplicate CSS link:', f);
  }
}
console.log('Done.');
