/**
 * ARŞİV SAYFALARINI ÜRETİR.
 *
 * Dört yüzey, tek kaynak (`data/season-archive.json`):
 *
 *   arsiv.html                                   sezon dizini
 *   arsiv/sezon-<sezon>.html                     sezon özeti, tablo, maç listesi
 *   arsiv/kadro-<sezon>-<takim>.html             o sezonun takım kadrosu
 *   arsiv/teknik-direktor-<sezon>-<isim>.html    teknik direktör dönemi
 *
 * ÜRETİM VERİYE BAĞLI. Sezon yoksa sayfa yok; kadro yoksa kadro sayfası yok;
 * kaynağı olmayan teknik direktör kaydı için sayfa açılmaz. Boş kabuk sayfa
 * üretmek SEO'da da okuyucuda da zarar: arama sonucunda görünüp içi boş çıkan
 * bir sayfa, olmayan sayfadan kötüdür.
 *
 * TEKNİK DİREKTÖR SAYFASI NE İDDİA EDER, NE ETMEZ. Elde o teknik direktörün
 * kayıtlı maçları varsa dönem bilançosu (G/B/M, atılan-yenilen gol) çizilir;
 * yoksa yalnızca göreve geliş bilgisi ve kaynağı gösterilir. "Dönem analizi"
 * başlığı altında maç verisi olmadan yorum üretilmez.
 *
 * Kullanım: node scripts/generate-archive-pages.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { readJsonFile } from "./lib/readJsonFile.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { LEAGUE_GOAL_PAGES, buildLeagueGoalPage, loadEventSources, subgroupLabel } from "./lib/archiveLeagueGoals.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { matchesTeam, seasonLabel, slug } = require("../services/seasonArchive.js");
const { SOURCE_LINK_REL } = require("../services/sourceLinks.js");

const DOMAIN = "https://www.futbolradar.com";
const ARCHIVE_DIR = path.join(root, "arsiv");

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatDate(value) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "Tarih belirtilmedi";
  return new Date(parsed).toLocaleDateString("tr-TR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul"
  });
}

/**
 * Sayfa iskeleti. `base` arşiv alt klasöründen köke çıkmak için "../".
 */
