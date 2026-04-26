import { execSync } from 'child_process';

const content = execSync('git show 2773700:public/Page_Login.html');
const lines = content.toString('utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.includes('Acquiring') || l.includes('surv-topbar-time') || 
      l.includes('surv-time-cell') || l.includes('MONITORED') ||
      l.includes('login-footer-left') || l.includes('title>Personnel')) {
    console.log(i+1, JSON.stringify(l.trim().slice(0,120)));
  }
}
