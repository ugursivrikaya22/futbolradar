import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const repo = 'ugursivrikaya22/futbolradar';
const title = '[FutbolRadar] Kritik operasyon hatası';
export function alertBody(report, runUrl) {
  const codes = [...new Set(report.issues || [])].sort();
  return `<!-- futbolradar-operations-alert -->\n${codes.map(code => `- ${code}`).join('\n')}\n\nKontrol: ${report.checkedAt}\n[GitHub Actions raporu](${runUrl})\n\nAynı hata sürerken yeni bildirim gönderilmez. Ayrıntılar operations-monitor artifact içindedir.`;
}
export function planAlert(report, existing, runUrl) {
  if (!report || !Array.isArray(report.issues)) throw new Error('Invalid monitor report');
  if (!report.issues.length) return existing ? { action: 'close', number: existing.number } : { action: 'none' };
  const body = alertBody(report, runUrl);
  // Compare only the issue codes, not timestamps or run URLs.
  const signature = value => (value.match(/^- .+$/gm) || []).sort().join('\n');
  if (existing && signature(existing.body || '') === signature(body)) return { action: 'none' };
  return { action: existing ? 'edit' : 'create', number: existing?.number, body };
}
function github(endpoint, method = 'GET', payload) {
  return JSON.parse(execFileSync('gh', ['api', endpoint, '--method', method, ...(payload ? ['--input', '-'] : [])], {
    input: payload ? JSON.stringify(payload) : undefined, encoding: 'utf8', windowsHide: true, timeout: 20000
  }));
}
export function notify(report) {
  if (process.env.GITHUB_REPOSITORY !== repo || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Alert restricted to production repository/main');
  const query = encodeURIComponent(`repo:${repo} is:issue is:open author:app/github-actions "${title}" in:title`);
  const issues = github(`search/issues?q=${query}&per_page=100`).items;
  const existing = issues.find(issue => issue.title === title && issue.body?.includes('<!-- futbolradar-operations-alert -->') && issue.user?.login === 'github-actions[bot]');
  const plan = planAlert(report, existing, `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`);
  if (plan.action === 'create') github(`repos/${repo}/issues`, 'POST', { title, body: plan.body });
  if (plan.action === 'edit') github(`repos/${repo}/issues/${plan.number}`, 'PATCH', { body: plan.body });
  if (plan.action === 'close') github(`repos/${repo}/issues/${plan.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
  console.log(`Operations alert: ${plan.action}`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const file = 'outputs/operations/monitor.json';
  const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { checkedAt: new Date().toISOString(), issues: ['monitor-report-missing'] };
  notify(report);
}
