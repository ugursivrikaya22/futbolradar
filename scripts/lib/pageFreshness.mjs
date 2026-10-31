// Sayfa tazelik denetimi yardımcıları (saf fonksiyonlar; test edilebilir).
export const STALE_DAYS = 30;

export function extractDateModified(html) {
  const m = String(html || "").match(/"dateModified"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

export function extractVisibleUpdate(html) {
  const s = String(html || "");
  const m = s.match(/(?:Son güncelleme|Veri tarihi|Güncellendi)\s*:?\s*(?:<[^>]+>\s*)*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+[0-9]{4})/i);
  return m ? m[1] : null;
}

export function sitemapLastmod(xml, loc) {
  const esc = loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = String(xml || "").match(new RegExp(`<loc>${esc}</loc>(?:(?!</url>)[\\s\\S])*?<lastmod>([^<]+)</lastmod>`));
  return m ? m[1] : null;
}

export function ageDays(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const t = Date.parse(String(dateStr).length === 10 ? `${dateStr}T00:00:00Z` : dateStr);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86400000);
}

/** Bayraklar: STALE (>30 gün), NO_DATEMODIFIED, NO_VISIBLE_DATE, NO_LASTMOD, LASTMOD_AHEAD_OF_DATA */
export function freshnessFlags({ dateModified, visible, lastmod, dataDate }, now = new Date(), staleDays = STALE_DAYS) {
  const flags = [];
  const newest = [dateModified, lastmod, dataDate].filter(Boolean).map((d) => String(d).slice(0, 10)).sort().pop() || null;
  const age = ageDays(newest, now);
  if (age === null || age > staleDays) flags.push("STALE");
  if (!dateModified) flags.push("NO_DATEMODIFIED");
  if (!visible) flags.push("NO_VISIBLE_DATE");
  if (!lastmod) flags.push("NO_LASTMOD");
  if (lastmod && dataDate && String(lastmod).slice(0, 10) > String(dataDate).slice(0, 10)) flags.push("LASTMOD_AHEAD_OF_DATA");
  return { flags, newest, age };
}

const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** ISO zaman damgasını İstanbul gününe (YYYY-MM-DD) çevirir; geçersizse null. */
export function istanbulDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t + 3 * 3600000).toISOString().slice(0, 10);
}

export function trDateLabel(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return `${d} ${TR_MONTHS[m - 1]} ${y}`;
}

/**
 * VERİ TARİHİ DAMGASI. Sayfaya (1) JSON-LD'deki sayfa düğümüne `dateModified`
 * ve (2) H1'in hemen ardına görünür "Son güncelleme" satırı basar. Tarih
 * DERLEME saati değil, kaynak veri dosyasının kendi zaman damgasıdır; yoksa
 * hiçbir şey basılmaz (uydurma tarih yok). İdempotenttir.
 */
export function applyDataFreshness(html, { dataTimestamp, pageUrl, label = "Kaynak veri" }) {
  const ymd = istanbulDate(dataTimestamp);
  if (!ymd) return html;
  let out = String(html);
  out = out.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (whole, body) => {
    let data;
    try { data = JSON.parse(body); } catch { return whole; }
    const nodes = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
    let touched = false;
    for (const node of nodes) {
      if (!node || !/(WebPage|CollectionPage)$/.test(String(node["@type"] || ""))) continue;
      const id = String(node["@id"] || node.url || "");
      if (pageUrl && id && !id.startsWith(pageUrl)) continue;
      node.dateModified = ymd;
      touched = true;
      break;
    }
    return touched ? `<script type="application/ld+json">${JSON.stringify(data)}</script>` : whole;
  });
  out = out.replace(/\s*<p class="evergreen-freshness" data-data-freshness>[\s\S]*?<\/p>/g, "");
  const stamp = `<p class="evergreen-freshness" data-data-freshness>Son güncelleme: <time datetime="${ymd}">${trDateLabel(ymd)}</time> · ${label}</p>`;
  out = out.replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/, `$1\n            ${stamp}`);
  return out;
}
