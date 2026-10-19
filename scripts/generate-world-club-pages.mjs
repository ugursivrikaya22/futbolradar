#!/usr/bin/env node
/**
 * WORLD CLUB PAGES — TR `/takimlar/{slug}` + EN `/en/teams/{slug}`, each with
 * squad, stats and honours sub-pages (8 pages per club).
 *
 * Curated facts (history, honours, records, squad snapshot) come from
 * `data/world-clubs.json`; every record there carries a source URL. Live
 * blocks are read at build time from the provider files the hourly refresh
 * already maintains, so the pages re-render in the postprocess chain:
 *   - data/league-standings.json   league position, W/D/L, form
 *   - data/fixture-calendar.json   recent results and upcoming fixtures
 *   - data/competition-leaders.json top scorers / assists
 * Matching is by API-Football team id, never by name (namesake clubs exist).
 * Missing values render as "Veri bekleniyor" / "Data pending".
 */
import {
  SITE_URL, absolute, escapeHtml, pageExists, readJson, renderPage, updateSitemap, writePage
} from "./lib/seoPage.mjs";

const CLUBS = readJson("data/world-clubs.json", { clubs: [] }).clubs;
const STANDINGS = readJson("data/league-standings.json", {});
const CALENDAR = readJson("data/fixture-calendar.json", { matches: [] });
const LEADERS = readJson("data/competition-leaders.json", { cache: {} }).cache || {};
const CL_ID = "sampiyonlar-ligi";

const SUB = {
  main: { tr: "", en: "" },
  squad: { tr: "/kadro", en: "/squad" },
  stats: { tr: "/istatistikler", en: "/stats" },
  honours: { tr: "/basarilar", en: "/honours" }
};

const T = {
  tr: {
    pending: "Veri bekleniyor", home: "Ana Sayfa", teams: "Takımlar", teamsPath: "/takimlar",
    overview: "Genel bakış", history: "Tarihçe", trophies: "Kupa zaferleri", legends: "Efsane oyuncular ve rekor sahipleri",
    season: "Son sezon performansı", stadium: "Stadyum", manager: "Teknik direktör", squadSummary: "Güncel kadro özeti",
    derbies: "Derbiler ve önemli rekabetler", recent: "Son maçlar", upcoming: "Sıradaki maçlar", links: "İlgili sayfalar",
    squad: "Kadro", stats: "İstatistikler", honours: "Başarılar", founded: "Kuruluş", city: "Şehir", colours: "Renkler",
    kit: "Forma tedarikçisi", capacity: "Kapasite", nicknames: "Lakaplar", league: "Lig", rank: "Sıra", played: "O", won: "G",
    drawn: "B", lost: "M", gf: "AG", ga: "YG", gd: "AV", pts: "P", form: "Son 5 maç (form)", number: "No", position: "Mevki",
    nationality: "Uyruk", player: "Oyuncu", captain: "kaptan", competition: "Turnuva", titles: "Kupa", first: "İlk", last: "Son",
    domestic: "Ulusal kupalar", continental: "Avrupa kupaları", worldwide: "Dünya kupaları", records: "Rekorlar",
    topScorers: "Gol katkısı: ligdeki ilk sıralarda yer alan oyuncular", goals: "Gol", assists: "Asist", apps: "Maç", minutes: "Dakika",
    perMatch: "Maç başına veriler", gfPer: "Maç başına atılan gol", gaPer: "Maç başına yenen gol", ptsPer: "Maç başına puan",
    lastSeasonTitles: "2025-26 sezonunda kazanılan kupalar", none: "Kayıt yok", source: "Kaynak", squadSource: "Kadro kaynağı",
    asOf: "tarihli kulüp listesi", date: "Tarih", match: "Maç", score: "Skor", seasonLabel: "2026-27 sezonu",
    clPhase: "Şampiyonlar Ligi lig aşaması", otherClubs: "Diğer dünya kulüpleri", superLig: "Süper Lig puan durumu",
    win: "G", draw: "B", loss: "M"
  },
  en: {
    pending: "Data pending", home: "Home", teams: "Teams", teamsPath: "/en/teams",
    overview: "Overview", history: "History", trophies: "Trophy cabinet", legends: "Legends and record holders",
    season: "Current season performance", stadium: "Stadium", manager: "Manager", squadSummary: "Current squad summary",
    derbies: "Derbies and key rivalries", recent: "Recent results", upcoming: "Upcoming fixtures", links: "Related pages",
    squad: "Squad", stats: "Stats", honours: "Honours", founded: "Founded", city: "City", colours: "Colours",
    kit: "Kit manufacturer", capacity: "Capacity", nicknames: "Nicknames", league: "League", rank: "Pos", played: "P", won: "W",
    drawn: "D", lost: "L", gf: "GF", ga: "GA", gd: "GD", pts: "Pts", form: "Last 5 (form)", number: "No", position: "Position",
    nationality: "Nationality", player: "Player", captain: "captain", competition: "Competition", titles: "Titles", first: "First", last: "Latest",
    domestic: "Domestic honours", continental: "European honours", worldwide: "Worldwide honours", records: "Records",
    topScorers: "Goal contributions: players among the league leaders", goals: "Goals", assists: "Assists", apps: "Apps", minutes: "Minutes",
    perMatch: "Per-match stats", gfPer: "Goals scored per match", gaPer: "Goals conceded per match", ptsPer: "Points per match",
    lastSeasonTitles: "Trophies won in 2025-26", none: "None recorded", source: "Source", squadSource: "Squad source",
    asOf: "club list dated", date: "Date", match: "Match", score: "Score", seasonLabel: "2026-27 season",
    clPhase: "Champions League league phase", otherClubs: "Other world clubs", superLig: "Süper Lig standings",
    win: "W", draw: "D", loss: "L"
  }
};

