#!/usr/bin/env node
/**
 * MAÇ DOSYASI SAYFALARINI ÜRET.
 *
 * Bir maç dosyası = bir HUB + modül sayfaları. Hub maçın künyesini ve
 * modüllere açılan kartları taşır; her kart GERÇEK bir sayfaya gider.
 * Boş hedefe kart basmak, okuyucuya olmayan bir söz vermektir — bu yüzden
 * kart listesi üretilen sayfa listesinden TÜRETİLİR, elle yazılmaz.
 *
 * İKİ TÜR MODÜL VAR:
 *
 *   • YAZILI modüller — `data/match-specials.json` içinde elle yazılan
 *     taktik metinler. İçerik editörün.
 *   • VERİ modülleri — kilit oyuncular, kilit eşleşmeler, form, ilk 11.
 *     İçerik veri katmanından gelir; burada yalnızca çizilir.
 *
 * Kaynak gösterilmiş MUHTEMEL 11 editoryal veri olarak çizilebilir; görünür
 * rozet ve açıklama bunun resmî olmadığını söyler. Resmî kadro yalnızca
 * `/api/match-lineup` sağlayıcısından gelir ve geldiğinde istemci muhtemel
 * katmanı kaldırıp gerçek oyuncu, forma numarası, yedek ve dizilişi çizer.
 *
 * ADRESLER: Türkçe `mac-dosyasi/<slug>.html`, İngilizce
 * `en/match-special/<slug>.html`. hreflang çifti `data/en-route-map.json`e
 * yazılır ve `inject-hreflang.mjs` iki tarafa da basar — tekilleştirme tek
 * yerde kalsın diye (o dosyanın kendi yorumunda yazılı).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  localizeSpecial,
  logRejected,
  selectMatchSpecial
} = require("../services/matchSpecial.js");
const { formatDate, formatTime, formatWeekday, absoluteUrl, hreflangOf } = require("../services/i18n.js");

const root = process.cwd();
const TR_DIR = "mac-dosyasi";
const EN_DIR = "en/match-special";
const DOMAIN = "https://www.futbolradar.com";

/**
 * Site köküne göreli önek. İki dil AYNI DERİNLİKTE DEĞİL: Türkçe dosya
 * `mac-dosyasi/` (bir kat), İngilizce `en/match-special/` (iki kat). Öneki
 * sabit yazmak, İngilizce tarafta `page.css`ten menü bağlantılarına kadar
 * her adresi bir kat yukarıdan aramak demekti — sayfa stilsiz açılır ve
 * bağlantılar 404 verirdi.
 */
function baseFor(dir) {
  return "../".repeat(dir.split("/").filter(Boolean).length);
}

