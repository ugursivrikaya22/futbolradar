import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { featureFlags } = require("../services/featureFlags");
const {
  normalizeKey,
  primaryCompetitions,
  scoreboardCompetitions
} = require("../services/competitionCatalog");
const {
  dateInTimeZone,
  dedupeMatches,
  matchSlug,
  normalizeMatchRecord
} = require("../services/matchDataService");

const root = process.cwd();
const publicRoot = path.join(root, "public");
const domain = "https://www.futbolradar.com";
const flags = featureFlags();
const competitions = primaryCompetitions();
const scoreCompetitions = scoreboardCompetitions();

function readJson(relativePath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeMirrored(relativePath, content) {
  for (const base of [root, publicRoot]) {
    const target = path.join(base, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function todayInIstanbul(offset = 0) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function formatDate(value) {
  if (!value) return "Tarih bekleniyor";
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(date);
}

function trustedLive(match) {
  const source = normalizeKey(match.source);
  const liveProvider = source.includes("api-football") || source.includes("football-data") || source.includes("live-api");
  return match.status === "LIVE" && liveProvider;
}

const manifest = readJson("data/generated-match-pages.json", { matches: [] });
const slugById = new Map((manifest.matches || []).flatMap((item) => [
  item.id ? [String(item.id), item.slug] : null,
  item.providerId ? [String(item.providerId), item.slug] : null
].filter(Boolean)));
const matches = dedupeMatches([
  ...readJson("data/matches.json"),
  ...readJson("data/matches-cache.json")
]);
const teams = readJson("data/teams.json");
const players = readJson("data/players.json");
const analyses = readJson("data/analyses.json");

function matchHref(match, prefix = "./") {
  const slug = slugById.get(String(match.id)) || slugById.get(String(match.providerId)) || matchSlug(match);
  return `${prefix}mac/${encodeURIComponent(slug)}/`;
}

function competitionHref(competition, prefix = "./") {
  return competition.competitionType === "domestic"
    ? `${prefix}lig/${competition.id}/`
    : `${prefix}turnuva/${competition.id}/`;
}

function teamInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "FR";
  if (words.length === 1) return words[0].slice(0, 3).toLocaleUpperCase("tr-TR");
  return words.slice(0, 3).map((word) => word[0]).join("").toLocaleUpperCase("tr-TR");
}

function teamScore(match, side) {
  const value = match.score && match.score[side];
  return value == null ? "–" : String(value);
}

function teamMarkup(match, side, redCards) {
  const name = side === "home" ? match.homeTeam : match.awayTeam;
  const logo = side === "home" ? match.homeTeamLogo : match.awayTeamLogo;
  const fallback = teamInitials(name);
  const logoMarkup = logo
    ? `<span class="score-team-logo has-image"><img src="${escapeHtml(logo)}" alt="" width="38" height="38" loading="lazy" decoding="async" data-team-logo /><span class="score-team-fallback" aria-hidden="true">${escapeHtml(fallback)}</span></span>`
    : `<span class="score-team-logo"><span class="score-team-fallback" aria-hidden="true">${escapeHtml(fallback)}</span></span>`;
  const card = redCards
    ? `<i title="Kırmızı kart" aria-label="${redCards} kırmızı kart">${redCards}</i>`
    : "";
  return `<span class="score-team">${logoMarkup}<strong>${escapeHtml(name)}</strong>${card}</span><b class="score-team-score" aria-label="${escapeHtml(name)} skoru">${escapeHtml(teamScore(match, side))}</b>`;
}

function statusText(match) {
  if (trustedLive(match)) return match.minute == null ? "CANLI" : `${match.minute}'`;
  if (match.status === "FINISHED") return "MS";
  if (match.status === "POSTPONED") return "ERT";
  if (match.status === "CANCELLED") return "İPT";
  return match.time || "Saat bekleniyor";
}

function matchCard(rawMatch, prefix = "./") {
  const match = normalizeMatchRecord(rawMatch);
  const redHome = Number(match.redCards && match.redCards.home || 0);
  const redAway = Number(match.redCards && match.redCards.away || 0);
  const liveClass = trustedLive(match) ? " is-live" : "";
  return `<a class="score-card${liveClass}" href="${matchHref(match, prefix)}" data-score-match data-match-league="${escapeHtml(match.competitionId)}" data-match-status="${escapeHtml(match.status)}" data-search-record="match" data-search-label="${escapeHtml(`${match.homeTeam} ${match.awayTeam} ${match.league}`)}"><span class="score-card-meta"><b>${escapeHtml(match.league)}</b><span>${escapeHtml(statusText(match))}</span></span>${teamMarkup(match, "home", redHome)}${teamMarkup(match, "away", redAway)}</a>`;
}

function emptyState(title, text) {
  return `<article class="score-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></article>`;
}

function nav(prefix = "./") {
  return `<header class="score-header"><div class="score-shell score-nav"><a class="score-brand" href="${prefix}index.html" aria-label="FutbolRadar ana sayfa"><span>FR</span><strong>FutbolRadar</strong></a><nav aria-label="Ana menü"><a href="${prefix}canli-skor.html">Canlı</a><a href="${prefix}maclar/">Maçlar</a><a href="${prefix}lig/super-lig/">Ligler</a><a href="${prefix}analizler.html">Analiz</a><a href="#site-search">Arama</a></nav></div></header>`;
}

function bottomNav(prefix = "./") {
  return `<nav class="score-bottom-nav" aria-label="Mobil hızlı menü"><a href="${prefix}canli-skor.html"><span aria-hidden="true">●</span>Canlı</a><a href="${prefix}maclar/"><span aria-hidden="true">▦</span>Bugün</a><a href="${prefix}lig/super-lig/"><span aria-hidden="true">≡</span>Ligler</a><a href="#site-search"><span aria-hidden="true">⌕</span>Ara</a></nav>`;
}

function footer(prefix = "./") {
  return `<footer class="score-footer"><div class="score-shell"><strong>FutbolRadar</strong><p>Skor, fikstür ve doğrulanmış maç verileri. Saatler Europe/Istanbul (TSİ).</p><nav aria-label="Alt menü"><a href="${prefix}veri-metodolojisi.html">Veri metodolojisi</a><a href="${prefix}duzeltme-politikasi.html">Düzeltme politikası</a><a href="${prefix}gizlilik.html">Gizlilik</a><a href="${prefix}kesfet.html">Radar araçları</a></nav></div></footer>`;
}

function head({ title, description, canonical, prefix = "./", schema }) {
  return `<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}" /><meta name="robots" content="index,follow" /><link rel="canonical" href="${canonical}" /><meta property="og:type" content="website" /><meta property="og:locale" content="tr_TR" /><meta property="og:site_name" content="FutbolRadar" /><meta property="og:title" content="${escapeHtml(title)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:url" content="${canonical}" /><meta property="og:image" content="${domain}/assets/og-image.svg" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHtml(title)}" /><meta name="twitter:description" content="${escapeHtml(description)}" /><link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml" /><link rel="manifest" href="${prefix}site.webmanifest" /><link rel="stylesheet" href="${prefix}page.css" />${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ""}`;
}

function searchSeeds(prefix = "./") {
  const records = [
    ...matches.map((match) => ({
      category: trustedLive(match) ? "Canlı maç" : "Maç",
      label: `${match.homeTeam} ${match.awayTeam} ${match.league}`,
      href: matchHref(match, prefix)
    })),
    ...scoreCompetitions.flatMap((item) => [
      { category: item.competitionType === "domestic" ? "Lig" : "Turnuva", label: item.name, href: competitionHref(item, prefix) },
      ...(item.competitionType === "domestic"
        ? [{ category: "Lig", label: `${item.name} puan durumu`, href: `${prefix}puan-durumu.html?league=${item.id}` }]
        : [])
    ]),
    ...teams.map((item) => ({ category: "Takım", label: item.name, href: `${prefix}takim-detay.html?team=${encodeURIComponent(item.name)}` })),
    ...players.slice(0, 24).map((item) => ({ category: "Oyuncu", label: item.name, href: `${prefix}oyuncular/${encodeURIComponent(item.id || item.slug)}.html` })),
    ...analyses.map((item) => ({ category: "Analiz", label: item.title, href: item.url ? `${prefix}${String(item.url).replace(/^\.\//, "")}` : `${prefix}analizler.html` }))
  ];
  return records.map((item) => `<a href="${item.href}" data-search-seed data-search-category="${escapeHtml(item.category)}" data-search-label="${escapeHtml(item.label)}">${escapeHtml(item.label)}</a>`).join("");
}

function leagueChips(selected = "all", pool = competitions) {
  return [`<button type="button" class="${selected === "all" ? "is-active" : ""}" data-score-league="all">Tümü</button>`, ...pool.map((item) => `<button type="button" class="${selected === item.id ? "is-active" : ""}" data-score-league="${item.id}">${escapeHtml(item.name)}</button>`)].join("");
}

function homepage() {
  const today = todayInIstanbul();
  const tomorrow = todayInIstanbul(1);
  const todayMatches = matches.filter((match) => dateInTimeZone(match.kickoffAtUtc) === today && scoreCompetitions.some((item) => item.id === match.competitionId));
  const liveMatches = todayMatches.filter(trustedLive);
  const upcoming = matches.filter((match) => {
    const date = dateInTimeZone(match.kickoffAtUtc);
    return date && date >= today && scoreCompetitions.some((item) => item.id === match.competitionId);
  }).slice(0, 8);
  const title = "Canlı Skorlar ve Bugünün Maçları | FutbolRadar";
  const description = "Süper Lig, Avrupa'nın beş büyük ligi ve UEFA turnuvalarındaki canlı skorlar, fikstür ve maç detayları FutbolRadar'da.";
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "FutbolRadar",
    url: `${domain}/`,
    potentialAction: { "@type": "SearchAction", target: `${domain}/?q={search_term_string}`, "query-input": "required name=search_term_string" }
  };

  return `<!doctype html><html lang="tr"><head>${head({ title, description, canonical: `${domain}/`, schema })}</head><body class="score-home" data-page="score-home" data-today="${today}" data-tomorrow="${tomorrow}" data-feature-live-scores="${flags.liveScores}">${nav()}<main class="score-shell score-main"><section class="score-intro"><p class="score-eyebrow">Canlı skor ve maç merkezi</p><h1>Maçlar, skorlar ve fikstür</h1><p>Altı büyük lig, UEFA turnuvaları ve hazırlık maçlarında canlı akış ile günün programı tek ekranda.</p></section><section class="score-search" id="site-search"><label for="score-search-input">Maç, takım, lig veya oyuncu ara</label><div><input id="score-search-input" type="search" autocomplete="off" placeholder="Örn. Fenerbahçe, Premier League, Icardi" data-score-search /><button type="button" data-score-search-submit>Ara</button></div><div class="score-search-results" data-score-search-results hidden></div><div class="score-search-seeds" hidden>${searchSeeds()}</div></section><section class="score-toolbar" aria-label="Maç filtreleri"><div class="score-period-tabs" role="tablist" aria-label="Tarih"><button type="button" data-score-period="live" role="tab">Canlı</button><button type="button" data-score-period="today" role="tab" class="is-active" aria-selected="true">Bugün</button><button type="button" data-score-period="tomorrow" role="tab">Yarın</button><button type="button" data-score-period="all" role="tab">Tümü</button></div><div class="score-league-chips" aria-label="Lig seçimi">${leagueChips("all", scoreCompetitions)}</div></section><p class="score-sync-status" data-score-sync-status role="status">Maç programı güncelleniyor.</p><section class="score-section" aria-labelledby="live-score-title"><div class="score-section-head"><div><span class="score-live-dot" aria-hidden="true"></span><h2 id="live-score-title">Canlı maçlar</h2></div><a href="./canli-skor.html">Tüm canlı skorlar</a></div><div class="score-list" data-score-live aria-live="polite">${liveMatches.length ? liveMatches.map((match) => matchCard(match)).join("") : emptyState("Şu anda seçili turnuvalarda canlı maç bulunmuyor", "Canlı başlayan karşılaşmalar otomatik olarak burada görünecek.")}</div></section><section class="score-section" aria-labelledby="today-score-title"><div class="score-section-head"><div><span data-score-date-label>${formatDate(today)}</span><h2 id="today-score-title" data-score-list-title>Bugünün maçları</h2></div><span data-score-count>${todayMatches.length} maç</span></div><div class="score-list" data-score-list aria-live="polite">${todayMatches.length ? todayMatches.map((match) => matchCard(match)).join("") : emptyState("Bugün seçili turnuvalarda maç bulunmuyor", "Program sağlayıcıdan geldiğinde bu liste otomatik güncellenecek.")}</div></section><section class="score-section score-upcoming" aria-labelledby="upcoming-title"><div class="score-section-head"><div><span>Takvim</span><h2 id="upcoming-title">Yaklaşan önemli maçlar</h2></div><a href="./maclar/">Maç merkezine git</a></div><div class="score-list">${upcoming.length ? upcoming.map((match) => matchCard(match)).join("") : emptyState("Yaklaşan maçlar kontrol ediliyor", "Doğrulanmış fikstür kayıtları geldikçe burada sıralanacak.")}</div></section><section class="score-shortcuts" aria-labelledby="shortcut-title"><h2 id="shortcut-title">Hızlı erişim</h2><div>${competitions.map((item) => `<a href="./lig/${item.id}/"><strong>${escapeHtml(item.name)}</strong><span>Fikstür ve sonuçlar</span></a>`).join("")}${scoreCompetitions.filter((item) => item.competitionType !== "domestic").map((item) => `<a href="${competitionHref(item)}"><strong>${escapeHtml(item.name)}</strong><span>Turnuva maçları</span></a>`).join("")}<a href="./oyuncu-radari.html"><strong>Oyuncu Radarı</strong><span>Form ve performans</span></a><a href="./kesfet.html"><strong>Radar araçları</strong><span>Momentum ve analizler</span></a></div></section></main>${footer()}${bottomNav()}<script src="./site.js" defer></script><script src="./score-home.js" defer></script></body></html>`;
}

function leaguePage(competition) {
  const prefix = "../../";
  const leagueMatches = matches.filter((match) => match.competitionId === competition.id);
  const leagueTeams = teams.filter((team) => normalizeKey(team.league) === normalizeKey(competition.name));
  const title = `${competition.name} Canlı Skor, Fikstür ve Sonuçlar | FutbolRadar`;
  const description = `${competition.name} canlı skorları, güncel fikstürü, maç sonuçları ve takım bağlantıları FutbolRadar lig merkezinde.`;
  const canonical = `${domain}/lig/${competition.id}/`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "SportsOrganization", name: competition.name, sport: "Football", url: canonical },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
        { "@type": "ListItem", position: 2, name: "Ligler", item: `${domain}/lig/super-lig/` },
        { "@type": "ListItem", position: 3, name: competition.name, item: canonical }
      ] }
    ]
  };
  const otherLeagues = competitions
    .filter((item) => item.id !== competition.id)
    .map((item) => `<a href="${prefix}lig/${item.id}/"><strong>${escapeHtml(item.name)}</strong><span>Lig merkezine git</span></a>`)
    .join("");
  return `<!doctype html><html lang="tr"><head>${head({ title, description, canonical, prefix, schema })}</head><body class="score-home score-league-page" data-page="league" data-league="${competition.id}" data-today="${todayInIstanbul()}">${nav(prefix)}<main class="score-shell score-main"><nav class="score-breadcrumb" aria-label="Sayfa yolu"><a href="${prefix}index.html">Ana Sayfa</a><span>/</span><span>Ligler</span><span>/</span><strong>${escapeHtml(competition.name)}</strong></nav><section class="score-intro"><p class="score-eyebrow">${escapeHtml(competition.country)} · Lig merkezi</p><h1>${escapeHtml(competition.name)}</h1><p>Canlı skor, fikstür, sonuçlar ve takım bağlantıları. Eksik karşılaşmalar tahminle doldurulmaz.</p></section><section class="score-search" id="site-search"><label for="score-search-input">Takım, oyuncu veya maç ara</label><div><input id="score-search-input" type="search" autocomplete="off" data-score-search /><button type="button" data-score-search-submit>Ara</button></div><div class="score-search-results" data-score-search-results hidden></div><div class="score-search-seeds" hidden>${searchSeeds(prefix)}</div></section><section class="score-toolbar"><div class="score-league-chips">${leagueChips(competition.id)}</div></section><section class="score-section"><div class="score-section-head"><div><span>Program</span><h2>${escapeHtml(competition.name)} maçları</h2></div><a href="${prefix}puan-durumu.html?league=${competition.id}">Puan durumu</a></div><div class="score-list" data-score-list aria-live="polite">${leagueMatches.length ? leagueMatches.map((match) => matchCard(match, prefix)).join("") : emptyState("Doğrulanmış maç kaydı bekleniyor", "Fikstür sağlayıcıdan geldiğinde bu lig sayfası otomatik güncellenecek.")}</div></section><section class="score-shortcuts"><h2>Takımlar ve bağlantılar</h2><div>${leagueTeams.length ? leagueTeams.map((team) => `<a href="${prefix}takim-detay.html?team=${encodeURIComponent(team.name)}"><strong>${escapeHtml(team.name)}</strong><span>Takım profili</span></a>`).join("") : `<a href="${prefix}takimlar.html"><strong>Takım merkezi</strong><span>${escapeHtml(competition.name)} takım verileri</span></a>`}<a href="${prefix}oyuncu-radari.html?league=${competition.id}"><strong>Oyuncu Radarı</strong><span>Lig oyuncularını incele</span></a><a href="${prefix}maclar/"><strong>Maç merkezi</strong><span>Tüm liglerin programı</span></a>${otherLeagues}</div></section></main>${footer(prefix)}${bottomNav(prefix)}<script src="${prefix}site.js" defer></script><script src="${prefix}score-home.js" defer></script></body></html>`;
}