const POSITION = {
  tr: { GK: "Kaleci", DF: "Defans", MF: "Orta saha", FW: "Forvet" },
  en: { GK: "Goalkeeper", DF: "Defender", MF: "Midfielder", FW: "Forward" }
};

const NATIONS = {
  ALG: ["Cezayir", "Algeria"], ARG: ["Arjantin", "Argentina"], AUT: ["Avusturya", "Austria"], BEL: ["Belçika", "Belgium"],
  BRA: ["Brezilya", "Brazil"], CAN: ["Kanada", "Canada"], CIV: ["Fildişi Sahili", "Ivory Coast"], COL: ["Kolombiya", "Colombia"],
  CRO: ["Hırvatistan", "Croatia"], DEN: ["Danimarka", "Denmark"], ECU: ["Ekvador", "Ecuador"], EGY: ["Mısır", "Egypt"],
  ENG: ["İngiltere", "England"], ESP: ["İspanya", "Spain"], FRA: ["Fransa", "France"], GER: ["Almanya", "Germany"],
  GHA: ["Gana", "Ghana"], GRE: ["Yunanistan", "Greece"], ITA: ["İtalya", "Italy"], JPN: ["Japonya", "Japan"],
  KOR: ["Güney Kore", "South Korea"], MAR: ["Fas", "Morocco"], NED: ["Hollanda", "Netherlands"], NIR: ["Kuzey İrlanda", "Northern Ireland"],
  NOR: ["Norveç", "Norway"], POL: ["Polonya", "Poland"], POR: ["Portekiz", "Portugal"], SEN: ["Senegal", "Senegal"],
  SWE: ["İsveç", "Sweden"], TUR: ["Türkiye", "Türkiye"], UKR: ["Ukrayna", "Ukraine"], URU: ["Uruguay", "Uruguay"],
  UZB: ["Özbekistan", "Uzbekistan"]
};

const MONTHS = {
  tr: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
};

const GENITIVE_TR = { "bayern-munich": "Bayern Münih'in", "real-madrid": "Real Madrid'in", barcelona: "Barcelona'nın", arsenal: "Arsenal'in", "manchester-city": "Manchester City'nin" };

const name = (club, locale) => (locale === "en" ? club.nameEn : club.nameTr);
const clubPath = (club, locale, sub = "main") =>
  `${locale === "en" ? `/en/teams/${club.slugEn}` : `/takimlar/${club.slugTr}`}${SUB[sub][locale]}`;
const nation = (code, locale) => (NATIONS[code] ? NATIONS[code][locale === "en" ? 1 : 0] : code || "");
const pending = (locale) => `<span class="evergreen-note">${T[locale].pending}</span>`;
const val = (value, locale) => (value === null || value === undefined || value === "" ? pending(locale) : escapeHtml(value));

function formatDate(iso, locale) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!m) return String(y);
  if (!d) return locale === "en" ? `${MONTHS.en[m - 1]} ${y}` : `${MONTHS.tr[m - 1]} ${y}`;
  return locale === "en" ? `${d} ${MONTHS.en[m - 1]} ${y}` : `${d} ${MONTHS.tr[m - 1]} ${y}`;
}

function formatNumber(n, locale) {
  return typeof n === "number" ? n.toLocaleString(locale === "en" ? "en-US" : "tr-TR") : null;
}

