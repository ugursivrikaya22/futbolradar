/**
 * ZENGİNLEŞTİRİLMİŞ MAÇ MERKEZİ — derleme anında, depodaki gerçek veriden.
 *
 * "Maçın 5 dakikası" yalnızca maç sonu raporunun hazır olay kaydından
 * (digest.turningPoints / lateGame) çıkar; metin üretilmez. Radar TV yalnızca
 * data/radar-tv.json'daki küratörlü kayıtlardan; kayıt yoksa hiçbir şey
 * basılmaz. Yayıncı bağlantısı yalnızca doğrulanmış yayın kaydının beyaz
 * listedeki resmî sayfasıdır. Bölümler yalnızca Türkçe sayfada basılır.
 */
import fs from "node:fs";
import path from "node:path";

const DAY = 86400000;
const READY_GRADES = new Set(["full", "partial", "events-only"]);
const READY_DATA = new Set(["complete", "partial"]);

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const time = (value) => {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : null;
};
const minuteOf = (value) => {
  const m = String(value || "").match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0) : null;
};

/** Maç tarihine yakın (-2/+3 gün) ve etiketlerinde iki takım da geçen yayımlanmış köşe yazıları. */
export function relatedColumnsFor({ columns, homeTeam, awayTeam, kickoff, sameClub, limit = 3 }) {
  const at = time(kickoff);
  if (at === null) return [];
  return (columns || [])
    .filter((column) => column && column.isPublic !== false && column.path && column.title)
    .filter((column) => {
      const date = time(column.date);
      if (date === null || date < at - 2 * DAY || date > at + 3 * DAY) return false;
      const tags = Array.isArray(column.tags) ? column.tags : [];
      return tags.some((tag) => sameClub(tag, homeTeam)) && tags.some((tag) => sameClub(tag, awayTeam));
    })
    .sort((a, b) => Math.abs(time(a.date) - at) - Math.abs(time(b.date) - at))
    .slice(0, limit)
    .map((column) => ({
      title: column.title,
      path: column.path,
      date: column.date,
      tactical: /taktik|analiz/i.test(`${column.title} ${(column.tags || []).join(" ")} ${column.contentType || ""}`)
    }));
}

/** Maç sonu raporundan en fazla 5 doğrulanmış an (dakika sırasıyla). */
export function fiveMinutesFrom(report) {
  if (!report || !READY_GRADES.has(report.coverageGrade) || !READY_DATA.has(report.dataStatus)) return [];
  const digest = report.digest || {};
  const pools = [digest.turningPoints, digest.lateGame].filter((block) => block && block.status === "ready" && Array.isArray(block.moments));
  const seen = new Set();
  const moments = [];
  for (const block of pools) {
    for (const moment of block.moments) {
      const minute = minuteOf(moment && moment.minute);
      if (minute === null || !moment.type || !moment.detail) continue;
      const key = `${minute}|${moment.type}|${moment.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      moments.push({ minute: String(moment.minute).trim(), sort: minute, type: String(moment.type), detail: String(moment.detail), team: moment.team ? String(moment.team) : "" });
    }
  }
  return moments.sort((a, b) => a.sort - b.sort).slice(0, 5).map(({ sort, ...rest }) => rest);
}

export function tacticalNotesFrom(report) {
  const tactical = report && report.digest && report.digest.tactical;
  return tactical && tactical.status === "ready" && Array.isArray(tactical.notes) ? tactical.notes.filter((note) => typeof note === "string" && note.trim()) : [];
}

const VIDEO_ID = { youtube: /^[A-Za-z0-9_-]{11}$/, vimeo: /^\d{6,12}$/ };

/** data/radar-tv.json içindeki geçerli, bu maça bağlı videolar. */
export function radarTvFor(store, slug) {
  const videos = store && Array.isArray(store.videos) ? store.videos : [];
  return videos.filter((video) => video && video.matchSlug === slug && VIDEO_ID[video.provider] && VIDEO_ID[video.provider].test(String(video.videoId || "")) && String(video.title || "").trim() && time(video.publishedAt) !== null)
    .map((video) => ({
      provider: video.provider,
      videoId: String(video.videoId),
      title: String(video.title).trim(),
      url: video.provider === "youtube" ? `https://www.youtube.com/watch?v=${video.videoId}` : `https://vimeo.com/${video.videoId}`,
      thumbnail: video.provider === "youtube" ? `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg` : null
    }));
}