function pageHtml({ file, base, title, description, h1, lead, breadcrumb, schema, body, bodyClass, robots }) {
  const url = `${DOMAIN}/${file}`;

  const crumbs = breadcrumb.map((crumb, index) => (
    crumb.href
      ? `<a href="${escapeHtml(crumb.href)}">${escapeHtml(crumb.label)}</a>`
      : `<span>${escapeHtml(crumb.label)}</span>`
  ) + (index < breadcrumb.length - 1 ? "<span>/</span>" : "")).join("");

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumb.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      item: crumb.href ? `${DOMAIN}/${String(crumb.href).replace(/^(\.\.\/)+/, "").replace(/^\.\//, "")}` : url
    }))
  };

  const graph = [breadcrumbSchema].concat(schema ? [schema] : []);

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${robots || ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(graph.length > 1 ? graph : graph[0])}</script>
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />
  </head>
  <body class="subpage ${bodyClass}">
    ${siteHeader({ base })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu">${crumbs}</nav>
      <section class="trend-hero"><div><span class="eyebrow">Arşiv</span><h1>${escapeHtml(h1)}</h1><p>${escapeHtml(lead)}</p></div><aside><span>Arşiv kaynağı</span><strong>Doğrulanmış maç kaydı</strong><small>Yalnızca kaydedilmiş veri gösterilir; eksik alan uydurulmaz.</small></aside></section>
      ${body}
    </main>
    ${siteFooter({ base })}
    <script src="${base}site.js" defer></script>
  </body>
</html>`;
}

function writePage(file, html) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html, "utf8");

  const mirror = path.join(root, "public", file);
  fs.mkdirSync(path.dirname(mirror), { recursive: true });
  fs.writeFileSync(mirror, html, "utf8");
}

function section(title, intro, inner, kicker) {
  return `<section class="container section">
    <div class="section-head"><div class="section-title">${kicker ? `<span class="section-kicker">${escapeHtml(kicker)}</span>` : ""}<h2>${escapeHtml(title)}</h2>${intro ? `<p>${escapeHtml(intro)}</p>` : ""}</div></div>
    ${inner}
  </section>`;
}

/**
 * İstatistik kutuları.
 *
 * Genel `.card` gövdesi kullanılmıyor: onun iç öğeleri satır içi akıyor ve
 * etiket ile sayı yan yana yapışıyordu ("KAYITLI MAÇ12"). Arşiv kutusunun
 * kendi ızgarası var — etiket üstte, sayı altta, not en altta.
 */
// `text: true` sayı değil metin taşıyan kutular içindir (kulüp adı, tarih);
// rakam boyutu uzun bir kulüp adını taşıyamıyor.
function statGrid(entries) {
  return `<div class="archive-stat-grid">${entries.map((entry) => `<article class="archive-stat"><span class="archive-stat-label">${escapeHtml(entry.label)}</span><strong class="archive-stat-value${entry.text ? " is-text" : ""}">${escapeHtml(String(entry.value))}</strong>${entry.note ? `<p class="archive-stat-note">${escapeHtml(entry.note)}</p>` : ""}</article>`).join("")}</div>`;
}

// ── Sezon sayfası ──────────────────────────────────────────────────────────

function matchRows(matches, base) {
  return matches.map((match) => {
    const reportExists = fs.existsSync(path.join(root, match.reportPage));
    const label = `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}`;
    const link = reportExists
      ? `<a class="detail-link" href="${base}${escapeHtml(match.reportPage)}">Maç raporu</a>`
      : `<span class="tag soft">Rapor yok</span>`;
    const verification = match.lastVerifiedAt ? `Doğrulama: ${formatDate(match.lastVerifiedAt)}` : "Doğrulama tarihi kaydedilmedi";
    const source = Array.isArray(match.sources) && match.sources.length ? `Kaynak: ${match.sources.map((item) => item.name).join(", ")}` : "Kaynak: doğrulanmış depo kaydı";
    return `<article class="archive-match-row" data-card="archive-match" data-match="${escapeHtml(match.id)}">
      <div><span class="archive-match-date">${escapeHtml(formatDate(match.kickoff))}</span><strong>${escapeHtml(label)}</strong><span class="archive-match-meta">${escapeHtml(match.league)}${match.stage ? ` · ${escapeHtml(match.stage)}` : ""} · ${escapeHtml(match.coverageLevel || "LIMITED")} · ${escapeHtml(verification)} · ${escapeHtml(source)}</span></div>
      ${link}
    </article>`;
  }).join("");
}

function teamTableHtml(rows, season, base) {
  return `<div class="archive-table-wrap"><table class="archive-table">
    <caption>Sezonun kayıtlı maçlarından türetilen takım bilançosu. Bu bir puan durumu değildir: hazırlık ve Avrupa maçları da sayıma dahildir.</caption>
    <thead><tr><th scope="col">Takım</th><th scope="col">O</th><th scope="col">G</th><th scope="col">B</th><th scope="col">M</th><th scope="col">A</th><th scope="col">Y</th><th scope="col">Av</th><th scope="col">Kadro</th></tr></thead>
    <tbody>${rows.map((row) => {
      const squadFile = `arsiv/kadro-${season}-${slug(row.team)}.html`;
      const hasSquad = fs.existsSync(path.join(root, squadFile));
      return `<tr><th scope="row">${escapeHtml(row.team)}</th><td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td><td>${row.goalsFor}</td><td>${row.goalsAgainst}</td><td>${row.goalDifference > 0 ? "+" : ""}${row.goalDifference}</td><td>${hasSquad ? `<a href="${base}${escapeHtml(squadFile)}">Kadro</a>` : "—"}</td></tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

/**
 * ARŞİVLENEN HER KADRO BAĞLANIR.
 *
 * Kadro sayfaları takım kadrosu veri kümesinden üretiliyor; takım bilançosu
 * tablosu ise yalnızca o sezon KAYITLI MAÇI olan takımları listeliyor. İkisi
 * aynı küme değil: 18 kadro sayfası üretilirken tabloda yalnızca 10 takım
 * vardı, dolayısıyla sekiz sayfa sitemap'te indexlenebilir durumda duruyor
 * ama siteden hiçbir yerden ulaşılamıyordu.
 *
 * Orphan sayfa iki şeyi birden söyler ve ikisi çelişir: Google'a "bunu
 * indexle", siteye "bu önemsiz". Üretilen her kadro burada listelenir.
 */
function squadListHtml(squads, season, base) {
  const cards = squads.map((squad) => {
    const file = `arsiv/kadro-${season}-${slug(squad.teamName)}.html`;
    const count = Array.isArray(squad.players) ? squad.players.length : 0;
    return `<article class="card" data-card="archive-squad"><span class="card-kicker">Kadro</span>` +
      `<h3>${escapeHtml(squad.teamName)}</h3>` +
      `<p>${count ? `${count} oyuncu arşivlendi.` : "Kadro kaydı arşivlendi."}</p>` +
      `<a class="detail-link" href="${base}${escapeHtml(file)}">Kadroyu aç</a></article>`;
  }).join("");
  return `<div class="grid">${cards}</div>`;
}

function managerListHtml(managers, missing, season, base) {
  const cards = managers.map((entry) => {
    const file = `arsiv/teknik-direktor-${season}-${slug(entry.manager)}.html`;
    return `<article class="card" data-card="archive-manager"><span class="card-kicker">${escapeHtml(entry.team)}</span><h3>${escapeHtml(entry.manager)}</h3><p>${escapeHtml(entry.appointedAt ? `${formatDate(entry.appointedAt)} tarihinde göreve geldi.` : "Önceki sezondan görevini sürdürüyor.")}</p><a class="detail-link" href="${base}${escapeHtml(file)}">Dönem sayfası</a></article>`;
  }).join("");

  const gap = missing.length
    ? `<article class="data-empty" data-card="empty-state"><strong>${missing.length} takım için kayıt yok</strong><span>${escapeHtml(missing.map((row) => row.team).join(", "))} — doğrulanmış bir kaynak bulunamadığı için kayıt açılmadı. Kaynak eklendiğinde sayfa kendiliğinden üretilir.</span></article>`
    : "";

  return `<div class="grid">${cards}${gap}</div>`;
}

function seasonPage(entry) {
  const season = entry.season;
  const label = seasonLabel(season);
  const file = `arsiv/sezon-${season}.html`;
  const summary = entry.summary;

  const stats = statGrid([
    { label: "Kayıtlı maç", value: summary.matchCount },
    { label: "Toplam gol", value: summary.totalGoals },
    { label: "Maç başına gol", value: summary.goalsPerMatch },
    { label: "Beraberlik", value: summary.drawCount },
    { label: "Gol yemeden biten", value: summary.cleanSheetMatches, note: "En az bir takımın gol yemediği maç sayısı." },
    { label: "Arşivlenen kadro", value: entry.squads.length }
  ]);

  // Seçili turnuvaların adı maç maç gol dökümü sayfasına bağlanır.
  const goalPageByLabel = new Map();
  for (const page of LEAGUE_GOAL_PAGES) {
    for (const leagueLabel of page.labels) goalPageByLabel.set(leagueLabel, page);
  }
  const competitionRows = summary.competitions.map((row) => {
    const goalPage = goalPageByLabel.get(row.competition);
    const name = goalPage
      ? `<a href="../${escapeHtml(leagueGoalFile(season, goalPage.slug))}" data-link="archive-league-goals">${escapeHtml(row.competition)}</a>`
      : escapeHtml(row.competition);
    return `<tr><th scope="row">${name}</th><td>${row.matches}</td><td>${row.goals}</td></tr>`;
  }).join("");

  const body = [
    section(`${label} sezon özeti`, "Aşağıdaki sayıların tamamı kayıtlı maç skorlarından doğrudan türetilmiştir.", stats, "İstatistik"),

    section("Turnuvaya göre dağılım", "Arşiv yalnızca sitede kaydı bulunan maçları toplar. Bağlantılı turnuva adları maç maç gol dökümünü (dakika, golcü, takım) açar.",
      `<div class="archive-table-wrap"><table class="archive-table"><thead><tr><th scope="col">Turnuva</th><th scope="col">Maç</th><th scope="col">Gol</th></tr></thead><tbody>${competitionRows}</tbody></table></div>`,
      "Kapsam"),

    section("Takım bilançosu", "", teamTableHtml(summary.teamTable, season, "../"), "Tablo"),

    section(`${label} maçları`, `${summary.matchCount} kayıtlı maç, yeniden eskiye.`,
      `<div class="archive-match-list">${matchRows(entry.matches, "../")}</div>`, "Maç arşivi"),

    entry.squads.length
      ? section("Arşivlenen kadrolar", "Sezonun kayıtlı kadroları; maç kaydı olmayan takımlar da dahil.",
        squadListHtml(entry.squads, season, "../"), "Kadro arşivi")
      : "",

    entry.managers.length
      ? section("Teknik direktörler", "Her kayıt kaynağıyla birlikte arşivlenir.",
        managerListHtml(entry.managers, entry.missingManagerTeams || [], season, "../"), "Teknik kadro")
      : "",

    // Bireysel döküm neden yok — sayfa kendi eksiğini açıklasın.
    section("Bireysel istatistikler", "",
      `<article class="data-empty" data-card="empty-state"><strong>Golcü ve asist dökümü yayımlanmıyor</strong><span>${escapeHtml(summary.individualStatsNote)}</span><div class="match-empty-actions"><a class="detail-link" href="../analizler.html">Maç raporlarına git</a></div></article>`,
      "Veri notu")
  ].filter(Boolean).join("");

  const schema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `FutbolRadar ${label} sezon arşivi`,
    description: `${label} sezonunda kaydedilen ${summary.matchCount} maçın sonuçları, takım bilançosu ve arşivlenen kadrolar.`,
    url: `${DOMAIN}/${file}`,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: "FutbolRadar", url: `${DOMAIN}/` },
    temporalCoverage: season.replace("-", "/"),
    variableMeasured: ["Maç sonucu", "Gol", "Takım bilançosu", "Sezon kadrosu"]
  };

  return {
    file,
    html: pageHtml({
      file, base: "../", bodyClass: "archive-page archive-season-page",
      title: `${label} Sezon Arşivi: Maçlar, Kadrolar ve İstatistikler | FutbolRadar`,
      description: `${label} sezonunda kaydedilen ${summary.matchCount} maç, ${summary.totalGoals} gol, takım bilançosu ve ${entry.squads.length} arşivlenmiş kadro.`,
      h1: `${label} Sezon Arşivi`,
      lead: `Bu sezonda sitede kaydı bulunan ${summary.matchCount} maç, takım bilançosu, arşivlenen kadrolar ve teknik direktör dönemleri.`,
      breadcrumb: [
        { label: "Ana Sayfa", href: "../index.html" },
        { label: "Arşiv", href: "../arsiv.html" },
        { label: `${label} sezonu` }
      ],
      schema,
      body
    })
  };
}

// ── Kadro sayfası ──────────────────────────────────────────────────────────

function squadPage(squad, season) {
  const label = seasonLabel(season);
  const file = `arsiv/kadro-${season}-${slug(squad.teamName)}.html`;

  const byPosition = new Map();
  for (const player of squad.players) {
    const key = player.position || "Belirtilmedi";
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(player);
  }

  const groups = [...byPosition.entries()].map(([position, players]) =>
    `<article class="card"><span class="card-kicker">${escapeHtml(position)}</span><ul class="archive-squad-list">${players
      .sort((left, right) => left.name.localeCompare(right.name, "tr"))
      .map((player) => `<li><span class="archive-squad-number">${player.number === null ? "—" : escapeHtml(String(player.number))}</span><strong>${escapeHtml(player.name)}</strong>${player.nationality ? `<span>${escapeHtml(player.nationality)}</span>` : ""}</li>`)
      .join("")}</ul></article>`).join("");

  const body = [
    section(`${squad.teamName} ${label} kadrosu`,
      `${squad.playerCount} oyuncu. Kadro, sezon içinde yakalanmış anlık görüntüdür; ${squad.capturedAt ? formatDate(squad.capturedAt) + " tarihinde" : "kayıt anında"} arşivlenmiştir.`,
      `<div class="grid">${groups}</div>`, "Kadro arşivi"),
    section("Bağlantılar", "",
      `<div class="grid"><article class="card"><h3>Sezon arşivi</h3><p>${escapeHtml(label)} sezonunun maçları, bilançosu ve diğer kadroları.</p><a class="detail-link" href="../arsiv/sezon-${escapeHtml(season)}.html">Sezon sayfasına git</a></article><article class="card"><h3>Takım radarı</h3><p>${escapeHtml(squad.teamName)} güncel form, momentum ve transfer hareketleri.</p><a class="detail-link" href="../takim-detay.html?team=${encodeURIComponent(squad.teamName)}">Takım sayfasına git</a></article></div>`,
      "İç bağlantılar")
  ].join("");

  const schema = {
    "@context": "https://schema.org",
    "@type": "SportsTeam",
    name: squad.teamName,
    sport: "Futbol",
    url: `${DOMAIN}/${file}`,
    athlete: squad.players.slice(0, 40).map((player) => ({ "@type": "Person", name: player.name }))
  };

  return {
    file,
    html: pageHtml({
      file, base: "../", bodyClass: "archive-page archive-squad-page",
      title: `${squad.teamName} ${label} Kadrosu | FutbolRadar Arşiv`,
      description: `${squad.teamName} ${label} sezonu kadrosu: ${squad.playerCount} oyuncu, mevkilere göre arşivlenmiş liste.`,
      h1: `${squad.teamName} — ${label} Kadrosu`,
      lead: `${label} sezonunda arşivlenen ${squad.playerCount} kişilik kadro.`,
      breadcrumb: [
        { label: "Ana Sayfa", href: "../index.html" },
        { label: "Arşiv", href: "../arsiv.html" },
        { label: `${label} sezonu`, href: `../arsiv/sezon-${season}.html` },
        { label: `${squad.teamName} kadrosu` }
      ],
      schema,
      body
    })
  };
}

// ── Teknik direktör sayfası ────────────────────────────────────────────────

function managerPage(entry, season, seasonEntry) {
  const label = seasonLabel(season);
  const file = `arsiv/teknik-direktor-${season}-${slug(entry.manager)}.html`;

  // Dönem bilançosu YALNIZCA kayıtlı maçtan çıkar. Maç yoksa bölüm çizilmez.
  // Eş adlar `teamAliases` ile açıkça verilir: kadro "Amed" derken künye
  // "Amed Sportif Faaliyetler" diyor ve düz eşitlik maçları ıskalardı.
  const teamNames = new Set([entry.team, ...(entry.teamAliases || [])]);
  const teamMatches = seasonEntry.matches.filter((match) =>
    matchesTeam(match, entry.team, entry.teamAliases));

  let record = null;
  if (teamMatches.length) {
    record = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 };
    for (const match of teamMatches) {
      const isHome = teamNames.has(match.homeTeam);
      const scored = isHome ? match.score.home : match.score.away;
      const conceded = isHome ? match.score.away : match.score.home;
      record.played += 1;
      record.goalsFor += scored;
      record.goalsAgainst += conceded;
      if (scored > conceded) record.won += 1;
      else if (scored < conceded) record.lost += 1;
      else record.drawn += 1;
    }
  }

  const confidenceNote = entry.confidence === "confirmed"
    ? "Resmî ya da birincil kaynakla doğrulandı."
    : "Güvenilir bir yayın organı aktardı; kulüp duyurusu ile ayrıca doğrulanmadı.";

  const body = [
    // Künye kutuları statGrid ile AYNI yapıyı kullanır: genel `.card` gövdesi
    // çocuklarını satır içinde akıtıyor ve etiketle değeri "GÖREVE
    // BAŞLANGIÇ10 Haziran 2026" diye bitiştiriyordu.
    section("Görev bilgisi", "",
      statGrid([
        { label: "Kulüp", value: entry.team, note: entry.note || "", text: true },
        {
          label: "Göreve başlangıç",
          value: entry.appointedAt ? formatDate(entry.appointedAt) : "Kayıtlı değil",
          note: entry.appointedAt
            ? ""
            : (entry.continuingFrom
              ? `${seasonLabel(entry.continuingFrom)} sezonundan görevini sürdürüyor.`
              : "Atama tarihi doğrulanmadığı için tahmin edilmedi."),
          text: true
        },
        {
          label: "Kayıt güveni",
          value: entry.confidence === "confirmed" ? "Doğrulandı" : "Basında",
          note: confidenceNote,
          text: true
        }
      ]), "Dönem"),

    record
      ? section(`${label} dönem bilançosu`,
        `Sitede kaydı bulunan ${record.played} maçtan türetildi. Bu, dönemin tamamı değil, ARŞİVLENEN maçlardır.`,
        statGrid([
          { label: "Kayıtlı maç", value: record.played },
          { label: "Galibiyet", value: record.won },
          { label: "Beraberlik", value: record.drawn },
          { label: "Mağlubiyet", value: record.lost },
          { label: "Atılan gol", value: record.goalsFor },
          { label: "Yenilen gol", value: record.goalsAgainst }
        ]), "Bilanço")
      : section(`${label} dönem bilançosu`, "",
        `<article class="data-empty" data-card="empty-state"><strong>Bu dönem için kayıtlı maç yok</strong><span>Bilanço uydurulmaz: ${escapeHtml(entry.team)} adına arşivlenmiş bir maç kaydı oluştuğunda bu bölüm kendiliğinden dolar.</span></article>`,
        "Bilanço"),

    record
      ? section("Dönemin maçları", "",
        `<div class="archive-match-list">${matchRows(teamMatches, "../")}</div>`, "Maçlar")
      : "",

    section("Kaynak", "",
      `<article class="card"><h3>${escapeHtml(entry.source.name)}</h3><p>${escapeHtml(entry.source.publishedAt ? formatDate(entry.source.publishedAt) + " tarihli kayıt." : "Yayın tarihi belirtilmedi.")}</p><a class="detail-link" href="${escapeHtml(entry.source.url)}" target="_blank" rel="${SOURCE_LINK_REL}">Kaynağı aç</a></article>`,
      "Künye")
  ].filter(Boolean).join("");

  const schema = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: entry.manager,
    jobTitle: "Teknik Direktör",
    url: `${DOMAIN}/${file}`,
    affiliation: { "@type": "SportsTeam", name: entry.team, sport: "Futbol" }
  };

  return {
    file,
    html: pageHtml({
      file, base: "../", bodyClass: "archive-page archive-manager-page",
      title: `${entry.manager} — ${entry.team} ${label} Dönemi | FutbolRadar Arşiv`,
      description: `${entry.manager}'in ${entry.team} ${label} dönemi: göreve başlangıç, kayıtlı maç bilançosu ve kaynak künyesi.`,
      h1: `${entry.manager} — ${entry.team}`,
      lead: `${label} sezonu teknik direktör dönemi. Bilanço yalnızca sitede kaydı bulunan maçlardan türetilir.`,
      breadcrumb: [
        { label: "Ana Sayfa", href: "../index.html" },
        { label: "Arşiv", href: "../arsiv.html" },
        { label: `${label} sezonu`, href: `../arsiv/sezon-${season}.html` },
        { label: entry.manager }
      ],
      schema,
      body
    })
  };
}

