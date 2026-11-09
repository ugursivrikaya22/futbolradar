/**
 * PREMIER LİG + LA LIGA KULÜP SAYFALARI.
 *
 * Sayılar yalnızca API-Football kaydından gelir: puan satırı
 * `data/league-standings.json`, kadro / stadyum / fikstür
 * `data/european-club-dossier.json` (scripts/sync-european-club-dossier.mjs).
 * TheSportsDB yok. Kaynak gösterilemeyen bölüm yazılmaz; sayı uydurulmaz.
 *
 * İndeks eşiği (hub): lig sırası (en az MIN_PLAYED maç, sıra, puan, form),
 * en az MIN_RESULTS bitmiş lig skoru, MIN_FIXTURES kayıtlı program maçı,
 * ülke veya stadyum. Kadro yoksa bölüm yazılmaz; hub eşiği kadro beklemez.
 * Altında `noindex,follow` ve site haritası dışı.
 *
 * Kadro alt sayfası yalnızca en az MIN_SQUAD isim varsa yazılır ve indekslenir.
 * Serie A, Bundesliga, Ligue 1 ve Avrupa kupası sayfaları bu turda yok
 * (docs/european-club-pages.md).
 */
import { STANDINGS_LEAGUES } from "./standingsCatalog.mjs";
import { RICH_TEAM_PAGES } from "./richTeamPages.mjs";

export const DOSSIER_FILE = "data/european-club-dossier.json";
export const SOURCE_DOCS = "https://www.api-football.com/documentation-v3";
export const MIN_PLAYED = 3;
export const MIN_SQUAD = 15;
export const MIN_RESULTS = 3;
export const MIN_FIXTURES = 1;

export const INDEX_LEAGUES = Object.freeze({
  "premier-league": Object.freeze({ providerLeagueId: "39" }),
  "la-liga": Object.freeze({ providerLeagueId: "140" })
});

const POSITION_ORDER = ["Goalkeeper", "Defender", "Midfielder", "Attacker"];
const POSITION_LABEL = Object.freeze({
  tr: { Goalkeeper: "Kaleci", Defender: "Defans", Midfielder: "Orta saha", Attacker: "Forvet", Other: "Diğer" },
  en: { Goalkeeper: "Goalkeeper", Defender: "Defender", Midfielder: "Midfielder", Attacker: "Forward", Other: "Other" }
});

const SKIP_FIXTURE = new Set(["POSTPONED", "CANCELLED", "ABANDONED", "UNKNOWN", "AWARDED"]);
const UPCOMING = new Set(["SCHEDULED", "LIVE", "HALFTIME", "INTERRUPTED"]);

