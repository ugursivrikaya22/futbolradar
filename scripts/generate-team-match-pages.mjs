#!/usr/bin/env node
/**
 * TAKIM MAÇ SAYFALARI — "galatasaray maçları", "fenerbahçe maçları" ...
 *
 * Türkiye'de en yüksek hacimli futbol aramalarından biri "<takım> maçları":
 * kullanıcı bir sonraki maçın ne zaman olduğunu ve son maçın nasıl bittiğini
 * arıyor. Sitede bu soruyu tek ekranda yanıtlayan bir sayfa yoktu; fikstür
 * lig genelindeydi, sonuçlar maç merkezindeydi, ikisi ayrı yerdeydi.
 *
 * SAYFA YALNIZCA ELDEKİ DOĞRULANMIŞ VERİDEN ÜRETİLİR:
 *
 *   • Sıradaki maç      — sağlayıcı takvimi (gün/saat/stat doğrulanmış)
 *   • Yaklaşan maçlar   — aynı takvim, TSİ gününe göre bugünden sonrası
 *   • Son maçlar        — maç sonu raporu üretilmiş karşılaşmalar
 *   • Sezon fikstürü    — TFF eşleşme listesi, 34 hafta
 *
 * İNCE İÇERİK ÜRETİLMEZ. Bir takım için ne yaklaşan maç ne rapor ne de
 * fikstür varsa o takımın sayfası HİÇ yazılmaz (`MIN_CONTENT_ROWS`).
 * Tarihi atanmamış hafta "tarih bekleniyor" diye görünür; uydurulmuş bir
 * gün yazılmaz. Skoru doğrulanmamış maç sonuç gibi gösterilmez.
 *
 * ŞEMA. Yalnızca başlama anı KESİN olan maçlar `SportsEvent` olur; tarihi
 * atanmamış eşleşme şemaya girmez (startDate'siz SportsEvent geçersizdir ve
 * uydurma tarih zengin sonuçta yanlış bilgi yayar).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { readVerifiedTeamNews, renderTeamNewsSection } from "./lib/newsCards.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { istanbulDay } = require("../services/matchStatus.js");
const { sameClub } = require("../services/superLigTeams.js");
const { CONFIRMED_FIXTURE_STATUSES } = require("../services/superLigFixtureService.js");
const { normalizeKey } = require("../services/competitionCatalog.js");

const DOMAIN = "https://www.futbolradar.com";

/** Sayfa üretmek için gereken en az doğrulanmış satır sayısı. */
const MIN_CONTENT_ROWS = 6;

const TEAMS = [
  { slug: "galatasaray", name: "Galatasaray", radar: "galatasaray-oyuncu-radari.html", transfer: "galatasaray-transfer-radar.html", form: "galatasaray-form-durumu.html" },
  { slug: "fenerbahce", name: "Fenerbahçe", radar: "fenerbahce-oyuncu-radari.html", transfer: "fenerbahce-transfer-radar.html", form: "fenerbahce-form-durumu.html" },
  { slug: "besiktas", name: "Beşiktaş", radar: "besiktas-oyuncu-radari.html", form: "besiktas-form-durumu.html" },
  { slug: "trabzonspor", name: "Trabzonspor", radar: "trabzonspor-oyuncu-radari.html", form: "trabzonspor-form-durumu.html" }
];

const calendar = JSON.parse(fs.readFileSync(path.join(root, "data", "fixture-calendar.json"), "utf8")).matches || [];
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-fixtures.json"), "utf8"));
const reportStore = JSON.parse(fs.readFileSync(path.join(root, "data", "post-match-reports.json"), "utf8"));
const reports = Array.isArray(reportStore) ? reportStore : (reportStore.reports || reportStore.records || []);
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isTeamMatch(match, team) {
  return sameClub(match && match.homeTeam, team.name) || sameClub(match && match.awayTeam, team.name);
}

function longDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul"
  }).format(parsed);
}

function clockLabel(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(parsed);
}

function opponentOf(match, team) {
  return sameClub(match.homeTeam, team.name) ? match.awayTeam : match.homeTeam;
}

function venueLabel(match, team) {
  if (match.venue) return match.venue;
  return sameClub(match.homeTeam, team.name) ? "İç saha" : "Deplasman";
}

/** Skoru doğrulanmış bitmiş maç mı? Yarım kayıt sonuç gibi gösterilmez. */
function hasFinalScore(match) {
  const score = match && match.score;
  return Boolean(score) && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
}