function enrichLeaguePage(html, competition) {
  const prefix = "../../";
  const today = todayInIstanbul();
  const leagueMatches = matches.filter((match) => match.competitionId === competition.id);
  const live = leagueMatches.filter(trustedLive);
  const todayMatches = leagueMatches.filter((match) => dateInTimeZone(match.kickoffAtUtc) === today);
  const upcoming = leagueMatches.filter((match) => {
    const date = dateInTimeZone(match.kickoffAtUtc);
    return date && date > today && match.status === "SCHEDULED";
  }).slice(0, 8);
  const results = leagueMatches
    .filter((match) => match.status === "FINISHED")
    .sort((left, right) => String(right.kickoffAtUtc || "").localeCompare(String(left.kickoffAtUtc || "")))
    .slice(0, 8);
  const leagueTeams = teams.filter((team) => normalizeKey(team.league) === normalizeKey(competition.name));
  const standings = leagueTeams
    .filter((team) => team.rank != null && team.points != null)
    .sort((left, right) => Number(left.rank) - Number(right.rank));
  const leagueAnalyses = analyses.filter((item) => normalizeKey(`${item.title} ${item.summary || ""}`).includes(normalizeKey(competition.name)));
  const section = (id, eyebrow, title, items, emptyTitle, emptyText) => `<section class="score-section" aria-labelledby="${id}"><div class="score-section-head"><div><span>${escapeHtml(eyebrow)}</span><h2 id="${id}">${escapeHtml(title)}</h2></div><span>${items.length} maç</span></div><div class="score-list">${items.length ? items.map((match) => matchCard(match, prefix)).join("") : emptyState(emptyTitle, emptyText)}</div></section>`;
  const standingsHtml = standings.length
    ? standings.map((team) => `<a class="score-standing-row" href="${prefix}takim-detay.html?team=${encodeURIComponent(team.name)}"><b>${Number(team.rank)}</b><strong>${escapeHtml(team.name)}</strong><span>${Number(team.played || 0)} O</span><em>${Number(team.points)} P</em></a>`).join("")
    : emptyState("Puan durumu henüz oluşmadı", "Lig başladığında doğrulanmış puanlar otomatik olarak burada gösterilecek.");
  const analysesHtml = leagueAnalyses.length
    ? leagueAnalyses.map((item) => `<a class="score-analysis-link" href="${prefix}${String(item.url || "analizler.html").replace(/^\.\//, "")}"><span>Analiz</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary || "")}</p></a>`).join("")
    : `<a class="score-analysis-link" href="${prefix}analizler.html"><span>Analiz</span><strong>${escapeHtml(competition.name)} analiz merkezi</strong><p>Form, fikstür ve doğrulanmış maç okumalarına geç.</p></a>`;
  const supplemental = `${section("league-live", "Canlı", "Canlı maçlar", live, "Şu anda bu ligde canlı maç bulunmuyor", "Canlı başlayan karşılaşmalar otomatik olarak burada görünecek.")}${section("league-today", formatDate(today), "Bugünün maçları", todayMatches, "Bugün bu ligde maç bulunmuyor", "Yaklaşan programı aşağıdan inceleyebilirsin.")}${section("league-upcoming", "Fikstür", "Yaklaşan maçlar", upcoming, "Yaklaşan maç kaydı bekleniyor", "Doğrulanmış fikstür geldiğinde burada sıralanacak.")}${section("league-results", "Arşiv", "Son sonuçlar", results, "Henüz doğrulanmış sonuç yok", "Tamamlanan maçlar burada kalıcı olarak listelenecek.")}<section class="score-section"><div class="score-section-head"><div><span>Tablo</span><h2>Puan durumu</h2></div><a href="${prefix}puan-durumu.html?league=${competition.id}">Tam tablo</a></div><div class="score-standings">${standingsHtml}</div></section><section class="score-section"><div class="score-section-head"><div><span>Radar</span><h2>Lig analizleri</h2></div><a href="${prefix}analizler.html">Tüm analizler</a></div><div class="score-analysis-list">${analysesHtml}</div></section>`;
  return html.replace('<section class="score-shortcuts">', `${supplemental}<section class="score-shortcuts">`);
}