export function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clock(iso) {
  const match = String(iso || "").match(/T(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

function dateOnly(iso) {
  const text = String(iso || "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

export function playersOf(club) {
  return (club && Array.isArray(club.players) ? club.players : []).filter((player) => player && String(player.name || "").trim());
}

export function venueOf(club) {
  const venue = club && club.venue;
  if (!venue || typeof venue !== "object") return null;
  const name = String(venue.name || "").trim();
  const city = String(venue.city || "").trim();
  const capacity = finite(venue.capacity);
  if (!name && !city && capacity === null) return null;
  return { name, city, capacity: capacity !== null && capacity > 0 ? capacity : null };
}

export function clubFacts(club) {
  if (!club) return { country: "", founded: null, venue: null };
  const founded = finite(club.founded);
  return {
    country: String(club.country || "").trim(),
    founded: founded !== null && founded >= 1800 && founded <= 2100 ? founded : null,
    venue: venueOf(club)
  };
}

export function hasClubInfo(club) {
  const facts = clubFacts(club);
  return Boolean(facts.country || (facts.venue && (facts.venue.name || facts.venue.city)));
}

export function splitMatches(matches, teamId) {
  const id = String(teamId || "");
  const mine = (Array.isArray(matches) ? matches : []).filter((match) => {
    if (!match) return false;
    return String(match.homeTeamId || "") === id || String(match.awayTeamId || "") === id;
  });
  const byKick = (a, b) => String(a.kickoff || "").localeCompare(String(b.kickoff || ""));
  const results = mine
    .filter((match) => match.status === "FINISHED" && finite(match.homeScore) !== null && finite(match.awayScore) !== null)
    .sort(byKick)
    .slice(-5)
    .reverse();
  const fixtures = mine
    .filter((match) => UPCOMING.has(match.status) && !SKIP_FIXTURE.has(match.status))
    .sort(byKick)
    .slice(0, 5);
  return { results, fixtures };
}

export function domesticStanding(record) {
  return (record && record.competitions || []).find((item) => INDEX_LEAGUES[item.leagueId]) || null;
}

/**
 * Hub indeks eşiği. Eksik parça `reasons` içinde durur; sayfa yine
 * eldeki bölümleri basabilir ama `indexable` yanlışsa noindex kalır.
 */
export function assessHub({ standing, club, matches, teamId }) {
  const reasons = [];
  if (!standing) reasons.push("standing");
  else {
    if (finite(standing.rank) === null) reasons.push("rank");
    if (finite(standing.played) === null || finite(standing.played) < MIN_PLAYED) reasons.push("played");
    if (finite(standing.points) === null) reasons.push("points");
    if (!Array.isArray(standing.form) || standing.form.length < 1) reasons.push("form");
  }
  if (!hasClubInfo(club)) reasons.push("club");
  const split = splitMatches(matches, teamId);
  if (split.results.length < MIN_RESULTS) reasons.push("results");
  if (split.fixtures.length < MIN_FIXTURES) reasons.push("fixtures");
  return { indexable: reasons.length === 0, reasons, ...split };
}

export function assessSquad(club) {
  const count = playersOf(club).length;
  return { indexable: count >= MIN_SQUAD, count };
}

export function leagueName(leagueId, locale) {
  const entry = STANDINGS_LEAGUES[leagueId];
  if (!entry) return leagueId || "";
  return locale === "en" ? entry.nameEn : entry.nameTr;
}

function goalDifference(standing) {
  const number = finite(standing.goalDifference);
  if (number !== null) return number;
  const gf = finite(standing.goalsFor);
  const ga = finite(standing.goalsAgainst);
  if (gf === null || ga === null) return null;
  return gf - ga;
}

function formatDiff(value) {
  if (value === null) return "";
  return `${value > 0 ? "+" : ""}${value}`;
}

export function groupPlayers(players) {
  const groups = new Map(POSITION_ORDER.map((key) => [key, []]));
  const other = [];
  for (const player of players) {
    const key = POSITION_ORDER.includes(player.position) ? player.position : "";
    if (key) groups.get(key).push(player);
    else other.push(player);
  }
  const ordered = POSITION_ORDER.filter((key) => groups.get(key).length).map((key) => ({ key, players: groups.get(key) }));
  if (other.length) ordered.push({ key: "Other", players: other });
  return ordered;
}

function sourceLine(locale, detail, recorded) {
  const when = dateOnly(recorded);
  const docs = `<a class="tp-src" target="_blank" rel="nofollow noopener noreferrer" href="${SOURCE_DOCS}">API-Football</a>`;
  if (locale === "en") {
    return `<p class="evergreen-freshness">Source: ${docs}${detail ? `, ${escapeHtml(detail)}` : ""}${when ? `, recorded ${escapeHtml(when)}` : ""}.</p>`;
  }
  return `<p class="evergreen-freshness">Kaynak: ${docs}${detail ? `, ${escapeHtml(detail)}` : ""}${when ? `, kayıt ${escapeHtml(when)}` : ""}.</p>`;
}

function statTable(rows) {
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><tbody>${rows.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</tbody></table></div>`;
}

function standingSection(standing, locale, recorded) {
  const en = locale === "en";
  const diff = goalDifference(standing);
  const rows = [
    [en ? "Rank" : "Sıra", finite(standing.rank)],
    [en ? "Played" : "Oynanan", finite(standing.played)],
    [en ? "Won" : "Galibiyet", finite(standing.won)],
    [en ? "Drawn" : "Beraberlik", finite(standing.drawn)],
    [en ? "Lost" : "Mağlubiyet", finite(standing.lost)],
    [en ? "Goals for" : "Attığı", finite(standing.goalsFor)],
    [en ? "Goals against" : "Yediği", finite(standing.goalsAgainst)],
    [en ? "Goal difference" : "Averaj", diff === null ? null : formatDiff(diff)],
    [en ? "Points" : "Puan", finite(standing.points)]
  ].filter(([, value]) => value !== null && value !== "");
  const form = (standing.form || []).join(" ");
  const legend = en
    ? "Form letters are the provider codes: W win, D draw, L loss."
    : "Form harfleri sağlayıcı kodudur: W galibiyet, D beraberlik, L mağlubiyet.";
  const leagueId = standing.providerLeagueId || (INDEX_LEAGUES[standing.leagueId] || {}).providerLeagueId || "";
  const season = standing.season || "";
  return `<section class="evergreen-section" id="puan"><h2>${escapeHtml(leagueName(standing.leagueId, locale))} ${escapeHtml(season)}</h2>${statTable(rows)}${form ? `<p>${en ? "Form" : "Form"}: ${escapeHtml(form)}</p><p>${escapeHtml(legend)}</p>` : ""}${sourceLine(locale, `/standings?league=${leagueId}&season=${season}`, recorded || standing.updatedAt)}</section>`;
}

function extraCompetitions(record, locale) {
  return (record.competitions || []).filter((item) => item !== domesticStanding(record) && finite(item.rank) !== null).map((item) => {
    const bits = [];
    const en = locale === "en";
    if (finite(item.rank) !== null) bits.push(`${en ? "Rank" : "Sıra"} ${item.rank}`);
    if (finite(item.played) !== null) bits.push(`${en ? "Played" : "Oynanan"} ${item.played}`);
    if (finite(item.points) !== null) bits.push(`${en ? "Points" : "Puan"} ${item.points}`);
    const form = (item.form || []).join(" ");
    return `<section class="evergreen-section"><h2>${escapeHtml(leagueName(item.leagueId, locale))} ${escapeHtml(item.season || "")}</h2><p>${escapeHtml(bits.join(" · "))}</p>${form ? `<p>${en ? "Form" : "Form"}: ${escapeHtml(form)}</p>` : ""}${sourceLine(locale, `/standings league ${item.providerLeagueId || item.leagueId}`, item.updatedAt)}</section>`;
  }).join("");
}

function factsSection(club, locale) {
  const facts = clubFacts(club);
  const en = locale === "en";
  const rows = [];
  if (facts.country) rows.push([en ? "Country" : "Ülke", facts.country]);
  if (facts.founded !== null) rows.push([en ? "Founded" : "Kuruluş", String(facts.founded)]);
  if (facts.venue && facts.venue.name) rows.push([en ? "Stadium" : "Stadyum", facts.venue.name]);
  if (facts.venue && facts.venue.city) rows.push([en ? "City" : "Şehir", facts.venue.city]);
  if (facts.venue && facts.venue.capacity !== null) rows.push([en ? "Capacity" : "Kapasite", String(facts.venue.capacity)]);
  if (!rows.length) return "";
  const detail = club.infoSource === "fixtures"
    ? (en ? "stadium on home fixtures; country is the league country" : "iç saha fikstüründeki stadyum; ülke lig ülkesi")
    : "/teams";
  return `<section class="evergreen-section" id="kulup"><h2>${en ? "Club" : "Kulüp"}</h2>${statTable(rows)}${sourceLine(locale, detail, club.teamsFetchedAt)}</section>`;
}

function resultMark(match, teamId, locale) {
  const home = finite(match.homeScore);
  const away = finite(match.awayScore);
  const usHome = String(match.homeTeamId || "") === String(teamId);
  const us = usHome ? home : away;
  const them = usHome ? away : home;
  if (us === null || them === null) return "";
  if (us > them) return locale === "en" ? "W" : "G";
  if (us < them) return locale === "en" ? "L" : "M";
  return locale === "en" ? "D" : "B";
}

function matchItems(list, teamId, locale, mode) {
  return list.map((match) => {
    const when = dateOnly(match.kickoff);
    const time = match.time || clock(match.kickoff);
    const stamp = [when, time].filter(Boolean).join(" ");
    const score = mode === "result" ? `${finite(match.homeScore)}-${finite(match.awayScore)}` : (locale === "en" ? "scheduled" : "program");
    const mark = mode === "result" ? resultMark(match, teamId, locale) : "";
    const bits = [match.venue, finite(match.round) !== null ? (locale === "en" ? `Round ${match.round}` : `Hafta ${match.round}`) : ""].filter(Boolean);
    return `<li>${mark ? `<span class="tp-res">${escapeHtml(mark)}</span> ` : ""}<span>${escapeHtml(stamp)}</span> <strong>${escapeHtml(match.homeTeam || "")} ${escapeHtml(score)} ${escapeHtml(match.awayTeam || "")}</strong>${bits.length ? ` <small>${escapeHtml(bits.join(" · "))}</small>` : ""}</li>`;
  }).join("");
}

function leaderSection(leaders, locale, recorded) {
  const rows = (Array.isArray(leaders) ? leaders : []).filter((row) => row && row.name);
  if (!rows.length) return "";
  const en = locale === "en";
  const items = rows.slice(0, 6).map((row) => {
    const bits = [];
    if (finite(row.goals) > 0) bits.push(en ? `${row.goals} goals` : `${row.goals} gol`);
    if (finite(row.assists) > 0) bits.push(en ? `${row.assists} assists` : `${row.assists} asist`);
    return `<li><strong>${escapeHtml(row.name)}</strong>${bits.length ? ` — ${escapeHtml(bits.join(", "))}` : ""}</li>`;
  }).join("");
  return `<section class="evergreen-section" id="liderler"><h2>${en ? "Goals and assists" : "Gol ve asist"}</h2><ul>${items}</ul>${sourceLine(locale, "/players/topscorers and /players/topassists", recorded)}</section>`;
}

function matchSections(split, teamId, locale, leagueId, season, recorded) {
  const en = locale === "en";
  const providerId = (INDEX_LEAGUES[leagueId] || {}).providerLeagueId || "";
  const detail = `/fixtures?league=${providerId}&season=${season}`;
  const results = split.results.length
    ? `<section class="evergreen-section" id="sonuclar"><h2>${en ? "Recent results" : "Sonuçlar"}</h2><ul class="tp-results">${matchItems(split.results, teamId, locale, "result")}</ul>${sourceLine(locale, detail, recorded)}</section>`
    : "";
  const fixtures = split.fixtures.length
    ? `<section class="evergreen-section" id="fikstur"><h2>${en ? "Fixtures" : "Fikstür"}</h2><ul class="tp-fixtures">${matchItems(split.fixtures, teamId, locale, "fixture")}</ul>${sourceLine(locale, detail, recorded)}</section>`
    : "";
  return results + fixtures;
}

function squadMarkup(club, locale, compact) {
  const players = playersOf(club);
  if (!players.length) return "";
  const labels = POSITION_LABEL[locale] || POSITION_LABEL.en;
  const groups = groupPlayers(players).map((group) => {
    const items = group.players.map((player) => {
      const number = finite(player.number);
      const age = finite(player.age);
      const prefix = number === null ? "" : `${number} `;
      const meta = [];
      if (age !== null) meta.push(locale === "en" ? `age ${age}` : `yaş ${age}`);
      return `<li><b>${escapeHtml(prefix)}</b>${escapeHtml(player.name)}${meta.length ? `<small>${escapeHtml(meta.join(", "))}</small>` : ""}</li>`;
    }).join("");
    return `<h3>${escapeHtml(labels[group.key] || group.key)}</h3><ul class="tp-squad">${items}</ul>`;
  }).join("");
  const note = sourceLine(locale, `/players/squads?team=${club.teamId || ""}`, club.squadFetchedAt);
  if (compact) return groups + note;
  return groups + note;
}

export function pageCopy(record, standing, locale, kind, options = {}) {
  const en = locale === "en";
  const name = record.name;
  const league = leagueName(standing.leagueId, locale);
  const season = standing.season || "";
  const rank = finite(standing.rank);
  const points = finite(standing.points);
  const played = finite(standing.played);
  if (kind === "squad") {
    const title = en ? `${name} squad | FutbolRadar` : `${name} kadrosu | FutbolRadar`;
    const description = en
      ? `${name} squad in ${league} ${season}. Named players recorded by API-Football.`
      : `${name} kadrosu, ${league} ${season}. İsimler API-Football kadro kaydından.`;
    const h1 = en ? `${name} squad` : `${name} kadrosu`;
    return { title, description, h1 };
  }
  const withSquad = Boolean(options.hasSquad);
  const withFixtures = options.hasFixtures !== false;
  const title = withSquad
    ? (en ? `${name}: squad, table and matches | FutbolRadar` : `${name}: kadro, puan ve maçlar | FutbolRadar`)
    : (en ? `${name}: table, form and matches | FutbolRadar` : `${name}: puan, form ve maçlar | FutbolRadar`);
  const bits = en
    ? [withSquad ? "Squad" : "Table", "form", withFixtures ? "fixtures" : ""].filter(Boolean)
    : [withSquad ? "Kadro" : "Puan", "form", withFixtures ? "fikstür" : ""].filter(Boolean);
  const joined = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(", ")} ${en ? "and" : "ve"} ${bits.at(-1)}`;
  const tail = en ? `${joined} from API-Football.` : `${joined} API-Football kaydından.`;
  const description = en
    ? `${name}, ${league} ${season}: rank ${rank}, ${points} points from ${played} matches. ${tail}`
    : `${name}, ${league} ${season}: ${rank}. sıra, ${points} puan, ${played} maç. ${tail}`;
  return { title, description, h1: name };
}

function jsonLd(canonical, copy, locale, record, standing, club) {
  const team = {
    "@type": "SportsTeam",
    name: record.name,
    sport: "Football",
    url: canonical,
    memberOf: { "@type": "SportsOrganization", name: leagueName(standing.leagueId, locale) }
  };
  const facts = clubFacts(club);
  if (facts.founded !== null) team.foundingDate = String(facts.founded);
  if (facts.venue && facts.venue.name) team.location = { "@type": "StadiumOrArena", name: facts.venue.name };
  const athletes = playersOf(club).slice(0, 40).map((player) => ({ "@type": "Person", name: player.name }));
  if (athletes.length) team.athlete = athletes;
  if (record.logo) team.logo = record.logo;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url: canonical,
        name: copy.h1,
        inLanguage: locale === "en" ? "en" : "tr-TR",
        description: copy.description
      },
      team
    ]
  };
}

const STYLE = `<style>.tp-squad{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;list-style:none;margin:0 0 12px;padding:0}.tp-squad li,.tp-results li,.tp-fixtures li{overflow-wrap:anywhere}.tp-page a{display:inline-flex;align-items:center;min-height:32px}.tp-page .evergreen-table-wrap{overflow-x:auto}.tp-results,.tp-fixtures{list-style:none;margin:0;padding:0;display:grid;gap:8px}.tp-results li,.tp-fixtures li{padding:10px 12px;border:1px solid var(--line,rgba(127,127,127,.25));border-radius:12px}.tp-res{display:inline-flex;align-items:center;justify-content:center;min-width:1.6em;height:1.6em;border-radius:6px;font-weight:700;margin-right:6px;background:rgba(127,127,127,.18)}</style>`;

function alternates({ trUrl, enUrl }) {
  return [
    `<link rel="alternate" hreflang="tr-TR" href="${trUrl}" />`,
    `<link rel="alternate" hreflang="en" href="${enUrl}" />`,
    `<link rel="alternate" hreflang="x-default" href="${trUrl}" />`
  ].join("\n    ");
}

function shell({ locale, base, title, description, robots, canonical, trUrl, enUrl, record, body, json, header, footer }) {
  const en = locale === "en";
  return `<!doctype html>
<html lang="${en ? "en" : "tr"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${robots}" />
    <link rel="canonical" href="${canonical}" />
    ${alternates({ trUrl, enUrl })}
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${base}page.css" />
    ${STYLE}
    <script type="application/ld+json">${JSON.stringify(json).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell tp-page" data-team-id="${escapeHtml(record.id)}" data-european-club="${escapeHtml(record.id)}">
      ${header || ""}
      <main class="evergreen-page">
        <div class="container">
          ${body}
        </div>
      </main>
      ${footer || ""}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

/**
 * Başlık ve açıklama üreticide doğrulanır. 60/155 sınırını aşan bir
 * kayıt yazılmaz; uzun ad sessizce kısılmaz.
 */
export function assertMeta(copy, tag) {
  if (copy.title.length > 60) throw new Error(`[${tag}] title ${copy.title.length}>60`);
  if (copy.description.length > 155) throw new Error(`[${tag}] description ${copy.description.length}>155`);
}

export function renderHub(options) {
  const { record, standing, club, matches, locale, robots, header, footer } = options;
  const en = locale === "en";
  const split = splitMatches(matches, record.id);
  const copy = pageCopy(record, standing, locale, "hub", {
    hasSquad: playersOf(club).length >= MIN_SQUAD,
    hasFixtures: split.fixtures.length > 0
  });
  assertMeta(copy, record.slug);
  const trUrl = `https://www.futbolradar.com/takimlar/${record.slug}`;
  const enUrl = `https://www.futbolradar.com/en/club/${record.slug}`;
  const canonical = en ? enUrl : trUrl;
  const base = en ? "../../" : "../";
  const squadHref = en ? `./${record.slug}/squad.html` : `./${record.slug}/kadro.html`;
  const standingsHref = en
    ? `../${STANDINGS_LEAGUES[standing.leagueId].slugEn}.html`
    : `../${STANDINGS_LEAGUES[standing.leagueId].slugTr}.html`;
  const squadLink = playersOf(club).length
    ? `<p><a href="${squadHref}">${en ? `${escapeHtml(record.name)} squad` : `${escapeHtml(record.name)} kadrosu`}</a></p>`
    : "";
  const intro = en
    ? `${leagueName(standing.leagueId, "en")} table, form, squad and fixtures recorded from API-Football. Sections without a stored row are left out.`
    : `${leagueName(standing.leagueId, "tr")} puanı, form, kadro ve fikstür API-Football kaydından. Kaydı olmayan bölüm yazılmaz.`;
  const rank = finite(standing.rank);
  const points = finite(standing.points);
  const body = `
          <header class="evergreen-hero">
            <span class="section-kicker">${escapeHtml(leagueName(standing.leagueId, locale))}</span>
            <h1>${record.logo ? `<img src="${escapeHtml(record.logo)}" alt="" width="36" height="36" /> ` : ""}${escapeHtml(copy.h1)}</h1>
            <p>${escapeHtml(intro)}</p>
            <p>${en ? "Rank" : "Sıra"} ${rank === null ? "" : rank} · ${en ? "points" : "puan"} ${points === null ? "" : points}.</p>
            <p><a href="${standingsHref}">${escapeHtml(leagueName(standing.leagueId, locale))}</a></p>
            ${squadLink}
          </header>
          ${standingSection(standing, locale, standing.updatedAt)}
          ${extraCompetitions(record, locale)}
          ${factsSection({ ...club, teamId: record.id, teamsFetchedAt: club && club.teamsFetchedAt }, locale)}
          ${matchSections(split, record.id, locale, standing.leagueId, standing.season || "", club && club.fixturesFetchedAt)}
          ${leaderSection(options.leaders, locale, options.leadersRecorded)}
          ${playersOf(club).length ? `<section class="evergreen-section" id="kadro"><h2>${en ? "Squad" : "Kadro"}</h2>${squadMarkup({ ...club, teamId: record.id }, locale, true)}</section>` : ""}
          ${options.nav || ""}`;
  const html = shell({
    locale,
    base,
    title: copy.title,
    description: copy.description,
    robots,
    canonical,
    trUrl,
    enUrl,
    record,
    body,
    header,
    footer,
    json: jsonLd(canonical, copy, locale, record, standing, club)
  });
  return { html, copy, canonical, trUrl, enUrl };
}

export function renderSquad(options) {
  const { record, standing, club, locale, robots } = options;
  const en = locale === "en";
  const copy = pageCopy(record, standing, locale, "squad");
  assertMeta(copy, `${record.slug}-squad`);
  const trUrl = `https://www.futbolradar.com/takimlar/${record.slug}/kadro`;
  const enUrl = `https://www.futbolradar.com/en/club/${record.slug}/squad`;
  const canonical = en ? enUrl : trUrl;
  const base = en ? "../../../" : "../../";
  const hubHref = en ? "../" + record.slug + ".html" : "../" + record.slug + ".html";
  const body = `
          <header class="evergreen-hero">
            <span class="section-kicker">${escapeHtml(leagueName(standing.leagueId, locale))}</span>
            <h1>${escapeHtml(copy.h1)}</h1>
            <p><a href="${hubHref}">${escapeHtml(record.name)}</a></p>
          </header>
          <section class="evergreen-section" id="kadro">${squadMarkup({ ...club, teamId: record.id }, locale, false)}</section>`;
  return {
    html: shell({
      locale,
      base,
      title: copy.title,
      description: copy.description,
      robots,
      canonical,
      trUrl,
      enUrl,
      record,
      body,
      header: options.header,
      footer: options.footer,
      json: jsonLd(canonical, copy, locale, record, standing, club)
    }),
    copy,
    canonical,
    trUrl,
    enUrl
  };
}

export function isRichProvider(id) {
  return Boolean(RICH_TEAM_PAGES[String(id)]);
}

export function sitemapEntry({ loc, lastmod, trUrl, enUrl }) {
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
    <xhtml:link rel="alternate" hreflang="tr-TR" href="${trUrl}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${trUrl}"/>
  </url>`;
}
