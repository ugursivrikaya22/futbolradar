#!/usr/bin/env node
/**
 * TRANSFER RADARI — super-lig-transferleri-2026-2027.html
 * ----------------------------------------------------------------------------
 * Adres DEĞİŞMEZ (menüdeki "Transfer Radar" ve kayan yazılar bu sayfaya
 * bağlanır). Sayfa altı lige ayrılmış bir transfer merkezidir: Süper Lig,
 * Premier Lig, La Liga, Serie A, Bundesliga, Ligue 1. Her ligde üç bölüm:
 *   1. Resmi transferler (tablo) — yalnızca doğrulanmış kayıt.
 *   2. Güçlü söylentiler — "Söylenti" etiketi + kaynak adı, en fazla 72 saat.
 *   3. Ocak 2027 ara transfer dönemi — tarih yalnızca resmî/izinli kaynakta
 *      varsa; yoksa "Güncelleniyor".
 *
 * Veri:
 *   - data/transfers.json  (Süper Lig, status "confirmed") — sayfadaki
 *     `#transfer-<oyuncu>` çapaları kayan yazı (scripts/lib/tickerFeed.mjs)
 *     tarafından kullanılır; HER kayıt basılır, çapa kırılmaz.
 *   - data/ticker.json     (Süper Lig söylentileri: süresi geçmemiş "iddia")
 *   - data/transfer-radar.json (beş Avrupa ligi + ocak pencereleri)
 * Kaynaksız, beyaz liste dışı ya da yasaklı alan adlı satır DERLEMEYİ DURDURUR
 * (sessizce düşürmek yerine) — uydurma/eksik kayıt yayına çıkamaz.
 *
 * Bu sayfa eskiden scripts/generate-trend-seo-pages.mjs içindeydi; oradan
 * çıkarıldı ve derlemede hemen onun ardından çalışır.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { SOURCE_LINK_REL, isAllowedSourceUrl } = require("../services/sourceLinks.js");
const { readTickerFile, selectHomeTickerItems } = require("../services/homeTicker.js");

export const PAGE_FILE = "super-lig-transferleri-2026-2027.html";
const DOMAIN = "https://www.futbolradar.com";
const PAGE_URL = `${DOMAIN}/${PAGE_FILE}`;
export const PAGE_TITLE = "Transfer Radarı 2026-2027 | Süper Lig ve Avrupa'nın Büyük Ligleri Transferleri | FutbolRadar";
export const PAGE_DESCRIPTION = "Süper Lig, Premier Lig, La Liga, Serie A, Bundesliga ve Ligue 1 transferlerini kapsayan, her gün güncellenen transfer merkezi: resmi transferler ve söylentiler.";
const RUMOUR_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/** Kullanıcı kuralı: izinli listede olsa bile bu kaynaklar transfer satırı olamaz. */
const FORBIDDEN_SOURCE = /(^|\.)(wikipedia\.org|transfermarkt\.[a-z.]+|fbref\.com|thesportsdb\.com|milliyet\.com\.tr|haber7\.com|abc\.[a-z.]+|x\.com|twitter\.com)$/i;

/** x.com yalnızca kendi hesabımızın paylaşımı olarak, izinli kaynağın YANINDA. */
const FUTBOLRADAR_X_POST = /^https:\/\/x\.com\/Futbolradarcom\/status\/\d+$/;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