function upcomingMatches(team, today) {
  return calendar
    .filter((match) => isTeamMatch(match, team))
    .filter((match) => match.kickoff && istanbulDay(match.kickoff) >= today)
    .filter((match) => !["POSTPONED", "CANCELLED", "ABANDONED"].includes(String(match.status || "").toUpperCase()))
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)));
}

/** Maç sonu raporu üretilmiş karşılaşmalar; en yenisi önde. */
function recentReports(team) {
  return reports
    .filter((report) => isTeamMatch(report, team))
    .filter((report) => report.seo && report.seo.path)
    .sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")))
    .slice(0, 6);
}

/** TFF eşleşme listesi: takımın 34 haftalık sezon programı. */
function seasonFixtures(team) {
  const rows = [];
  for (const round of fixtures.rounds || []) {
    for (const match of round.matches || []) {
      if (!CONFIRMED_FIXTURE_STATUSES.has(match.fixtureStatus)) continue;
      if (!sameClub(match.homeTeam, team.name) && !sameClub(match.awayTeam, team.name)) continue;
      rows.push({ ...match, round: round.round, roundLabel: round.label, dateRange: round.dateRange });
    }
  }
  return rows.sort((left, right) => Number(left.round) - Number(right.round));
}

function teamTransfers(team) {
  return transfers
    .filter((row) => sameClub(row.toTeam, team.name) || sameClub(row.fromTeam, team.name))
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, 4);
}

function matchPageHref(match) {
  if (match.analysisPage) return `./${match.analysisPage}`;
  const fixtureId = match.providerId || match.id;
  return fixtureId ? `./mac-detay.html?fixtureId=${encodeURIComponent(fixtureId)}` : "./mac-merkezi.html";
}

function nextMatchCard(match, team) {
  if (!match) {
    return `<article class="data-empty" data-card="empty-state"><strong>Takvimde doğrulanmış sıradaki maç yok</strong><span>Kulüp ya da organizasyon gün ve saat açıkladığında bu alan otomatik güncellenir. Tahmini tarih yazılmaz.</span></article>`;
  }

  const home = sameClub(match.homeTeam, team.name);
  return `<article class="glass-card team-next-match" data-card="next-match">
    <div class="team-next-match-head"><span class="tag green">Sıradaki maç</span><span>${escapeHtml(match.league || "Maç programı")}</span></div>
    <h3>${escapeHtml(match.homeTeam)} <span aria-hidden="true">–</span> ${escapeHtml(match.awayTeam)}</h3>
    <dl class="team-next-match-facts">
      <div><dt>Tarih</dt><dd><time datetime="${escapeHtml(match.kickoff)}">${escapeHtml(longDate(match.kickoff))}</time></dd></div>
      <div><dt>Saat</dt><dd>${escapeHtml(clockLabel(match.kickoff))} TSİ</dd></div>
      <div><dt>Stat</dt><dd>${escapeHtml(venueLabel(match, team))}</dd></div>
      <div><dt>Konum</dt><dd>${home ? "İç saha" : "Deplasman"}</dd></div>
      ${match.broadcast && match.broadcast.turkey ? `<div><dt>Yayın</dt><dd>${escapeHtml(match.broadcast.turkey)}</dd></div>` : ""}
    </dl>
    <a class="detail-link" href="${escapeHtml(matchPageHref(match))}">Maç ayrıntısı</a>
  </article>`;
}

