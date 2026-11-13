/**
 * PUAN DURUMUNDAKİ TAKIM SAYFALARI.
 *
 * Süper Lig dışındaki satırlar tıklanınca açılacak sayfayı üretir.
 * Sayılar yalnızca data/league-standings.json, data/fixture-calendar.json
 * (kaynağı api-football), data/international-squads.json ve
 * data/competition-leaders.json içinden gelir. TheSportsDB kullanılmaz.
 * Eksik bölüm boş bırakılmaz: kayıt olmadığı cümleyle yazılır, sayı uydurulmaz.
 *
 * Mevcut takimlar/*.html ve en/team/*.html dosyalarına yazılmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { createRequire } from "node:module";
import { EN_PAGE_ORDER, STANDINGS_LEAGUES } from "./lib/standingsCatalog.mjs";
import {
  escapeHtml,
  generatedTeamRecords,
  importanceNavHtml,
  leagueLabel,
  linkMapPayload,
  loadStandingsTeamIndex,
  primaryLeagueId,
  relativeHref,
  standingsPageHref,
  standingsTeamHref
} from "./lib/standingsTeamLinks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.futbolradar.com";
const { writeDynamicRoutePairs } = createRequire(import.meta.url)("../services/i18n.js");

const POSITION_TR = {
  Goalkeeper: "Kaleci",
  Defender: "Defans",
  Midfielder: "Orta saha",
  Attacker: "Forvet"
};

function writeBoth(relativePath, contents) {
  for (const base of [root, path.join(root, "public")]) {
    const file = path.join(base, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== contents) {
      fs.writeFileSync(file, contents);
    }
  }
}

function approvedMatch(match) {
  const source = String(match && (match.source || match.providerName) || "").toLowerCase();
  if (!source || /thesportsdb|sportsdb/.test(source)) return false;
  return source === "api-football" || source.includes("api-football");
}

function loadMatchesByTeam() {
  const byTeam = new Map();
  let calendar;
  try {
    calendar = JSON.parse(fs.readFileSync(path.join(root, "data", "fixture-calendar.json"), "utf8"));
  } catch {
    return byTeam;
  }
  for (const match of calendar.matches || []) {
    if (!approvedMatch(match)) continue;
    for (const id of [match.homeTeamId, match.awayTeamId]) {
      if (id == null || id === "") continue;
      const key = String(id);
      if (!byTeam.has(key)) byTeam.set(key, []);
      byTeam.get(key).push(match);
    }
  }
  return byTeam;
}

function loadSquads() {
  const byId = new Map();
  let squads = [];
  try {
    squads = JSON.parse(fs.readFileSync(path.join(root, "data", "international-squads.json"), "utf8"));
  } catch {
    return byId;
  }
  for (const squad of squads) {
    if (!squad || squad.status !== "complete" || !Array.isArray(squad.players) || !squad.players.length) continue;
    byId.set(String(squad.teamId), squad);
  }
  return byId;
}

function teamIdFromLogo(url) {
  const match = String(url || "").match(/\/teams\/(\d+)\.png/);
  return match ? match[1] : "";
}

function loadLeaders() {
  const byTeam = new Map();
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(path.join(root, "data", "competition-leaders.json"), "utf8"));
  } catch {
    return byTeam;
  }
  if (!String(payload.source || "").startsWith("api-football:")) return byTeam;
  for (const entry of Object.values(payload.cache || {})) {
    for (const row of entry.rows || []) {
      const id = teamIdFromLogo(row.teamLogo);
      if (!id) continue;
      if (!byTeam.has(id)) byTeam.set(id, []);
      byTeam.get(id).push({ ...row, listLeagueId: String(entry.leagueId || row.leagueId || ""), listSeason: String(entry.season || row.season || "") });
    }
  }
  return byTeam;
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function cell(value) {
  const number = finite(value);
  return number === null ? "—" : escapeHtml(number);
}

function goalDifference(value) {
  const number = finite(value);
  if (number === null) return "—";
  return `${number > 0 ? "+" : ""}${number}`;
}

function isoDate(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

function competitionTables(record, locale) {
  return record.competitions.map((item) => {
    const label = leagueLabel(item.leagueId, item.storedName, locale);
    const href = standingsPageHref(item.leagueId, locale, locale === "en" ? "en/club" : "takimlar");
    const title = href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : escapeHtml(label);
    const form = item.form.length ? item.form.join(" ") : "";
    const head = locale === "en"
      ? ["Rank", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"]
      : ["Sıra", "O", "G", "B", "M", "A", "Y", "Av.", "P"];
    const values = [item.rank, item.played, item.won, item.drawn, item.lost, item.goalsFor, item.goalsAgainst, item.goalDifference, item.points];
    const body = head.map((name, index) => {
      const shown = name === "Av." || name === "GD" ? goalDifference(values[index]) : cell(values[index]);
      return `<tr><th scope="row">${escapeHtml(name)}</th><td>${shown}</td></tr>`;
    }).join("");
    const recorded = isoDate(item.updatedAt);
    const note = locale === "en"
      ? `API-Football standings${item.season ? `, season ${escapeHtml(item.season)}` : ""}${recorded ? `, recorded ${escapeHtml(recorded)}` : ""}.`
      : `API-Football puan satırı${item.season ? `, sezon ${escapeHtml(item.season)}` : ""}${recorded ? `, kayıt ${escapeHtml(recorded)}` : ""}.`;
    const formLine = form
      ? `<p>${locale === "en" ? "Recorded form" : "Kayıtlı form"}: ${escapeHtml(form)}</p>`
      : "";
    return `<section class="evergreen-section"><h2>${title}</h2><div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${escapeHtml(label)}</caption><tbody>${body}</tbody></table></div>${formLine}<p class="evergreen-freshness">${note}</p></section>`;
  }).join("");
}

function leaderBlock(record, leaders, locale) {
  const allowed = new Set(record.competitions.map((item) => `${item.providerLeagueId}:${String(item.season || "")}`));
  const rows = (leaders.get(record.id) || []).filter((row) => allowed.has(`${row.listLeagueId}:${row.listSeason}`) && row.name);
  const heading = locale === "en" ? "Goal and assist leaders" : "Gol ve asist liderleri";
  if (!rows.length) {
    const text = locale === "en"
      ? "No stored goal or assist leader for this club in these competitions."
      : "Bu kulüp için bu yarışmalarda kayıtlı gol veya asist lideri yok.";
    return `<section class="evergreen-section"><h2>${heading}</h2><p class="standings-empty" data-empty-state="unavailable">${text}</p></section>`;
  }
  const items = rows.slice(0, 8).map((row) => {
    const bits = [];
    const goals = finite(row.goals);
    const assists = finite(row.assists);
    const apps = finite(row.appearances);
    if (goals !== null) bits.push(locale === "en" ? `${goals} goals` : `${goals} gol`);
    if (assists !== null) bits.push(locale === "en" ? `${assists} assists` : `${assists} asist`);
    if (apps !== null) bits.push(locale === "en" ? `${apps} apps` : `${apps} maç`);
    return `<li><strong>${escapeHtml(row.name)}</strong>${bits.length ? ` — ${escapeHtml(bits.join(", "))}` : ""}</li>`;
  }).join("");
  return `<section class="evergreen-section"><h2>${heading}</h2><ul>${items}</ul><p class="evergreen-freshness">${locale === "en" ? "API-Football player lists for the same league and season." : "Aynı lig ve sezonun API-Football oyuncu listesi."}</p></section>`;
}

function squadBlock(record, squads, locale) {
  const squad = squads.get(record.id);
  const heading = locale === "en" ? "Squad" : "Kadro";
  if (!squad) {
    const text = locale === "en"
      ? "No synced squad is stored for this club."
      : "Bu kulüp için senkronize kadro kaydı yok.";
    return `<section class="evergreen-section"><h2>${heading}</h2><p class="standings-empty" data-empty-state="unavailable">${text}</p></section>`;
  }
  const items = squad.players.map((player) => {
    const position = locale === "en" ? player.position : (POSITION_TR[player.position] || player.position || "");
    const number = finite(player.number);
    const prefix = number === null ? "" : `${number} `;
    return `<li>${escapeHtml(prefix)}${escapeHtml(player.name || "")}${position ? ` <small>${escapeHtml(position)}</small>` : ""}</li>`;
  }).join("");
  const recorded = isoDate(squad.syncedAt);
  return `<section class="evergreen-section"><h2>${heading}</h2><ul class="tp-squad">${items}</ul><p class="evergreen-freshness">${locale === "en" ? `API-Football squad${recorded ? `, recorded ${escapeHtml(recorded)}` : ""}.` : `API-Football kadrosu${recorded ? `, kayıt ${escapeHtml(recorded)}` : ""}.`}</p></section>`;
}

function pickMatches(matches) {
  const seen = new Set();
  const unique = [];
  for (const match of matches) {
    const id = String(match.id || `${match.homeTeam}|${match.awayTeam}|${match.kickoff}`);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(match);
  }
  unique.sort((a, b) => String(a.kickoff || "").localeCompare(String(b.kickoff || "")));
  const now = Date.now();
  const upcoming = unique.filter((match) => {
    const kick = Date.parse(match.kickoff || "");
    return Number.isFinite(kick) && kick >= now;
  }).slice(0, 3);
  const recent = unique.filter((match) => {
    const kick = Date.parse(match.kickoff || "");
    const status = String(match.status || "").toUpperCase();
    return status === "FINISHED" && Number.isFinite(kick) && kick < now && finite(match.score && match.score.home) !== null && finite(match.score && match.score.away) !== null;
  }).slice(-5).reverse();
  return { recent, upcoming };
}

function matchItem(match, locale) {
  const when = isoDate(match.kickoff) || "";
  const score = finite(match.score && match.score.home);
  const away = finite(match.score && match.score.away);
  const status = String(match.status || "").toUpperCase();
  const result = status === "FINISHED" && score !== null && away !== null ? `${score}-${away}` : (locale === "en" ? "scheduled" : "program");
  const competition = locale === "en" ? "" : (match.league || "");
  return `<li><span>${escapeHtml(when)}</span> <strong>${escapeHtml(match.homeTeam || "")} ${escapeHtml(result)} ${escapeHtml(match.awayTeam || "")}</strong>${competition ? ` <small>${escapeHtml(competition)}</small>` : ""}</li>`;
}

function matchBlock(record, matchesByTeam, locale) {
  const heading = locale === "en" ? "Fixtures" : "Maçlar";
  const picked = pickMatches(matchesByTeam.get(record.id) || []);
  const items = [...picked.recent, ...picked.upcoming];
  if (!items.length) {
    const text = locale === "en"
      ? "No stored API-Football fixture for this club."
      : "Bu kulüp için kayıtlı API-Football maçı yok.";
    return `<section class="evergreen-section"><h2>${heading}</h2><p class="standings-empty" data-empty-state="unavailable">${text}</p></section>`;
  }
  return `<section class="evergreen-section"><h2>${heading}</h2><ul>${items.map((match) => matchItem(match, locale)).join("")}</ul><p class="evergreen-freshness">${locale === "en" ? "API-Football fixtures already stored for this club." : "Bu kulüp için kayıtlı API-Football fikstürü."}</p></section>`;
}

function pageHtml(record, locale, extras) {
  const en = locale === "en";
  const from = en ? "en/club" : "takimlar";
  const canonicalPath = en ? `/en/club/${record.slug}` : `/takimlar/${record.slug}`;
  const canonical = `${SITE}${canonicalPath}`;
  const otherPath = en ? record.trHref : record.enHref;
  const otherUrl = otherPath ? `${SITE}/${otherPath.replace(/^\//, "")}` : "";
  const primary = primaryLeagueId(record);
  const league = leagueLabel(primary, (record.competitions.find((item) => item.leagueId === primary) || {}).storedName, locale);
  const lead = record.competitions[0];
  const rank = lead ? cell(lead.rank) : "—";
  const points = lead ? cell(lead.points) : "—";
  const title = en
    ? `${record.name} club record | FutbolRadar`
    : `${record.name} takım kaydı | FutbolRadar`;
  const description = en
    ? `${record.name} recorded standings${league ? ` in ${league}` : ""}. Missing squad, fixture or leader lists stay empty.`
    : `${record.name} için kayıtlı puan satırı${league ? ` (${league})` : ""}. Kadro, maç veya lider listesi yoksa bölüm boş bırakılır.`;
  const intro = en
    ? "Only stored provider rows are shown. Missing sections are not estimated."
    : "Yalnızca kayıtlı sağlayıcı satırları gösterilir. Eksik bölüm tahminle doldurulmaz.";
  const nav = primary ? importanceNavHtml(primary, { locale, from }) : "";
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url: canonical,
        name: record.name,
        inLanguage: en ? "en" : "tr-TR",
        description
      },
      {
        "@type": "SportsTeam",
        name: record.name,
        sport: "Football",
        url: canonical,
        memberOf: league ? { "@type": "SportsOrganization", name: league } : undefined
      }
    ]
  };
  const base = en ? "../../" : "../";
  const altHref = en ? record.trHref : record.enHref;
  return `<!doctype html>
<html lang="${en ? "en" : "tr"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${canonical}" />
    ${otherUrl ? `<link rel="alternate" hreflang="${en ? "tr-TR" : "en"}" href="${otherUrl}" />` : ""}
    <link rel="alternate" hreflang="${en ? "en" : "tr-TR"}" href="${canonical}" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${base}page.css" />
    <style>.tp-squad{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;list-style:none;margin:0;padding:0}.tp-squad li,.tp-page li{overflow-wrap:anywhere}.tp-page a{display:inline-flex;align-items:center;min-height:32px}.tp-page .evergreen-table-wrap{overflow-x:auto}</style>
    <script type="application/ld+json">${JSON.stringify(graph).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell tp-page" data-team-id="${escapeHtml(record.id)}">
      ${siteHeader({ base, locale, altHref })}
      <main class="evergreen-page">
        <div class="container">
          <header class="evergreen-hero">
            <span class="section-kicker">${escapeHtml(league)}</span>
            <h1>${record.logo ? `<img src="${escapeHtml(record.logo)}" alt="" width="36" height="36" /> ` : ""}${escapeHtml(record.name)}</h1>
            <p>${escapeHtml(intro)}</p>
            <p>${en ? "Recorded place" : "Kayıtlı sıra"} ${rank} · ${en ? "points" : "puan"} ${points}.</p>
            ${en && record.enHref.startsWith("en/team/") ? `<p><a href="${escapeHtml(relativeHref(from, record.enHref))}">Team page: fixtures, results and squad</a></p>` : ""}
            ${en && record.existingTr ? `<p><a href="${escapeHtml(relativeHref(from, record.trHref))}">Full club profile (Turkish)</a></p>` : ""}
          </header>
          ${competitionTables(record, locale)}
          ${leaderBlock(record, extras.leaders, locale)}
          ${matchBlock(record, extras.matches, locale)}
          ${squadBlock(record, extras.squads, locale)}
          ${nav ? `<section class="evergreen-section" aria-label="${en ? "Clubs" : "Takımlar"}">${nav}</section>` : ""}
        </div>
      </main>
      ${siteFooter({ base, locale })}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

function patchFile(relativePath, transform) {
  for (const base of [root, path.join(root, "public")]) {
    const file = path.join(base, relativePath);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, "utf8");
    const after = transform(before);
    if (after && after !== before) fs.writeFileSync(file, after);
  }
}

function wrapStandingsNames(html, rows, locale, from, cellTag) {
  let next = html;
  let linked = 0;
  for (const row of rows) {
    const name = escapeHtml(row.name || row.team || "");
    if (!name || next.includes(`>${name}</a>`)) {
      if (name && next.includes(`>${name}</a>`)) linked += 1;
      continue;
    }
    const href = standingsTeamHref(row, { locale, from });
    if (!href) continue;
    const token = cellTag === "td"
      ? new RegExp(`<td>\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</td>`)
      : new RegExp(`<th scope="row">${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</th>`);
    const replacement = cellTag === "td"
      ? `<td><a class="standings-team-link" href="${escapeHtml(href)}" style="display:inline-flex;align-items:center;min-height:32px">${name}</a></td>`
      : `<th scope="row"><a class="standings-team-link" href="${escapeHtml(href)}" style="display:inline-flex;align-items:center;min-height:32px">${name}</a></th>`;
    if (!token.test(next)) continue;
    next = next.replace(token, replacement);
    linked += 1;
  }
  return { html: next, linked };
}

function sectionBounds(html, startMarker) {
  const sectionStart = html.indexOf(startMarker);
  if (sectionStart < 0) return null;
  const sectionEnd = html.indexOf("</section>", sectionStart);
  if (sectionEnd < 0) return null;
  return [sectionStart, sectionEnd];
}

function patchLeagueStandingsPages() {
  const index = loadStandingsTeamIndex();
  const jobs = [];
  for (const [leagueId, rows] of index.rowsByLeague) {
    const entry = STANDINGS_LEAGUES[leagueId];
    if (entry && leagueId !== "super-lig") {
      jobs.push({ file: `${entry.slugTr}.html`, rows, locale: "tr", from: "", cell: "th", leagueId, start: 'id="standings-heading"' });
    }
    if (entry && EN_PAGE_ORDER.includes(leagueId)) {
      jobs.push({ file: `en/${entry.slugEn}.html`, rows, locale: "en", from: "en", cell: "th", leagueId, start: 'id="standings-heading"' });
    }
    jobs.push({ file: `lig/${leagueId}.html`, rows, locale: "tr", from: "lig", cell: "td", leagueId, start: "<h2>Puan durumu</h2>" });
  }
  for (const job of jobs) patchFile(job.file, (html) => {
    const bounds = sectionBounds(html, job.start);
    if (!bounds) return html;
    const [sectionStart, sectionEnd] = bounds;
    const wrapped = wrapStandingsNames(html.slice(sectionStart, sectionEnd), job.rows, job.locale, job.from, job.cell);
    let nextSlice = wrapped.html;
    if (!nextSlice.includes('data-team-list="importance"')) {
      const nav = importanceNavHtml(job.leagueId, { locale: job.locale, from: job.from });
      if (nav) nextSlice += nav;
    }
    return html.slice(0, sectionStart) + nextSlice + html.slice(sectionEnd);
  });
}

function patchHomeWidgets() {
  const index = loadStandingsTeamIndex();
  for (const [relative, locale, from] of [["index.html", "tr", ""], ["en/index.html", "en", "en"]]) {
    patchFile(relative, (html) => {
      const start = html.indexOf("<!-- prerender:standings-tabs:start -->");
      const end = html.indexOf("<!-- prerender:standings-tabs:end -->");
      const bounded = start >= 0 && end > start;
      const blockStart = bounded ? start : 0;
      const blockEnd = bounded ? end : html.length;
      if (!html.includes("standings-panel-")) return html;
      let block = html.slice(blockStart, blockEnd);
      for (const [leagueId, rows] of index.rowsByLeague) {
        const panelAt = block.indexOf(`id="standings-panel-${leagueId}"`);
        if (panelAt < 0) continue;
        const panelEnd = block.indexOf("</section>", panelAt);
        if (panelEnd < 0) continue;
        let panel = block.slice(panelAt, panelEnd);
        for (const row of rows) {
          const name = escapeHtml(row.name || row.team || "");
          const href = standingsTeamHref(row, { locale, from });
          if (!name || !href || panel.includes(`>${name}</a>`)) continue;
          const token = `<span class="home-standing-team">`;
          const nameToken = `<b>${name}</b></span>`;
          const at = panel.indexOf(nameToken);
          if (at < 0) continue;
          const open = panel.lastIndexOf(token, at);
          if (open < 0) continue;
          const inner = panel.slice(open + token.length, at + `<b>${name}</b>`.length);
          panel = `${panel.slice(0, open)}<a class="home-standing-team" href="${escapeHtml(href)}">${inner}</a>${panel.slice(at + nameToken.length)}`;
        }
        block = block.slice(0, panelAt) + panel + block.slice(panelEnd);
      }
      return html.slice(0, blockStart) + block + html.slice(blockEnd);
    });
  }
}

function main() {
  const extras = {
    matches: loadMatchesByTeam(),
    squads: loadSquads(),
    leaders: loadLeaders()
  };
  let trPages = 0;
  let enPages = 0;
  let squadsShown = 0;
  let matchesShown = 0;
  let standingsOnly = 0;
  for (const record of generatedTeamRecords()) {
    if (!record.competitions.length) continue;
    const hasSquad = extras.squads.has(record.id);
    const hasMatches = (extras.matches.get(record.id) || []).some(approvedMatch);
    if (hasSquad) squadsShown += 1;
    if (hasMatches) matchesShown += 1;
    if (!hasSquad && !hasMatches) standingsOnly += 1;
    if (record.generateTr) {
      writeBoth(`${record.trHref}.html`, pageHtml(record, "tr", extras));
      trPages += 1;
    }
    if (record.generateEn && record.enHref.startsWith("en/club/")) {
      writeBoth(`${record.enHref}.html`, pageHtml(record, "en", extras));
      enPages += 1;
    }
  }
  /*
   * ELLE YAZILMIŞ TÜRKÇE TAKIM SAYFALARININ İNGİLİZCE EŞİ.
   *
   * `takimlar/<slug>` sayfası başka bir üreticiden gelen kulüplerde (18
   * Süper Lig kulübü, zengin kulüp sayfaları, Stuttgart) Türkçe sayfanın
   * İngilizce karşılığı yoktu ya da vardı ama iki sayfa birbirini
   * göstermiyordu: hreflang yok, dil kutusu ana sayfaya düşüyordu.
   * Süper Lig kulüplerinde `en/team/<slug>` ZATEN `<slug>-maclari.html`
   * ile eşli (hreflang bire birdir), bu yüzden `takimlar/<slug>` için ayrı
   * bir kulüp kaydı sayfası yazılır. İçerik diğer `en/club` sayfalarıyla
   * aynı kaynaktan gelir: kayıtlı puan satırı, kadro, maç — çeviri değil.
   * Eşleme rota haritasına yazılır; Türkçe tarafa hreflang ve dil kutusu
   * oradan gelir.
   */
  const curatedPairs = [];
  let curatedEnPages = 0;
  for (const record of loadStandingsTeamIndex().records) {
    if (!record.existingTr || record.generateTr || !record.slug) continue;
    if (record.trHref !== `takimlar/${record.slug}` || !record.competitions.length) continue;
    const enFile = `en/club/${record.slug}.html`;
    if (!(record.generateEn && record.enHref === `en/club/${record.slug}`)) {
      writeBoth(enFile, pageHtml(record, "en", extras));
      curatedEnPages += 1;
    }
    curatedPairs.push({
      tr: `takimlar/${record.slug}.html`,
      en: enFile,
      trUrl: `${SITE}/takimlar/${record.slug}`,
      enUrl: `${SITE}/en/club/${record.slug}`
    });
  }
  writeDynamicRoutePairs("club", curatedPairs);
  console.log(`[standings-team-pages] elle yazılmış ${curatedPairs.length} Türkçe takım sayfası İngilizce eşine bağlandı (${curatedEnPages} yeni en/club sayfası)`);
  const map = `${JSON.stringify(linkMapPayload())}\n`;
  writeBoth("data/standings-team-links.json", map);
  patchLeagueStandingsPages();
  patchHomeWidgets();
  const index = loadStandingsTeamIndex();
  console.log(`[standings-team-pages] TR ${trPages}, EN ${enPages}, kadrolu ${squadsShown}, maçlı ${matchesShown}, yalnız puan satırı ${standingsOnly}, lig ${index.leagueOrder.length}`);
  console.log("[standings-team-pages] Dünya Kupası elemeleri league-standings.json içinde yok; satır üretilmedi.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