if (!flags.scoreFirstHomepage) {
  const legacy = fs.readFileSync(path.join(root, "kesfet.html"), "utf8");
  const legacyHome = legacy
    .replaceAll(`${domain}/kesfet.html`, `${domain}/`)
    .replace("FutbolRadar Keşfet | Momentum, Oyuncu ve Transfer Radarları", "FutbolRadar | Canlı Skor, Maç ve Oyuncu İstatistikleri")
    .replace("FutbolRadar Keşfet | Momentum ve Oyuncu Radarları", "FutbolRadar | Canlı Skor ve Futbol İstatistikleri")
    .replace('"@type": "CollectionPage"', '"@type": "WebSite"')
    .replace('"name": "FutbolRadar Keşfet"', '"name": "FutbolRadar"');
  writeMirrored("index.html", legacyHome);
  console.log("Score-first homepage disabled; legacy dashboard restored.");
} else {
  const scoreHomepage = homepage()
    .replace("<h1>Maçlar, skorlar ve fikstür</h1>", "<h1>Canlı skorlar ve bugünün maçları</h1>")
    .replace('data-score-period="all" role="tab">Tümü</button>', 'data-score-period="all" role="tab">Tüm Maçlar</button>');
  writeMirrored("index.html", scoreHomepage);
  console.log("Generated score-first homepage.");
}

for (const competition of competitions) {
  writeMirrored(path.join("lig", competition.id, "index.html"), enrichLeaguePage(leaguePage(competition), competition));
}

console.log(`Generated ${competitions.length} permanent league pages.`);