function upcomingRows(matches, team) {
  if (!matches.length) return "";
  return `<div class="archive-table-wrap"><table class="archive-table">
    <caption>${escapeHtml(team.name)} yaklaşan maçlar</caption>
    <thead><tr><th scope="col">Tarih</th><th scope="col">Saat</th><th scope="col">Karşılaşma</th><th scope="col">Turnuva</th><th scope="col">Stat</th></tr></thead>
    <tbody>${matches.map((match) => `<tr>
      <td><time datetime="${escapeHtml(match.kickoff)}">${escapeHtml(longDate(match.kickoff))}</time></td>
      <td>${escapeHtml(clockLabel(match.kickoff))}</td>
      <td><a href="${escapeHtml(matchPageHref(match))}">${escapeHtml(match.homeTeam)} – ${escapeHtml(match.awayTeam)}</a></td>
      <td>${escapeHtml(match.league || "—")}</td>
      <td>${escapeHtml(venueLabel(match, team))}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function resultRows(rows, team) {
  if (!rows.length) {
    return `<article class="data-empty" data-card="empty-state"><strong>Yayımlanmış maç raporu yok</strong><span>Maç sonu raporu, olay akışı ve istatistik doğrulandığında üretilir.</span></article>`;
  }

  return `<div class="trend-transfer-grid">${rows.map((report) => {
    const scored = hasFinalScore(report);
    const score = scored ? `${report.score.home} - ${report.score.away}` : "Sonuç doğrulanıyor";
    return `<article class="glass-card team-match-result" data-card="match-report">
      <div class="team-match-result-head"><time datetime="${escapeHtml(report.kickoff || "")}">${escapeHtml(longDate(report.kickoff) || "Tarih bekleniyor")}</time><span>${escapeHtml(report.league || report.competition || "")}</span></div>
      <h3>${escapeHtml(report.homeTeam)} <b>${escapeHtml(score)}</b> ${escapeHtml(report.awayTeam)}</h3>
      <a class="detail-link" href="./${escapeHtml(report.seo.path.replace(/^\//, ""))}">Maç raporunu oku</a>
    </article>`;
  }).join("")}</div>`;
}

function seasonRows(rows, team) {
  if (!rows.length) return "";
  return `<div class="archive-table-wrap"><table class="archive-table">
    <caption>${escapeHtml(team.name)} ${escapeHtml(fixtures.season || "")} Süper Lig fikstürü</caption>
    <thead><tr><th scope="col">Hafta</th><th scope="col">Karşılaşma</th><th scope="col">Tarih</th><th scope="col">Saha</th></tr></thead>
    <tbody>${rows.map((match) => {
      const home = sameClub(match.homeTeam, team.name);
      // Tarihi atanmamış hafta "bekleniyor" yazar; gün UYDURULMAZ.
      const when = match.kickoff
        ? `<time datetime="${escapeHtml(match.kickoff)}">${escapeHtml(longDate(match.kickoff))} ${escapeHtml(clockLabel(match.kickoff))}</time>`
        : `<span class="muted">${escapeHtml(match.dateLabel || match.dateRange || "Tarih ve saat bekleniyor")}</span>`;
      return `<tr><td>${escapeHtml(String(match.round))}. hafta</td>
        <td>${escapeHtml(match.homeTeam)} – ${escapeHtml(match.awayTeam)}</td>
        <td>${when}</td>
        <td>${home ? "İç saha" : "Deplasman"}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function transferRows(rows) {
  if (!rows.length) return "";
  return `<ul class="trend-mini-stats team-match-transfer-list">${rows.map((row) => `<li><span>${escapeHtml(row.date)}</span><strong>${escapeHtml(row.playerName)}</strong><span>${escapeHtml(row.fromTeam)} → ${escapeHtml(row.toTeam)}</span><span class="tag green">${escapeHtml(row.type || "Transfer")}</span></li>`).join("")}</ul>`;
}

function section(title, note, body, kicker) {
  if (!body) return "";
  return `<section class="trend-section">
    <div class="section-head"><div class="section-title">${kicker ? `<span class="section-kicker">${escapeHtml(kicker)}</span>` : ""}<h2>${escapeHtml(title)}</h2>${note ? `<p>${escapeHtml(note)}</p>` : ""}</div></div>
    ${body}
  </section>`;
}

function schemaFor(team, url, description, scheduled) {
  const graph = [
    {
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: `${team.name} Maçları`,
      description,
      isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` },
      inLanguage: "tr-TR",
      about: { "@type": "SportsTeam", name: team.name, sport: "Football" }
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` },
        { "@type": "ListItem", position: 2, name: "Takımlar", item: `${DOMAIN}/takimlar.html` },
        { "@type": "ListItem", position: 3, name: `${team.name} Maçları`, item: url }
      ]
    }
  ];

  // Yalnızca başlama anı kesin olan maçlar şemaya girer.
  if (scheduled.length) {
    graph.push({
      "@type": "ItemList",
      name: `${team.name} yaklaşan maçları`,
      numberOfItems: scheduled.length,
      itemListElement: scheduled.map((match, index) => {
        const event = {
          "@type": "SportsEvent",
          name: `${match.homeTeam} - ${match.awayTeam}`,
          startDate: match.kickoff,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
          awayTeam: { "@type": "SportsTeam", name: match.awayTeam }
        };
        if (match.venue) event.location = { "@type": "Place", name: match.venue };
        if (match.league) event.superEvent = { "@type": "SportsOrganization", name: match.league };
        return { "@type": "ListItem", position: index + 1, item: event };
      })
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

function relatedLinks(team) {
  const links = [
    { href: "./super-lig-fikstur.html", kicker: "Lig", title: "Süper Lig fikstürü", text: "Tüm haftaların eşleşmelerini ve açıklanan saatleri gör." },
    { href: "./canli-skor.html", kicker: "Canlı", title: "Canlı skor", text: "Oynanan maçların dakikası ve skoru." },
    { href: "./puan-durumu.html", kicker: "Tablo", title: "Puan durumu", text: "Süper Lig sıralaması ve averaj." }
  ];
  if (team.radar) links.push({ href: `./${team.radar}`, kicker: "Kadro", title: `${team.name} oyuncu radarı`, text: "Kadro, form ve rol sinyalleri." });
  if (team.form) links.push({ href: `./${team.form}`, kicker: "Form", title: `${team.name} form durumu`, text: "Son maçların form okuması." });
  if (team.transfer) links.push({ href: `./${team.transfer}`, kicker: "Transfer", title: `${team.name} transfer radar`, text: "Doğrulanmış gelen ve giden oyuncular." });
  return `<div class="trend-link-grid">${links.map((link) => `<a class="" href="${escapeHtml(link.href)}"><span>${escapeHtml(link.kicker)}</span><strong>${escapeHtml(link.title)}</strong><p>${escapeHtml(link.text)}</p></a>`).join("")}</div>`;
}

function buildPage(team, today) {
  const upcoming = upcomingMatches(team, today);
  const results = recentReports(team);
  const season = seasonFixtures(team);
  const moves = teamTransfers(team);

  // İnce içerik koruması: elde anlamlı satır yoksa sayfa üretilmez.
  const contentRows = upcoming.length + results.length + season.length;
  if (contentRows < MIN_CONTENT_ROWS) {
    return { skipped: `${team.name}: yalnızca ${contentRows} doğrulanmış satır (en az ${MIN_CONTENT_ROWS} gerekli)` };
  }

  const file = `${team.slug}-maclari.html`;
  const url = `${DOMAIN}/${file}`;
  const next = upcoming[0] || null;
  const scheduled = upcoming.filter((match) => match.kickoff);

  const nextSentence = next
    ? `${team.name}'ın sıradaki maçı ${longDate(next.kickoff)} günü saat ${clockLabel(next.kickoff)} TSİ'de ${opponentOf(next, team)} karşısında.`
    : `${team.name} için takvimde gün ve saati doğrulanmış bir sonraki maç henüz yok.`;

  const title = `${team.name} Maçları | Fikstür, Maç Programı ve Sonuçlar | FutbolRadar`;
  const description = `${team.name} maç programı: sıradaki maç, yaklaşan karşılaşmalar, Süper Lig fikstürü ve yayımlanmış maç raporları. Saatler Türkiye saatiyle.`;

  const html = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.svg" />
    <script type="application/ld+json">${JSON.stringify(schemaFor(team, url, description, scheduled))}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage team-match-page">
    ${siteHeader({ base: "./" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><a href="./takimlar.html">Takımlar</a><span>/</span><span>${escapeHtml(team.name)} Maçları</span></nav>
      <section class="trend-hero">
        <div>
          <span class="eyebrow">Maç programı · ${escapeHtml(fixtures.season || "")}</span>
          <h1>${escapeHtml(team.name)} Maçları</h1>
          <p>${escapeHtml(nextSentence)}</p>
          <p class="muted">Tüm tarih ve saatler Türkiye saatiyle (Europe/Istanbul) gösterilir. Gün ve saati açıklanmamış karşılaşmalar tahmin edilmez.</p>
        </div>
        ${nextMatchCard(next, team)}
      </section>
      ${section("Yaklaşan maçlar", "Gün ve saati doğrulanmış karşılaşmalar, en yakın tarih önde.", upcomingRows(upcoming, team), "Takvim")}
      ${section("Son maçlar", "Yalnızca maç sonu raporu üretilmiş karşılaşmalar listelenir.", resultRows(results, team), "Sonuçlar")}
      ${section(`${team.name} Süper Lig fikstürü`, `${fixtures.season || ""} sezonu eşleşmeleri. Tarihi atanmamış haftalar için gün uydurulmaz.`, seasonRows(season, team), "Sezon")}
      ${section("Son transfer hareketleri", "Yalnızca resmî açıklamayla doğrulanmış kayıtlar.", transferRows(moves), "Kadro")}
      ${renderTeamNewsSection(readVerifiedTeamNews(root, team.name, 3), { team: team.name, base: "./" })}
      ${section("İlgili ekranlar", "Aynı veriyi lig, kadro ve form açısından derinleştir.", relatedLinks(team), "İç bağlantılar")}
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
  </body>
</html>`;

  return { file, html, stats: { upcoming: upcoming.length, results: results.length, season: season.length, scheduled: scheduled.length } };
}

/**
 * Sayfaları KEŞFEDİLEBİLİR yapar.
 *
 * Sitemap'e girmek tek başına yetmez: hiçbir sayfadan bağlantı almayan bir
 * sayfa öksüzdür, tarayıcı ona nadiren döner ve sıralamada karşılığı olmaz.
 * Kırıntı yolu bu sayfaları "Takımlar"ın altına koyuyor; o hâlde bağlantının
 * gerçekten Takımlar sayfasında durması gerekir.
 */
function injectTeamMatchLinks(files) {
  const target = path.join(root, "takimlar.html");
  if (!fs.existsSync(target) || !files.length) return false;

  const cards = files.map((entry) => `<a href="./${escapeHtml(entry.file)}"><span>Maç programı</span><strong>${escapeHtml(entry.name)} Maçları</strong><p>${escapeHtml(entry.blurb)}</p></a>`).join("");
  const block = `<!-- team-match-links:start -->
<section class="trend-section" aria-labelledby="team-match-links-title">
  <div class="section-head"><div class="section-title"><span class="section-kicker">Maç programı</span><h2 id="team-match-links-title">Takımların maç sayfaları</h2><p>Sıradaki maç, yaklaşan karşılaşmalar ve yayımlanmış maç raporları tek ekranda.</p></div></div>
  <section class="trend-link-grid" aria-label="Takım maç sayfaları">${cards}</section>
</section>
<!-- team-match-links:end -->`;

  let html = fs.readFileSync(target, "utf8");
  const pattern = /<!-- team-match-links:start -->[\s\S]*?<!-- team-match-links:end -->/;

  if (pattern.test(html)) {
    html = html.replace(pattern, block);
  } else if (html.includes("</main>")) {
    html = html.replace("</main>", `  ${block}\n    </main>`);
  } else {
    return false;
  }

  fs.writeFileSync(target, html, "utf8");
  const mirror = path.join(root, "public", "takimlar.html");
  if (fs.existsSync(mirror)) fs.writeFileSync(mirror, html, "utf8");
  return true;
}

const today = istanbulDay(new Date().toISOString());
const written = [];
const skipped = [];

for (const team of TEAMS) {
  const page = buildPage(team, today);
  if (page.skipped) {
    skipped.push(page.skipped);
    continue;
  }

  fs.writeFileSync(path.join(root, page.file), page.html, "utf8");
  const mirror = path.join(root, "public", page.file);
  if (fs.existsSync(path.dirname(mirror))) fs.writeFileSync(mirror, page.html, "utf8");
  written.push({ file: page.file, name: team.name, blurb: page.stats.upcoming
    ? `${page.stats.upcoming} yaklaşan maç, ${page.stats.season} haftalık fikstür.`
    : `${page.stats.season} haftalık sezon fikstürü ve maç raporları.` });
  console.log(`[team-match-pages] ${page.file} — ${page.stats.upcoming} yaklaşan, ${page.stats.results} rapor, ${page.stats.season} fikstür satırı, ${page.stats.scheduled} SportsEvent`);
}

const sitemapPath = path.join(root, "sitemap.xml");
if (fs.existsSync(sitemapPath)) {
  let xml = fs.readFileSync(sitemapPath, "utf8");
  const stamp = today;
  let added = 0;

  for (const entry of written) {
    const loc = `${DOMAIN}/${entry.file}`;
    if (xml.includes(`<loc>${loc}</loc>`)) continue;
    // ÇOK SATIRLI biçim zorunlu: `generate-match-pages.mjs` sitemap'i yeniden
    // yazarken girdileri `  <url>...  </url>` kalıbıyla koruyor. Tek satırlık
    // bir girdi o kalıba uymaz ve sessizce SİLİNİR — sayfalar sitemap'ten
    // düşer, bu adım "eklendi" dediği hâlde.
    xml = xml.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${stamp}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
    added += 1;
  }

  if (added) {
    fs.writeFileSync(sitemapPath, xml, "utf8");
    const publicSitemap = path.join(root, "public", "sitemap.xml");
    if (fs.existsSync(publicSitemap)) fs.writeFileSync(publicSitemap, xml, "utf8");
  }
  console.log(`[team-match-pages] sitemap: ${added} yeni URL eklendi.`);
}

for (const note of skipped) console.warn(`[team-match-pages] atlandı — ${note}`);
const linked = injectTeamMatchLinks(written);
console.log(`[team-match-pages] ${written.length} sayfa üretildi; takimlar.html bağlantı bloğu ${linked ? "güncellendi" : "YAZILAMADI"}.`);