// ── Lig gol dökümü sayfası ────────────────────────────────────────────────

const LEAGUE_GOAL_INDEX_MIN_DETAIL_SHARE = 0.1;

function leagueGoalFile(season, pageSlug) {
  return `arsiv/sezon-${season}/${pageSlug}.html`;
}

function teamLink(team, base) {
  const file = `${slug(team)}-maclari.html`;
  return fs.existsSync(path.join(root, file))
    ? `<a href="${base}${escapeHtml(file)}">${escapeHtml(team)}</a>`
    : escapeHtml(team);
}

function goalItem(goal, base) {
  const minute = goal.minute ? escapeHtml(goal.minute) : "Dakika yok";
  const team = goal.team ? teamLink(goal.team, base) : "Takım belirtilmedi";
  if (goal.note) {
    return `<li><strong>${minute}</strong> · ${team} · <span>${escapeHtml(goal.note)}</span> <span class="tag soft">Editoryal kayıt metni</span></li>`;
  }
  const player = goal.player ? escapeHtml(goal.player) : "Golcü kayıtta yok";
  const kind = goal.kind ? ` <span class="tag soft">${escapeHtml(goal.kind)}</span>` : "";
  const assist = goal.assist ? ` · Asist: ${escapeHtml(goal.assist)}` : "";
  return `<li><strong>${minute}</strong> · ${player} (${team})${kind}${assist}</li>`;
}