function standingsRow(club, competitionId) {
  const table = STANDINGS[competitionId]?.table || [];
  return table.find((row) => String(row.id ?? row.providerId) === String(club.providerTeamId)) || null;
}

function standingsUpdatedAt(competitionId) {
  return (STANDINGS[competitionId]?.updatedAt || "").slice(0, 10) || null;
}

function clubMatches(club) {
  const id = String(club.providerTeamId);
  const all = (CALENDAR.matches || []).filter((m) => String(m.homeTeamId) === id || String(m.awayTeamId) === id);
  const finished = all.filter((m) => m.status === "FINISHED" && m.score && m.score.home !== null)
    .sort((a, b) => String(b.kickoff).localeCompare(String(a.kickoff))).slice(0, 5);
  const upcoming = all.filter((m) => m.status === "SCHEDULED")
    .sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff))).slice(0, 3);
  return { finished, upcoming };
}

function leaderRows(club, leagueId, kind) {
  const entry = LEADERS[`${kind}:${leagueId}:2026`];
  const logo = `/teams/${club.providerTeamId}.png`;
  return (entry?.rows || []).filter((row) => String(row.teamLogo || "").endsWith(logo));
}

const competitionName = (m, locale) => {
  if (locale === "en" && /Şampiyonlar Ligi/.test(m.league)) return "Champions League";
  return m.league;
};

function matchResult(m, club) {
  const home = String(m.homeTeamId) === String(club.providerTeamId);
  const own = home ? m.score.home : m.score.away;
  const opp = home ? m.score.away : m.score.home;
  return own > opp ? "win" : own < opp ? "loss" : "draw";
}