function readJson(relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** Paragraflara böl: veri `\n\n` ile ayrılmış düz metin taşıyor. */
function paragraphs(body) {
  return String(body || "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
    .map((part) => `<p>${escapeHtml(part)}</p>`).join("\n            ");
}

const STRINGS = {
  tr: {
    breadcrumbHome: "Ana Sayfa", breadcrumbHub: "Maç Dosyası",
    kickoff: "Başlama", venue: "Stat", competition: "Turnuva", week: "Hafta",
    status: "Durum", countdown: "Maça kalan", statusScheduled: "Başlamadı",
    modules: "Dosya bölümleri", readMore: "İncele", backToHub: "Maç dosyasına dön",
    keyPlayers: "Kilit Oyuncular", matchups: "Maçın Kilit Eşleşmeleri",
    form: "Form ve İstatistik", lineups: "Muhtemel / Resmî İlk 11",
    formVerified: "Doğrulanmış maç verisinden",
    formEditorial: "Editoryal kayıt — sitenin doğrulanmış maç arşivinde bu takımın maçı yok",
    lastFive: "Son 5 maç", scored: "Attığı", conceded: "Yediği", cleanSheet: "Gol yemediği maç",
    editorialNote: "Bu bölüm editoryal yorumdur; sitenin doğrulanmış maç verisinden ayrıdır.",
    squadNote: "Oyuncu listesi güncel kadro verisinden alınır; kadroda olmayan isim gösterilmez.",
    lineupPending: "İlk 11'ler henüz açıklanmadı",
    lineupPendingBody: "Resmî kadrolar sağlayıcı tarafından yayımlandığı anda bu bölüm kendiliğinden güncellenir; oyuncular, forma numaraları, yedekler ve diziliş API verisiyle değiştirilir.",
    liveEntry: "Canlı skor merkezi", matchCentre: "Maç merkezi",
    live: "Canlı", finished: "Tamamlandı"
  },
  en: {
    breadcrumbHome: "Home", breadcrumbHub: "Match Special",
    kickoff: "Kick-off", venue: "Stadium", competition: "Competition", week: "Week",
    status: "Status", countdown: "Time to kick-off", statusScheduled: "Not started",
    modules: "Sections", readMore: "Open", backToHub: "Back to the match special",
    keyPlayers: "Key Players", matchups: "Key Matchups",
    form: "Form and Statistics", lineups: "Probable / Official XI",
    formVerified: "From verified match data",
    formEditorial: "Editorial record — this club has no matches in the site's verified archive",
    lastFive: "Last 5 matches", scored: "Scored", conceded: "Conceded", cleanSheet: "Clean sheets",
    editorialNote: "This section is editorial opinion, separate from the site's verified match data.",
    squadNote: "Player lists come from current squad data; a name not in the squad is not shown.",
    lineupPending: "Line-ups have not been announced yet",
    lineupPendingBody: "This section updates itself when the provider publishes the official line-ups; players, shirt numbers, substitutes and formation are replaced with API data.",
    liveEntry: "Live scores", matchCentre: "Match centre",
    live: "Live", finished: "Full time"
  }
};

/** Sayfa iskeleti. Başlık/altlık `apply-shared-layout.mjs` tarafından yazılır. */
function pageShell({ locale, title, description, canonical, body, schema, base }) {
  return `<!doctype html>
<html lang="${locale === "en" ? "en" : "tr"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="${locale === "en" ? "en_GB" : "tr_TR"}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />${schema ? `
    <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>` : ""}
  </head>
  <body class="subpage">
    <header class="topbar"></header>
${body}
    <footer class="footer"></footer>
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

/** Maç künyesi: hepsi fikstür verisinden, hiçbiri elle yazılmamış. */
function fixtureBoard(special, copy, locale) {
  const fixture = special.fixture;
  const kickoffDate = formatDate(fixture.kickoff, locale);
  const kickoffTime = formatTime(fixture.kickoff, locale);
  const weekday = formatWeekday(fixture.kickoff, locale);

  return `      <section class="match-special__board" data-match-special-board data-match-id="${escapeHtml(fixture.id)}" data-kickoff="${escapeHtml(fixture.kickoff)}">
        <div class="match-special__teams">
          <div class="match-special__team"><strong>${escapeHtml(fixture.homeTeam)}</strong></div>
          <div class="match-special__vs" aria-hidden="true">–</div>
          <div class="match-special__team"><strong>${escapeHtml(fixture.awayTeam)}</strong></div>
        </div>
        <dl class="match-special__meta">
          <div><dt>${escapeHtml(copy.kickoff)}</dt><dd>${escapeHtml(`${weekday}, ${kickoffDate} · ${kickoffTime}`)}</dd></div>
          <div><dt>${escapeHtml(copy.venue)}</dt><dd>${escapeHtml(fixture.venue)}</dd></div>
          <div><dt>${escapeHtml(copy.competition)}</dt><dd>${escapeHtml(fixture.league)}${fixture.round ? ` · ${escapeHtml(copy.week)} ${escapeHtml(fixture.round)}` : ""}</dd></div>
          <div><dt>${escapeHtml(copy.status)}</dt><dd data-match-special-status>${escapeHtml(copy.statusScheduled)}</dd></div>
        </dl>
        <p class="match-special__countdown" data-match-special-countdown hidden></p>
        <p class="match-special__score" data-match-special-score hidden></p>
        <p class="match-special__flag" data-lineup-badge hidden></p>
      </section>`;
}

/** Form tablosu — KAYNAĞIYLA birlikte. */
function formBlock(team, copy) {
  const rows = (team.form.matches || []).map((row) => {
    const label = row.label || "";
    const badge = row.result === "win" ? "G" : (row.result === "loss" ? "M" : "B");
    return `<li class="match-special__form-row is-${escapeHtml(row.result || "draw")}">` +
      `<span class="match-special__form-badge">${badge}</span>` +
      `<span>${escapeHtml(label)}</span>` +
      (row.date ? `<time datetime="${escapeHtml(row.date)}">${escapeHtml(row.date)}</time>` : "") +
      `</li>`;
  }).join("\n            ");

  const verified = team.form.source === "verified";
  const scored = (team.form.matches || []).reduce((sum, row) => sum + (Number(row.scored) || 0), 0);
  const conceded = (team.form.matches || []).reduce((sum, row) => sum + (Number(row.conceded) || 0), 0);
  const clean = (team.form.matches || []).filter((row) => Number(row.conceded) === 0).length;

  return `<article class="match-special__form">
          <h3>${escapeHtml(team.name)}</h3>
          <p class="match-special__source is-${verified ? "verified" : "editorial"}">${escapeHtml(verified ? copy.formVerified : copy.formEditorial)}</p>
          <ul class="match-special__form-list">
            ${rows || ""}
          </ul>${verified ? `
          <dl class="match-special__form-totals">
            <div><dt>${escapeHtml(copy.scored)}</dt><dd>${scored}</dd></div>
            <div><dt>${escapeHtml(copy.conceded)}</dt><dd>${conceded}</dd></div>
            <div><dt>${escapeHtml(copy.cleanSheet)}</dt><dd>${clean}</dd></div>
          </dl>` : ""}
        </article>`;
}

/** Kilit oyuncu kartları — hepsi güncel kadrodan. */
function keyPlayerBlock(team, copy) {
  const cards = (team.keyPlayers || []).map((player) => `<article class="match-special__player">
            <h4>${escapeHtml(player.name)}</h4>
            <p>${escapeHtml([player.position, player.number ? `#${player.number}` : ""].filter(Boolean).join(" · "))}</p>
          </article>`).join("\n          ");

  return `<section class="match-special__players">
          <h3>${escapeHtml(team.name)}</h3>
          <div class="match-special__player-grid">
          ${cards}
          </div>
        </section>`;
}

function probableLineupBlock(special, locale) {
  const probable = special.probableLineup;
  if (!probable) return "";
  const base = baseFor(locale === "en" ? EN_DIR : TR_DIR);
  const rows = [0, 1, 2, 3, 4].map((rowIndex) => {
    const players = (probable.players || [])
      .filter((player) => player.row === rowIndex)
      .sort((left, right) => (left.order || 0) - (right.order || 0));
    return `<div class="match-special__pitch-row is-${players.length}">
              ${players.map((player) => {
                const profile = player.profile && (player.profile[locale] || player.profile.tr);
                return `<a class="match-special__pitch-player" href="${escapeHtml(`${base}${profile}`)}">${escapeHtml(player.name)}</a>`;
              }).join("\n              ")}
            </div>`;
  }).join("\n            ");
  const analysis = (probable.analysis || []).map((section) => `<article class="match-special__probable-analysis-card">
              <h3>${escapeHtml(section.heading)}</h3>
              <p>${escapeHtml(section.body)}</p>
            </article>`).join("\n            ");

  return `<section class="match-special__probable" id="probable-xi" data-probable-lineup>
          <header class="match-special__probable-head">
            <span class="match-special__probable-badge">${escapeHtml(probable.badge)}</span>
            <h2>${escapeHtml(probable.title)}</h2>
            <p>${escapeHtml(probable.sourceLabel)}</p>
            <strong>${escapeHtml(locale === "en" ? "Formation" : "Diziliş")} ${escapeHtml(probable.formation)}</strong>
          </header>
          <div class="match-special__pitch" role="group" aria-label="${escapeHtml(`${probable.team} ${probable.formation}`)}">
            ${rows}
          </div>
          <div class="match-special__probable-analysis">
            ${analysis}
          </div>
        </section>`;
}

/**
 * VERİ MODÜLLERİ. Yazılı modüllerle aynı kart yapısını kullanırlar ki
 * hub'daki liste tek biçimli kalsın.
 */
function dataModules(special, copy, locale) {
  return [
    {
      id: "kilit-oyuncular",
      slug: locale === "en" ? "key-players" : "kilit-oyuncular",
      kicker: locale === "en" ? "Squad" : "Kadro",
      title: copy.keyPlayers,
      summary: copy.squadNote,
      html: `${keyPlayerBlock(special.teams.home, copy)}
        ${keyPlayerBlock(special.teams.away, copy)}
        <p class="match-special__note">${escapeHtml(copy.squadNote)}</p>`
    },
    {
      id: "kilit-eslesmeler",
      slug: locale === "en" ? "key-matchups" : "kilit-eslesmeler",
      kicker: locale === "en" ? "Duels" : "İkili mücadele",
      title: copy.matchups,
      summary: locale === "en"
        ? "The individual duels most likely to decide the match."
        : "Maçı belirleyebilecek ikili mücadeleler.",
      html: (special.matchups || []).map((row) => `<article class="match-special__matchup">
          <h3>${escapeHtml(row.title)}</h3>
          ${paragraphs(row.body)}
        </article>`).join("\n        ")
    },
    {
      id: "form-istatistik",
      slug: locale === "en" ? "form-and-statistics" : "form-ve-istatistik",
      kicker: locale === "en" ? "Data" : "Veri",
      title: copy.form,
      summary: locale === "en"
        ? "Recent results for both sides, each labelled with its source."
        : "İki takımın son maçları, kaynağıyla birlikte.",
      html: `<div class="match-special__form-grid">
          ${formBlock(special.teams.home, copy)}
          ${formBlock(special.teams.away, copy)}
        </div>`
    },
    {
      id: "ilk-11",
      slug: locale === "en" ? "line-ups" : "ilk-11",
      kicker: special.probableLineup ? special.probableLineup.moduleKicker : (locale === "en" ? "Line-ups" : "Kadro"),
      title: special.probableLineup ? special.probableLineup.title : copy.lineups,
      summary: special.probableLineup ? special.probableLineup.sourceLabel : (locale === "en"
        ? "Updates automatically when the provider publishes the official XIs."
        : "Resmî kadrolar yayımlandığı anda kendiliğinden güncellenir."),
      // Başlık kadro açıklandığında "Resmî İlk 11"e döner; kanca burada.
      headingHook: true,
      lineupCard: true,
      html: `<section class="match-special__lineups" data-match-lineups data-match-id="${escapeHtml(special.fixture.id)}" data-lineup-locale="${locale}">
          ${probableLineupBlock(special, locale)}
          <p class="match-special__flag" data-lineup-badge hidden></p>
          <p class="match-special__lineup-status" data-lineup-status>${escapeHtml(copy.lineupPending)}</p>
          <p class="match-special__note" data-lineup-note>${escapeHtml(copy.lineupPendingBody)}</p>
          <div class="match-special__lineup-grid" data-lineup-grid hidden></div>
        </section>`
    }
  ];
}

function allModules(special, copy, locale) {
  const generated = dataModules(special, copy, locale);
  if (!special.probableLineup) return [...special.modules, ...generated];
  const lineup = generated.find((module) => module.id === "ilk-11");
  return [lineup, ...special.modules, ...generated.filter((module) => module.id !== "ilk-11")];
}

/** Modül kartı — hub'daki tıklanabilir giriş. */
function moduleCard(module, hubSlug, copy, locale) {
  const href = `./${hubSlug}-${module.slug}.html`;
  return `<a class="match-special__card${module.lineupCard ? " is-lineup" : ""}" href="${escapeHtml(href)}"${module.lineupCard ? " data-lineup-card" : ""}>
            <span class="match-special__card-kicker">${escapeHtml(module.kicker || "")}</span>
            <strong${module.headingHook ? " data-lineup-heading" : ""}>${escapeHtml(module.title)}</strong>${module.lineupCard ? `
            <span class="match-special__card-flag" data-lineup-badge hidden></span>` : ""}
            ${module.summary ? `<p>${escapeHtml(module.summary)}</p>` : ""}
            <span class="match-special__card-cta">${escapeHtml(copy.readMore)} →</span>
          </a>`;
}

/** SportsEvent — yalnızca DOĞRULANMIŞ alanlarla. */
function sportsEventSchema(special, canonical, locale) {
  const fixture = special.fixture;
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${fixture.homeTeam} - ${fixture.awayTeam}`,
    startDate: fixture.kickoff,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url: canonical,
    inLanguage: locale === "en" ? "en" : "tr",
    // Stadyum adı fikstürde var; adres/koordinat YOK ve uydurulmaz.
    location: fixture.venue ? { "@type": "Place", name: fixture.venue } : undefined,
    competitor: [
      { "@type": "SportsTeam", name: fixture.homeTeam },
      { "@type": "SportsTeam", name: fixture.awayTeam }
    ],
    superEvent: fixture.league ? { "@type": "SportsOrganization", name: fixture.league } : undefined
  };
}

function seoFor(special, locale) {
  const fixture = special.fixture;
  const date = formatDate(fixture.kickoff, locale);
  if (locale === "en") {
    return {
      title: `${fixture.homeTeam} vs ${fixture.awayTeam} | Match Special, Line-ups and Analysis | FutbolRadar`,
      description: `${fixture.homeTeam} vs ${fixture.awayTeam} on ${date} at ${fixture.venue}: tactical analysis, probable and official line-ups, key players, key matchups, form and a match prediction.`
    };
  }
  return {
    title: `${fixture.homeTeam} ${fixture.awayTeam} maçı | Muhtemel 11, analiz ve canlı skor | FutbolRadar`,
    description: `${fixture.homeTeam} ${fixture.awayTeam} maçı ${date} ${fixture.venue}'ta. Maç analizi, muhtemel ve resmî ilk 11, kilit oyuncular, kilit eşleşmeler, form ve FutbolRadar maç tahmini.`
  };
}

/** Hub sayfası. */
function hubPage(special, modules, locale) {
  const copy = STRINGS[locale];
  const dir = locale === "en" ? EN_DIR : TR_DIR;
  const base = baseFor(dir);
  const canonical = `${DOMAIN}/${dir}/${special.slug}.html`;
  const seo = seoFor(special, locale);
  const liveHref = locale === "en" ? `${base}en/live-scores.html` : `${base}canli-skor.html`;
  const centreHref = locale === "en" ? `${base}en/match-centre.html` : `${base}mac-merkezi.html`;

  const body = `    <main class="container match-special">
      <nav class="breadcrumb" aria-label="${locale === "en" ? "Breadcrumb" : "Sayfa yolu"}"><a href="${base}${locale === "en" ? "en/index.html" : "index.html"}">${escapeHtml(copy.breadcrumbHome)}</a><span>/</span><span>${escapeHtml(copy.breadcrumbHub)}</span></nav>
      <section class="hero match-special__hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">${escapeHtml(special.kicker || copy.breadcrumbHub)}</span>
            <h1>${escapeHtml(special.title)}</h1>
            <p class="lead">${escapeHtml(special.lead)}</p>
          </div>
        </div>
      </section>
${fixtureBoard(special, copy, locale)}
      <section class="match-special__actions">
        <a class="button primary" href="${escapeHtml(liveHref)}">${escapeHtml(copy.liveEntry)}</a>
        <a class="button secondary" href="${escapeHtml(centreHref)}">${escapeHtml(copy.matchCentre)}</a>
      </section>
      <section class="match-special__modules" aria-labelledby="match-special-modules-title">
        <h2 id="match-special-modules-title">${escapeHtml(copy.modules)}</h2>
        <div class="match-special__grid">
          ${modules.map((module) => moduleCard(module, special.slug, copy, locale)).join("\n          ")}
        </div>
      </section>
    </main>`;

  return pageShell({
    locale, base, canonical, body,
    title: seo.title, description: seo.description,
    schema: sportsEventSchema(special, canonical, locale)
  });
}

/** Modül sayfası. */
function modulePage(special, module, locale) {
  const copy = STRINGS[locale];
  const dir = locale === "en" ? EN_DIR : TR_DIR;
  const base = baseFor(dir);
  const canonical = `${DOMAIN}/${dir}/${special.slug}-${module.slug}.html`;
  const fixture = special.fixture;

  const content = module.html
    ? module.html
    : (module.sections || []).map((section) => `<section class="match-special__section">
          ${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ""}
          ${paragraphs(section.body)}
        </section>`).join("\n        ");

  const body = `    <main class="container match-special-module">
      <nav class="breadcrumb" aria-label="${locale === "en" ? "Breadcrumb" : "Sayfa yolu"}"><a href="${base}${locale === "en" ? "en/index.html" : "index.html"}">${escapeHtml(copy.breadcrumbHome)}</a><span>/</span><a href="./${escapeHtml(special.slug)}.html">${escapeHtml(copy.breadcrumbHub)}</a><span>/</span><span>${escapeHtml(module.title)}</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">${escapeHtml(module.kicker || copy.breadcrumbHub)}</span>
            <h1${module.headingHook ? " data-lineup-heading" : ""}>${escapeHtml(module.title)}</h1>
            <p class="lead">${escapeHtml(`${fixture.homeTeam} – ${fixture.awayTeam}${module.summary ? ` · ${module.summary}` : ""}`)}</p>
          </div>
        </div>
      </section>
      ${content}
      ${module.editorial ? `<p class="match-special__note is-editorial">${escapeHtml(copy.editorialNote)}</p>` : ""}
      <p class="match-special__back"><a class="detail-link" href="./${escapeHtml(special.slug)}.html">← ${escapeHtml(copy.backToHub)}</a></p>
    </main>`;

  return pageShell({
    locale, base, canonical, body,
    title: `${module.title} | ${fixture.homeTeam} – ${fixture.awayTeam} | FutbolRadar`,
    description: module.summary || special.lead,
    schema: null
  });
}

// ── Üretim ──────────────────────────────────────────────────────────────────

const sources = {
  specials: readJson("data/match-specials.json") || {},
  fixtures: readJson("data/fixture-calendar.json") || {},
  squads: readJson("data/super-lig-squads.json") || {},
  archive: readJson("data/season-archive.json") || {}
};

const records = Array.isArray(sources.specials.specials) ? sources.specials.specials : [];
let written = 0;
const pairs = [];
const problems = [];
/**
 * ANA SAYFA KARTLARI ADRESİ BURADAN OKUR.
 *
 * Ana sayfa tanıtım kutusu, modül adreslerini kendisi TÜRETMEZ; bu üretici
 * ne yazdıysa onu okur. Aynı hata iki kez yapılmasın diye:
 * `motm-poll-pages.json` de tam bu yüzden var — adresi iki yerde ayrı ayrı
 * kurmak, biri değişince diğerinin sessizce 404'e bağlanması demek.
 */
const manifest = [];

for (const record of records) {
  const { special, rejected } = selectMatchSpecial(sources, { matchId: record.matchId });
  logRejected(rejected);
  if (!special) {
    problems.push(`${record.matchId}: dosya üretilemedi`);
    continue;
  }
  // Eşleşmeler servis çıktısında yok (editoryal ek); kayıttan alınır.
  special.matchups = record.matchups || [];

  for (const locale of ["tr", "en"]) {
    const localized = localizeSpecial(special, locale);
    localized.matchups = (record.matchups || []).map((row) => ({
      title: (row.title && (row.title[locale] || row.title.tr)) || "",
      body: (row.body && (row.body[locale] || row.body.tr)) || ""
    }));

    const dir = locale === "en" ? EN_DIR : TR_DIR;
    const modules = allModules(localized, STRINGS[locale], locale);

    fs.mkdirSync(path.join(root, dir), { recursive: true });
    const targets = [path.join(root, dir)];
    const publicDir = path.join(root, "public", dir);
    if (fs.existsSync(path.join(root, "public"))) {
      fs.mkdirSync(publicDir, { recursive: true });
      targets.push(publicDir);
    }

    const files = [
      { name: `${localized.slug}.html`, html: hubPage(localized, modules, locale) },
      ...modules.map((module) => ({
        name: `${localized.slug}-${module.slug}.html`,
        html: modulePage(localized, module, locale)
      }))
    ];

    for (const file of files) {
      for (const target of targets) {
        const full = path.join(target, file.name);
        const previous = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
        if (previous !== file.html) {
          fs.writeFileSync(full, file.html, "utf8");
          written += 1;
        }
      }
    }
  }

  // hreflang çiftleri: hub ve her modül için. Tekilleştirme
  // inject-hreflang.mjs'te, tek yerde.
  const trLocalized = localizeSpecial(special, "tr");
  const enLocalized = localizeSpecial(special, "en");
  const trModules = allModules(trLocalized, STRINGS.tr, "tr");
  const enModules = allModules(enLocalized, STRINGS.en, "en");

  pairs.push({ kind: "special", tr: `${TR_DIR}/${trLocalized.slug}.html`, en: `${EN_DIR}/${enLocalized.slug}.html` });
  for (let index = 0; index < trModules.length; index += 1) {
    pairs.push({
      kind: "special",
      tr: `${TR_DIR}/${trLocalized.slug}-${trModules[index].slug}.html`,
      en: `${EN_DIR}/${enLocalized.slug}-${enModules[index].slug}.html`
    });
  }

  manifest.push({
    matchId: special.fixture.id,
    kickoff: special.fixture.kickoff,
    homeTeam: special.fixture.homeTeam,
    awayTeam: special.fixture.awayTeam,
    homeTeamLogo: special.fixture.homeTeamLogo || null,
    awayTeamLogo: special.fixture.awayTeamLogo || null,
    league: special.fixture.league || null,
    round: special.fixture.round ?? null,
    venue: special.fixture.venue || null,
    locales: {
      tr: {
        title: trLocalized.title,
        lead: trLocalized.lead,
        hub: `${TR_DIR}/${trLocalized.slug}.html`,
        probableLineup: trLocalized.probableLineup ? {
          title: trLocalized.probableLineup.promoTitle,
          spot: trLocalized.probableLineup.promoSpot,
          badge: trLocalized.probableLineup.badge,
          href: `${TR_DIR}/${trLocalized.slug}-${trModules.find((module) => module.id === "ilk-11").slug}.html#probable-xi`
        } : null,
        modules: trModules.map((module) => ({
          id: module.id,
          title: module.title,
          kicker: module.kicker || "",
          href: `${TR_DIR}/${trLocalized.slug}-${module.slug}.html`
        }))
      },
      en: {
        title: enLocalized.title,
        lead: enLocalized.lead,
        hub: `${EN_DIR}/${enLocalized.slug}.html`,
        probableLineup: enLocalized.probableLineup ? {
          title: enLocalized.probableLineup.promoTitle,
          spot: enLocalized.probableLineup.promoSpot,
          badge: enLocalized.probableLineup.badge,
          href: `${EN_DIR}/${enLocalized.slug}-${enModules.find((module) => module.id === "ilk-11").slug}.html#probable-xi`
        } : null,
        modules: enModules.map((module) => ({
          id: module.id,
          title: module.title,
          kicker: module.kicker || "",
          href: `${EN_DIR}/${enLocalized.slug}-${module.slug}.html`
        }))
      }
    }
  });
}

// Ana sayfa kartlarının okuduğu adres listesi.
{
  const manifestPath = path.join(root, "data", "match-special-pages.json");
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const previous = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : null;
  if (previous !== serialized) fs.writeFileSync(manifestPath, serialized, "utf8");
}

/**
 * SİTE HARİTASI — ÜRETİLEN HER SAYFA GİRER.
 *
 * Sitemap'e girmeyen sayfa, siteden bağlanmış olsa bile taranmayı bekler.
 * Kayıt EKLENİR, dosya baştan yazılmaz: bu betik tüm sitenin haritasını
 * bilmiyor ve dosyayı sıfırdan kurmaya kalkarsa diğer üreticilerin
 * kayıtlarını siler (bu hata daha önce yaşandı).
 */
{
  const sitemapPath = path.join(root, "sitemap.xml");
  if (fs.existsSync(sitemapPath) && manifest.length) {
    let xml = fs.readFileSync(sitemapPath, "utf8");
    const today = new Date().toISOString().slice(0, 10);
    let added = 0;

    const files = manifest.flatMap((entry) => ["tr", "en"].flatMap((locale) => [
      entry.locales[locale].hub,
      ...entry.locales[locale].modules.map((module) => module.href)
    ]));

    for (const file of files) {
      const loc = `${DOMAIN}/${file}`;
      if (xml.includes(`<loc>${loc}</loc>`)) continue;
      xml = xml.replace("</urlset>",
        `  <url><loc>${loc}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>\n</urlset>`);
      added += 1;
    }

    if (added) {
      fs.writeFileSync(sitemapPath, xml, "utf8");
      const publicSitemap = path.join(root, "public", "sitemap.xml");
      if (fs.existsSync(publicSitemap)) fs.writeFileSync(publicSitemap, xml, "utf8");
    }
  }
}

// Rota haritasına yaz: mevcut kayıtlar korunur, kendi kaydımız tazelenir.
if (pairs.length) {
  const mapPath = path.join(root, "data", "en-route-map.json");
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  } catch { existing = []; }
  const kept = (Array.isArray(existing) ? existing : []).filter((row) => row && row.kind !== "special");
  const next = [...kept, ...pairs];
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (fs.readFileSync(mapPath, "utf8") !== serialized) fs.writeFileSync(mapPath, serialized, "utf8");
}

if (problems.length) {
  console.error("match-special FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else {
  console.log(`Match special: ${records.length} dosya, ${pairs.length} sayfa çifti, ${written} dosya yazıldı.`);
}
