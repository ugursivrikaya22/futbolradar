#!/usr/bin/env node
/**
 * BÜYÜK DÖRT VERİ SAYFALARI + KÖŞE YAZARI VERİ BESLEMESİ.
 *
 * Galatasaray, Fenerbahçe, Beşiktaş ve Trabzonspor için dört kalıcı sayfa:
 *   takimlar/<slug>/kadro.html · istatistikler.html · mac-sonuclari.html · tarihce.html
 * ve Köşe yazarı ajanı için makine okunur besleme:
 *   data/kose-feed/<slug>.json + data/kose-feed/index.json
 *
 * KURALLAR
 * - Yalnızca depoda ZATEN bulunan veriler okunur; ağ çağrısı yapılmaz.
 * - Her kayıt bir kaynak URL'si taşır. Kaynak URL'si gösterilemeyen maç
 *   kaydı listelenmez (sayısı beslemede `excludedWithoutSource` olarak durur).
 * - Depoda karşılığı olmayan bölüm (kuruluş, kupalar, stadyum…) UYDURULMAZ;
 *   sayfada "Güncelleniyor — veri bekleniyor", beslemede `status: "veri-bekleniyor"`.
 * - İngilizce karşılık bulunmadığı için hreflang yazılmaz (tek yönlü alternate
 *   Google tarafından yok sayılır).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { sameClub } = require("../services/superLigTeams.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const API = "https://v3.football.api-sports.io";
const LEAGUE_ID = "203";
const SECTIONS = [
  { key: "kadro", label: "Kadro" },
  { key: "istatistikler", label: "İstatistikler" },
  { key: "mac-sonuclari", label: "Maç Sonuçları" },
  { key: "tarihce", label: "Tarihçe" }
];
export const BIG_FOUR = [
  { slug: "galatasaray", name: "Galatasaray" },
  { slug: "fenerbahce", name: "Fenerbahçe" },
  { slug: "besiktas", name: "Beşiktaş" },
  { slug: "trabzonspor", name: "Trabzonspor" }
];
// Tüm Süper Lig takımları: slug = takimlar/<slug>.html profil dosyası.
export const ALL_TEAMS = [
  ...BIG_FOUR,
  { slug: "samsunspor", name: "Samsunspor" }, { slug: "basaksehir", name: "Başakşehir" },
  { slug: "konyaspor", name: "Konyaspor" }, { slug: "goztepe", name: "Göztepe" },
  { slug: "alanyaspor", name: "Alanyaspor" }, { slug: "genclerbirligi", name: "Gençlerbirliği" },
  { slug: "kasimpasa", name: "Kasımpaşa" }, { slug: "rizespor", name: "Rizespor" },
  { slug: "erzurumspor", name: "Erzurumspor" }, { slug: "gaziantep-fk", name: "Gaziantep FK" },
  { slug: "amed", name: "Amed" }, { slug: "eyupspor", name: "Eyüpspor" },
  { slug: "corum-fk", name: "Çorum FK" }, { slug: "kocaelispor", name: "Kocaelispor" }
];
const PENDING = "Güncelleniyor — veri bekleniyor";

const exists = (rel) => fs.existsSync(path.join(root, rel));
const readJson = (rel, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
};
const teams = readJson("data/teams.json", []);
const squads = readJson("data/super-lig-squads.json", []);
const leaders = readJson("data/league-leaders.json", {});
const managers = readJson("data/managers.json", {});
const archive = readJson("data/historical-match-archive.json", { records: [] });
const matchesFile = readJson("data/matches.json", []);
const clubHistory = readJson("data/club-history-sources.json", { clubs: {} });
const leagueHistory = readJson("data/evergreen-history-sources.json", { champions: [], source: {} });
const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const trDate = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return m ? `${d} ${TR_MONTHS[m - 1]} ${y}` : `${y} yılında`; };
const wikiRev = (oldid) => `https://en.wikipedia.org/w/index.php?oldid=${oldid}`;
const slugMap = new Map((readJson("data/player-url-slugs.json", {}).entries || []).map((e) => [e.id, e.slug]));
// Lider kaydındaki kimlik (ör. v-muriqi-fenerbahce) kalıcı futbolcu adresine çevrilir; sayfa yoksa bağlantı verilmez.
function playerProfile(id) {
  const slug = slugMap.get(id) || id;
  return id && exists(`futbolcu/${slug}.html`) ? `${siteUrl}/futbolcu/${slug}` : null;
}

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const num = (v) => (Number.isFinite(v) ? v : null);
const POS_TR = { Goalkeeper: "Kaleci", Defender: "Defans", Midfielder: "Orta saha", Attacker: "Forvet" };
const POS_ORDER = ["Goalkeeper", "Defender", "Midfielder", "Attacker"];

function seasonParam(team) {
  // "2026/27" → API-Football sezon parametresi "2026".
  const m = /^(\d{4})/.exec(String(team?.standingsSeason || leaders.season || ""));
  return m ? m[1] : null;
}

function standingsSource(team) {
  const season = seasonParam(team);
  return season ? `${API}/standings?league=${LEAGUE_ID}&season=${season}` : null;
}

function teamResults(teamName) {
  const pool = [
    ...(archive.records || []).map((r) => r.match).filter(Boolean),
    ...(Array.isArray(matchesFile) ? matchesFile : [])
  ];
  const byKey = new Map();
  let excluded = 0;
  for (const m of pool) {
    if (m.status !== "FINISHED") continue;
    if (!m.score || !Number.isFinite(m.score.home) || !Number.isFinite(m.score.away)) continue;
    const home = sameClub(m.homeTeam, teamName);
    const away = sameClub(m.awayTeam, teamName);
    if (!home && !away) continue;
    const date = String(m.kickoff || "").slice(0, 10);
    const opponent = home ? m.awayTeam : m.homeTeam;
    const key = `${date}|${String(opponent).toLocaleLowerCase("tr").replace(/[^a-z0-9çğıöşü]/g, "").slice(0, 6)}`;
    const urls = Array.isArray(m.sourceUrls) ? m.sourceUrls.filter((u) => /^https?:\/\//.test(u)) : [];
    const providerId = m.providerIds?.apiFootball || m.providerId || null;
    const sourceUrl = urls[0] || (providerId ? `${API}/fixtures?id=${providerId}` : null);
    const record = {
      id: m.id,
      date,
      kickoff: m.kickoff || null,
      competition: m.competition || m.league || null,
      venue: home ? "İç saha" : "Deplasman",
      stadium: m.venue || null,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      opponent,
      score: { home: m.score.home, away: m.score.away },
      goalsFor: home ? m.score.home : m.score.away,
      goalsAgainst: home ? m.score.away : m.score.home,
      result: null,
      reportPage: m.reportPage && exists(m.reportPage) ? `${siteUrl}/${m.reportPage}` : null,
      sourceUrl,
      sourceType: urls[0] ? "resmi-ya-da-yayin" : "api-football"
    };
    record.result = record.goalsFor > record.goalsAgainst ? "G" : record.goalsFor < record.goalsAgainst ? "M" : "B";
    const prev = byKey.get(key);
    // Aynı maçın iki kaydı varsa yayın/kulüp kaynaklı olan tercih edilir.
    if (!prev || (!prev.sourceUrl && record.sourceUrl) || (prev.sourceType === "api-football" && record.sourceType !== "api-football" && record.sourceUrl)) {
      byKey.set(key, { ...prev, ...record, reportPage: record.reportPage || prev?.reportPage || null });
    }
  }
  const all = [...byKey.values()].sort((a, b) => String(b.kickoff).localeCompare(String(a.kickoff)));
  const withSource = all.filter((r) => r.sourceUrl);
  excluded = all.length - withSource.length;
  return { results: withSource, excluded };
}

function buildTeamData({ slug, name }) {
  const team = teams.find((t) => t.id === slug || sameClub(t.name, name)) || null;
  const squad = squads.find((s) => sameClub(s.teamName, name)) || null;
  const season = seasonParam(team);
  const stSrc = standingsSource(team);
  const { results, excluded } = teamResults(name);

  const standings = team && stSrc && Number.isFinite(team.played)
    ? {
        status: "ok",
        season: team.standingsSeason || null,
        rank: num(team.rank), played: num(team.played), won: num(team.won), drawn: num(team.drawn), lost: num(team.lost),
        goalsFor: num(team.goalsFor), goalsAgainst: num(team.goalsAgainst), goalDifference: num(team.goalDifference), points: num(team.points),
        syncedAt: team.lastStandingsSyncedAt || null,
        sourceUrl: stSrc, sourceName: "API-Football /standings"
      }
    : { status: "veri-bekleniyor" };

  const leagueForm = team && Array.isArray(team.form) && team.form.length && stSrc
    ? { status: "ok", last: team.form.map((f) => f.label), note: "Süper Lig son maçlar (soldan sağa, sağlayıcı sırası)", sourceUrl: stSrc, sourceName: "API-Football /standings" }
    : { status: "veri-bekleniyor" };
  const recentAll = results.slice(0, 5);
  const allCompForm = recentAll.length
    ? { status: "ok", last: recentAll.map((r) => r.result), matches: recentAll.map((r) => ({ id: r.id, result: r.result, sourceUrl: r.sourceUrl })) }
    : { status: "veri-bekleniyor" };

  const leaderSrc = (kind) => (leaders.season ? `${API}/players/${kind}?league=${LEAGUE_ID}&season=${leaders.season}` : null);
  const pick = (list, kind) => (list || []).filter((p) => sameClub(p.team, name)).map((p) => ({
    name: p.name, rank: p.rank, goals: num(p.goals), assists: num(p.assists), appearances: num(p.appearances), minutes: num(p.minutes),
    profile: playerProfile(p.slug), sourceUrl: leaderSrc(kind), sourceName: `API-Football /players/${kind}`
  })).filter((p) => p.sourceUrl);
  const topScorers = pick(leaders.topScorers, "topscorers");
  const topAssists = pick(leaders.topAssists, "topassists");

  const squadSrc = squad?.teamId ? `${API}/players/squads?team=${squad.teamId}` : null;
  const players = squad && squadSrc ? (squad.players || []).map((p) => ({
    name: p.name, position: p.position || null, positionTr: POS_TR[p.position] || null, age: num(p.age), number: num(p.number), providerId: p.providerId || null, sourceUrl: squadSrc
  })) : [];
  const squadBlock = players.length
    ? { status: "ok", season: squad.season || season, syncedAt: squad.syncedAt || null, count: players.length, sourceUrl: squadSrc, sourceName: "API-Football /players/squads", players }
    : { status: "veri-bekleniyor" };

  const mgr = (managers.managers || []).find((m) => sameClub(m.team, name) && m.source?.url);
  const club = clubHistory.clubs?.[slug];
  const clubSrc = club ? { sourceName: `Wikipedia (EN) — ${club.source.title}, revizyon ${club.source.oldid}`, sourceUrl: wikiRev(club.source.oldid) } : null;
  const champSeasons = (leagueHistory.champions || []).filter((row) => sameClub(row.winner, name)).map((row) => row.season);
  const runnerUps = (leagueHistory.champions || []).filter((row) => sameClub(row.runnerUp, name)).length;
  const champSrc = leagueHistory.source?.champions;
  const history = {
    founded: club ? { status: "ok", date: club.founded, fullName: club.fullName, note: club.foundedNote || null, ...clubSrc } : { status: "veri-bekleniyor" },
    honours: champSrc && leagueHistory.champions?.length ? { status: "ok", superLigTitles: champSeasons.length, seasons: champSeasons, runnerUps, coverage: `${leagueHistory.champions[0].season} ile ${leagueHistory.champions.at(-1).season} arası`, sourceName: `Wikipedia (EN) — ${champSrc.title}, revizyon ${champSrc.oldid}`, sourceUrl: wikiRev(champSrc.oldid) } : { status: "veri-bekleniyor" },
    stadium: club ? { status: "ok", name: club.stadium, capacity: club.capacity, ...clubSrc } : { status: "veri-bekleniyor" },
    colours: { status: "veri-bekleniyor" },
    currentManager: mgr
      ? { status: "ok", name: mgr.manager, appointedAt: mgr.appointedAt || null, note: mgr.note || null, confidence: mgr.confidence || null, sourceName: mgr.source.name, sourceUrl: mgr.source.url, publishedAt: mgr.source.publishedAt || null }
      : { status: "veri-bekleniyor" }
  };

  const played = results.length;
  const sum = (k) => results.reduce((a, r) => a + r[k], 0);
  const resultsSummary = played
    ? { status: "ok", matches: played, won: results.filter((r) => r.result === "G").length, drawn: results.filter((r) => r.result === "B").length, lost: results.filter((r) => r.result === "M").length, goalsFor: sum("goalsFor"), goalsAgainst: sum("goalsAgainst"), note: "Arşivdeki kaynaklı tüm resmî ve hazırlık maçları" }
    : { status: "veri-bekleniyor" };

  return {
    slug, name, season: team?.standingsSeason || null,
    pages: Object.fromEntries(SECTIONS.map((s) => [s.key, `${siteUrl}/takimlar/${slug}/${s.key}.html`])),
    teamPage: `${siteUrl}/takimlar/${slug}`,
    standings, form: { league: leagueForm, allCompetitions: allCompForm },
    stats: { standings, resultsSummary, topScorers, topAssists },
    results: { status: results.length ? "ok" : "veri-bekleniyor", excludedWithoutSource: excluded, items: results },
    squad: squadBlock,
    history
  };
}

// ---------- HTML ----------
const pending = (label) => `<p class="evergreen-note" data-status="veri-bekleniyor"><strong>${esc(label)}:</strong> ${PENDING}</p>`;
const src = (url, label = "Kaynak") => (url ? `<a href="${esc(url)}" rel="nofollow noopener noreferrer" target="_blank">${esc(label)}</a>` : "");
const table = (caption, heads, rows) => `<div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${esc(caption)}</caption><thead><tr>${heads.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
const section = (id, title, body) => `<section class="evergreen-section" aria-labelledby="${id}"><h2 id="${id}">${esc(title)}</h2>${body}</section>`;

function sectionNav(d, current) {
  return `<nav class="evergreen-related" aria-label="${esc(d.name)} veri sayfaları"><h2>${esc(d.name)} veri sayfaları</h2><ul class="evergreen-link-list">${SECTIONS.map((s) =>
    s.key === current ? `<li><span aria-current="page">${esc(s.label)}</span></li>` : `<li><a href="./${s.key}.html">${esc(d.name)} ${esc(s.label.toLocaleLowerCase("tr"))}</a></li>`).join("")}
    <li><a href="../${d.slug}">${esc(d.name)} takım profili</a></li>${[["form-durumu", "form durumu"], ["maclari", "maçları"], ["puan-durumu", "puan durumu"]].filter(([k]) => exists(`${d.slug}-${k}.html`)).map(([k, l]) => `<li><a href="../../${d.slug}-${k}.html">${esc(d.name)} ${l}</a></li>`).join("")}${exists("super-lig-puan-durumu.html") ? `<li><a href="../../super-lig-puan-durumu.html">Süper Lig puan durumu</a></li>` : ""}${exists("super-lig-bu-hafta.html") ? `<li><a href="../../super-lig-bu-hafta.html">Süper Lig bu hafta</a></li>` : ""}</ul>
    <p>${BIG_FOUR.some((t) => t.slug === d.slug) ? "Diğer büyükler" : "Diğer Süper Lig takımları"}: ${(BIG_FOUR.some((t) => t.slug === d.slug) ? BIG_FOUR : ALL_TEAMS).filter((t) => t.slug !== d.slug).map((t) => `<a href="../${t.slug}/${current}.html">${esc(t.name)}</a>`).join(" · ")}</p></nav>`;
}

function kadroContent(d) {
  if (d.squad.status !== "ok") return section("kadro", "Kadro", pending("Kadro"));
  const groups = POS_ORDER.map((pos) => [pos, d.squad.players.filter((p) => p.position === pos)]).filter(([, l]) => l.length);
  const other = d.squad.players.filter((p) => !POS_ORDER.includes(p.position));
  const body = groups.map(([pos, list]) => table(`${POS_TR[pos]} (${list.length})`, ["Oyuncu", "Yaş", "Forma"], list.map((p) => `<tr><th scope="row">${esc(p.name)}</th><td>${p.age ?? "—"}</td><td>${p.number ?? "—"}</td></tr>`))).join("")
    + (other.length ? table("Mevkisi kayıtlı olmayan", ["Oyuncu", "Yaş", "Forma"], other.map((p) => `<tr><th scope="row">${esc(p.name)}</th><td>${p.age ?? "—"}</td><td>${p.number ?? "—"}</td></tr>`)) : "");
  return section("kadro", `${d.name} kadrosu (${d.squad.count} oyuncu)`, `${body}<p class="evergreen-source">Kaynak: ${src(d.squad.sourceUrl, d.squad.sourceName)} · Senkron: ${esc(String(d.squad.syncedAt || "").slice(0, 10))}. Forma numarası sağlayıcıda yoksa "—" gösterilir.</p>`);
}

function statsContent(d) {
  const s = d.stats.standings;
  const st = s.status === "ok" ? table(`${d.name} ${s.season} Süper Lig`, ["Gösterge", "Değer"], [
    ["Sıra", s.rank], ["Oynanan", s.played], ["Galibiyet", s.won], ["Beraberlik", s.drawn], ["Mağlubiyet", s.lost], ["Atılan gol", s.goalsFor], ["Yenilen gol", s.goalsAgainst], ["Averaj", s.goalDifference], ["Puan", s.points]
  ].map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v ?? "—"}</td></tr>`)) + `<p class="evergreen-source">Kaynak: ${src(s.sourceUrl, s.sourceName)}</p>` : pending("Lig istatistikleri");
  const f = d.form.league;
  const form = f.status === "ok" ? `<p class="evergreen-form" aria-label="Son maçlar">${f.last.map((x) => `<b data-form="${esc(x)}">${esc(x)}</b>`).join(" ")}</p><p class="evergreen-source">${esc(f.note)} · Kaynak: ${src(f.sourceUrl, f.sourceName)}</p>` : pending("Form");
  const lead = (list, label, key) => (list.length ? table(label, ["Oyuncu", key === "goals" ? "Gol" : "Asist", "Maç", "Kaynak"], list.map((p) => `<tr><th scope="row">${p.profile ? `<a href="${esc(p.profile.replace(siteUrl, "../.."))}">${esc(p.name)}</a>` : esc(p.name)}</th><td>${p[key] ?? "—"}</td><td>${p.appearances ?? "—"}</td><td>${src(p.sourceUrl)}</td></tr>`)) : pending(label));
  const r = d.stats.resultsSummary;
  const rs = r.status === "ok" ? table("Arşivdeki kaynaklı maçlar (tüm turnuvalar)", ["Gösterge", "Değer"], [["Maç", r.matches], ["G-B-M", `${r.won}-${r.drawn}-${r.lost}`], ["Gol", `${r.goalsFor}-${r.goalsAgainst}`]].map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`)) : pending("Maç özeti");
  return section("lig", "Lig istatistikleri", st) + section("form", "Form durumu", form) + section("liderler", "Gol ve asist liderleri", lead(d.stats.topScorers, "Gol krallığındaki oyuncular", "goals") + lead(d.stats.topAssists, "Asist listesindeki oyuncular", "assists")) + section("ozet", "Maç özeti", rs)
    + section("ileri", "İleri istatistikler", pending("xG, topa sahip olma ve şut ortalamaları"));
}

function resultsContent(d) {
  if (d.results.status !== "ok") return section("sonuclar", "Maç sonuçları", pending("Maç sonuçları"));
  // Mobil öncelikli: 390 px'te yatay kaydırma gerektiren tablo yerine kart listesi.
  const items = d.results.items.map((r) => `<li data-result="${r.result}"><p><time datetime="${esc(r.date)}">${esc(r.date)}</time> · ${esc(r.competition || "—")} · <strong>${r.result === "G" ? "Galibiyet" : r.result === "M" ? "Mağlubiyet" : "Beraberlik"}</strong></p><p><strong>${esc(r.homeTeam)} ${r.score.home}-${r.score.away} ${esc(r.awayTeam)}</strong></p><p>${r.reportPage ? `<a href="${esc(r.reportPage.replace(siteUrl, "../.."))}">Maç raporu</a> · ` : ""}${src(r.sourceUrl)}</p></li>`).join("");
  const note = d.results.excludedWithoutSource ? `<p class="evergreen-note">${d.results.excludedWithoutSource} maç kaynak URL'si olmadığı için listelenmedi.</p>` : "";
  return section("sonuclar", `${d.name} maç sonuçları (${d.results.items.length})`, `<ol class="evergreen-results">${items}</ol>` + note);
}

function historyContent(d) {
  const h = d.history;
  const mgr = h.currentManager.status === "ok"
    ? `<p>Teknik direktör: <strong>${esc(h.currentManager.name)}</strong>${h.currentManager.appointedAt ? ` (göreve başlama: ${esc(h.currentManager.appointedAt)})` : ""}. ${esc(h.currentManager.note || "")}</p><p class="evergreen-source">Kaynak: ${src(h.currentManager.sourceUrl, h.currentManager.sourceName)}</p>`
    : pending("Teknik direktör");
  const f = h.founded;
  const founded = f.status === "ok"
    ? `<p>${esc(f.fullName)}, <time datetime="${esc(f.date)}">${esc(trDate(f.date))}</time>${String(f.date).length > 4 ? " tarihinde" : ""} kuruldu${f.note ? ` (${esc(f.note)})` : ""}.</p><p class="evergreen-source">Kaynak: ${src(f.sourceUrl, f.sourceName)}</p>${pending("Kulüp renkleri")}`
    : pending("Kuruluş yılı, renkler");
  const o = h.honours;
  const honours = o.status === "ok"
    ? `<p>Türkiye şampiyonluğu listesine göre (${esc(o.coverage)} sezonlar) ${esc(d.name)} <strong>${o.superLigTitles}</strong> kez şampiyon, ${o.runnerUps} kez ikinci oldu.</p>${o.seasons.length ? `<p>Şampiyonluk sezonları: ${o.seasons.map(esc).join(", ")}.</p>` : ""}<p class="evergreen-source">Kaynak: ${src(o.sourceUrl, o.sourceName)}. Kulüplerin kendi resmî sayımları 1959 öncesini de kapsayabilir; burada yalnızca bu listenin sezonları sayıldı. Türkiye Kupası ve Avrupa kupaları bu listede yok; kaynaklı veri eklenince gösterilecek. Tüm sezonlar: <a href="../../super-lig-tarihcesi.html">Süper Lig tarihçesi</a>.</p>`
    : pending("Kupa listesi");
  const st = h.stadium;
  const stadium = st.status === "ok"
    ? `<p>İç saha: <strong>${esc(st.name)}</strong>, kapasite ${Number(st.capacity).toLocaleString("tr-TR")}.</p><p class="evergreen-source">Kaynak: ${src(st.sourceUrl, st.sourceName)}</p>`
    : pending("Stadyum bilgisi");
  const derby = ["galatasaray", "fenerbahce", "besiktas"].includes(d.slug) && exists("derbi-gecmisi.html")
    ? section("derbiler", "Derbi geçmişi", `<p>İstanbul derbilerinin kaynaklı karşılaşma özetleri: <a href="../../derbi-gecmisi.html">Derbi geçmişi</a>.</p>`) : "";
  return section("kurulus", "Kuruluş ve kulüp kimliği", founded)
    + section("kupalar", "Şampiyonluklar", honours)
    + section("stadyum", "Stadyum", stadium)
    + derby
    + section("teknik", "Güncel teknik direktör", mgr);
}

const META = {
  kadro: (d) => ({ title: `${d.name} Kadrosu ${d.season || ""} | Oyuncular ve Mevkiler | FutbolRadar`, description: `${d.name} güncel kadrosu: ${d.squad.count || ""} oyuncu, mevki ve yaş bilgisiyle. Her kayıt kaynak bağlantılı.`, h1: `${d.name} Kadrosu`, intro: `${d.name} için sağlayıcıdan senkronlanan güncel oyuncu listesi, mevkilere göre.`, body: kadroContent }),
  istatistikler: (d) => ({ title: `${d.name} İstatistikleri ${d.season || ""} | Puan, Gol, Form | FutbolRadar`, description: `${d.name} istatistikleri: Süper Lig sırası, galibiyet-beraberlik-mağlubiyet, atılan/yenilen gol, form ve gol-asist liderleri.`, h1: `${d.name} İstatistikleri`, intro: `${d.name} için kayıtlı lig istatistikleri, form ve oyuncu liderleri.`, body: statsContent }),
  "mac-sonuclari": (d) => ({ title: `${d.name} Maç Sonuçları ${d.season || ""} | Skorlar | FutbolRadar`, description: `${d.name} maç sonuçları: Süper Lig, Avrupa kupaları ve hazırlık maçlarının skorları, kaynak bağlantılarıyla.`, h1: `${d.name} Maç Sonuçları`, intro: `${d.name}'in arşivde kaynağıyla doğrulanmış maç skorları.`, body: resultsContent }),
  tarihce: (d) => ({ title: `${d.name} Tarihçesi | Kulüp Bilgileri | FutbolRadar`, description: `${d.name} tarihçesi ve kulüp bilgileri. Doğrulanmış kaynak bulunan bilgiler gösterilir; diğer bölümler güncelleniyor.`, h1: `${d.name} Tarihçesi`, intro: `${d.name} kulüp künyesi: kuruluş, şampiyonluklar, stadyum ve teknik direktör. Her bilgi kaynağıyla verilir; kaynağı olmayan bölümler “veri bekleniyor” olarak işaretlenir.`, body: historyContent })
};

function pageHtml(d, key, dataDate) {
  const base = "../../";
  const meta = META[key](d);
  const label = SECTIONS.find((s) => s.key === key).label;
  const canonical = `${siteUrl}/takimlar/${d.slug}/${key}.html`;
  const crumbs = [
    { name: "Ana Sayfa", url: `${siteUrl}/`, href: base },
    { name: "Takımlar", url: `${siteUrl}/takimlar`, href: "../../takimlar.html" },
    { name: d.name, url: `${siteUrl}/takimlar/${d.slug}`, href: `../${d.slug}` },
    { name: label, url: canonical }
  ];
  const graph = [
    { "@type": "WebPage", "@id": `${canonical}#page`, url: canonical, name: meta.h1, description: meta.description, inLanguage: "tr-TR", dateModified: dataDate,
      about: { "@id": `${siteUrl}/takimlar/${d.slug}#team` } },
    { "@type": "SportsTeam", "@id": `${siteUrl}/takimlar/${d.slug}#team`, name: d.name, sport: "Football", url: `${siteUrl}/takimlar/${d.slug}`, memberOf: { "@type": "SportsOrganization", name: "Süper Lig" },
      ...(key === "kadro" && d.squad.status === "ok" ? { athlete: d.squad.players.map((p) => ({ "@type": "Person", name: p.name })) } : {}),
      ...(d.history.founded.status === "ok" ? { foundingDate: d.history.founded.date } : {}),
      ...(d.history.currentManager.status === "ok" ? { coach: { "@type": "Person", name: d.history.currentManager.name } } : {}) },
    { "@type": "BreadcrumbList", itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })) }
  ];
  const crumbHtml = `<nav class="evergreen-breadcrumb" aria-label="İçerik yolu">${crumbs.map((c, i) => (i === crumbs.length - 1 ? `<span aria-current="page">${esc(c.name)}</span>` : `<a href="${esc(c.href)}">${esc(c.name)}</a><span aria-hidden="true">/</span>`)).join("")}</nav>`;
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(meta.title.replace(/\s+\|/g, " |"))}</title>
    <meta name="description" content="${esc(meta.description)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(meta.title)}" />
    <meta property="og:description" content="${esc(meta.description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${siteUrl}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${base}page.css" />
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base })}
      <main class="evergreen-page">
        <div class="container">
          ${crumbHtml}
          <header class="evergreen-hero">
            <span class="section-kicker">${esc(d.name)} · ${esc(label)}</span>
            <h1>${esc(meta.h1)}</h1>
            <p>${esc(meta.intro)}</p>
            <p class="evergreen-freshness"><time datetime="${dataDate}">Veri tarihi: ${dataDate}</time> · Her kayıt kaynak bağlantısı taşır; eksik bölümler "veri bekleniyor" olarak işaretlenir.</p>
          </header>
          ${meta.body(d)}
          ${sectionNav(d, key)}
        </div>
      </main>
      ${siteFooter({ base })}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

function write(rel, content) {
  for (const outRoot of [root, path.join(root, "public")]) {
    const dest = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && fs.readFileSync(dest, "utf8") === content) continue;
    fs.writeFileSync(dest, content, "utf8");
  }
}

export function buildAll() {
  return ALL_TEAMS.map(buildTeamData);
}

function main() {
  const data = buildAll();
  const dataDate = teams.map((t) => t.lastStandingsSyncedAt).filter(Boolean).sort().at(-1)?.slice(0, 10) || "1970-01-01";
  const files = [];
  for (const d of data) {
    for (const s of SECTIONS) {
      const rel = `takimlar/${d.slug}/${s.key}.html`;
      write(rel, pageHtml(d, s.key, dataDate));
      files.push(rel);
    }
    if (!BIG_FOUR.some((t) => t.slug === d.slug)) continue; // Köşe beslemesi yalnızca büyük dört için.
    const feed = {
      schema: "futbolradar.kose-feed.v1",
      team: { slug: d.slug, name: d.name, season: d.season, teamPage: d.teamPage, pages: d.pages },
      dataDate,
      rules: "Her kayıt sourceUrl taşır. status:'veri-bekleniyor' olan alan için içerik ÜRETME/TAHMİN ETME.",
      form: d.form, standings: d.standings,
      stats: { resultsSummary: d.stats.resultsSummary, topScorers: d.stats.topScorers, topAssists: d.stats.topAssists },
      results: d.results, squad: d.squad, history: d.history
    };
    write(`data/kose-feed/${d.slug}.json`, `${JSON.stringify(feed, null, 2)}\n`);
  }
  write("data/kose-feed/index.json", `${JSON.stringify({ schema: "futbolradar.kose-feed.index.v1", dataDate, teams: data.filter((d) => BIG_FOUR.some((t) => t.slug === d.slug)).map((d) => ({ slug: d.slug, name: d.name, feed: `data/kose-feed/${d.slug}.json`, url: `${siteUrl}/data/kose-feed/${d.slug}.json` })) }, null, 2)}\n`);

  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    const retained = (fs.readFileSync(sitemapPath, "utf8").match(URL_ENTRY_RE) || [])
      .filter((e) => !files.some((f) => e.includes(`<loc>${siteUrl}/${f}</loc>`)));
    const entries = files.map((f) => `  <url>\n    <loc>${siteUrl}/${f}</loc>\n    <lastmod>${dataDate}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.75</priority>\n  </url>`);
    fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
  }
  console.log(`[big-four-data-pages] ${files.length} sayfa, ${BIG_FOUR.length} Köşe beslemesi yazıldı.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