function matchesTable(list, club, locale, finished) {
  const t = T[locale];
  if (!list.length) return `<p>${pending(locale)}</p>`;
  const rows = list.map((m) => {
    const date = formatDate(String(m.kickoff).slice(0, 10), locale);
    const score = finished ? `${m.score.home}–${m.score.away} <small>(${t[matchResult(m, club)]})</small>` : escapeHtml(m.time || "");
    return `<tr><td>${escapeHtml(date)}</td><td>${escapeHtml(competitionName(m, locale))}</td><th scope="row">${escapeHtml(m.homeTeam)} – ${escapeHtml(m.awayTeam)}</th><td>${score}</td></tr>`;
  }).join("");
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><thead><tr><th scope="col">${t.date}</th><th scope="col">${t.competition}</th><th scope="col">${t.match}</th><th scope="col">${finished ? t.score : (locale === "en" ? "Kick-off (TRT)" : "Saat (TSİ)")}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function formLetters(form, locale) {
  if (!Array.isArray(form) || !form.length) return null;
  const map = locale === "en" ? { W: "W", D: "D", L: "L" } : { W: "G", D: "B", L: "M" };
  return form.map((r) => map[r] || r).join(" ");
}

function standingsTable(row, club, locale, label) {
  const t = T[locale];
  if (!row) return `<p>${pending(locale)}</p>`;
  const gd = Number(row.goalDifference);
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${escapeHtml(label)}</caption><thead><tr><th scope="col">${t.rank}</th><th scope="col">${t.played}</th><th scope="col">${t.won}</th><th scope="col">${t.drawn}</th><th scope="col">${t.lost}</th><th scope="col">${t.gf}</th><th scope="col">${t.ga}</th><th scope="col">${t.gd}</th><th scope="col">${t.pts}</th></tr></thead><tbody><tr><td>${val(row.rank, locale)}</td><td>${val(row.played, locale)}</td><td>${val(row.won, locale)}</td><td>${val(row.drawn, locale)}</td><td>${val(row.lost, locale)}</td><td>${val(row.goalsFor, locale)}</td><td>${val(row.goalsAgainst, locale)}</td><td>${Number.isFinite(gd) ? `${gd > 0 ? "+" : ""}${gd}` : pending(locale)}</td><td><strong>${val(row.points, locale)}</strong></td></tr></tbody></table></div>`;
}

function factsTable(rows) {
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${v}</td></tr>`).join("")}</tbody></table></div>`;
}

const section = (id, title, body) => `<section class="evergreen-section" aria-labelledby="${id}"><h2 id="${id}">${escapeHtml(title)}</h2>${body}</section>`;
const sourceLine = (locale, url, label) => `<p class="evergreen-note">${T[locale].source}: <a href="${escapeHtml(url)}" rel="noopener" target="_blank">${escapeHtml(label || url.replace(/^https?:\/\//, ""))}</a></p>`;

function subNav(club, locale, current) {
  const t = T[locale];
  const items = [["main", name(club, locale)], ["squad", t.squad], ["stats", t.stats], ["honours", t.honours]];
  return `<nav class="evergreen-link-grid" aria-label="${escapeHtml(name(club, locale))}">${items.map(([key, label]) => key === current
    ? `<span aria-current="page"><strong>${escapeHtml(label)}</strong></span>`
    : `<a href="${clubPath(club, locale, key)}">${escapeHtml(label)}</a>`).join("")}</nav>`;
}

function relatedLinks(club, locale) {
  const t = T[locale];
  const links = [];
  const standingsPath = locale === "en" ? club.league.standingsEn : club.league.standingsTr;
  if (pageExists(standingsPath)) links.push([standingsPath, `${club.league.name} ${locale === "en" ? "standings" : "puan durumu"}`]);
  const clPath = locale === "en" ? "/en/champions-league-standings" : "/sampiyonlar-ligi-puan-durumu";
  if (pageExists(clPath)) links.push([clPath, locale === "en" ? "Champions League standings" : "Şampiyonlar Ligi puan durumu"]);
  for (const other of CLUBS.filter((c) => c.id !== club.id)) links.push([clubPath(other, locale), name(other, locale)]);
  const superLig = locale === "en" ? "/en/super-lig-standings" : "/super-lig-puan-durumu";
  if (pageExists(superLig)) links.push([superLig, t.superLig]);
  const onThisDay = locale === "en" ? "/en/on-this-day" : "/tarihte-bugun";
  if (pageExists(onThisDay)) links.push([onThisDay, locale === "en" ? "On this day in football" : "Futbolda tarihte bugün"]);
  if (pageExists(t.teamsPath)) links.push([t.teamsPath, t.teams]);
  links.push([locale === "en" ? "/en" : "/", t.home]);
  return `<aside class="evergreen-related" aria-labelledby="related-heading"><h2 id="related-heading">${t.links}</h2><div class="evergreen-link-grid">${links.map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join("")}</div></aside>`;
}

function teamNode(club, locale, extra = {}) {
  const node = {
    "@type": "SportsTeam",
    "@id": `${absolute(clubPath(club, "tr"))}#team`,
    name: club.officialName,
    alternateName: [...new Set([club.nameEn, club.nameTr, ...(club.nicknames || [])])],
    sport: "Soccer",
    url: absolute(clubPath(club, locale)),
    logo: `https://media.api-sports.io/football/teams/${club.providerTeamId}.png`,
    memberOf: { "@type": "SportsOrganization", name: club.league.name },
    location: { "@type": "Place", name: club.stadium?.name, address: { "@type": "PostalAddress", addressLocality: locale === "en" ? club.city_en : club.city_tr, addressCountry: locale === "en" ? club.country_en : club.country_tr } },
    sameAs: [club.sourceUrl]
  };
  if (club.founded) node.foundingDate = club.founded;
  if (club.manager) node.coach = { "@type": "Person", name: club.manager };
  return { ...node, ...extra };
}

function webPageNode(club, locale, sub, title, description, dataDate) {
  const url = absolute(clubPath(club, locale, sub));
  return {
    "@type": sub === "main" ? "ProfilePage" : "WebPage",
    "@id": `${url}#page`,
    url,
    name: title,
    description,
    inLanguage: locale === "en" ? "en-US" : "tr-TR",
    dateModified: dataDate,
    about: { "@id": `${absolute(clubPath(club, "tr"))}#team` },
    isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: SITE_URL }
  };
}

function breadcrumbs(club, locale, sub) {
  const t = T[locale];
  const items = [{ name: t.home, path: locale === "en" ? "/en" : "/" }];
  if (pageExists(t.teamsPath)) items.push({ name: t.teams, path: t.teamsPath });
  items.push({ name: name(club, locale), path: clubPath(club, locale) });
  if (sub !== "main") items.push({ name: t[sub], path: clubPath(club, locale, sub) });
  return items;
}

function honoursCount(club, pattern) {
  const h = club.honours.find((x) => pattern.test(x.competition_en));
  return h ? h.titles : null;
}

function seasonTitles(club, locale) {
  return club.honours.filter((h) => h.last === "2025–26").map((h) => (locale === "en" ? h.competition_en : h.competition_tr));
}

function mainPage(club, locale) {
  const t = T[locale];
  const n = name(club, locale);
  const row = standingsRow(club, club.league.competitionId);
  const clRow = standingsRow(club, CL_ID);
  const dataDate = standingsUpdatedAt(club.league.competitionId) || club.verifiedAt;
  const { finished, upcoming } = clubMatches(club);
  const league = honoursCount(club, /^(German Championship|La Liga$|League titles)/);
  const ucl = honoursCount(club, /Champions League/);
  const title = locale === "en"
    ? `${n}: History, Honours, Stadium & 2026-27 Season | FutbolRadar`
    : `${n}: Tarihçe, Kupalar, Stadyum ve 2026-27 Sezonu | FutbolRadar`;
  const description = locale === "en"
    ? `${n} club guide: founded ${formatDate(club.founded, "en")}, ${club.stadium.name}, ${league} league titles${ucl ? ` and ${ucl} Champions League/European Cup${ucl > 1 ? "s" : ""}` : ""}, current ${club.league.name} position, recent results and squad.`
    : `${n} rehberi: ${formatDate(club.founded, "tr")} kuruluş, ${club.stadium.name}, ${league} lig şampiyonluğu${ucl ? ` ve ${ucl} Şampiyonlar Ligi/Avrupa Kupası` : ""}, güncel ${club.league.name} sırası, son maçlar ve kadro.`;
  const captain = club.squad.players.filter((p) => p.captain).map((p) => p.name);
  const posCounts = ["GK", "DF", "MF", "FW"].map((code) => `${POSITION[locale][code]}: ${club.squad.players.filter((p) => p.position === code).length}`).join(" · ");
  const won = seasonTitles(club, locale);
  const derbyRows = club.derbies.map((d) => {
    const opponent = locale === "en" ? (d.opponent_en || d.opponent) : d.opponent;
    const target = d.opponentClubId && CLUBS.find((c) => c.id === d.opponentClubId);
    const opp = target ? `<a href="${clubPath(target, locale)}">${escapeHtml(opponent)}</a>` : escapeHtml(opponent);
    return `<li><strong>${escapeHtml(locale === "en" ? d.name_en : d.name_tr)}</strong> — ${opp}</li>`;
  }).join("");

  const content = [
    subNav(club, locale, "main"),
    section("overview-heading", t.overview, `<p>${escapeHtml(locale === "en" ? club.summary_en : club.summary_tr)}</p>${factsTable([
      [t.founded, val(formatDate(club.founded, locale), locale)],
      [t.city, val(locale === "en" ? club.city_en : club.city_tr, locale)],
      [t.league, `<a href="${escapeHtml(locale === "en" ? club.league.standingsEn : club.league.standingsTr)}">${escapeHtml(club.league.name)}</a>`],
      [t.colours, val(locale === "en" ? club.colours_en : club.colours_tr, locale)],
      [t.kit, val(club.kitManufacturer, locale)],
      [t.nicknames, val((club.nicknames || []).join(", "), locale)]
    ])}`),
    section("history-heading", t.history, `<p>${escapeHtml(locale === "en" ? club.history_en : club.history_tr)}</p>`),
    section("trophies-heading", t.trophies, `<ul>${club.honours.filter((h) => h.scope !== "domestic" || h.titles >= 5).map((h) => `<li>${escapeHtml(locale === "en" ? h.competition_en : h.competition_tr)}: <strong>${h.titles}</strong> (${t.last.toLowerCase()}: ${escapeHtml(h.last)})</li>`).join("")}</ul><p><a class="detail-link" href="${clubPath(club, locale, "honours")}">${locale === "en" ? "All honours and records" : "Tüm başarılar ve rekorlar"}</a></p>`),
    section("legends-heading", t.legends, club.legends.length
      ? `<ul>${club.legends.map((l) => `<li><strong>${escapeHtml(l.name)}</strong> — ${escapeHtml(locale === "en" ? l.en : l.tr)}</li>`).join("")}</ul>`
      : `<p>${pending(locale)}</p>`),
    section("season-heading", `${t.season} — ${t.seasonLabel}`, `${standingsTable(row, club, locale, `${club.league.name} · ${t.seasonLabel}`)}${row ? `<p>${t.form}: <strong>${escapeHtml(formLetters(row.form, locale) || t.pending)}</strong></p>` : ""}${clRow ? standingsTable(clRow, club, locale, t.clPhase) : ""}<h3>${t.lastSeasonTitles}</h3><p>${won.length ? escapeHtml(won.join(", ")) : t.none}</p>`),
    section("recent-heading", t.recent, matchesTable(finished, club, locale, true)),
    section("upcoming-heading", t.upcoming, matchesTable(upcoming, club, locale, false)),
    section("stadium-heading", t.stadium, factsTable([
      [t.stadium, val(club.stadium?.name, locale)],
      [t.capacity, val(formatNumber(club.stadium?.capacity, locale), locale)]
    ])),
    section("manager-heading", t.manager, `<p>${val(club.manager, locale)}</p>`),
    section("squad-summary-heading", t.squadSummary, `<p>${locale === "en" ? `${club.squad.players.length} first-team players` : `${club.squad.players.length} A takım oyuncusu`} · ${escapeHtml(posCounts)}</p>${captain.length ? `<p>${locale === "en" ? "Captain(s)" : "Kaptan(lar)"}: ${escapeHtml(captain.join(", "))}</p>` : ""}<p><a class="detail-link" href="${clubPath(club, locale, "squad")}">${locale === "en" ? `Full ${n} squad` : `${n} kadrosunun tamamı`}</a></p>`),
    section("derbies-heading", t.derbies, `<ul>${derbyRows}</ul>`),
    sourceLine(locale, club.sourceUrl, "Wikipedia"),
    relatedLinks(club, locale)
  ].join("\n");

  return {
    title, description, dataDate,
    html: renderPage({
      locale, path: clubPath(club, locale), altPath: clubPath(club, locale === "en" ? "tr" : "en"), title, description,
      h1: locale === "en" ? `${n} — history, honours, squad and ${t.seasonLabel}` : `${n} — tarihçe, kupalar, kadro ve ${t.seasonLabel}`,
      kicker: `${locale === "en" ? club.country_en : club.country_tr} · ${club.league.name}`,
      intro: null, breadcrumbs: breadcrumbs(club, locale, "main"), dataDate,
      freshnessNote: locale === "en" ? "Live blocks come from provider data; historical facts are sourced." : "Canlı bloklar sağlayıcı verisinden, tarihî bilgiler kaynaklıdır.",
      schema: [webPageNode(club, locale, "main", title, description, dataDate), teamNode(club, locale)],
      content
    })
  };
}

function squadPage(club, locale) {
  const t = T[locale];
  const n = name(club, locale);
  const dataDate = club.squad.asOf;
  const title = locale === "en"
    ? `${n} Squad 2026-27: Players, Positions & Shirt Numbers | FutbolRadar`
    : `${n} Kadrosu 2026-27: Oyuncular, Mevkiler ve Forma Numaraları | FutbolRadar`;
  const description = locale === "en"
    ? `${n} first-team squad for 2026-27: ${club.squad.players.length} players with shirt numbers, positions and nationalities, from the club's official list.`
    : `${n} 2026-27 A takım kadrosu: ${club.squad.players.length} oyuncunun forma numarası, mevkisi ve uyruğu, kulübün resmi listesine göre.`;
  const groups = ["GK", "DF", "MF", "FW"].map((code) => {
    const players = club.squad.players.filter((p) => p.position === code).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
    if (!players.length) return "";
    const rows = players.map((p) => `<tr><td>${p.number ?? "—"}</td><th scope="row">${escapeHtml(p.name)}${p.captain ? ` <small>(${t.captain})</small>` : ""}</th><td>${escapeHtml(nation(p.nationality, locale))}</td></tr>`).join("");
    return `<h3>${POSITION[locale][code]}</h3><div class="evergreen-table-wrap"><table class="evergreen-table"><thead><tr><th scope="col">${t.number}</th><th scope="col">${t.player}</th><th scope="col">${t.nationality}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("");
  const content = [
    subNav(club, locale, "squad"),
    section("squad-heading", `${t.squad} — ${t.seasonLabel}`, `${groups}<p class="evergreen-note">${t.squadSource}: <a href="${escapeHtml(club.squad.officialSourceUrl)}" rel="noopener" target="_blank">${escapeHtml(club.squad.officialSourceUrl.replace(/^https?:\/\//, ""))}</a> · <a href="${escapeHtml(club.squad.sourceUrl)}" rel="noopener" target="_blank">Wikipedia</a> (${t.asOf} ${escapeHtml(formatDate(club.squad.asOf, locale))})</p>`),
    section("manager-heading", t.manager, `<p>${val(club.manager, locale)}</p>`),
    relatedLinks(club, locale)
  ].join("\n");
  const athletes = club.squad.players.map((p) => ({ "@type": "Person", name: p.name, ...(NATIONS[p.nationality] ? { nationality: { "@type": "Country", name: NATIONS[p.nationality][1] } } : {}) }));
  return {
    title, description, dataDate,
    html: renderPage({
      locale, path: clubPath(club, locale, "squad"), altPath: clubPath(club, locale === "en" ? "tr" : "en", "squad"), title, description,
      h1: locale === "en" ? `${n} squad — players, positions and numbers` : `${n} kadrosu — oyuncular, mevkiler ve numaralar`,
      kicker: `${club.league.name} · ${t.seasonLabel}`, intro: null, breadcrumbs: breadcrumbs(club, locale, "squad"), dataDate,
      schema: [webPageNode(club, locale, "squad", title, description, dataDate), teamNode(club, locale, { athlete: athletes })],
      content
    })
  };
}

function leadersTable(rows, locale, kind) {
  const t = T[locale];
  if (!rows.length) return `<p>${pending(locale)}</p>`;
  const body = rows.map((r) => `<tr><td>${val(r.rank, locale)}</td><th scope="row">${escapeHtml(r.name)}</th><td>${val(kind === "assists" ? r.assists : r.goals, locale)}</td><td>${val(kind === "assists" ? r.goals : r.assists, locale)}</td><td>${val(r.appearances, locale)}</td><td>${val(r.minutes, locale)}</td></tr>`).join("");
  const [a, b] = kind === "assists" ? [t.assists, t.goals] : [t.goals, t.assists];
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><thead><tr><th scope="col">${t.rank}</th><th scope="col">${t.player}</th><th scope="col">${a}</th><th scope="col">${b}</th><th scope="col">${t.apps}</th><th scope="col">${t.minutes}</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function statsPage(club, locale) {
  const t = T[locale];
  const n = name(club, locale);
  const row = standingsRow(club, club.league.competitionId);
  const dataDate = (LEADERS[`topscorers:${club.league.leagueId}:2026`]?.updatedAt || "").slice(0, 10) || standingsUpdatedAt(club.league.competitionId) || club.verifiedAt;
  const title = locale === "en"
    ? `${n} Stats 2026-27: Top Scorers, Assists & Per-Match Numbers | FutbolRadar`
    : `${n} İstatistikleri 2026-27: Golcüler, Asistler ve Maç Başına Veriler | FutbolRadar`;
  const description = locale === "en"
    ? `${n} 2026-27 statistics: ${club.league.name} goals and assists leaders, Champions League contributions, goals scored and conceded per match.`
    : `${n} 2026-27 istatistikleri: ${club.league.name} gol ve asist liderleri, Şampiyonlar Ligi katkıları, maç başına atılan ve yenen goller.`;
  const per = (a) => (row && Number(row.played) > 0 ? (Number(a) / Number(row.played)).toFixed(2) : null);
  const content = [
    subNav(club, locale, "stats"),
    section("league-scorers-heading", `${club.league.name}: ${t.goals}`, leadersTable(leaderRows(club, club.league.leagueId, "topscorers"), locale, "goals")),
    section("league-assists-heading", `${club.league.name}: ${t.assists}`, leadersTable(leaderRows(club, club.league.leagueId, "assists"), locale, "assists")),
    section("cl-scorers-heading", `${locale === "en" ? "Champions League" : "Şampiyonlar Ligi"}: ${t.goals}`, leadersTable(leaderRows(club, "2", "topscorers"), locale, "goals")),
    section("per-match-heading", `${t.perMatch} — ${club.league.name}`, row ? factsTable([
      [t.played, val(row.played, locale)],
      [t.gfPer, val(per(row.goalsFor), locale)],
      [t.gaPer, val(per(row.goalsAgainst), locale)],
      [t.ptsPer, val(per(row.points), locale)],
      [t.form, val(formLetters(row.form, locale), locale)]
    ]) : `<p>${pending(locale)}</p>`),
    `<p class="evergreen-note">${locale === "en"
      ? "Scorer tables list only this club's players who appear in the provider's league-wide top-scorer and top-assist lists (API-Football). Players outside those lists are not shown."
      : "Golcü tabloları, sağlayıcının (API-Football) lig geneli gol ve asist listelerinde yer alan bu kulübün oyuncularını gösterir; listede olmayan oyuncular gösterilmez."}</p>`,
    relatedLinks(club, locale)
  ].join("\n");
  return {
    title, description, dataDate,
    html: renderPage({
      locale, path: clubPath(club, locale, "stats"), altPath: clubPath(club, locale === "en" ? "tr" : "en", "stats"), title, description,
      h1: locale === "en" ? `${n} stats — scorers, assists and per-match numbers` : `${n} istatistikleri — golcüler, asistler ve maç başına veriler`,
      kicker: `${club.league.name} · ${t.seasonLabel}`, intro: null, breadcrumbs: breadcrumbs(club, locale, "stats"), dataDate,
      schema: [webPageNode(club, locale, "stats", title, description, dataDate), teamNode(club, locale)],
      content
    })
  };
}

function honoursPage(club, locale) {
  const t = T[locale];
  const n = name(club, locale);
  const dataDate = club.verifiedAt;
  const total = club.honours.reduce((sum, h) => sum + h.titles, 0);
  const league = honoursCount(club, /^(German Championship|La Liga$|League titles)/);
  const title = locale === "en"
    ? `${n} Honours: League Titles, European Cups & Records | FutbolRadar`
    : `${n} Başarıları: Şampiyonluklar, Avrupa Kupaları ve Rekorlar | FutbolRadar`;
  const description = locale === "en"
    ? `Every major ${n} trophy: ${league} league titles, domestic cups, European and worldwide honours with first and latest wins, plus club records.`
    : `${GENITIVE_TR[club.id] || n} tüm büyük kupaları: ${league} lig şampiyonluğu, ulusal kupalar, Avrupa ve dünya kupaları; ilk ve son zaferler, kulüp rekorları.`;
  const groups = ["domestic", "continental", "worldwide"].map((scope) => {
    const list = club.honours.filter((h) => h.scope === scope);
    if (!list.length) return "";
    const rows = list.map((h) => `<tr><th scope="row">${escapeHtml(locale === "en" ? h.competition_en : h.competition_tr)}</th><td><strong>${h.titles}</strong></td><td>${escapeHtml(h.first)}</td><td>${escapeHtml(h.last)}</td></tr>`).join("");
    return `<h3>${t[scope]}</h3><div class="evergreen-table-wrap"><table class="evergreen-table"><thead><tr><th scope="col">${t.competition}</th><th scope="col">${t.titles}</th><th scope="col">${t.first}</th><th scope="col">${t.last}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("");
  const content = [
    subNav(club, locale, "honours"),
    section("honours-heading", t.honours, `<p>${locale === "en" ? `${total} major titles in the competitions listed below.` : `Aşağıdaki turnuvalarda toplam ${total} büyük kupa.`}</p>${groups}`),
    section("records-heading", t.records, `<ul>${club.records.map((r) => `<li>${escapeHtml(locale === "en" ? r.en : r.tr)}</li>`).join("")}</ul>`),
    sourceLine(locale, club.sourceUrl, "Wikipedia"),
    relatedLinks(club, locale)
  ].join("\n");
  const list = {
    "@type": "ItemList",
    name: title,
    itemListElement: club.honours.map((h, i) => ({ "@type": "ListItem", position: i + 1, name: `${h.competition_en}: ${h.titles}` }))
  };
  return {
    title, description, dataDate,
    html: renderPage({
      locale, path: clubPath(club, locale, "honours"), altPath: clubPath(club, locale === "en" ? "tr" : "en", "honours"), title, description,
      h1: locale === "en" ? `${n} honours — titles, European cups and records` : `${n} başarıları — şampiyonluklar, Avrupa kupaları ve rekorlar`,
      kicker: club.officialName, intro: null, breadcrumbs: breadcrumbs(club, locale, "honours"), dataDate,
      schema: [webPageNode(club, locale, "honours", title, description, dataDate), teamNode(club, locale), list],
      content
    })
  };
}

const BUILDERS = { main: mainPage, squad: squadPage, stats: statsPage, honours: honoursPage };
const sitemapEntries = [];
const report = [];

for (const club of CLUBS) {
  for (const locale of ["tr", "en"]) {
    for (const [sub, build] of Object.entries(BUILDERS)) {
      const page = build(club, locale);
      const urlPath = clubPath(club, locale, sub);
      writePage(urlPath, page.html);
      sitemapEntries.push({
        path: urlPath, altPath: clubPath(club, locale === "en" ? "tr" : "en", sub), locale, lastmod: page.dataDate,
        changefreq: sub === "honours" ? "monthly" : "daily", priority: sub === "main" ? "0.8" : "0.6"
      });
      report.push(urlPath);
    }
  }
}

const ownPrefixes = CLUBS.flatMap((c) => [absolute(clubPath(c, "tr")), absolute(clubPath(c, "en"))]);
updateSitemap(sitemapEntries, (loc) => ownPrefixes.some((prefix) => loc === prefix || loc.startsWith(`${prefix}/`)));

console.log(`[world-club-pages] ${report.length} pages for ${CLUBS.length} clubs`);