const STATUS_TAG = {
  complete: "",
  goalless: `<span class="tag soft">Golsüz</span>`,
  missing: `<span class="tag soft">Gol detayı yok</span>`,
  mismatch: `<span class="tag soft">Gol detayı eksik</span>`
};

function goalMatchHtml(row, base) {
  const match = row.match;
  const reportExists = fs.existsSync(path.join(root, match.reportPage));
  const score = `${match.score.home}-${match.score.away}`;
  let inner;
  if (row.status === "goalless") {
    inner = `<p>Maç golsüz bitti.</p>`;
  } else if (row.status === "missing") {
    inner = `<p><strong>Gol detayı yok.</strong> Kaynak kayıtta bu maç için dakika/golcü bilgisi bulunmuyor; yalnızca skor (${escapeHtml(score)}) doğrulanmış. Golcü tahmin edilmez.</p>`;
  } else {
    inner = `<ol class="archive-goal-list">${row.goals.map((goal) => goalItem(goal, base)).join("")}</ol>` +
      (row.status === "mismatch"
        ? `<p><strong>Gol detayı eksik:</strong> kayıtlı gol olayı ${row.goals.length}, skordaki gol ${row.scoreGoals}. Eksik goller tahmin edilmedi.</p>`
        : "");
  }
  const sourceLabel = row.eventSource === "manual"
    ? "Kaynak: FutbolRadar editoryal kaydı"
    : "Kaynak: API-Football";
  const flags = [
    row.unapproved ? "Bu maçın kayıt zincirinde onaylı olmayan ikincil bir kaynak var; kayıt incelemede." : "",
    row.groupMethod === "team-set" ? "Turnuva kimliği, iki takımın aynı kimlikli turnuvada kayıtlı olmasından belirlendi." : ""
  ].filter(Boolean).map((line) => `<p class="archive-match-meta">${escapeHtml(line)}</p>`).join("");
  const verified = match.lastVerifiedAt ? ` · Doğrulama: ${formatDate(match.lastVerifiedAt)}` : "";
  return `<details class="archive-match-row" data-card="archive-goal-match" data-match="${escapeHtml(match.id)}">
      <summary><span class="archive-match-date">${escapeHtml(formatDate(match.kickoff))}</span> <strong>${escapeHtml(match.homeTeam)} ${escapeHtml(score)} ${escapeHtml(match.awayTeam)}</strong> ${STATUS_TAG[row.status]}</summary>
      <p class="archive-match-meta">${teamLink(match.homeTeam, base)} – ${teamLink(match.awayTeam, base)} · ${escapeHtml(match.league)}${match.stage ? ` · ${escapeHtml(match.stage)}` : ""} · ${escapeHtml(sourceLabel)}${escapeHtml(verified)}</p>
      ${inner}${flags}
      ${reportExists ? `<a class="detail-link" href="${base}${escapeHtml(match.reportPage)}">Maç raporu</a>` : ""}
    </details>`;
}

