/**
 * Büyük dört takım sayfaları için elle doğrulanmış güncellemeler
 * (data/team-updates/*.json) ve resmî transfer kayıtları (data/transfers.json).
 *
 * KURALLAR
 * - Her sonuç/transfer bir kaynak URL'si taşır ve kaynak ana bilgisayarı
 *   services/sourceLinks.js ALLOWED_SOURCE_HOSTS içinde olmalıdır; değilse atlanır.
 * - Kesinleşmemiş maç ("pending") skor olmadan "Güncelleniyor" olarak gösterilir.
 * - Transfer bölümü yalnızca status:"confirmed" kayıtları gösterir; söylenti üretilmez.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../../services/sourceLinks.js");
const { sameClub } = require("../../services/superLigTeams.js");

export const API_FOOTBALL_HOME = "https://www.api-football.com/";
export const SOURCE_REL = "nofollow noopener noreferrer";
const SEASON_WINDOW_START = "2026-06-01";

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };

export function isApiFootballUrl(url) {
  return /^https:\/\/(v3\.football\.api-sports\.io|www\.api-football\.com)\//.test(String(url || ""));
}

/** Kaynak gösterilebilir mi? API-Football uç noktaları onaylı sağlayıcıdır. */
// TheSportsDB editoryal kaynak olarak onaylı değil: listede (arşiv künyesi için)
// dursa da takım sayfalarında kaynak olarak gösterilmez.
const UNAPPROVED_FOR_TEAM_PAGES = /(^|\.)thesportsdb\.com$/;

export function usableSource(url) {
  if (isApiFootballUrl(url)) return true;
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return false; }
  return !UNAPPROVED_FOR_TEAM_PAGES.test(host) && isAllowedSourceUrl(url);
}

export function hostLabel(url) {
  if (isApiFootballUrl(url)) return "Veri: API-Football";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Kaynak"; }
}

/** Kaynak bağlantısı. API-Football ham uç noktası yerine sağlayıcının sitesine bağlanır. */
export function sourceLink(url, label) {
  if (!url) return "";
  const href = isApiFootballUrl(url) ? API_FOOTBALL_HOME : url;
  const text = isApiFootballUrl(url) ? "Veri: API-Football" : (label || hostLabel(url));
  return `<a href="${esc(href)}" rel="${SOURCE_REL}" target="_blank">${esc(text)}</a>`;
}

export function loadTeamUpdates(root) {
  const dir = path.join(root, "data", "team-updates");
  if (!fs.existsSync(dir)) return { updatedAt: null, results: [], pending: [], leaguePoints: [] };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const out = { updatedAt: null, results: [], pending: [], leaguePoints: [] };
  for (const f of files) {
    const d = readJson(path.join(dir, f), {});
    if (d.updatedAt && (!out.updatedAt || d.updatedAt > out.updatedAt)) out.updatedAt = d.updatedAt;
    for (const r of d.results || []) {
      const sources = (r.sources || []).filter(usableSource);
      if (!sources.length || !r.score || !Number.isFinite(r.score.home) || !Number.isFinite(r.score.away)) continue;
      out.results.push({ ...r, sources });
    }
    out.pending.push(...(d.pending || []));
    for (const p of d.leaguePoints || []) if (usableSource(p.source)) out.leaguePoints.push(p);
  }
  return out;
}

/** Güncelleme dosyasındaki maçları büyük-dört sonuç kaydı biçimine çevirir. */
export function updateResultsFor(updates, teamName) {
  return updates.results.filter((r) => sameClub(r.homeTeam, teamName) || sameClub(r.awayTeam, teamName)).map((r) => {
    const home = sameClub(r.homeTeam, teamName);
    const gf = home ? r.score.home : r.score.away;
    const ga = home ? r.score.away : r.score.home;
    return {
      id: r.id, date: r.date, kickoff: `${r.date}T23:59:00+03:00`, competition: r.competition, venue: home ? "İç saha" : "Deplasman",
      homeTeam: r.homeTeam, awayTeam: r.awayTeam, opponent: home ? r.awayTeam : r.homeTeam,
      score: { ...r.score }, goalsFor: gf, goalsAgainst: ga, result: gf > ga ? "G" : gf < ga ? "M" : "B",
      reportPage: null, sourceUrl: r.sources[0], sourceUrls: r.sources, sourceType: "haber-ya-da-kulup", note: r.note || null
    };
  });
}

export function pendingFor(updates, teamName) {
  return updates.pending.filter((r) => sameClub(r.homeTeam, teamName) || sameClub(r.awayTeam, teamName));
}

export function leaguePointsFor(updates, teamName) {
  return updates.leaguePoints.filter((p) => sameClub(p.team, teamName)).sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)))[0] || null;
}

