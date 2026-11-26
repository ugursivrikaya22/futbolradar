/**
 * PUAN DURUMU TAZELİK BİLGİSİ — sayfada görünen "Son güncelleme".
 *
 * Tarih DERLEME ANI DEĞİL, VERİNİN KENDİ TARİHİDİR. Sayfa her derlemede
 * yeniden üretildiği için derleme tarihini basmak, tablo haftalardır
 * değişmemişken bile sayfayı "bugün güncellendi" gösterirdi. Burada tabloyu
 * oluşturan satırların `lastStandingsSyncedAt` değerlerinin en yenisi
 * kullanılır (scripts/sync-standings.mjs bunu yalnızca satırın değerleri
 * gerçekten değiştiğinde yazar). Hiçbir satırda yoksa tarih BASILMAZ;
 * uydurulmaz.
 *
 * Tabloya yansıyan hafta = en çok maç oynayan takımın maç sayısı.
 */

const LOCALES = {
  tr: {
    tag: "tr-TR",
    updated: "Son güncelleme",
    afterMatches: (n) => `${n}. hafta sonrası`,
    zone: "TSİ"
  },
  en: {
    tag: "en-GB",
    updated: "Last updated",
    afterMatches: (n) => `after matchweek ${n}`,
    zone: "TRT"
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** @returns {{iso: string, week: number}|null} */
export function standingsFreshness(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let latest = 0;
  let week = 0;
  for (const row of list) {
    const time = Date.parse(row && row.lastStandingsSyncedAt);
    if (Number.isFinite(time) && time > latest) latest = time;
    const played = Number(row && row.played);
    if (Number.isFinite(played) && played > week) week = played;
  }
  if (!latest) return null;
  return { iso: new Date(latest).toISOString(), week };
}

export function formatUpdatedAt(iso, locale = "tr") {
  const copy = LOCALES[locale] || LOCALES.tr;
  const when = new Date(iso);
  // Tarih ve saat ayrı biçimlenir: ICU sürümüne göre değişen birleştirici
  // ("at", virgül) çıktıya karışmasın.
  const day = new Intl.DateTimeFormat(copy.tag, {
    timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric"
  }).format(when);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(when);
  return `${day}${locale === "en" ? ", " : " "}${time} ${copy.zone}`;
}

/** Görünen satır; veri tarihi yoksa boş döner. */
export function standingsUpdatedHtml(rows, locale = "tr") {
  const fresh = standingsFreshness(rows);
  if (!fresh) return "";
  const copy = LOCALES[locale] || LOCALES.tr;
  const week = fresh.week > 0 ? ` · ${escapeHtml(copy.afterMatches(fresh.week))}` : "";
  return `<p class="muted standings-updated" data-standings-updated="${escapeHtml(fresh.iso)}">${escapeHtml(copy.updated)}: <time datetime="${escapeHtml(fresh.iso)}">${escapeHtml(formatUpdatedAt(fresh.iso, locale))}</time>${week}</p>`;
}
