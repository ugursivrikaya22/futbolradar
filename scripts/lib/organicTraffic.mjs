/**
 * ORGANİK TRAFİK RAPORU — SAF İŞLEVLER.
 *
 * Kural: VERİ YOKSA SAYI YOK. Boş bir dosya "0 ziyaretçi" demez, "veri yok"
 * der: ölçülmemiş şeyi sıfır diye yazmak, ölçülmüş sıfırdan ayırt edilemez ve
 * yanlış karar üretir. Bu modül hiçbir sayı uydurmaz; yalnızca
 * `data/analytics/organic-traffic.json` içinde gerçekten bulunan satırlardan
 * toplam/ortalama hesaplar.
 *
 * Veri şeması: data/analytics/organic-traffic.schema.json
 *   daily[]    { date: "YYYY-MM-DD", sessions, users, newUsers, engagedSessions }
 *   topPages[] { path, sessions, users, engagementRate (0-1), avgSessionSeconds }
 *
 * Kaynak: GA4 Data API (scripts/fetch-ga4-organic.mjs, ücretsiz) ya da elle
 * dışa aktarılmış GA4 raporu. İkisi de aynı şemaya yazar.
 */

export const EMPTY_ORGANIC_TRAFFIC = Object.freeze({
  version: 1,
  source: null,
  configured: false,
  fetchedAt: null,
  range: { start: null, end: null },
  note: "GA4 verisi bağlı değil; bu dosya boş. Sayı üretilmez. Kurulum: docs/seo/30-gunluk-organik-trafik-plani.md ve scripts/fetch-ga4-organic.mjs.",
  daily: [],
  topPages: []
});

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isCount = (v) => Number.isFinite(v) && v >= 0 && Math.floor(v) === v;

/** @returns {string[]} hata listesi (boş = geçerli) */
export function validateOrganicTraffic(data, { now = Date.now() } = {}) {
  const errors = [];
  if (!data || typeof data !== "object") return ["veri nesne değil"];
  if (!Array.isArray(data.daily)) errors.push("daily dizi olmalı");
  if (!Array.isArray(data.topPages)) errors.push("topPages dizi olmalı");
  const today = new Date(now + 36 * 3600000).toISOString().slice(0, 10);
  const seen = new Set();
  for (const [i, row] of (data.daily || []).entries()) {
    if (!row || !ISO_DAY.test(row.date) || Number.isNaN(Date.parse(row.date))) { errors.push(`daily[${i}].date geçersiz`); continue; }
    if (row.date > today) errors.push(`daily[${i}].date gelecekte: ${row.date}`);
    if (seen.has(row.date)) errors.push(`daily[${i}].date tekrarlanıyor: ${row.date}`);
    seen.add(row.date);
    for (const key of ["sessions", "users"]) if (!isCount(row[key])) errors.push(`daily[${i}].${key} sayaç değil: ${row[key]}`);
    for (const key of ["newUsers", "engagedSessions"]) if (row[key] !== undefined && !isCount(row[key])) errors.push(`daily[${i}].${key} sayaç değil`);
    if (isCount(row.sessions) && isCount(row.engagedSessions) && row.engagedSessions > row.sessions) errors.push(`daily[${i}] etkileşimli oturum > oturum`);
  }
  for (const [i, row] of (data.topPages || []).entries()) {
    if (!row || typeof row.path !== "string" || !row.path.startsWith("/")) { errors.push(`topPages[${i}].path "/" ile başlamalı`); continue; }
    if (!isCount(row.sessions)) errors.push(`topPages[${i}].sessions sayaç değil`);
    if (row.engagementRate !== undefined && !(row.engagementRate >= 0 && row.engagementRate <= 1)) errors.push(`topPages[${i}].engagementRate 0-1 dışında`);
  }
  return errors;
}

/**
 * Özet. `days` günlük pencere; elde o kadar gün yoksa eldeki günler kullanılır
 * ve `coverageDays` bunu açıkça söyler (eksik günler sıfır sayılmaz).
 */
export function summarizeOrganicTraffic(data, { days = 28 } = {}) {
  const rows = Array.isArray(data && data.daily) ? [...data.daily].sort((a, b) => a.date.localeCompare(b.date)) : [];
  if (!rows.length) {
    return { hasData: false, reason: (data && data.note) || EMPTY_ORGANIC_TRAFFIC.note, configured: Boolean(data && data.configured), topPages: [] };
  }
  const window = rows.slice(-days);
  const previous = rows.slice(-days * 2, -days);
  const sum = (list, key) => list.reduce((total, row) => total + (row[key] || 0), 0);
  const sessions = sum(window, "sessions");
  const peak = window.reduce((best, row) => (row.sessions > best.sessions ? row : best), window[0]);
  const summary = {
    hasData: true,
    source: data.source || null,
    fetchedAt: data.fetchedAt || null,
    range: { start: window[0].date, end: window[window.length - 1].date },
    coverageDays: window.length,
    requestedDays: days,
    organicSessions: sessions,
    avgDailySessions: Math.round((sessions / window.length) * 10) / 10,
    // Günlük tekil kullanıcılar günler arasında TOPLANAMAZ (aynı kişi birden çok
    // gün sayılır): toplam yerine günlük ortalama ve en yüksek gün verilir.
    avgDailyUsers: Math.round((sum(window, "users") / window.length) * 10) / 10,
    peakDay: { date: peak.date, sessions: peak.sessions },
    engagedSessionShare: sum(window, "engagedSessions") && sessions ? Math.round((sum(window, "engagedSessions") / sessions) * 1000) / 1000 : null,
    previousPeriod: previous.length === window.length
      ? { sessions: sum(previous, "sessions"), changePercent: sum(previous, "sessions") ? Math.round(((sessions - sum(previous, "sessions")) / sum(previous, "sessions")) * 1000) / 10 : null }
      : null,
    topPages: [...(data.topPages || [])].sort((a, b) => b.sessions - a.sessions).slice(0, 20)
  };
  return summary;
}