export function sourceProblem(row) {
  if (!row || !String(row.sourceName || "").trim()) return "kaynak adı yok";
  const url = String(row.sourceUrl || "").trim();
  if (!url) return "kaynak adresi yok";
  if (FORBIDDEN_SOURCE.test(hostOf(url))) return `yasaklı kaynak: ${hostOf(url)}`;
  if (!isAllowedSourceUrl(url)) return `beyaz liste dışı kaynak: ${hostOf(url)}`;
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

/** scripts/lib/tickerFeed.mjs ile AYNI: kayan yazı çapası `#transfer-<slug>`. */
export function slugify(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const TR_DATE = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
const TR_DATE_TIME = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

function dayDate(value) {
  const day = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return new Date(`${day}T12:00:00+03:00`);
}
function formatDay(value) {
  const date = dayDate(value);
  return date ? TR_DATE.format(date) : "";
}
function formatDateTime(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? `${TR_DATE_TIME.format(new Date(ms))} (TSİ)` : "";
}

function readJson(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

/** Transfer tipini filtre grubuna indirger (tablo filtresi). */
function typeGroup(type) {
  const value = String(type || "").toLocaleLowerCase("tr-TR");
  if (value.includes("kiral")) return "kiralik";
  if (value.includes("serbest") || value.includes("bedelsiz")) return "serbest";
  if (value.includes("fesih") || value.includes("sözleşme")) return "ayrilik";
  return "bonservis";
}

/**
 * Tüm veriyi lig bazında toplar. `now` (ms) söylenti süresi için.
 * Dönüş: { leagues: [{ id, name, official: [], rumours: [], january }], updatedAt, problems }
 */
export function buildTransferRadar(root = process.cwd(), options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const radar = readJson(root, "data/transfer-radar.json");
  const transfers = readJson(root, "data/transfers.json");
  const tickerItems = options.tickerItems || readTickerFile(path.join(root, "data", "ticker.json"));
  const problems = [];

  const leagues = radar.leagues.map((league) => ({ ...league, official: [], rumours: [], january: null }));
  const byId = new Map(leagues.map((league) => [league.id, league]));
  const clubLeagues = radar.clubLeagues || {};
  const clubToLeague = new Map();
  for (const [leagueId, clubs] of Object.entries(clubLeagues)) {
    if (leagueId.startsWith("_") || !Array.isArray(clubs)) continue;
    for (const club of clubs) clubToLeague.set(club, leagueId);
  }

  // 1) Süper Lig resmi kayıtları (data/transfers.json) — hepsi, çapa kırılmasın.
  const seenAnchors = new Set();
  for (const record of transfers) {
    if (record.status !== "confirmed") continue;
    const problem = sourceProblem(record);
    if (problem) { problems.push(`${record.id}: ${problem}`); continue; }
    const anchor = `transfer-${slugify(record.playerName)}`;
    const row = {
      id: record.id,
      anchor: seenAnchors.has(anchor) ? "" : anchor,
      playerName: record.playerName,
      fromTeam: record.fromTeam,
      toTeam: record.toTeam,
      type: record.type,
      typeNote: "",
      date: record.date || null,
      fee: record.fee || "",
      sourceName: record.sourceName,
      sourceUrl: record.sourceUrl,
      season: record.season || ""
    };
    seenAnchors.add(anchor);
    byId.get("super-lig").official.push(row);
    // Avrupa sekmesinde de göster: yalnızca 2026/27 ve ligi tartışmasız kulüp.
    if (record.season === "2026/27") {
      const crossLeagues = new Set([clubToLeague.get(record.fromTeam), clubToLeague.get(record.toTeam)].filter(Boolean));
      for (const leagueId of crossLeagues) byId.get(leagueId)?.official.push({ ...row, anchor: "" });
    }
  }

  // 2) Avrupa resmi kayıtları.
  for (const record of radar.official || []) {
    const problem = sourceProblem(record);
    if (problem) { problems.push(`${record.id}: ${problem}`); continue; }
    if (!record.playerName || !record.fromTeam || !record.toTeam || !record.type) { problems.push(`${record.id}: zorunlu alan eksik`); continue; }
    for (const leagueId of record.leagues || []) {
      const league = byId.get(leagueId);
      if (!league) { problems.push(`${record.id}: bilinmeyen lig ${leagueId}`); continue; }
      league.official.push({
        id: record.id, anchor: "", playerName: record.playerName, fromTeam: record.fromTeam, toTeam: record.toTeam,
        type: record.type, typeNote: record.typeNote || "", date: record.date || null, fee: record.fee || "",
        sourceName: record.sourceName, sourceUrl: record.sourceUrl, sourceDate: record.sourceDate || ""
      });
    }
  }

  // 3) Söylentiler: Süper Lig → kayan yazının süresi geçmemiş "iddia" öğeleri;
  //    Avrupa → data/transfer-radar.json. İkisi de en fazla 72 saat.
  const { items: tickerActive } = selectHomeTickerItems(tickerItems, { now: nowMs, limit: 1000 });
  for (const item of tickerActive) {
    if (item.category !== "iddia") continue;
    if (sourceProblem(item)) continue;
    byId.get("super-lig").rumours.push({
      id: item.id, text: item.text, date: item.date, expiresAt: item.expiresAt,
      sourceName: item.sourceName, sourceUrl: item.sourceUrl,
      url: String(item.url || "").startsWith("/haber/") ? item.url : ""
    });
  }
  for (const rumour of radar.rumours || []) {
    const problem = sourceProblem(rumour);
    if (problem) { problems.push(`${rumour.id}: ${problem}`); continue; }
    const date = Date.parse(rumour.date);
    const expires = Date.parse(rumour.expiresAt);
    if (!Number.isFinite(date) || !Number.isFinite(expires)) { problems.push(`${rumour.id}: tarih/expiresAt geçersiz`); continue; }
    if (expires - date > RUMOUR_MAX_AGE_MS) { problems.push(`${rumour.id}: söylenti 72 saati aşıyor`); continue; }
    if (!/iddia|söylenti/i.test(rumour.text)) { problems.push(`${rumour.id}: metin 'iddia' demiyor`); continue; }
    if (expires <= nowMs) continue;
    for (const leagueId of rumour.leagues || []) {
      byId.get(leagueId)?.rumours.push({
        id: rumour.id, text: rumour.text, date: rumour.date, expiresAt: rumour.expiresAt,
        sourceName: rumour.sourceName, sourceUrl: rumour.sourceUrl, january: rumour.january === true, url: ""
      });
    }
  }

  // 4) Ocak 2027 pencereleri.
  for (const window of radar.januaryWindows || []) {
    const problem = sourceProblem(window);
    if (problem) { problems.push(`ocak ${window.league}: ${problem}`); continue; }
    const league = byId.get(window.league);
    if (league) league.january = window;
  }

  // 5) FIFA transfer (kayıt) yasakları — transfer değil, ayrı kutu. Ana kaynak
  //    izinli listede olmalı; x.com yalnızca @Futbolradarcom paylaşımı olarak EK.
  const bansData = radar.transferBans || null;
  let transferBans = null;
  if (bansData && Array.isArray(bansData.items) && bansData.items.length) {
    const items = [];
    for (const ban of bansData.items) {
      const problem = sourceProblem(ban);
      if (problem) { problems.push(`${ban.id}: ${problem}`); continue; }
      if (!ban.club || !ban.league || !ban.duration || !ban.text) { problems.push(`${ban.id}: zorunlu alan eksik`); continue; }
      const extras = [];
      for (const extra of ban.extraSources || []) {
        const extraProblem = sourceProblem(extra);
        if (extraProblem) { problems.push(`${ban.id} ek kaynak: ${extraProblem}`); continue; }
        extras.push(extra);
      }
      items.push({ ...ban, extraSources: extras });
    }
    const xPostUrl = String(bansData.xPostUrl || "");
    if (xPostUrl && !FUTBOLRADAR_X_POST.test(xPostUrl)) problems.push(`transferBans.xPostUrl: yalnızca x.com/Futbolradarcom/status bağlantısı ek olarak gösterilebilir`);
    if (!dayDate(bansData.date)) problems.push("transferBans: tarih geçersiz");
    if (items.length) {
      transferBans = { headline: bansData.headline || "", date: bansData.date, items, xPostUrl: FUTBOLRADAR_X_POST.test(xPostUrl) ? xPostUrl : "" };
      for (const leagueId of bansData.leagues || ["super-lig"]) {
        const league = byId.get(leagueId);
        if (league) league.transferBans = transferBans;
      }
    }
  }

  for (const league of leagues) {
    league.official.sort((a, b) => String(b.date || b.sourceDate || "").localeCompare(String(a.date || a.sourceDate || "")) || a.playerName.localeCompare(b.playerName, "tr"));
    league.rumours.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }

  const stamps = [Date.parse(radar.updatedAt)];
  for (const league of leagues) for (const rumour of league.rumours) stamps.push(Date.parse(rumour.date));
  const updatedMs = Math.max(...stamps.filter(Number.isFinite));
  const updatedAt = new Date(Math.min(updatedMs, nowMs)).toISOString();

  return { leagues, updatedAt, problems, transferBans };
}

function sourceLink(row) {
  return `<a class="tr-src" href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="${SOURCE_LINK_REL}">${escapeHtml(row.sourceName)}</a>`;
}

function officialTable(league) {
  if (!league.official.length) {
    return `<p class="tr-empty" data-tr-empty>Güncelleniyor — bu lig için kaynağı doğrulanmış resmi transfer kaydı henüz eklenmedi.</p>`;
  }
  const rows = league.official.map((row) => {
    const dateCell = row.date
      ? `<time datetime="${escapeHtml(String(row.date).slice(0, 10))}">${escapeHtml(formatDay(row.date))}</time>`
      : `<span title="Kaynakta duyuru günü yok; kaynak yayımı ${escapeHtml(formatDay(row.sourceDate))}">Yaz 2026</span>`;
    const season = row.season && row.season !== "2026/27" ? `<small>${escapeHtml(row.season)} sezonu</small>` : "";
    const typeNote = row.typeNote ? `<small>${escapeHtml(row.typeNote)}</small>` : "";
    const fee = row.fee ? `<small>Bedel: ${escapeHtml(row.fee)}</small>` : "";
    const search = `${row.playerName} ${row.fromTeam} ${row.toTeam}`.toLocaleLowerCase("tr-TR");
    return `<tr${row.anchor ? ` id="${escapeHtml(row.anchor)}"` : ""} data-tr-type="${typeGroup(row.type)}" data-tr-search="${escapeHtml(search)}">
          <th scope="row" data-label="Oyuncu">${escapeHtml(row.playerName)}</th>
          <td data-label="Eski kulüp">${escapeHtml(row.fromTeam)}</td>
          <td data-label="Yeni kulüp">${escapeHtml(row.toTeam)}</td>
          <td data-label="Tip"><span class="tr-type">${escapeHtml(row.type)}</span>${typeNote}${fee}</td>
          <td data-label="Tarih">${dateCell}${season}</td>
          <td data-label="Kaynak">${sourceLink(row)}</td>
        </tr>`;
  }).join("\n        ");
  return `<div class="tr-table-wrap">
      <table class="tr-table">
        <caption class="tr-sr">${escapeHtml(league.name)} resmi transferleri</caption>
        <thead><tr><th scope="col">Oyuncu</th><th scope="col">Eski kulüp</th><th scope="col">Yeni kulüp</th><th scope="col">Bonservis / kiralık</th><th scope="col">Tarih</th><th scope="col">Kaynak</th></tr></thead>
        <tbody>
        ${rows}
        </tbody>
      </table>
    </div>
    <p class="tr-empty" data-tr-nomatch hidden>Filtreye uyan resmi transfer yok.</p>`;
}

function rumourList(items, emptyText) {
  if (!items.length) return `<p class="tr-empty" data-tr-empty>${escapeHtml(emptyText)}</p>`;
  return `<ul class="tr-rumours">${items.map((item) => {
    const text = item.url
      ? `<a href=".${escapeHtml(item.url)}">${escapeHtml(item.text)}</a>`
      : escapeHtml(item.text);
    return `<li class="tr-rumour" data-tr-rumour data-expires="${escapeHtml(item.expiresAt)}"><span class="tr-tag">Söylenti</span><p>${text}</p><small>Kaynak: ${sourceLink(item)} · <time datetime="${escapeHtml(item.date)}">${escapeHtml(formatDateTime(item.date))}</time></small></li>`;
  }).join("")}</ul>
    <p class="tr-empty" data-tr-rumour-empty hidden>Güncelleniyor — yayında söylenti kalmadı (söylentiler en fazla 72 saat gösterilir).</p>`;
}

function januaryBlock(league) {
  const window = league.january;
  const dates = window
    ? `<p class="tr-window"><strong>${escapeHtml(formatDay(window.opens))} – ${escapeHtml(formatDay(window.closes))}</strong>${window.closesNote ? ` <small>(kapanış ${escapeHtml(window.closesNote)})</small>` : ""} · Kaynak: ${sourceLink(window)}</p>`
    : `<p class="tr-window">Pencere tarihleri: <strong>Güncelleniyor</strong> — resmî kaynakta doğrulanınca eklenecek.</p>`;
  const januaryRumours = league.rumours.filter((item) => item.january);
  return `${dates}
      <p class="tr-note">Ocak 2027 resmi transferleri: <strong>Güncelleniyor</strong> — pencere açılıp kulüpler duyurdukça bu bölüme eklenir.</p>
      ${januaryRumours.length ? `<h4>Ocak dönemine dönük söylentiler</h4>${rumourList(januaryRumours, "")}` : ""}`;
}

function transferBansBlock(bans) {
  if (!bans) return "";
  const rows = bans.items.map((ban) => {
    const extras = ban.extraSources.map((extra) => ` · ${sourceLink(extra)}`).join("");
    return `<li class="tr-ban" id="${escapeHtml(ban.id)}">
          <p class="tr-ban-head"><strong>${escapeHtml(ban.club)}</strong> <small>${escapeHtml(ban.league)}</small> <span class="tr-ban-dur">${escapeHtml(ban.duration)}</span></p>
          <p>“${escapeHtml(ban.text)}”</p>
          <small>Kaynak: ${sourceLink(ban)}${extras}</small>
        </li>`;
  }).join("\n        ");
  const xLink = bans.xPostUrl
    ? `<p class="tr-note">FutbolRadar X paylaşımı (ek bağlantı, kaynak değildir): <a href="${escapeHtml(bans.xPostUrl)}" target="_blank" rel="${SOURCE_LINK_REL}">@Futbolradarcom</a></p>`
    : "";
  return `<div class="tr-block tr-bans" data-tr-bans>
      <h3><span class="tr-tag tr-tag--ban">FIFA</span> FIFA transfer yasakları</h3>
      <p class="tr-note">Bu bir transfer değildir; FIFA'nın kayıt (transfer) yasağı listesine ilişkin haberdir. ${escapeHtml(bans.headline)} — <time datetime="${escapeHtml(bans.date)}">${escapeHtml(formatDay(bans.date))}</time>.</p>
      <ul class="tr-ban-list">
        ${rows}
      </ul>
      ${xLink}
      <p class="tr-note"><a href="./transfer-donemi-2026-27.html">Transfer dönemi 2026-27: tarihler ve FIFA yasakları</a></p>
    </div>`;
}

function leagueSection(league, index) {
  const id = `lig-${league.id}`;
  return `<section class="tr-league" id="${id}" data-tr-league="${escapeHtml(league.id)}" role="tabpanel" aria-labelledby="tab-${id}" tabindex="-1">
    <header class="tr-league-head">
      <h2>${escapeHtml(league.name)} transferleri</h2>
      <a class="tr-league-link" href="./${escapeHtml(league.leaguePage)}">${escapeHtml(league.name)} sayfası</a>
    </header>
    ${transferBansBlock(league.transferBans)}
    <div class="tr-block tr-official">
      <h3><span class="tr-tag tr-tag--ok">Resmi</span> Resmi transferler <small>(${league.official.length})</small></h3>
      ${officialTable(league)}
    </div>
    <div class="tr-block tr-rumour-block">
      <h3><span class="tr-tag">Söylenti</span> Güçlü söylentiler <small>(${league.rumours.length})</small></h3>
      <p class="tr-note">Söylentiler resmi transfer DEĞİLDİR; kaynak yayın adıyla, en fazla 72 saat gösterilir.</p>
      ${rumourList(league.rumours, "Güncelleniyor — son 72 saatte izinli bir kaynakta bu lige dair güçlü söylenti bulunmadı.")}
    </div>
    <div class="tr-block tr-january">
      <h3>Ocak 2027 ara transfer dönemi</h3>
      ${januaryBlock(league)}
    </div>
  </section>`;
}

const INLINE_CSS = `
.tr-page .tr-hero{padding:16px 0 8px}
.tr-page .tr-hero h1{margin:4px 0 8px;font-size:clamp(1.6rem,5vw,2.4rem)}
.tr-page .tr-hero p{margin:0 0 8px;max-width:70ch}
.tr-updated{display:inline-block;margin:0 0 12px;padding:4px 10px;border-radius:999px;background:rgba(11,143,90,.1);color:var(--green-deep,#086a43);font-weight:700;font-size:.875rem}
.tr-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 12px;font-size:.8125rem;color:var(--muted,#55606e)}
.tr-tabs{position:sticky;top:0;z-index:5;display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:8px 0;margin:0 0 8px;background:var(--bg,#fff)}
.tr-tabs::-webkit-scrollbar{display:none}
.tr-tab{flex:0 0 auto;min-height:40px;padding:6px 14px;border:1px solid var(--line,#d7dde4);border-radius:999px;background:var(--card,#fff);color:inherit;font:inherit;font-weight:700;font-size:.875rem;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.tr-tab[aria-selected="true"]{background:var(--green-deep,#086a43);border-color:var(--green-deep,#086a43);color:#fff}
.tr-tools{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.tr-tools input,.tr-tools select{min-height:40px;padding:6px 10px;border:1px solid var(--line,#d7dde4);border-radius:10px;font:inherit;font-size:16px;background:var(--card,#fff);color:inherit;min-width:0}
.tr-tools input{flex:1 1 180px}
.tr-tools select{flex:0 1 160px}
.tr-league{margin:0 0 28px;scroll-margin-top:64px}
.tr-league-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px}
.tr-league-head h2{margin:8px 0}
.tr-league-link{font-size:.875rem;font-weight:700}
.tr-block{margin:0 0 18px;padding:12px;border:1px solid var(--line,#d7dde4);border-radius:14px;background:var(--card,#fff)}
.tr-block h3{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 10px;font-size:1.05rem}
.tr-block h3 small{font-weight:600;color:var(--muted,#55606e)}
.tr-block h4{margin:12px 0 6px;font-size:.95rem}
.tr-tag{display:inline-block;padding:2px 8px;border-radius:999px;background:#fff1d6;color:#8a4b00;font-size:.75rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase}
.tr-tag--ok{background:rgba(11,143,90,.12);color:var(--green-deep,#086a43)}
.tr-note{margin:0 0 8px;font-size:.8125rem;color:var(--muted,#55606e)}
.tr-empty{margin:0;padding:10px;border-radius:10px;background:var(--soft,#f4f6f8);font-size:.9rem}
.tr-table-wrap{width:100%}
.tr-table{width:100%;border-collapse:collapse;font-size:.9rem}
.tr-table th,.tr-table td{padding:8px 6px;border-bottom:1px solid var(--line,#e3e7ec);text-align:left;vertical-align:top}
.tr-table thead th{font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;color:var(--muted,#55606e)}
.tr-table td small{display:block;color:var(--muted,#55606e);font-size:.75rem}
.tr-table tr:target{background:rgba(11,143,90,.08)}
.tr-type{font-weight:700}
.tr-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tr-rumours{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.tr-rumour{padding:10px;border-left:4px solid #f0a020;border-radius:8px;background:#fffaf0}
.tr-rumour p{margin:6px 0 4px;overflow-wrap:anywhere}
.tr-rumour small{color:var(--muted,#55606e)}
.tr-window{margin:0 0 6px}
.tr-src{overflow-wrap:anywhere}
.tr-bans{border-color:#e7b4b4;background:#fff7f7}
.tr-tag--ban{background:#fde2e2;color:#9b1c1c}
.tr-ban-list{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:8px}
.tr-ban{padding:10px;border-left:4px solid #c53030;border-radius:8px;background:var(--card,#fff)}
.tr-ban p{margin:0 0 4px;overflow-wrap:anywhere}
.tr-ban-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}
.tr-ban-head small{color:var(--muted,#55606e)}
.tr-ban-dur{font-size:.8125rem;font-weight:800;color:#9b1c1c}
.tr-ban small{color:var(--muted,#55606e)}
[data-theme="dark"] .tr-bans{background:rgba(197,48,48,.08)}
[data-theme="dark"] .tr-ban{background:transparent}
[data-theme="dark"] .tr-tag--ban,[data-theme="dark"] .tr-ban-dur{color:#ffb4b4}
[data-theme="dark"] .tr-rumour{background:rgba(240,160,32,.08)}
[data-theme="dark"] .tr-tag{background:rgba(240,160,32,.2);color:#ffd28a}
@media (max-width:720px){
  .tr-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .tr-table,.tr-table tbody,.tr-table tr,.tr-table th,.tr-table td{display:block;width:100%}
  .tr-table tr{padding:8px 0;border-bottom:1px solid var(--line,#e3e7ec)}
  .tr-table th,.tr-table td{border:0;padding:2px 0;display:grid;grid-template-columns:92px minmax(0,1fr);gap:8px}
  .tr-table th[scope="row"]{font-size:1rem}
  .tr-table th::before,.tr-table td::before{content:attr(data-label);font-size:.75rem;font-weight:700;color:var(--muted,#55606e);text-transform:uppercase}
  .tr-table td small{grid-column:2}
}
`;

const INLINE_JS = `
(function(){
  var root=document.querySelector("[data-transfer-radar]");if(!root)return;
  var now=Date.now();
  root.querySelectorAll("[data-tr-rumour]").forEach(function(li){var e=Date.parse(li.getAttribute("data-expires"));if(isFinite(e)&&e<=now)li.remove();});
  root.querySelectorAll(".tr-rumours").forEach(function(ul){if(!ul.children.length){ul.hidden=true;var p=ul.nextElementSibling;if(p&&p.hasAttribute("data-tr-rumour-empty"))p.hidden=false;var h=ul.previousElementSibling;if(h&&h.tagName==="H4")h.hidden=true;}});
  var tabs=[].slice.call(root.querySelectorAll("[data-tr-tab]"));
  var panels=[].slice.call(root.querySelectorAll("[data-tr-league]"));
  var q=root.querySelector("[data-tr-q]"),type=root.querySelector("[data-tr-type-filter]");
  function select(id,focus){
    if(!panels.some(function(p){return p.getAttribute("data-tr-league")===id;}))id=panels[0].getAttribute("data-tr-league");
    tabs.forEach(function(t){var on=t.getAttribute("data-tr-tab")===id;t.setAttribute("aria-selected",on?"true":"false");t.tabIndex=on?0:-1;});
    panels.forEach(function(p){p.hidden=p.getAttribute("data-tr-league")!==id;});
    if(focus)tabs.filter(function(t){return t.getAttribute("data-tr-tab")===id;})[0].focus();
    filter();
  }
  function filter(){
    var term=(q&&q.value||"").toLocaleLowerCase("tr-TR").trim(),kind=type&&type.value||"";
    panels.forEach(function(p){var rows=p.querySelectorAll("tbody tr"),shown=0;rows.forEach(function(r){var ok=(!term||r.getAttribute("data-tr-search").indexOf(term)>-1)&&(!kind||r.getAttribute("data-tr-type")===kind);r.hidden=!ok;if(ok)shown++;});var nm=p.querySelector("[data-tr-nomatch]");if(nm)nm.hidden=!rows.length||shown>0;});
  }
  tabs.forEach(function(t,i){
    t.addEventListener("click",function(ev){ev.preventDefault();var id=t.getAttribute("data-tr-tab");select(id);if(history.replaceState)history.replaceState(null,"","#lig-"+id);});
    t.addEventListener("keydown",function(ev){var d=ev.key==="ArrowRight"?1:ev.key==="ArrowLeft"?-1:0;if(!d)return;ev.preventDefault();var n=tabs[(i+d+tabs.length)%tabs.length];select(n.getAttribute("data-tr-tab"),true);});
  });
  if(q)q.addEventListener("input",filter);if(type)type.addEventListener("change",filter);
  function fromHash(){
    var h=decodeURIComponent(location.hash.slice(1));
    if(h.indexOf("lig-")===0){select(h.slice(4));return;}
    var row=h&&document.getElementById(h);
    if(row){var p=row.closest("[data-tr-league]");if(p){select(p.getAttribute("data-tr-league"));row.scrollIntoView({block:"center"});return;}}
    select(panels[0].getAttribute("data-tr-league"));
  }
  window.addEventListener("hashchange",fromHash);
  root.classList.add("is-enhanced");fromHash();
})();
`;

export function renderTransferRadarPage(data) {
  const { leagues, updatedAt } = data;
  // Birden çok lige giren kayıt (ör. Barcola: PSG → Liverpool) bir kez sayılır.
  const totalOfficial = new Set(leagues.flatMap((league) => league.official.map((row) => row.id))).size;
  const totalRumours = new Set(leagues.flatMap((league) => league.rumours.map((row) => row.id))).size;
  const updatedLabel = formatDateTime(updatedAt);

  // ItemList: yalnızca resmi transferler (söylenti yapılandırılmış veriye girmez).
  const listItems = [];
  for (const league of leagues) {
    for (const row of league.official) {
      if (listItems.some((item) => item.key === row.id)) continue;
      listItems.push({ key: row.id, league, row });
    }
  }
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${PAGE_URL}#webpage`,
        name: "Transfer Radarı",
        headline: "Transfer Radarı 2026-2027",
        description: PAGE_DESCRIPTION,
        url: PAGE_URL,
        inLanguage: "tr-TR",
        dateModified: updatedAt,
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` },
        mainEntity: { "@id": `${PAGE_URL}#resmi-transferler` }
      },
      {
        "@type": "ItemList",
        "@id": `${PAGE_URL}#resmi-transferler`,
        name: "Resmi transferler — Süper Lig ve Avrupa'nın büyük ligleri (2026-2027)",
        numberOfItems: listItems.length,
        itemListElement: listItems.map(({ league, row }, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: `${row.playerName}: ${row.fromTeam} → ${row.toTeam} (${row.type})`,
          url: `${PAGE_URL}#${row.anchor || `lig-${league.id}`}`
        }))
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` },
          { "@type": "ListItem", position: 2, name: "Transfer Radarı", item: PAGE_URL }
        ]
      }
    ]
  };

  const tabs = leagues.map((league, index) => `<a class="tr-tab" role="tab" id="tab-lig-${escapeHtml(league.id)}" href="#lig-${escapeHtml(league.id)}" data-tr-tab="${escapeHtml(league.id)}" aria-controls="lig-${escapeHtml(league.id)}" aria-selected="${index === 0 ? "true" : "false"}">${escapeHtml(league.name)}</a>`).join("");

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(PAGE_TITLE)}</title>
    <meta name="description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <link rel="canonical" href="${PAGE_URL}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${PAGE_URL}" />
    <meta property="og:title" content="${escapeHtml(PAGE_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(PAGE_TITLE)}" />
    <meta name="twitter:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
    <style data-transfer-radar-css>${INLINE_CSS}</style>
  </head>
  <body class="subpage trend-seo-page tr-page">
    ${siteHeader({ base: "./" })}
    <main class="container" data-transfer-radar>
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><span>Transfer Radarı</span></nav>
      <header class="tr-hero">
        <span class="eyebrow">Süper Lig · Premier Lig · La Liga · Serie A · Bundesliga · Ligue 1</span>
        <h1>Transfer Radarı</h1>
        <p class="tr-updated">Son güncelleme: <time datetime="${escapeHtml(updatedAt)}">${escapeHtml(updatedLabel)}</time></p>
        <p>FutbolRadar transfer radarı, 2026-2027 sezonunda Süper Lig ile Avrupa'nın beş büyük liginin transferlerini tek ekranda toplar. Resmi transferler kulüp ya da lig duyurusuyla doğrulanır; söylentiler ayrı bölümde, "Söylenti" etiketi ve kaynak yayın adıyla gösterilir. Şu an ${totalOfficial} resmi kayıt ve ${totalRumours} güncel söylenti var.</p>
        <p class="tr-legend"><span><span class="tr-tag tr-tag--ok">Resmi</span> kulüp/lig duyurusu</span><span><span class="tr-tag">Söylenti</span> doğrulanmamış haber, en fazla 72 saat</span><span>Kaynağı olmayan haber eklenmez; bedel açıklanmadıysa yazılmaz.</span></p>
      </header>
      <nav class="tr-tabs" role="tablist" aria-label="Lig seç">${tabs}</nav>
      <div class="tr-tools" role="search">
        <label class="tr-sr" for="tr-q">Oyuncu veya kulüp ara</label>
        <input id="tr-q" type="search" placeholder="Oyuncu veya kulüp ara" autocomplete="off" data-tr-q />
        <label class="tr-sr" for="tr-type">Transfer tipi</label>
        <select id="tr-type" data-tr-type-filter>
          <option value="">Tüm tipler</option>
          <option value="bonservis">Bonservis</option>
          <option value="kiralik">Kiralık</option>
          <option value="serbest">Serbest / bedelsiz</option>
          <option value="ayrilik">Fesih / sözleşme sonu</option>
        </select>
      </div>
      ${leagues.map(leagueSection).join("\n      ")}
      <section class="tr-block">
        <h2>İlgili sayfalar</h2>
        <p><a href="./transfer-donemi-2026-27.html">Transfer dönemi 2026-27: tarihler ve FIFA yasakları</a> · <a href="./transfer-sezonu-ne-zaman-bitiyor.html">Transfer sezonu ne zaman bitiyor?</a> · <a href="./haberler.html">Son haberler</a> · <a href="./index.html">Ana sayfa</a></p>
      </section>
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
    <script data-transfer-radar-js>${INLINE_JS}</script>
  </body>
</html>
`;
}

/**
 * Site haritasına sayfayı ekler/günceller. Eskiden trend üreticisi bu sayfayı
 * haritaya ekliyordu; sayfa oradan çıkınca kayıt düşüyordu ve QA
 * ("sitemap missing …") derlemeyi durduruyordu. Aynı biçimle upsert edilir.
 */
function upsertSitemapEntry(root, lastmod) {
  const escapedLoc = PAGE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entry = new RegExp(`(<url>\\s*<loc>${escapedLoc}<\\/loc>\\s*<lastmod>)[^<]*(<\\/lastmod>)`);
  for (const file of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(file)) continue;
    const xml = fs.readFileSync(file, "utf8");
    let next;
    if (entry.test(xml)) next = xml.replace(entry, `$1${lastmod}$2`);
    else if (xml.includes(`<loc>${PAGE_URL}</loc>`)) next = xml;
    else next = xml.replace("</urlset>", `  <url>\n    <loc>${PAGE_URL}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n</urlset>`);
    if (next !== xml) fs.writeFileSync(file, next, "utf8");
  }
}

export function generateTransferRadarPage(root = process.cwd(), options = {}) {
  const data = buildTransferRadar(root, options);
  if (data.problems.length) {
    throw new Error(`[transfer-radar] kaynak/veri sorunu, sayfa üretilmedi:\n - ${data.problems.join("\n - ")}`);
  }
  const html = renderTransferRadarPage(data);
  fs.writeFileSync(path.join(root, PAGE_FILE), html, "utf8");
  if (fs.existsSync(path.join(root, "public"))) fs.writeFileSync(path.join(root, "public", PAGE_FILE), html, "utf8");
  if (options.sitemap !== false) upsertSitemapEntry(root, data.updatedAt.slice(0, 10));
  const counts = data.leagues.map((league) => `${league.name}: ${league.official.length} resmi / ${league.rumours.length} söylenti`).join(" · ");
  console.log(`[transfer-radar] ${PAGE_FILE} üretildi — ${counts}`);
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateTransferRadarPage(process.cwd(), { sitemap: !process.argv.includes("--no-sitemap") });
}