export function loadRadarTv(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", "radar-tv.json"), "utf8"));
  } catch {
    return { videos: [] };
  }
}

/** Doğrulanmış yayın kaydından resmî yayıncı sayfası; beyaz liste dışıysa null. */
export function broadcasterLinkFor(record, isAllowedSourceUrl) {
  if (!record || !String(record.turkey || "").trim()) return null;
  const url = String(record.sourceUrl || "").trim();
  if (!/^https:\/\//.test(url) || !isAllowedSourceUrl(url)) return null;
  return { channel: String(record.turkey).trim(), url };
}

// page.css değişirse ~19 bin sayfanın varlık damgası yenilenmeli; bu yüzden küçük, bölüme özel stil satır içi.
const FIVE_CSS = "<style>.msp-five-list{margin:0 0 8px;padding:0;list-style:none;display:grid;gap:8px}.msp-five-list li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 6px;line-height:1.4}.msp-five-list b{min-width:44px;font-variant-numeric:tabular-nums}.msp-five-list small{color:var(--muted)}</style>";
const TV_CSS = "<style>.msp-tv-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}.msp-tv-card{display:grid;gap:6px;padding:10px;color:inherit;text-decoration:none;min-width:0}.msp-tv-card img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:8px}.msp-tv-card small{color:var(--muted)}</style>";

export function fiveMinutesSectionHtml(moments) {
  if (!moments.length) return "";
  const title = moments.length === 5 ? "Maçın 5 dakikası" : `Maçın ${moments.length} kritik anı`;
  return `<section class="msp-section" id="macin-5-dakikasi" aria-labelledby="msp-five-title">${FIVE_CSS}<h2 id="msp-five-title" class="msp-section-title">${esc(title)}</h2><div class="card msp-five"><ol class="msp-five-list">${moments.map((m) => `<li><b>${esc(m.minute)}</b> <span>${esc(m.type)}</span> · ${esc(m.detail)}${m.team ? ` <small>${esc(m.team)}</small>` : ""}</li>`).join("")}</ol><p class="muted-copy">Kaynak: maç sonu olay kaydı. Yalnızca doğrulanmış olaylar listelenir.</p></div></section>`;
}

export function radarTvSectionHtml(videos, rel) {
  if (!videos.length) return "";
  return `<section class="msp-section" id="radar-tv" aria-labelledby="msp-tv-title">${TV_CSS}<h2 id="msp-tv-title" class="msp-section-title">Radar TV</h2><div class="msp-tv-grid">${videos.map((v) => `<a class="card msp-tv-card" href="${esc(v.url)}" target="_blank" rel="${esc(rel)}">${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="" width="480" height="360" loading="lazy" decoding="async" />` : ""}<strong>${esc(v.title)}</strong><small>${v.provider === "youtube" ? "YouTube" : "Vimeo"} · FutbolRadar</small></a>`).join("")}</div></section>`;
}

/**
 * "Bu maçı derinlemesine" bağlantıları: rapor, taktik, istatistik, ikili
 * rekabet, karşılaştırma, köşe yazıları, oyuncular, resmî yayıncı.
 */
export function deepLinksSectionHtml({ links, broadcaster, sourceRel }) {
  const rows = links.filter((link) => link && link.href);
  if (!rows.length && !broadcaster) return "";
  const cards = rows.map((link) => `<a class="match-related-card" href="${esc(link.href)}"><span>${esc(link.kicker)}</span><strong>${esc(link.title)}</strong></a>`).join("");
  const official = broadcaster ? `<p class="msp-more">Resmî yayıncı: <a href="${esc(broadcaster.url)}" target="_blank" rel="${esc(sourceRel)}">${esc(broadcaster.channel)} yayın akışı</a></p>` : "";
  return `<section class="msp-section msp-related" id="mac-merkezi" aria-labelledby="msp-deep-title"><h2 id="msp-deep-title" class="msp-section-title">Bu maçı derinlemesine</h2>${cards ? `<div class="msp-related-grid">${cards}</div>` : ""}${official}</section>`;
}
