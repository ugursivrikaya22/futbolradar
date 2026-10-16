// Only reviewed claims can reach the public feed. RSS discovery is never approval.
const { createHash } = require('node:crypto');
const TAG = 'hakem-sorusturmasi';
const HOUR = 3600000;
const FALLBACK = '/haber/hakemler-dosyasi-son-gelismeler.html';
const SOURCES = ['istanbul.adalet.gov.tr', 'tff.org', 'aa.com.tr', 'anadoluajansi.gov.tr', 'dha.com.tr', 'trtspor.com.tr', 'trthaber.com', 'ntv.com.tr', 'haberturk.com', 'haberler.com', 'tr.euronews.com'];
const ACTIONS = Object.freeze({ detained: 'gözaltına alındı', referred_to_courthouse: 'adliyeye sevk edildi', released: 'serbest bırakıldı', remanded: 'tutuklandı', judicial_control: 'adli kontrol kararıyla serbest bırakıldı' });
function sourceRank(url) {
  try { const u = new URL(url); if (u.protocol !== 'https:') return -1; const host = u.hostname;
    const domain = SOURCES.find(d => host === d || host.endsWith('.' + d));
    return domain ? domain === SOURCES[0] ? 0 : domain === 'tff.org' ? 1 : /aa.com.tr|anadoluajansi.gov.tr/.test(domain) ? 2 : 3 : -1;
  } catch { return -1; }
}
function internalHref(value) {
  if (typeof value !== 'string' || !/^\/(?:haber|kose-yazilari)\/[a-z0-9-]+\.html$/.test(value)) return null;
  return value;
}
function claimText(item) {
  if (item.kind === 'legal-status') return ACTIONS[item.legalStatus] && item.subject ? `Soruşturma kapsamında ${item.subject} ${ACTIONS[item.legalStatus]}.` : '';
  return typeof item.text === 'string' ? item.text.trim() : '';
}
function reviewHash(item) {
  return createHash('sha256').update(JSON.stringify([item.id, item.tag, item.kind, item.legalStatus, item.subject, item.text, item.label,
    item.subjectKeys, item.supersedes, item.importance, item.publishedAt, item.updatedAt, item.expiresAt, item.sourcePublishedAt, item.sources])).digest('hex');
}
function validate(item, now = Date.now()) {
  const errors = [], text = claimText(item || {}), review = item?.review;
  if (!item?.id || item.tag !== TAG || !['legal-status', 'report', 'correction'].includes(item.kind)) errors.push('invalid-identity');
  if (!text || text.length > 360 || /suçlu|şikeci|bahisçi/i.test(text)) errors.push('invalid-language');
  if (!Array.isArray(item?.subjectKeys) || !item.subjectKeys.length || item.subjectKeys.some(k => typeof k !== 'string' || !k)) errors.push('missing-subjects');
  if (item?.kind === 'legal-status' && !ACTIONS[item.legalStatus]) errors.push('unknown-legal-status');
  if (item?.kind === 'legal-status' && /gözaltına|adliyeye sevk|tutuklan|serbest bırak/i.test(item.subject || '')) errors.push('subject-contains-legal-status');
  if (item?.kind !== 'legal-status' && /gözaltına alındı|adliyeye sevk edildi|tutuklandı|serbest bırakıldı/i.test(text)) errors.push('structured-legal-status-required');
  if (!['normal', 'high'].includes(item?.importance)) errors.push('invalid-importance');
  for (const k of ['publishedAt', 'updatedAt', 'expiresAt', 'sourcePublishedAt']) if (!Number.isFinite(Date.parse(item?.[k]))) errors.push('missing-time:' + k);
  if (Date.parse(item?.publishedAt) > now || Date.parse(item?.updatedAt) > now || Date.parse(item?.sourcePublishedAt) > now) errors.push('future-time');
  if (Date.parse(item?.expiresAt) <= Date.parse(item?.publishedAt)) errors.push('invalid-expiry');
  if (!Array.isArray(item?.sources) || !item.sources.length || item.sources.some(s => !s?.name || sourceRank(s.url) < 0)) errors.push('untrusted-source');
  if (item?.status !== 'approved' || review?.status !== 'verified' || !review.by || !review.notes || !review.legalStatusChecked || !review.conflictsChecked || !Number.isFinite(Date.parse(review.checkedAt)) || Date.parse(review.checkedAt) > now || review.contentHash !== reviewHash(item)) errors.push('review-required');
  return { valid: errors.length === 0, errors };
}
function taggedNewsCandidates(news) {
  return (Array.isArray(news) ? news : []).filter(n => n.status === 'verified' && n.tags?.includes(TAG) && n.agendaItem).map(n => n.agendaItem);
}
function buildFeed(config, news = [], now = Date.now()) {
  const rows = [...(config.items || []), ...taggedNewsCandidates(news)], rejected = [];
  const valid = rows.filter(item => { const v = validate(item, now); if (!v.valid) rejected.push({ id: item?.id, errors: v.errors }); return v.valid; });
  // Supersession happens BEFORE expiry: an older custody report must never reappear.
  valid.sort((a, b) => Date.parse(b.sourcePublishedAt) - Date.parse(a.sourcePublishedAt) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const subjects = new Set(), ids = new Set(), texts = new Set(), selected = [];
  const superseded = new Set(valid.flatMap(i => i.supersedes || []));
  for (const item of valid) {
    const text = claimText(item);
    if (superseded.has(item.id) || ids.has(item.id) || item.subjectKeys.some(k => subjects.has(k)) || texts.has(text)) continue;
    ids.add(item.id); item.subjectKeys.forEach(k => subjects.add(k)); texts.add(text);
    const expires = Math.min(Date.parse(item.expiresAt), Date.parse(item.publishedAt) + 24 * HOUR, Date.parse(item.sourcePublishedAt) + 72 * HOUR);
    if (now >= expires) continue;
    selected.push({ id: item.id, label: item.label, text, publishedAt: item.publishedAt, updatedAt: item.updatedAt, sourcePublishedAt: item.sourcePublishedAt,
      expiresAt: new Date(expires).toISOString(), breakingUntil: item.importance === 'high' ? new Date(Math.min(expires, Date.parse(item.sourcePublishedAt) + 12 * HOUR)).toISOString() : null,
      sources: item.sources, legalStatus: item.legalStatus || null, verified: true });
  }
  const href = internalHref(config.destinationHref) || FALLBACK;
  return { feed: { schemaVersion: 1, tag: TAG, enabled: config.enabled !== false, href, items: config.enabled === false ? [] : selected.slice(0, 4) }, rejected };
}
module.exports = { TAG, FALLBACK, ACTIONS, sourceRank, internalHref, claimText, reviewHash, validate, buildFeed };