function percent(part, whole) {
  return whole ? `%${Math.round((part / whole) * 100)}` : "—";
}

function leagueGoalPage(result, seasonEntry, freshness) {
  const { page, rows, stats } = result;
  const season = seasonEntry.season;
  const label = seasonLabel(season);
  const file = leagueGoalFile(season, page.slug);
  const base = "../../";

  // İçerik kuralı: gollü maçların en az %10'unda gol dökümü yoksa sayfa
  // büyük ölçüde sezon sayfasındaki skorların tekrarıdır (ince içerik);
  // `noindex,follow` kalır ve sitemap'e girmez. Veri geldikçe kendiliğinden açılır.
  const indexable = stats.matchesWithGoals > 0 && stats.withAnyDetail / stats.matchesWithGoals >= LEAGUE_GOAL_INDEX_MIN_DETAIL_SHARE;

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  const orderedGroups = [...groups.entries()].sort((left, right) => {
    if (left[0] === null) return 1;
    if (right[0] === null) return -1;
    return right[1].length - left[1].length;
  });

  const statBlock = statGrid([
    { label: "Kayıtlı maç", value: stats.matches },
    { label: "Toplam gol (skor)", value: stats.archiveGoals, note: "Sezon arşivi tablosundaki sayıyla aynı kaynaktan." },
    { label: "Listelenen gol olayı", value: stats.goalEvents, note: "Dakika/golcü kaydı olan goller." },
    { label: "Gol detayı tam", value: stats.completeDetail, note: `Gollü ${stats.matchesWithGoals} maçın ${percent(stats.completeDetail, stats.matchesWithGoals)}'i.` },
    { label: "Gol detayı yok", value: stats.missingDetail, note: `Gollü maçların ${percent(stats.missingDetail, stats.matchesWithGoals)}'i; yalnızca skor var.` },
    { label: "Gol detayı eksik", value: stats.mismatch, note: "Olay sayısı skorla tutmuyor." }
  ]);

  const labelNote = page.labels.length > 1
    ? `Bu sayfa arşivdeki şu etiketleri birlikte gösterir: ${stats.byLabel.map((entry) => `${entry.label} (${entry.matches} maç)`).join(", ")}.`
    : `Arşiv etiketi: ${page.labels[0]}.`;

  const sourceCard = `<article class="card" data-card="archive-goal-source"><h3>Kaynak: API-Football</h3><p>Skorlar ve gol olayları (dakika, golcü, takım) API-Football maç olay akışından alınır; birkaç Avrupa maçı FutbolRadar editoryal kaydından gelir ve öyle işaretlenir. ${escapeHtml(labelNote)}</p><p>Son doğrulanan maç kaydı: ${escapeHtml(stats.lastVerifiedAt ? formatDate(stats.lastVerifiedAt) : "kayıtlı değil")}. Kalıcı maç arşivi güncellemesi: ${escapeHtml(freshness.historicalUpdatedAt ? formatDate(freshness.historicalUpdatedAt) : "kayıtlı değil")}.</p></article>`;

  const groupSections = orderedGroups.map(([key, groupRows]) => {
    const title = orderedGroups.length > 1 || key ? subgroupLabel(key) : page.title;
    const intro = key === null && orderedGroups.length > 1
      ? "Bu maçların sağlayıcı lig kimliği kayıtta yok ve takımlar tek bir kimlikli turnuvayla eşleşmedi; ülke tahmin edilmedi."
      : `${groupRows.length} maç, yeniden eskiye.`;
    return section(title, intro, `<div class="archive-match-list">${groupRows.map((row) => goalMatchHtml(row, base)).join("")}</div>`, "Maç maç goller");
  }).join("");

  const mixedNote = orderedGroups.length > 1
    ? section("Aynı ad, farklı turnuvalar", "",
      `<article class="data-empty" data-card="empty-state"><strong>"${escapeHtml(page.labels.join(" / "))}" etiketi birden fazla turnuvayı kapsıyor</strong><span>Sağlayıcı aynı adı farklı ülkelerin turnuvalarına veriyor. Maçlar, kayıttaki API-Football lig kimliğine göre gruplandı; kimliği olmayanlar ayrı listede.</span></article>`,
      "Veri notu")
    : "";

  const body = [
    section(`${page.title} — ${label} gol dökümü`, "Sayılar bu sayfadaki maç kayıtlarından doğrudan hesaplanır.", statBlock, "Özet"),
    section("Kaynak ve güncellik", "", sourceCard, "Künye"),
    mixedNote,
    groupSections,
    section("Bağlantılar", "", `<div class="grid"><article class="card"><h3>${escapeHtml(label)} sezon arşivi</h3><p>Turnuvaya göre dağılım, takım bilançosu ve tüm maçlar.</p><a class="detail-link" href="${base}arsiv/sezon-${escapeHtml(season)}.html">Sezon arşivine dön</a></article></div>`, "İç bağlantılar")
  ].join("");

  return {
    file,
    indexable,
    html: pageHtml({
      file, base, bodyClass: "archive-page archive-league-goals-page",
      robots: indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW,
      title: `${page.title} ${label} Gol Dökümü: Maç Maç Goller | FutbolRadar Arşiv`,
      description: `${page.title} ${label}: ${stats.matches} kayıtlı maç, ${stats.archiveGoals} gol; ${stats.goalEvents} golün dakikası, golcüsü ve takımı. Kaynak: API-Football.`,
      h1: `${page.title} — ${label} Gol Dökümü`,
      lead: `${stats.matches} maç, maç maç goller: dakika, golcü ve takım. Gol detayı kaynakta olmayan maçlar açıkça işaretlenir.`,
      breadcrumb: [
        { label: "Ana Sayfa", href: `${base}index.html` },
        { label: "Arşiv", href: `${base}arsiv.html` },
        { label: `${label} sezonu`, href: `${base}arsiv/sezon-${season}.html` },
        { label: page.title }
      ],
      schema: {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: `${page.title} ${label} gol dökümü`,
        url: `${DOMAIN}/${file}`,
        isAccessibleForFree: true,
        creator: { "@type": "Organization", name: "FutbolRadar", url: `${DOMAIN}/` },
        temporalCoverage: season.replace("-", "/"),
        variableMeasured: ["Maç sonucu", "Gol dakikası", "Golcü", "Takım"]
      },
      body
    })
  };
}

