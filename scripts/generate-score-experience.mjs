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
    month: "long",
    year: "numeric"
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
  const status = String(match.status || "").toUpperCase();
  const showScore = trustedLive(match) || ["FINISHED", "FT", "AET", "PEN"].includes(status);
  if (!showScore) return "\u2013";
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
  return `<nav class="score-bottom-nav" aria-label="Mobil hızlı menü"><a href="${prefix}canli-skor.html"><span aria-hidden="true">●</span>Canlı</a><a href="${prefix}bugunun-maclari.html"><span aria-hidden="true">▦</span>Bugün</a><a href="${prefix}lig/super-lig/"><span aria-hidden="true">≡</span>Ligler</a><a href="#site-search"><span aria-hidden="true">⌕</span>Ara</a></nav>`;
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

function discoveryLinkGroup(title, links) {
  return `<section class="score-link-group"><h3>${escapeHtml(title)}</h3><nav class="score-link-list" aria-label="${escapeHtml(title)}">${links.map((item) => `<a href="${item.href}"><span>${escapeHtml(item.name)}</span><b aria-hidden="true">›</b></a>`).join("")}</nav></section>`;
}

function homepage() {
  const yesterday = todayInIstanbul(-1);
  const today = todayInIstanbul();
  const tomorrow = todayInIstanbul(1);
  const todayMatches = matches.filter((match) => dateInTimeZone(match.kickoffAtUtc) === today && scoreCompetitions.some((item) => item.id === match.competitionId));
  const homepageTodayMatches = todayMatches
    .slice()
    .sort((left, right) => String(left.kickoffAtUtc || left.time || "").localeCompare(String(right.kickoffAtUtc || right.time || "")))
    .slice(0, 10);
  const liveMatches = todayMatches.filter(trustedLive);
  const upcoming = matches.filter((match) => {
    const date = dateInTimeZone(match.kickoffAtUtc);
    return date && date >= today && scoreCompetitions.some((item) => item.id === match.competitionId);
  }).slice(0, 8);
  const title = "Canlı Skorlar ve Bugünün Maçları | FutbolRadar";
  const description = "Bugünün maçları, canlı skorlar, maç sonuçları, Süper Lig ve Avrupa ligleri fikstürü FutbolRadar'da. Takım, oyuncu ve maç ara.";
  const popularLinks = [
    { name: "Bugünün maçları", href: "./bugunun-maclari.html" },
    { name: "Canlı skor", href: "./canli-skor.html" },
    { name: "Süper Lig fikstürü", href: "./super-lig-fikstur.html" },
    { name: "Süper Lig puan durumu", href: "./puan-durumu.html?league=super-lig" },
    { name: "Transfer Radarı", href: "./transfer-radari.html" },
    { name: "Oyuncu Radarı", href: "./oyuncu-radari.html" },
    { name: "En iyi Süper Lig oyuncuları", href: "./en-iyi-super-lig-oyunculari.html" },
    { name: "UEFA ülke puanı", href: "./uefa-ulke-puani-siralamasi.html" },
    { name: "Şampiyonlar Ligi ön eleme", href: "./sampiyonlar-ligi-on-eleme-maclari.html" }
  ];
  const teamNames = ["Fenerbahçe", "Galatasaray", "Beşiktaş", "Trabzonspor"];
  const teamLinks = teamNames.map((name) => ({
    name,
    href: `./takim-detay.html?team=${encodeURIComponent(name)}`
  }));
  const competitionLinks = scoreCompetitions.map((competition) => ({
    name: competition.name,
    href: competitionHref(competition)
  }));
  const discovery = [
    discoveryLinkGroup("Popüler", popularLinks),
    discoveryLinkGroup("Takımlar", teamLinks),
    discoveryLinkGroup("Ligler ve kupalar", competitionLinks)
  ].join("");
  const featuredMatch = liveMatches[0] || todayMatches[0] || upcoming[0] || null;
  const featuredMatchHtml = featuredMatch
    ? `<article class="popular-card home-featured-match"><span class="status-badge" data-status="${trustedLive(featuredMatch) ? "live" : "verified"}">${trustedLive(featuredMatch) ? "Canlı" : statusText(featuredMatch)}</span><div><small>${escapeHtml(featuredMatch.league)}</small><h2>${escapeHtml(featuredMatch.homeTeam)} <span>${escapeHtml(teamScore(featuredMatch, "home"))} - ${escapeHtml(teamScore(featuredMatch, "away"))}</span> ${escapeHtml(featuredMatch.awayTeam)}</h2></div><a class="primary-button" href="${matchHref(featuredMatch)}" data-analytics-event="match_detail_open">Maç Detayı</a></article>`
    : `<article class="popular-card home-featured-match"><span class="status-badge" data-status="unavailable">Program bekleniyor</span><div><small>Günün Radar Maçı</small><h2>Öne çıkan karşılaşma doğrulanıyor</h2></div><a class="secondary-button" href="./bugunun-maclari.html">Maç programını aç</a></article>`;
  const popularCards = [
    ["Bugünün maçları", `${todayMatches.length} doğrulanmış karşılaşma`, "Saat ve skor", "Lig filtreleri", "./bugunun-maclari.html", "Maçları gör", "homepage_today_matches_click"],
    ["Canlı skor", liveMatches.length ? `${liveMatches.length} canlı maç` : "Şu anda canlı maç yok", "Dakika ve skor", "Maç Detayı", "./canli-skor.html", "Canlı skoru aç", "homepage_live_score_click"],
    ["Puan durumu", "Lig tabloları", "Oynanan maç", "Puan ve averaj", "./puan-durumu.html", "Tabloyu aç", ""],
    ["Transfer gündemi", "Gelen ve gidenler", "Güncel takım", "Doğrulanmış kayıt", "./transfer-radari.html", "Transferleri aç", "transfer_radar_click"],
    ["En iyi oyuncular", "Rating ve form", "Genç potansiyel", "Karşılaştırma", "./en-iyi-super-lig-oyunculari.html", "Oyuncuları aç", ""]
  ].map((item) => `<article class="popular-card"><div><span class="card-kicker">${escapeHtml(item[1])}</span><h3>${escapeHtml(item[0])}</h3></div><p>${escapeHtml(item[2])} · ${escapeHtml(item[3])}</p><a class="secondary-button" href="${item[4]}"${item[6] ? ` data-analytics-event="${item[6]}"` : ""}>${escapeHtml(item[5])}</a></article>`).join("");
  const bigTeamCards = teamNames.map((name) => {
    const team = teams.find((item) => normalizeKey(item.name) === normalizeKey(name));
    const teamMatch = matches.find((match) => {
      const date = dateInTimeZone(match.kickoffAtUtc);
      return date && date >= today && [match.homeTeam, match.awayTeam].some((value) => normalizeKey(value) === normalizeKey(name));
    });
    const opponent = teamMatch
      ? (normalizeKey(teamMatch.homeTeam) === normalizeKey(name) ? teamMatch.awayTeam : teamMatch.homeTeam)
      : "";
    const formLabel = team && Array.isArray(team.tags) && team.tags[0] ? team.tags[0].label : "Yeni sezon takibi";
    return `<article class="team-card popular-card"><div><span class="status-badge" data-status="computed">${escapeHtml(formLabel)}</span><h3>${escapeHtml(name)}</h3></div><p>${teamMatch ? `${escapeHtml(statusText(teamMatch))} · ${escapeHtml(opponent)}` : "Sıradaki doğrulanmış maç bekleniyor"}</p><div class="section-actions"><a href="./takim-detay.html?team=${encodeURIComponent(name)}" data-analytics-event="team_detail_open">Takım detayı</a><a href="./oyuncu-radari.html?team=${encodeURIComponent(name)}">Oyuncular</a><a href="./transfer-radari.html?team=${encodeURIComponent(name)}">Transfer Radar</a></div></article>`;
  }).join("");
  const radarCards = [
    ["Momentum", "Takım ivmesi ve form dengesi", "./momentum.html"],
    ["Oyuncu Radar", "Rating, rol ve performans sinyalleri", "./oyuncu-radari.html"],
    ["Takım Radar", "Kadro, form ve oyuncu liderleri", "./takimlar.html"],
    ["Maç Analizi", "Skordan maç olaylarına ve rapora", "./analizler.html"],
    ["Transfer Etkisi", "Güncel takım ve kadro değişimi", "./transfer-radari.html"],
    ["Oyuncu Karşılaştır", "İki oyuncuyu ortak metriklerle oku", "./oyuncu-karsilastir.html"]
  ].map((item) => `<article class="analysis-card"><h3>${escapeHtml(item[0])}</h3><p>${escapeHtml(item[1])}</p><a class="deep-analysis-button" href="${item[2]}">Analize git</a></article>`).join("");
  const ratedPlayers = players.filter((player) => Number.isFinite(Number(player.overallRating || player.aiRating || player.rating)));
  const topRated = ratedPlayers.slice().sort((a, b) => Number(b.overallRating || b.aiRating || b.rating) - Number(a.overallRating || a.aiRating || a.rating))[0] || players[0];
  const rising = ratedPlayers.find((player) => normalizeKey(player.trendDirection || player.trend).includes("up") || Number(player.formChange) > 0) || topRated;
  const young = ratedPlayers.filter((player) => Number(player.computedAge || player.age) > 0 && Number(player.computedAge || player.age) <= 23).sort((a, b) => Number(b.potentialRating || 0) - Number(a.potentialRating || 0))[0] || topRated;
  const transferred = players.find((player) => Array.isArray(player.transferHistory) && player.transferHistory.length) || topRated;
  const playerShowcase = [
    ["En yüksek oyuncu puanı", topRated],
    ["Yükselen oyuncu", rising],
    ["Genç potansiyel", young],
    ["Transfer hareketliliği", transferred]
  ].filter((item) => item[1]).map((item) => {
    const player = item[1];
    const rating = Number(player.overallRating || player.aiRating || player.rating);
    return `<article class="player-card analysis-card"><span class="card-kicker">${escapeHtml(item[0])}</span><h3>${escapeHtml(player.name)}</h3><p>${escapeHtml(player.currentTeam || player.team || "Takım bilgisi bekleniyor")} · ${escapeHtml(player.position || "Mevki bilgisi bekleniyor")}</p>${Number.isFinite(rating) ? `<strong class="rating-badge">${rating.toFixed(1)}</strong>` : `<span class="data-freshness">Performans verisi bekleniyor</span>`}<a class="deep-analysis-button" href="./oyuncular/${encodeURIComponent(player.id || player.slug)}.html" data-analytics-event="player_profile_open">Oyuncu profili</a></article>`;
  }).join("");
  const trendCards = [
    ["Süper Lig fikstürü", "Yeni sezon maç takvimini incele.", "./super-lig-fikstur.html"],
    ["UEFA ülke puanı", "Avrupa maçlarının ülke sıralamasına etkisini oku.", "./uefa-ulke-puani-siralamasi.html"],
    ["En iyi Süper Lig oyuncuları", "Rating ve form listelerine geç.", "./en-iyi-super-lig-oyunculari.html"],
    ["Futbol Radar rehberi", "Momentum ve rating metriklerini tanı.", "./futbol-radar-rehberi.html"]
  ].map((item) => `<article class="analysis-card"><h3>${escapeHtml(item[0])}</h3><p>${escapeHtml(item[1])}</p><a href="${item[2]}">İncele</a></article>`).join("");
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "FutbolRadar",
        url: `${domain}/`,
        potentialAction: {
          "@type": "SearchAction",
          target: `${domain}/?q={search_term_string}`,
          "query-input": "required name=search_term_string"
        }
      },
      {
        "@type": "ItemList",
        name: "FutbolRadar popüler futbol sayfaları",
        itemListElement: popularLinks.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          url: new URL(item.href.replace(/^\.\//, ""), `${domain}/`).href
        }))
      }
    ]
  };

  return `<!doctype html>
<html lang="tr">
<head>${head({ title, description, canonical: `${domain}/`, schema })}</head>
<body class="score-home" data-page="score-home" data-yesterday="${yesterday}" data-today="${today}" data-tomorrow="${tomorrow}" data-feature-live-scores="${flags.liveScores}">
${nav()}
<main class="score-shell score-main">
  <section class="product-home-hero">
    <div class="product-home-copy">
      <p class="score-eyebrow">Skordan analize</p>
      <h1>Bugünün maçları, skorlar ve futbolun radar analizi.</h1>
      <p>Maçları takip et; form, momentum ve oyuncu analizlerine istediğin kadar derinleş.</p>
      <div class="product-home-actions">
        <a class="primary-button" href="./bugunun-maclari.html" data-analytics-event="homepage_today_matches_click">Bugünün Maçları</a>
        <a class="primary-button" href="./canli-skor.html" data-analytics-event="homepage_live_score_click">Canlı Skor</a>
        <a class="deep-analysis-button" href="./radar-merkezi.html" data-analytics-event="radar_center_click">Derin Analizlere Git</a>
      </div>
    </div>
    <div><span class="card-kicker">Günün Radar Maçı</span>${featuredMatchHtml}</div>
  </section>
  <section class="score-search" id="site-search">
    <label for="score-search-input">Maç, takım, lig veya oyuncu ara</label>
    <div><input id="score-search-input" type="search" autocomplete="off" placeholder="Takım, lig veya oyuncu yaz" data-score-search /><button type="button" data-score-search-submit>Ara</button></div>
    <div class="score-search-results" data-score-search-results hidden></div>
    <div class="score-search-seeds" hidden>${searchSeeds()}</div>
  </section>
  <section class="score-toolbar" aria-label="Maç filtreleri">
    <div class="score-period-tabs" role="tablist" aria-label="Tarih"><button type="button" data-score-period="live" role="tab">Canlı</button><button type="button" data-score-period="yesterday" role="tab">Dün</button><button type="button" data-score-period="today" role="tab" class="is-active" aria-selected="true">Bugün</button><button type="button" data-score-period="tomorrow" role="tab">Yarın</button><button type="button" data-score-period="all" role="tab">Tüm maçlar</button></div>
    <div class="score-league-chips" aria-label="Lig seçimi">${leagueChips("all", scoreCompetitions)}</div>
  </section>
  <p class="score-sync-status" data-score-sync-status role="status">Maç programı güncelleniyor.</p>
  <section class="score-section" aria-labelledby="live-score-title">
    <div class="score-section-head"><div><span class="score-live-dot" aria-hidden="true"></span><h2 id="live-score-title">Canlı maçlar</h2></div><a href="./canli-skor.html">Tüm canlı skorlar</a></div>
    <div class="score-list" data-score-live aria-live="polite">${liveMatches.length ? liveMatches.map((match) => matchCard(match)).join("") : emptyState("Şu anda seçili turnuvalarda canlı maç bulunmuyor", "Canlı başlayan karşılaşmalar otomatik olarak burada görünecek.")}</div>
  </section>
  <section class="score-section" aria-labelledby="today-score-title">
    <div class="score-section-head"><div><span data-score-date-label>${formatDate(today)}</span><h2 id="today-score-title" data-score-list-title>Bugünün maçları</h2></div><div class="score-section-actions"><span data-score-count>${todayMatches.length} maç</span><a href="./bugunun-maclari.html">Tüm maçları gör</a></div></div>
    <div class="score-list" data-score-list aria-live="polite">${homepageTodayMatches.length ? homepageTodayMatches.map((match) => matchCard(match)).join("") : emptyState("Bugün seçili turnuvalarda maç bulunmuyor", "Program sağlayıcıdan geldiğinde bu liste otomatik güncellenecek.")}</div>
  </section>
  <section class="score-section score-upcoming" aria-labelledby="upcoming-title">
    <div class="score-section-head"><div><span>Takvim</span><h2 id="upcoming-title">Yaklaşan önemli maçlar</h2></div><a href="./maclar/">Tüm fikstür</a></div>
    <div class="score-list">${upcoming.length ? upcoming.map((match) => matchCard(match)).join("") : emptyState("Yaklaşan maçlar kontrol ediliyor", "Doğrulanmış fikstür kayıtları geldikçe burada sıralanacak.")}</div>
  </section>
  <section class="product-home-section" aria-labelledby="popular-title">
    <div class="section-header"><div><span class="card-kicker">Hızlı erişim</span><h2 id="popular-title">Bugün öne çıkanlar</h2></div></div>
    <div class="popular-grid home-popular-grid">${popularCards}</div>
  </section>
  <section class="product-home-section" aria-labelledby="teams-title">
    <div class="section-header"><div><span class="card-kicker">Takım merkezleri</span><h2 id="teams-title">Büyük takımlar</h2></div><a href="./takimlar.html">Tüm takımlar</a></div>
    <div class="popular-grid home-team-grid">${bigTeamCards}</div>
  </section>
  <section class="product-home-section home-analysis-layer" aria-labelledby="radar-center-title">
    <div class="section-header"><div><span class="card-kicker">Radar Merkezi</span><h2 id="radar-center-title">Daha derine in</h2></div><a class="deep-analysis-button" href="./radar-merkezi.html" data-analytics-event="radar_center_click">Tüm analiz araçları</a></div>
    <div class="analysis-grid">${radarCards}</div>
  </section>
  <section class="product-home-section" aria-labelledby="player-showcase-title">
    <div class="section-header"><div><span class="card-kicker">Oyuncu Radar</span><h2 id="player-showcase-title">Oyuncu vitrini</h2></div><a href="./oyuncu-radari.html">Tüm oyuncular</a></div>
    <div class="analysis-grid home-player-showcase">${playerShowcase || emptyState("Oyuncu verisi hazırlanıyor", "Doğrulanmış oyuncu kayıtları geldikçe vitrin güncellenecek.")}</div>
  </section>
  <section class="product-home-section" aria-labelledby="trend-content-title">
    <div class="section-header"><div><span class="card-kicker">Keşfet</span><h2 id="trend-content-title">Trend futbol içerikleri</h2></div></div>
    <div class="analysis-grid">${trendCards}</div>
  </section>
  <section class="score-discovery" aria-labelledby="discovery-title">
    <div class="score-discovery-head"><span>Hızlı erişim</span><h2 id="discovery-title">Futbol gündemi</h2></div>
    <div class="score-link-groups">${discovery}</div>
  </section>
  <p class="home-data-note">Veriler periyodik olarak güncellenir. Canlı veri geçici olarak alınamadığında son doğrulanmış kayıtlar gösterilebilir.</p>
</main>
${footer()}
${bottomNav()}
<script src="./site.js" defer></script><script src="./score-home.js" defer></script>
</body>
</html>`;
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
  writeMirrored("index.html", homepage());
  console.log("Generated score-first homepage.");
}

for (const competition of competitions) {
  writeMirrored(path.join("lig", competition.id, "index.html"), enrichLeaguePage(leaguePage(competition), competition));
}

console.log(`Generated ${competitions.length} permanent league pages.`);
