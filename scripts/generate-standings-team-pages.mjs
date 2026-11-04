/**
 * PUAN DURUMU TAKIM SAYFALARI (TR) — `/takimlar/<slug>`.
 *
 * Puan durumu sayfalarındaki (scripts/lib/standingsCatalog.mjs) Süper Lig
 * dışı her takım için kalıcı Türkçe takım sayfası. Kayıt ve slug kuralı:
 * scripts/lib/standingsTeamRegistry.mjs. Süper Lig takımları ve özel kulüp
 * sayfası olanlar (ör. vfb-stuttgart.html) burada YENİDEN ÜRETİLMEZ.
 *
 * İçerik yalnızca depodaki kaynaklı veriden:
 *   - Puan durumu satırı(ları): data/league-standings.json (API-Football).
 *   - Son maçlar: data/fixture-calendar.json (yalnız `source: api-football`,
 *     takım kimliğiyle) + data/historical-match-archive.json (API-Football
 *     kimlikli, aynı yarışma adıyla eşleşen kayıtlar). TheSportsDB karışan
 *     kayıt KULLANILMAZ.
 *   - Gol kralları: data/competition-leaders.json (API-Football topscorers).
 *   - Tarihçe: onaylı kaynak olmadığı için yazılmaz.
 *   - Kadro: resmî lig/UEFA/TFF sitesine bağlantı (ALLOWED_SOURCE_HOSTS).
 *
 * İndeksleme: en az MIN_INDEXABLE_MATCHES kaynaklı bitmiş maç + ligi
 * iddaa kapsamında (config/iddaa-leagues.json varsa) → index + sitemap.
 * Aksi hâlde ince sayfa: noindex,follow ve sitemap dışı.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { buildRegistry, leagueIndexable, MIN_INDEXABLE_MATCHES } from "./lib/standingsTeamRegistry.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl, SOURCE_LINK_REL } = require("../services/sourceLinks.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const socialImage = `${siteUrl}/assets/og-image.png`;
const API_FOOTBALL_URL = "https://www.api-football.com/";

/** Resmî kadro/kulüp listesi sayfası (lig bazında). */
const OFFICIAL_LEAGUE_PAGES = {
  "premier-league": ["https://www.premierleague.com/en/clubs", "Premier League resmî sitesi — kulüpler"],
  "la-liga": ["https://www.laliga.com/en-GB/laliga-easports/clubs", "LALIGA resmî sitesi — kulüpler"],
  "serie-a": ["https://www.legaseriea.it/en", "Lega Serie A resmî sitesi"],
  "bundesliga": ["https://www.bundesliga.com/en/bundesliga/clubs", "Bundesliga resmî sitesi — kulüpler"],
  "ligue-1": ["https://ligue1.com/", "Ligue 1 resmî sitesi"],
  "1-lig": ["https://www.tff.org/", "TFF resmî sitesi"],
  "sampiyonlar-ligi": ["https://www.uefa.com/uefachampionsleague/clubs/", "UEFA Şampiyonlar Ligi — kulüpler"],
  "avrupa-ligi": ["https://www.uefa.com/uefaeuropaleague/clubs/", "UEFA Avrupa Ligi — kulüpler"],
  "konferans-ligi": ["https://www.uefa.com/uefaconferenceleague/clubs/", "UEFA Konferans Ligi — kulüpler"]
};
/** Resmî kulüp sitesi zaten onaylı listede olan kulüpler (API-Football kimliği). */
const OFFICIAL_CLUB_SITES = {
  "50": "https://www.mancity.com/",
  "40": "https://www.liverpoolfc.com/",
  "529": "https://www.fcbarcelona.com/",
  "541": "https://www.realmadrid.com/"
};