// ── Arşiv dizini ───────────────────────────────────────────────────────────

function indexPage(seasons) {
  const cards = seasons.map((entry) => {
    const label = seasonLabel(entry.season);
    return `<article class="card" data-card="archive-season"><span class="card-kicker">${escapeHtml(label)}</span><h3>${escapeHtml(label)} sezonu</h3><p>${entry.matchCount} kayıtlı maç · ${entry.summary.totalGoals} gol · ${entry.squads.length} kadro${entry.managers.length ? ` · ${entry.managers.length} teknik direktör` : ""}</p><a class="detail-link" href="./arsiv/sezon-${escapeHtml(entry.season)}.html">Sezon arşivini aç</a></article>`;
  }).join("");

  const body = [
    section("Sezonlar", "Arşiv yalnızca sitede kaydı bulunan sezonları listeler.",
      `<div class="grid">${cards}</div>`, "Sezon arşivi"),
    section("Arşiv nasıl büyüyor?", "",
      `<article class="card"><p>Arşiv ayrı bir veri kaynağı değil, doğrulanmış maç kaydının sezona göre dondurulmuş görüntüsüdür. Yeni bir maç kaydedildiğinde <code>scripts/archive-season-data.mjs</code> onu ait olduğu sezona yazar; kadrolar sezon başına bir kez yakalanır ve sonradan daralsa bile silinmez. Kaydı olmayan sezon için sayfa üretilmez.</p></article>`,
      "Veri notu")
  ].join("");

  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "FutbolRadar Arşiv",
    url: `${DOMAIN}/arsiv.html`,
    description: "Sezon bazlı maç, kadro, teknik direktör ve istatistik arşivi.",
    hasPart: seasons.map((entry) => ({
      "@type": "WebPage",
      name: `${seasonLabel(entry.season)} sezon arşivi`,
      url: `${DOMAIN}/arsiv/sezon-${entry.season}.html`
    }))
  };

  return {
    file: "arsiv.html",
    html: pageHtml({
      file: "arsiv.html", base: "./", bodyClass: "archive-page archive-index-page",
      title: "Futbol Arşivi: Sezon Sezon Maçlar, Kadrolar ve İstatistikler | FutbolRadar",
      description: `Sezon bazlı futbol arşivi: ${seasons.reduce((sum, entry) => sum + entry.matchCount, 0)} kayıtlı maç, takım kadroları, teknik direktör dönemleri ve istatistik özetleri.`,
      h1: "Futbol Arşivi",
      lead: "Sezon sezon maç sonuçları, takım kadroları, teknik direktör dönemleri ve istatistiksel özetler.",
      breadcrumb: [{ label: "Ana Sayfa", href: "./index.html" }, { label: "Arşiv" }],
      schema,
      body
    })
  };
}

