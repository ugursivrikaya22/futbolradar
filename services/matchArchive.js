"use strict";

/**
 * MAÇ ARŞİVİ — biten maçların kalıcı, aranabilir tarihçe sayfaları.
 *
 * Adres düzeni: /mac/<YYYY-MM-DD>/<ev>-<deplasman>  (dosya: mac/<gün>/<çift>.html)
 * Aynı gün aynı eşleşme iki kez oynandıysa ikinci maç "-2", üçüncüsü "-3" alır.
 *
 * KURAL: veri uydurulmaz. Bir bölüm (goller, kadrolar, istatistik, korner)
 * yalnızca kayıtta veri VARSA ve sayfada ALLOWED_SOURCE_HOSTS içinden en az
 * bir kaynak bağlantısı gösterilebiliyorsa basılır. Kaynaksız ya da yalnızca
 * skordan ibaret maç sayfası `noindex,follow` olur ve site haritasına girmez.
 */

const { isAllowedSourceUrl, hostOf } = require("./sourceLinks.js");
const { teamSlugPart, istanbulDateParts, TR_MONTHS } = require("./matchSeoPages.js");

const DOMAIN = "https://www.futbolradar.com";
const FINISHED_STATUSES = new Set(["FINISHED", "AWARDED", "FT", "AET", "PEN"]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ARCHIVE_PATH_RE = /^mac\/(\d{4}-\d{2}-\d{2})\/([a-z0-9-]+)$/;

function pad(value) {
  return String(value).padStart(2, "0");
}

/** Türkiye saatine göre YYYY-MM-DD. */
function archiveDay(kickoff) {
  const parts = istanbulDateParts(kickoff);
  return parts ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` : null;
}

function trDateLabel(day) {
  if (!DAY_RE.test(String(day || ""))) return "";
  const [year, month, date] = day.split("-").map(Number);
  const name = TR_MONTHS[month - 1] || "";
  return `${date} ${name.charAt(0).toLocaleUpperCase("tr-TR")}${name.slice(1)} ${year}`;
}

function pairSlug(homeTeam, awayTeam) {
  const home = teamSlugPart(homeTeam);
  const away = teamSlugPart(awayTeam);
  return home && away ? `${home}-${away}` : null;
}

function pairKey(homeTeam, awayTeam, kickoff) {
  const pair = pairSlug(homeTeam, awayTeam);
  const day = archiveDay(kickoff);
  return pair && day ? `${day}/${pair}` : null;
}

/** Arşiv dosyasının kökten göreli yolu: mac/2026-10-18/galatasaray-fenerbahce.html */
function archiveFile(day, slug) {
  return `mac/${day}/${slug}.html`;
}

/** Kanonik (uzantısız) yol: /mac/2026-10-18/galatasaray-fenerbahce */
function archivePath(day, slug) {
  return `/mac/${day}/${slug}`;
}

function archiveUrl(day, slug) {
  return `${DOMAIN}${archivePath(day, slug)}`;
}

function isFinished(status) {
  return FINISHED_STATUSES.has(String(status || "").toUpperCase());
}

function isArchivePath(pathname) {
  const clean = String(pathname || "").replace(/^\/+/, "").replace(/\.html$/, "");
  return ARCHIVE_PATH_RE.test(clean);
}

/**
 * Kayıttaki TÜM URL'ler taranır; yalnız beyaz listedeki kaynaklar kalır.
 * Wikipedia ve sitenin kendi adresi hiçbir zaman kaynak sayılmaz.
 */
function collectSourceUrls(...objects) {
  const seen = new Set();
  const out = [];
  for (const object of objects) {
    if (!object) continue;
    const text = JSON.stringify(object);
    for (const raw of text.match(/https?:\/\/[^"\\\s<>]+/g) || []) {
      const url = raw.replace(/[),.;]+$/, "");
      if (/wikipedia\.org/i.test(url)) continue;
      if (/\.(png|jpe?g|svg|webp|gif)(\?|$)/i.test(url)) continue;
      if (!isAllowedSourceUrl(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, host: String(hostOf(url) || "").replace(/^www\./, "") });
    }
  }
  return out;
}

/** Gol olayları: dakika, oyuncu, takım, tür. Kaçan penaltı gol sayılmaz. */
function goalEvents(events) {
  const goals = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event) continue;
    const type = String(event.type || "");
    const detail = String(event.detail || "");
    if (!/^(goal|gol)$/i.test(type)) continue;
    if (/missed|kaçan|kacan/i.test(detail)) continue;
    let player = event.player && event.player.name ? String(event.player.name) : "";
    let assist = event.assist && event.assist.name ? String(event.assist.name) : "";
    if (!player && event.value) {
      const parts = String(event.value).split(" · ").map((part) => part.trim());
      player = parts[0] || "";
      const assistPart = parts.find((part) => /^Asist:/i.test(part));
      if (assistPart && !assist) assist = assistPart.replace(/^Asist:\s*/i, "");
    }
    if (!player && /^gol$/i.test(type)) {
      // Editoryal kayıt: "Vedat Muriqi skoru 0-1 yaptı." — ilk iki büyük harfli kelime.
      const m = /^((?:[A-ZÇĞİÖŞÜ][\p{L}'’.-]+\s?){1,3})/u.exec(detail);
      player = m ? m[1].trim() : "";
    }
    if (!player || /^(normal goal|penalty|own goal)$/i.test(player)) continue;
    const kind = /own goal|kendi kalesine/i.test(detail) ? "kk" : /penalty|penaltı/i.test(detail) ? "pen" : "";
    const minute = String(event.time || "").trim();
    goals.push({
      minute: minute && minute !== "'" ? minute : "",
      team: event.team && event.team.name ? String(event.team.name) : String(event.team || ""),
      player,
      assist,
      kind
    });
  }
  return goals;
}

function cardEvents(events) {
  return (Array.isArray(events) ? events : []).filter((event) => event && /^card$/i.test(String(event.type || "")) && event.value).map((event) => ({
    minute: String(event.time || ""),
    team: event.team && event.team.name ? String(event.team.name) : "",
    player: String(event.value).split(" · ")[0],
    red: /red/i.test(String(event.detail || ""))
  }));
}

function lineupBlocks(lineups) {
  return (Array.isArray(lineups) ? lineups : []).map((lineup) => {
    if (!lineup) return null;
    const starters = Array.isArray(lineup.startingDetails) && lineup.startingDetails.length
      ? lineup.startingDetails.map((row) => ({ name: String(row.name || ""), number: row.number ?? null, position: row.position || "" }))
      : (Array.isArray(lineup.players) ? lineup.players : []).map((name) => ({ name: String(name || ""), number: null, position: "" }));
    const subs = Array.isArray(lineup.substituteDetails)
      ? lineup.substituteDetails.map((row) => ({ name: String(row.name || ""), number: row.number ?? null, position: row.position || "" }))
      : [];
    const clean = (rows) => rows.filter((row) => row.name).map((row) => ({ ...row, name: row.name.replace(/&apos;/g, "'") }));
    return { team: String(lineup.team || ""), formation: lineup.formation || "", starters: clean(starters), subs: clean(subs) };
  }).filter((block) => block && block.team && block.starters.length >= 7);
}

function statRows(statistics) {
  return (Array.isArray(statistics) ? statistics : [])
    .filter((row) => row && row.type && row.home !== null && row.home !== undefined && row.away !== null && row.away !== undefined && row.home !== "" && row.away !== "")
    .map((row) => ({ type: String(row.type), home: row.home, away: row.away, decimals: row.decimals || 0, corner: /korner|corner/i.test(String(row.type)) }));
}

/**
 * Kapsam kararı. Sayfa ancak (a) skor var, (b) beyaz listeden kaynak var ve
 * (c) skorun ötesinde en az bir veri bloğu (goller, kadro, istatistik)
 * gösterilebiliyorsa indekslenir.
 */
/** Veri API-Football kökenli mi: fixture kimliği API-Football'dan geliyorsa. thesportsdb vb. sayılmaz. */
function isApiFootballOrigin(m) {
  if (!m || typeof m !== "object") return false;
  const ids = m.providerIds || {};
  if (ids.apiFootball || ids["api-football"]) return true;
  return /api-football|api-sports/i.test(String(m.source || m.provider || "")) && Boolean(m.providerId);
}

function indexDecision({ score, sources, goals, lineups, stats, apiFootball = false }) {
  const hasScore = score && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away)) && score.home !== null && score.away !== null;
  if (!hasScore) return { indexable: false, reason: "skor-yok" };
  if (!sources.length && !apiFootball) return { indexable: false, reason: "izinli-kaynak-yok" };
  const blocks = (goals.length ? 1 : 0) + (lineups.length ? 1 : 0) + (stats.length ? 1 : 0);
  const goalless = Number(score.home) + Number(score.away) === 0;
  if (!blocks) return { indexable: false, reason: goalless ? "yalniz-skor-golsuz" : "yalniz-skor" };
  return { indexable: true, reason: "kaynakli-icerik" };
}

/** Eski TR maç sayfası slug'ı: <ev>-<dep>-<gün>-<ay>-<yıl> */
function legacySlugFor(day, pair) {
  if (!DAY_RE.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  return `${pair}-${date}-${TR_MONTHS[month - 1]}-${year}`;
}

module.exports = {
  DOMAIN,
  FINISHED_STATUSES,
  archiveDay,
  archiveFile,
  archivePath,
  archiveUrl,
  cardEvents,
  collectSourceUrls,
  goalEvents,
  indexDecision,
  isApiFootballOrigin,
  isArchivePath,
  isFinished,
  legacySlugFor,
  lineupBlocks,
  pairKey,
  pairSlug,
  statRows,
  trDateLabel
};