function esc(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
}
function srcLink(url, label) {
  if (!isAllowedSourceUrl(url)) throw new Error(`İzinli olmayan kaynak: ${url}`);
  return `<a href="${esc(url)}" rel="${SOURCE_LINK_REL}" target="_blank">${esc(label)}</a>`;
}
function trDate(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }) : "";
}
const FINISHED = new Set(["FINISHED", "AWARDED"]);

// --- Maç havuzu (yalnızca API-Football kaynaklı) ---
function loadMatches() {
  const out = new Map();
  const cal = readJson(path.join("data", "fixture-calendar.json"), { matches: [] }).matches || [];
  for (const m of cal) {
    if (m.source !== "api-football" || !FINISHED.has(m.status) || !m.score) continue;
    if (m.score.home === null || m.score.home === undefined) continue;
    const key = String(m.providerId || m.id);
    out.set(key, { key, kickoff: m.kickoff, league: m.league, home: m.homeTeam, away: m.awayTeam, homeId: String(m.homeTeamId || ""), awayId: String(m.awayTeamId || ""), score: m.score });
  }
  const archive = readJson(path.join("data", "historical-match-archive.json"), { records: [] }).records || [];
  for (const rec of (Array.isArray(archive) ? archive : Object.values(archive))) {
    const m = rec && rec.match;
    if (!m || !FINISHED.has(m.status) || !m.score || m.score.home === null || m.score.home === undefined) continue;
    const afId = m.providerIds && m.providerIds.apiFootball;
    if (!afId) continue;
    const blob = JSON.stringify([m.source, m.providerName, m.sourceUrls || []]).toLowerCase();
    if (blob.includes("thesportsdb")) continue;
    const key = String(afId);
    if (out.has(key)) continue;
    out.set(key, { key, kickoff: m.kickoff, league: m.league || m.competition, home: m.homeTeam, away: m.awayTeam, homeId: "", awayId: "", score: m.score });
  }
  return [...out.values()];
}

function teamMatches(team, pool) {
  const leagueNames = new Set(team.standings.map((s) => s.row && s.leagueName).filter(Boolean));
  return pool.filter((m) => {
    if (m.homeId || m.awayId) return m.homeId === team.id || m.awayId === team.id;
    // Kimliksiz arşiv kaydı: ad + yarışma adı birlikte eşleşmeli (adaşlara karşı).
    return (m.home === team.name || m.away === team.name) && leagueNames.has(m.league);
  }).sort((a, b) => String(b.kickoff).localeCompare(String(a.kickoff)));
}

function scorersFor(team, leaders) {
  const out = [];
  for (const s of team.standings) {
    const leagueId = s.row && s.row.providerLeagueId;
    const block = Object.entries(leaders).find(([k]) => k.startsWith(`topscorers:${leagueId}:`));
    if (!block) continue;
    for (const p of block[1].rows || []) {
      const logoId = (String(p.teamLogo || "").match(/teams\/(\d+)\./) || [])[1];
      if (logoId === team.id || (!logoId && p.team === team.name)) out.push({ ...p, leagueNameTr: s.league.nameTr });
    }
  }
  return out;
}

function resultFor(team, m) {
  const isHome = m.homeId ? m.homeId === team.id : m.home === team.name;
  const gf = isHome ? m.score.home : m.score.away;
  const ga = isHome ? m.score.away : m.score.home;
  return gf > ga ? "G" : gf < ga ? "M" : "B";
}

