import fs from 'fs';
const buf = fs.readFileSync('public/Page_Login.html');

// Find 'Acquiring' bytes
let idx = buf.indexOf('Acquiring');
if (idx > 0) {
  const slice = buf.slice(idx-10, idx+5);
  console.log('Bytes before Acquiring:', slice.toString('hex'));
  console.log('String:', JSON.stringify(slice.toString('utf8')));
}
// Title
let tidx = buf.indexOf('Personnel Login');
if (tidx > 0) {
  const slice = buf.slice(tidx, tidx+30);
  console.log('Title bytes:', slice.toString('hex'));
  console.log('Title string:', JSON.stringify(slice.toString('utf8')));
}
// surv-time initial value
let stidx = buf.indexOf('surv-time">');
if (stidx > 0) {
  const slice = buf.slice(stidx, stidx+30);
  console.log('surv-time bytes:', slice.toString('hex'));
  console.log('surv-time string:', JSON.stringify(slice.toString('utf8')));
}
// MONITORED
let midx = buf.indexOf('MONITORED');
if (midx > 0) {
  const slice = buf.slice(midx-10, midx+10);
  console.log('MONITORED bytes:', slice.toString('hex'));
  console.log('MONITORED string:', JSON.stringify(slice.toString('utf8')));
}