// ── Üretim ─────────────────────────────────────────────────────────────────

const archive = readJsonFile(path.join(root, "data", "season-archive.json"), { seasons: {} });
const seasons = Object.values(archive.seasons || {})
  .sort((left, right) => String(right.season).localeCompare(String(left.season)));

if (!seasons.length) {
  console.log("[archive-pages] Arşivde sezon yok; sayfa üretilmedi. Boş kabuk sayfa üretilmez.");
  process.exit(0);
}

// Eski üretim kalıntısı kalmasın: kaynak veriden düşen bir sezonun sayfası
// sitede asılı kalırsa arama sonucunda ölü bir sayfa görünür.
for (const dir of [ARCHIVE_DIR, path.join(root, "public", "arsiv")]) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

const written = [];

// Kadro sayfaları ÖNCE: sezon sayfasındaki tablo "kadro var mı?" diye dosya
// varlığına bakıyor.
for (const entry of seasons) {
  for (const squad of entry.squads) {
    const page = squadPage(squad, entry.season);
    writePage(page.file, page.html);
    written.push(page.file);
  }
  for (const manager of entry.managers) {
    if (!manager || !manager.source || !manager.source.url) continue;
    const page = managerPage(manager, entry.season, entry);
    writePage(page.file, page.html);
    written.push(page.file);
  }
}