/** 2026 yaz penceresinde resmîleşen, izinli kaynaklı transferler. */
// Kaynak, haberin kendisini göstermeli; yalnızca site ana sayfası (ör. /tr) kanıt sayılmaz.
function isArticleUrl(url) {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    return segments.filter((seg) => !/^[a-z]{2}$/i.test(seg)).length > 0;
  } catch {
    return false;
  }
}

export function confirmedTransfersFor(root, teamName) {
  const rows = readJson(path.join(root, "data", "transfers.json"), []);
  return rows
    .filter((r) => r.status === "confirmed" && String(r.date) >= SEASON_WINDOW_START && usableSource(r.sourceUrl) && isArticleUrl(r.sourceUrl))
    .filter((r) => sameClub(r.toTeam, teamName) || sameClub(r.fromTeam, teamName))
    .map((r) => ({ playerName: r.playerName, date: r.date, fromTeam: r.fromTeam, toTeam: r.toTeam, type: r.type, direction: sameClub(r.toTeam, teamName) ? "gelen" : "giden", sourceUrl: r.sourceUrl }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function transferWindowNote(root, today) {
  const w = readJson(path.join(root, "data", "transfer-window.json"), { windows: [] }).windows || [];
  const next = w.find((x) => String(x.opensAt).slice(0, 10) > today);
  const last = [...w].reverse().find((x) => String(x.closesAt).slice(0, 10) <= today);
  return { closedAt: last ? String(last.closesAt).slice(0, 10) : null, nextOpensAt: next ? String(next.opensAt).slice(0, 10) : null, nextLabel: next?.label || null };
}

const RESULT_TR = { G: "Galibiyet", B: "Beraberlik", M: "Mağlubiyet" };

/** Mobil öncelikli sonuç kartları (tablo yok → 390 px'te yatay kaydırma yok). */
export function resultsListHtml(items, { reportBase = "" } = {}) {
  return `<ol class="evergreen-results">${items.map((r) => {
    const links = (r.sourceUrls || [r.sourceUrl]).filter(Boolean).map((u) => sourceLink(u)).join(" · ");
    const report = r.reportPage ? `<a href="${esc(reportBase + String(r.reportPage).replace(/^https:\/\/www\.futbolradar\.com\//, ""))}">Maç raporu</a> · ` : "";
    return `<li data-result="${esc(r.result)}"><p><time datetime="${esc(r.date)}">${esc(r.date)}</time> · ${esc(r.competition || "—")} · <strong>${RESULT_TR[r.result] || ""}</strong></p><p><strong>${esc(r.homeTeam)} ${r.score.home}-${r.score.away} ${esc(r.awayTeam)}</strong></p>${r.note ? `<p class="evergreen-note">${esc(r.note)}</p>` : ""}<p>${report}${links}</p></li>`;
  }).join("")}</ol>`;
}

export function pendingListHtml(items) {
  if (!items.length) return "";
  return `<ul class="evergreen-results">${items.map((p) => `<li data-status="guncelleniyor"><p><time datetime="${esc(p.date)}">${esc(p.date)}</time> · ${esc(p.competition)}</p><p><strong>${esc(p.homeTeam)} – ${esc(p.awayTeam)}</strong>: Güncelleniyor</p><p class="evergreen-note">${esc(p.note || "")}</p></li>`).join("")}</ul>`;
}

export function transfersHtml(teamName, transfers, windowNote) {
  const closed = windowNote.closedAt
    ? `<p class="evergreen-note"><strong>Transfer dönemi kapalı.</strong> 2026 yaz tescil dönemi ${esc(windowNote.closedAt)} tarihinde kapandı${windowNote.nextOpensAt ? `; ${esc(windowNote.nextLabel || "ara transfer dönemi")} ${esc(windowNote.nextOpensAt)} tarihinde açılıyor` : ""}. Bu nedenle aşağıda yalnızca resmîleşmiş transferler var; doğrulanmamış iddia yayımlanmaz.</p>`
    : "";
  if (!transfers.length) return `${closed}<p class="evergreen-note" data-status="veri-bekleniyor">${esc(teamName)} için kaynaklı resmî transfer kaydı: Güncelleniyor.</p>`;
  const item = (t) => `<li><p><time datetime="${esc(t.date)}">${esc(t.date)}</time> · ${esc(t.type || "Transfer")}</p><p><strong>${esc(t.playerName)}</strong> · ${esc(t.fromTeam)} → ${esc(t.toTeam)}</p><p>${sourceLink(t.sourceUrl)}</p></li>`;
  const inn = transfers.filter((t) => t.direction === "gelen");
  const out = transfers.filter((t) => t.direction === "giden");
  return `${closed}${inn.length ? `<h3>Gelenler (${inn.length})</h3><ul class="evergreen-results">${inn.map(item).join("")}</ul>` : ""}${out.length ? `<h3>Gidenler (${out.length})</h3><ul class="evergreen-results">${out.map(item).join("")}</ul>` : ""}`;
}