export function renderOrganicReport(summary) {
  const lines = ["# Organik trafik raporu", ""];
  if (!summary.hasData) {
    lines.push("**Veri yok.** GA4 organik trafik verisi bu depoya bağlı değil; hiçbir ziyaretçi, oturum ya da sayfa sayısı gösterilmiyor.", "");
    lines.push("| Ölçü | Değer |", "| --- | --- |", "| Günlük organik oturum | — (veri yok) |", "| Günlük organik kullanıcı | — (veri yok) |", "| En çok trafik getiren sayfalar | — (veri yok) |", "");
    lines.push(`Neden: ${summary.reason}`, "");
    lines.push("Bağlamak için: `GA4_PROPERTY_ID`, `GA4_CLIENT_EMAIL`, `GA4_PRIVATE_KEY` tanımlayıp `npm run fetch:ga4` çalıştırın; ardından `npm run report:organic`.");
    return lines.join("\n");
  }
  lines.push(`Kaynak: ${summary.source || "bilinmiyor"} · Çekildi: ${summary.fetchedAt || "bilinmiyor"} · Aralık: ${summary.range.start} → ${summary.range.end} (${summary.coverageDays}/${summary.requestedDays} gün)`, "");
  if (summary.coverageDays < summary.requestedDays) lines.push(`> Uyarı: istenen ${summary.requestedDays} günden yalnızca ${summary.coverageDays} gün verisi var; eksik günler sıfır sayılmadı.`, "");
  lines.push("| Ölçü | Değer |", "| --- | --- |");
  lines.push(`| Organik oturum (toplam) | ${summary.organicSessions} |`);
  lines.push(`| Günlük ortalama oturum | ${summary.avgDailySessions} |`);
  lines.push(`| Günlük ortalama kullanıcı | ${summary.avgDailyUsers} |`);
  lines.push(`| En yüksek gün | ${summary.peakDay.date} (${summary.peakDay.sessions} oturum) |`);
  if (summary.engagedSessionShare !== null) lines.push(`| Etkileşimli oturum oranı | %${(summary.engagedSessionShare * 100).toFixed(1)} |`);
  lines.push(`| Önceki dönem değişimi | ${summary.previousPeriod && summary.previousPeriod.changePercent !== null ? `%${summary.previousPeriod.changePercent}` : "— (önceki dönem verisi yok)"} |`, "");
  lines.push("## En çok organik trafik getiren sayfalar", "");
  if (!summary.topPages.length) lines.push("Sayfa bazlı veri yok.");
  else {
    lines.push("| Sayfa | Oturum | Kullanıcı | Etkileşim oranı |", "| --- | ---: | ---: | ---: |");
    for (const page of summary.topPages) lines.push(`| ${page.path} | ${page.sessions} | ${page.users ?? "—"} | ${page.engagementRate === undefined ? "—" : `%${(page.engagementRate * 100).toFixed(1)}`} |`);
  }
  return lines.join("\n");
}

/** GA4 Data API `runReport` yanıtından günlük satırlar. */
export function parseDailyReport(response) {
  return ((response && response.rows) || []).map((row) => {
    const raw = row.dimensionValues[0].value; // YYYYMMDD
    const [sessions, users, newUsers, engagedSessions] = row.metricValues.map((m) => Number(m.value));
    return { date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, sessions, users, newUsers, engagedSessions };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * GA4 Data API `runReport` yanıtından en çok trafik getiren sayfalar.
 * Sorgu dizgisi atılır (`/x?utm_source=…` ile `/x` aynı sayfa); aynı yola düşen
 * satırlar birleşir: oturum/kullanıcı toplanır, oranlar oturumla ağırlıklanır.
 */
export function parseTopPagesReport(response) {
  const byPath = new Map();
  for (const row of (response && response.rows) || []) {
    const [sessions, users, engagementRate, avgSessionSeconds] = row.metricValues.map((m) => Number(m.value));
    const path = (row.dimensionValues[0].value || "/").split("?")[0] || "/";
    if (!path.startsWith("/")) continue;
    const entry = byPath.get(path) || { path, sessions: 0, users: 0, rate: 0, seconds: 0 };
    entry.sessions += sessions;
    entry.users += users;
    entry.rate += engagementRate * sessions;
    entry.seconds += avgSessionSeconds * sessions;
    byPath.set(path, entry);
  }
  return [...byPath.values()]
    .map((e) => ({ path: e.path, sessions: e.sessions, users: e.users, engagementRate: e.sessions ? Math.round((e.rate / e.sessions) * 1000) / 1000 : 0, avgSessionSeconds: e.sessions ? Math.round(e.seconds / e.sessions) : 0 }))
    .sort((a, b) => b.sessions - a.sessions);
}