function page(team, ctx) {
  const { matches, scorers, indexable } = ctx;
  const primary = team.standings.find((s) => !["sampiyonlar-ligi", "avrupa-ligi", "konferans-ligi"].includes(s.leagueId)) || team.standings[0];
  const pr = primary.row;
  const canonicalPath = `/takimlar/${team.slug}`;
  const canonical = `${siteUrl}${canonicalPath}`;
  const dataDate = team.standings.map((s) => (s.updatedAt || "").slice(0, 10)).filter(Boolean).sort().at(-1) || "";
  let title = `${team.name} Puan Durumu ve Son Maçları | FutbolRadar`;
  if (title.length > 60) title = `${team.name} Puan Durumu ve Maçları`;
  if (title.length > 60) title = `${team.name} Puan Durumu`.slice(0, 60);
  let description = `${team.name}, ${primary.league.nameTr} puan durumunda ${pr.played} maçta ${pr.points} puanla ${pr.rank}. sırada. Son maçlar ve gol kralları kaynaklı veriyle.`;
  if (description.length > 155) description = `${team.name}: ${primary.league.nameTr} ${pr.rank}. sıra, ${pr.points} puan. Son maçlar ve gol kralları kaynaklı veriyle.`;
  if (description.length > 155) description = description.slice(0, 152).replace(/\s+\S*$/, "") + "…";

  const standingsRows = team.standings.map((s) => {
    const r = s.row;
    return `<tr><th scope="row"><a href="../${esc(s.league.slugTr)}">${esc(s.league.nameTr)}</a></th><td>${esc(r.rank)}</td><td>${esc(r.played)}</td><td>${esc(r.won)}</td><td>${esc(r.drawn)}</td><td>${esc(r.lost)}</td><td>${esc(r.goalsFor)}:${esc(r.goalsAgainst)}</td><td><strong>${esc(r.points)}</strong></td></tr>`;
  }).join("");
  const standingsSection = `<section class="evergreen-section" aria-labelledby="ts-standings"><h2 id="ts-standings">Puan durumundaki yeri</h2><div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${esc(team.name)} puan durumu satırları</caption><thead><tr><th scope="col">Yarışma</th><th scope="col">Sıra</th><th scope="col">O</th><th scope="col">G</th><th scope="col">B</th><th scope="col">M</th><th scope="col">Gol</th><th scope="col">P</th></tr></thead><tbody>${standingsRows}</tbody></table></div><p class="evergreen-note">Veri tarihi: ${esc(dataDate)} · Veri: ${srcLink(API_FOOTBALL_URL, "API-Football")}</p></section>`;

  const shown = matches.slice(0, 10);
  const matchSection = shown.length
    ? `<section class="evergreen-section" aria-labelledby="ts-matches"><h2 id="ts-matches">Son maçlar</h2><ul class="evergreen-player-list ts-matches">${shown.map((m) => `<li><span class="ts-res ts-res-${resultFor(team, m)}" aria-label="${{ G: "Galibiyet", B: "Beraberlik", M: "Mağlubiyet" }[resultFor(team, m)]}">${resultFor(team, m)}</span> <time datetime="${esc(String(m.kickoff).slice(0, 10))}">${esc(trDate(m.kickoff))}</time> · ${esc(m.home)} <strong>${esc(m.score.home)}-${esc(m.score.away)}</strong> ${esc(m.away)} <small>(${esc(m.league)})</small></li>`).join("")}</ul><p class="evergreen-note">Kayıtlı bitmiş maçlar · Veri: ${srcLink(API_FOOTBALL_URL, "API-Football")}</p></section>`
    : `<section class="evergreen-section" aria-labelledby="ts-matches"><h2 id="ts-matches">Son maçlar</h2><p>Güncelleniyor — bu takım için kaynaklı maç kaydı henüz yok.</p></section>`;

  const scorerSection = scorers.length
    ? `<section class="evergreen-section" aria-labelledby="ts-scorers"><h2 id="ts-scorers">Gol kralları</h2><ul class="evergreen-player-list">${scorers.map((p) => `<li><strong>${esc(p.name)}</strong> — ${esc(p.goals)} gol${p.assists ? `, ${esc(p.assists)} asist` : ""} (${esc(p.leagueNameTr)} gol krallığında ${esc(p.rank)}. sıra)</li>`).join("")}</ul><p class="evergreen-note">Veri: ${srcLink(API_FOOTBALL_URL, "API-Football")} (lig gol krallığı ilk 20)</p></section>`
    : "";

  const kadroLinks = [
    ...(OFFICIAL_CLUB_SITES[team.id] ? [srcLink(OFFICIAL_CLUB_SITES[team.id], `${team.name} resmî sitesi`)] : []),
    ...[...new Set(team.standings.map((s) => s.leagueId))].filter((id) => OFFICIAL_LEAGUE_PAGES[id]).map((id) => srcLink(...OFFICIAL_LEAGUE_PAGES[id]))
  ];
  const kadroSection = `<section class="evergreen-section" aria-labelledby="ts-squad"><h2 id="ts-squad">Kadro</h2><p>Güncel kadro listesi için resmî kaynaklar:</p><div class="evergreen-link-grid">${kadroLinks.join("")}</div></section>`;

  const faq = [];
  faq.push([`${team.name} puan durumunda kaçıncı sırada?`, team.standings.map((s) => `${s.league.nameTr}: ${s.row.played} maçta ${s.row.points} puanla ${s.row.rank}. sırada (veri tarihi ${(s.updatedAt || "").slice(0, 10)}).`).join(" ")]);
  if (shown.length) {
    const m = shown[0];
    faq.push([`${team.name} son maçında ne yaptı?`, `${trDate(m.kickoff)} tarihli ${m.league} maçında ${m.home} ${m.score.home}-${m.score.away} ${m.away}.`]);
  }
  if (scorers.length) {
    const top = scorers.slice().sort((a, b) => b.goals - a.goals)[0];
    faq.push([`${team.name} takımının en golcü oyuncusu kim?`, `Kayıtlı ${top.leagueNameTr} gol krallığı verisinde ${top.name} ${top.goals} golle öne çıkıyor.`]);
  }
  const faqSection = `<section class="evergreen-section" aria-labelledby="ts-faq"><h2 id="ts-faq">Sık sorulan sorular</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}</section>`;

  const related = `<aside class="evergreen-related" aria-labelledby="ts-related"><h2 id="ts-related">Puan durumuna dön</h2><div class="evergreen-link-grid">${[...new Map(team.standings.map((s) => [s.league.slugTr, s.league])).values()].map((l) => `<a href="../${esc(l.slugTr)}">${esc(l.nameTr)} puan durumu</a>`).join("")}<a href="../puan-durumu.html">Tüm ligler — puan durumu</a><a href="../takimlar">Takımlar</a></div></aside>`;

  const breadcrumbs = [
    { name: "Ana Sayfa", href: "../", url: `${siteUrl}/` },
    { name: `${primary.league.nameTr} Puan Durumu`, href: `../${primary.league.slugTr}`, url: `${siteUrl}/${primary.league.slugTr}` },
    { name: team.name, href: `../takimlar/${team.slug}`, url: canonical }
  ];
  const graph = [
    { "@type": "SportsTeam", "@id": `${canonical}#team`, name: team.name, sport: "Futbol", url: canonical, ...(team.logo ? { logo: team.logo } : {}), memberOf: [...new Map(team.standings.map((s) => [s.league.id, { "@type": "SportsOrganization", name: s.league.nameTr, url: `${siteUrl}/${s.league.slugTr}` }])).values()] },
    { "@type": "BreadcrumbList", itemListElement: breadcrumbs.map((b, i) => ({ "@type": "ListItem", position: i + 1, name: b.name, item: b.url })) },
    { "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }
  ];
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${socialImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="../page.css" />
    <style data-standings-team>.ts-matches li{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;padding:6px 0}.ts-res{display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:6px;font-weight:800;font-size:.8rem;color:#fff;background:#64748b}.ts-res-G{background:#1e7a52}.ts-res-M{background:#b42318}.evergreen-link-grid a,.evergreen-table th[scope="row"] a{display:inline-flex;align-items:center;min-height:32px}</style>
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "../" })}
      <main class="evergreen-page">
        <div class="container">
          <nav class="evergreen-breadcrumb" aria-label="İçerik yolu">${breadcrumbs.map((b, i) => i === breadcrumbs.length - 1 ? `<span aria-current="page">${esc(b.name)}</span>` : `<a href="${esc(b.href)}">${esc(b.name)}</a><span aria-hidden="true">/</span>`).join("")}</nav>
          <header class="evergreen-hero">
            <span class="section-kicker">${esc(primary.league.countryTr)} · ${esc(primary.league.nameTr)}</span>
            <h1>${esc(team.name)}</h1>
            <p>${esc(team.name)}, ${esc(primary.league.nameTr)} puan durumunda ${esc(pr.played)} maçta ${esc(pr.won)} galibiyet, ${esc(pr.drawn)} beraberlik ve ${esc(pr.lost)} mağlubiyetle ${esc(pr.points)} puan topladı ve ${esc(pr.rank)}. sırada.</p>
            <p class="evergreen-freshness"><time datetime="${esc(dataDate)}">Veri tarihi: ${esc(dataDate)}</time> · Veri: ${srcLink(API_FOOTBALL_URL, "API-Football")}</p>
          </header>
          ${standingsSection}
          ${matchSection}
          ${scorerSection}
          ${kadroSection}
          ${faqSection}
          ${related}
        </div>
      </main>
      ${siteFooter({ base: "../" })}
    </div>
    <script src="../site.js" defer></script>
  </body>
</html>\n`;
}

function writePage(rel, html) {
  for (const outRoot of [root, path.join(root, "public")]) {
    const dest = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, html, "utf8");
  }
}

const registry = buildRegistry();
const leagueStandings = readJson(path.join("data", "league-standings.json"), {});
// Puan durumu satırlarına sağlayıcı lig kimliği ve lig adı eklenir (eşleştirme için).
for (const team of registry.values()) {
  for (const s of team.standings) {
    const raw = (leagueStandings[s.leagueId]?.table || []).find((r) => String(r.id) === team.id);
    s.row.providerLeagueId = raw?.leagueId || null;
    s.leagueName = raw?.league || null;
    s.row.leagueName = raw?.league || null;
  }
}
const pool = loadMatches();
const leaders = readJson(path.join("data", "competition-leaders.json"), { cache: {} }).cache || {};
const results = [];
for (const team of registry.values()) {
  if (team.kind !== "generated") continue;
  const matches = teamMatches(team, pool);
  const scorers = scorersFor(team, leaders);
  const indexable = matches.length >= MIN_INDEXABLE_MATCHES && team.standings.some((s) => leagueIndexable(s.leagueId));
  writePage(path.join("takimlar", `${team.slug}.html`), page(team, { matches, scorers, indexable }));
  results.push({ team, indexable, matches: matches.length, scorers: scorers.length, dataDate: team.standings.map((s) => (s.updatedAt || "").slice(0, 10)).sort().at(-1) });
}

function updateSitemap(file) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const all = new Set(results.map((r) => `${siteUrl}/takimlar/${r.team.slug}`));
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((e) => ![...all].some((u) => e.includes(`<loc>${u}</loc>`)));
  const fresh = results.filter((r) => r.indexable).map((r) => `  <url>\n    <loc>${siteUrl}/takimlar/${r.team.slug}</loc>\n    <lastmod>${r.dataDate}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>`);
  fs.writeFileSync(file, wrapUrlset([...existing, ...fresh]), "utf8");
}
for (const f of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) updateSitemap(f);

const idx = results.filter((r) => r.indexable).length;
console.log(`[standings-team-pages] ${results.length} takım sayfası (${idx} index, ${results.length - idx} noindex)`);
if (process.argv.includes("--report")) {
  fs.writeFileSync("/tmp/standings-team-report.json", JSON.stringify(results.map((r) => ({ name: r.team.name, slug: r.team.slug, leagues: r.team.standings.map((s) => s.leagueId), matches: r.matches, scorers: r.scorers, indexable: r.indexable })), null, 1));
}