// Lig gol dökümü sayfaları. Yalnızca indekslenebilir olanlar sitemap'e girer.
const notIndexed = new Set();
const goalPageStats = [];
for (const entry of seasons) {
  const wantedLabels = new Set(LEAGUE_GOAL_PAGES.flatMap((page) => page.labels));
  const wantedIds = new Set(entry.matches.filter((match) => wantedLabels.has(match.league)).map((match) => match.id));
  if (!wantedIds.size) continue;
  const sources = loadEventSources(root, wantedIds);
  for (const goalPage of LEAGUE_GOAL_PAGES) {
    const result = buildLeagueGoalPage(goalPage, entry.matches, sources);
    if (!result.stats.matches) {
      console.log(`[archive-pages] ${entry.season} ${goalPage.title}: arşivde maç yok, sayfa üretilmedi.`);
      continue;
    }
    const page = leagueGoalPage(result, entry, sources.freshness);
    writePage(page.file, page.html);
    written.push(page.file);
    if (!page.indexable) notIndexed.add(page.file);
    goalPageStats.push({ season: entry.season, slug: goalPage.slug, file: page.file, indexable: page.indexable, ...result.stats });
  }
}
if (process.env.ARCHIVE_GOAL_STATS) {
  fs.writeFileSync(process.env.ARCHIVE_GOAL_STATS, JSON.stringify(goalPageStats, null, 2));
}

for (const entry of seasons) {
  const page = seasonPage(entry);
  writePage(page.file, page.html);
  written.push(page.file);
}

const index = indexPage(seasons);
writePage(index.file, index.html);
written.push(index.file);

// Sitemap: arşiv sayfaları aranabilir olmalı, yoksa SEO tarafı yarım kalır.
const sitemapPath = path.join(root, "sitemap.xml");
if (fs.existsSync(sitemapPath)) {
  let xml = fs.readFileSync(sitemapPath, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;

  for (const file of written) {
    if (notIndexed.has(file)) continue;
    const loc = `${DOMAIN}/${file}`;
    if (xml.includes(`<loc>${loc}</loc>`)) continue;
    xml = xml.replace("</urlset>", `  <url><loc>${loc}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n</urlset>`);
    added += 1;
  }

  if (added) {
    fs.writeFileSync(sitemapPath, xml, "utf8");
    const publicSitemap = path.join(root, "public", "sitemap.xml");
    if (fs.existsSync(publicSitemap)) fs.writeFileSync(publicSitemap, xml, "utf8");
  }
  console.log(`[archive-pages] sitemap: ${added} yeni URL eklendi.`);
}

console.log(`[archive-pages] ${written.length} sayfa üretildi (${seasons.length} sezon).`);
