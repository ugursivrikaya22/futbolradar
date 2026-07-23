import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const domain = "https://www.futbolradar.com";
const { featureFlags } = require("../services/featureFlags.js");
const flags = featureFlags();
const rawMatches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const cachedMatchesPath = path.join(root, "data", "matches-cache.json");
const cachedMatches = fs.existsSync(cachedMatchesPath) ? JSON.parse(fs.readFileSync(cachedMatchesPath, "utf8")) : [];
const previousManifestPath = path.join(root, "data", "generated-match-pages.json");
const previousManifest = fs.existsSync(previousManifestPath)
  ? JSON.parse(fs.readFileSync(previousManifestPath, "utf8"))
  : { dailyPages: [], matches: [] };
const competitions = JSON.parse(fs.readFileSync(path.join(root, "data", "competitions.json"), "utf8"));
const {
  contentQualityScore,
  dailySummary,
  dateInTimeZone,
  dedupeMatches,
  isIndexableMatch,
  isStaleMatch,
  matchSlug,
  normalizeMatchRecord,
  schemaEventStatus
} = require("../services/matchDataService.js");

const matches = dedupeMatches([...rawMatches, ...cachedMatches]);
const generatedAt = new Date();
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(generatedAt);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function writeMirrored(relativePath, content) {
  for (const base of [root, path.join(root, "public")]) {
    const destination = path.join(base, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, "utf8");
  }
}

function shiftDate(value, offset) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function formatDate(value, withTime) {
  const date = new Date(withTime ? value : `${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Tarih doğrulanmadı";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: withTime ? undefined : "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: withTime ? "2-digit" : undefined,
    minute: withTime ? "2-digit" : undefined
  }).format(date) + (withTime ? " TSİ" : "");
}

function statusLabel(value) {
  return ({
    SCHEDULED: "Planlandı",
    LIVE: "Canlı",
    FINISHED: "Tamamlandı",
    POSTPONED: "Ertelendi",
    CANCELLED: "İptal edildi",
    SUSPENDED: "Durduruldu"
  })[value] || "Durum bekleniyor";
}

function broadcastLabel(match) {
  if (match.broadcast.status === "confirmed" && match.broadcast.channels.length) {
    return match.broadcast.channels.map((channel) => channel.channelName || channel.platformName).filter(Boolean).join(", ");
  }
  if (match.broadcast.status === "none") return "Yayın bulunmuyor";
  return "Yayın bilgisi doğrulanmadı";
}

function latestTimestamp(records) {
  return records
    .flatMap((record) => [record.lastVerifiedAt, record.fetchedAt])
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function scoreText(match) {
  const home = match.score && match.score.home;
  const away = match.score && match.score.away;
  return home !== null && home !== undefined && away !== null && away !== undefined ? `${home}-${away}` : "-";
}

function nav(prefix) {
  return `<header class="topbar"><nav class="container nav" aria-label="Ana menü"><a class="brand" href="${prefix}index.html" aria-label="FutbolRadar ana sayfa"><span class="brand-mark">FR</span><span>FutbolRadar</span></a><button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false" aria-controls="primary-menu"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button><div class="nav-menu" id="primary-menu"><div class="nav-links"><a href="${prefix}maclar/">Bugünkü Maçlar</a><a href="${prefix}canli-skor.html">Canlı Skor</a><a href="${prefix}puan-durumu.html">Puan Durumu</a><a href="${prefix}takimlar.html">Takımlar</a><a href="${prefix}oyuncu-radari.html">Oyuncu Radarı</a><a href="${prefix}momentum.html">Momentum</a></div><a class="cta" href="${prefix}index.html#radar-sinyalleri">Radar Sinyalleri</a></div></nav></header>`;
}

function footer(prefix) {
  return `<footer class="footer"><div class="container footer-links">FutbolRadar · Maç Merkezi · <a href="${prefix}veri-metodolojisi.html">Veri Metodolojisi</a> · <a href="${prefix}duzeltme-politikasi.html">Düzeltme Politikası</a> · <a href="${prefix}iletisim.html">İletişim</a></div></footer>`;
}

function ogSvg(kicker, title, meta) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title description"><title id="title">${escapeHtml(title)}</title><desc id="description">${escapeHtml(meta)}</desc><rect width="1200" height="630" fill="#060b10"/><rect x="56" y="52" width="1088" height="526" rx="18" fill="#0d1a22" stroke="#2d6f63" stroke-width="2"/><rect x="82" y="84" width="74" height="74" rx="10" fill="#173c32" stroke="#80ff9b"/><text x="119" y="131" text-anchor="middle" fill="#80ff9b" font-family="Arial, sans-serif" font-size="25" font-weight="700">FR</text><text x="184" y="112" fill="#4de5ff" font-family="Arial, sans-serif" font-size="24">${escapeHtml(kicker)}</text><text x="82" y="265" fill="#eef8f5" font-family="Arial, sans-serif" font-size="55" font-weight="700">${escapeHtml(title.slice(0, 38))}</text><text x="82" y="338" fill="#eef8f5" font-family="Arial, sans-serif" font-size="55" font-weight="700">${escapeHtml(title.slice(38, 76))}</text><line x1="82" y1="400" x2="1118" y2="400" stroke="#2d6f63"/><text x="82" y="467" fill="#9fb1af" font-family="Arial, sans-serif" font-size="28">${escapeHtml(meta.slice(0, 72))}</text><text x="82" y="534" fill="#80ff9b" font-family="Arial, sans-serif" font-size="24" font-weight="700">futbolradar.com</text></svg>`;
}

function matchCard(match, slug) {
  const time = match.kickoffPrecision === "datetime" ? match.time : "Saat doğrulanmadı";
  const score = scoreText(match);
  const headline = score === "-" ? statusLabel(match.status) : score;
  return `<article class="card match-card" data-card="today-match" data-match="${escapeHtml(match.id)}">
    <div class="card-head"><span class="card-kicker">${escapeHtml(time)} · ${escapeHtml(match.league)} · ${escapeHtml(statusLabel(match.status))}</span><strong class="big-value match-score-value">${escapeHtml(headline)}</strong></div>
    <h2>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</h2>
    <div class="match-teams"><div class="team-line"><span>${escapeHtml(match.homeTeam)}</span></div><div class="team-line"><span>${escapeHtml(match.awayTeam)}</span></div></div>
    <p class="match-broadcast"><span>Yayın</span><b>${escapeHtml(broadcastLabel(match))}</b></p>
    <a class="detail-link" href="../../mac/${escapeHtml(slug)}/">Maç detayını aç</a>
  </article>`;
}

function groupMatches(records, slugs) {
  const groups = new Map();
  records.forEach((match) => {
    if (!groups.has(match.league)) groups.set(match.league, []);
    groups.get(match.league).push(match);
  });
  return Array.from(groups.entries()).map(([league, leagueMatches]) => `<section class="league-match-group" data-league-group="${escapeHtml(league)}"><header><div><span>Lig / turnuva</span><h2>${escapeHtml(league)}</h2></div><b>${leagueMatches.length} maç</b></header><div class="league-match-grid">${leagueMatches.map((match) => matchCard(match, slugs.get(match.id))).join("")}</div></section>`).join("");
}

function competitionChips(prefix) {
  const selected = competitions.filter((competition) => competition.isActive !== false);
  return selected.map((competition) => `<a href="${prefix}?league=${escapeHtml(competition.id)}" data-competition-filter="${escapeHtml(competition.id)}">${escapeHtml(competition.name)}</a>`).join("");
}

function dailyPageHtml(date, records, slugs, rootPage) {
  const summary = dailySummary(records);
  const latest = latestTimestamp(records);
  const dateLabel = formatDate(date, false);
  const canonical = rootPage ? `${domain}/maclar/` : `${domain}/maclar/${date}/`;
  const ogImage = `${domain}/assets/og/maclar-${date}.svg`;
  const indexable = records.some((match) => isIndexableMatch(match));
  const robots = indexable ? "index,follow" : "noindex,follow";
  const title = `${dateLabel} Maçları, Saatleri ve Yayın Bilgileri | FutbolRadar`;
  const description = `${dateLabel} futbol maçları; TSİ başlama saatleri, turnuvalar, yayın durumu, canlı skor ve maç detayları FutbolRadar'da.`;
  const summaryText = summary.total
    ? `${dateLabel} FutbolRadar kapsamındaki turnuvalarda ${summary.total} doğrulanmış maç bulunuyor. ${summary.friendlies} hazırlık, ${summary.uefa} UEFA karşılaşması listeleniyor.`
    : `${dateLabel} için doğrulanmış maç programı henüz bulunmuyor. Canlı sağlayıcı kontrolü sayfa açıldığında yeniden yapılır.`;
  const body = records.length
    ? groupMatches(records, slugs)
    : `<article class="data-empty" data-card="empty-state"><strong>Maç programı henüz güncelleniyor</strong><span>Bu tarih için doğrulanmış kayıt geldiğinde maçlar turnuvalara göre burada listelenecek.</span></article>`;
  const itemList = records.map((match, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: `${match.homeTeam} - ${match.awayTeam}`,
    url: `${domain}/mac/${slugs.get(match.id)}/`
  }));
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
        { "@type": "ListItem", position: 2, name: "Maçlar", item: `${domain}/maclar/` },
        { "@type": "ListItem", position: 3, name: dateLabel, item: canonical }
      ] },
      { "@type": "ItemList", name: `${dateLabel} maç programı`, numberOfItems: records.length, itemListElement: itemList }
    ]
  };

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}" /><link rel="canonical" href="${canonical}" /><meta name="robots" content="${robots}" /><meta property="og:type" content="website" /><meta property="og:locale" content="tr_TR" /><meta property="og:site_name" content="FutbolRadar" /><meta property="og:title" content="${escapeHtml(title)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:url" content="${canonical}" /><meta property="og:image" content="${ogImage}" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHtml(title)}" /><meta name="twitter:description" content="${escapeHtml(description)}" /><meta name="twitter:image" content="${ogImage}" /><script type="application/ld+json">${JSON.stringify(schema)}</script><link rel="icon" href="${rootPage ? "../" : "../../"}favicon.svg" type="image/svg+xml" /><link rel="manifest" href="${rootPage ? "../" : "../../"}site.webmanifest" /><link rel="stylesheet" href="${rootPage ? "../" : "../../"}page.css" /></head>
  <body class="subpage match-date-page" data-match-date="${date}">${nav(rootPage ? "../" : "../../")}<main class="container"><nav class="breadcrumb" aria-label="Sayfa yolu"><a href="${rootPage ? "../" : "../../"}index.html">Ana Sayfa</a><span>/</span><a href="${rootPage ? "./" : "../"}">Maçlar</a><span>/</span><span>${escapeHtml(dateLabel)}</span></nav><section class="hero"><div class="hero-row"><div><span class="eyebrow">Günlük maç merkezi</span><h1 data-match-page-title>${escapeHtml(dateLabel)} Maçları</h1><p class="lead">${escapeHtml(summaryText)}</p></div><span class="hero-meta">Son veri kontrolü: <b data-last-match-check>${escapeHtml(latest ? formatDate(latest, true) : "Güncelleniyor")}</b></span></div></section>
  <section class="match-freshness-strip" aria-label="Maç verisi durumu"><div><span>Veri durumu</span><b data-match-data-status>${records.length ? "Son doğrulanmış kayıtlar hazır" : "Program kontrol ediliyor"}</b></div><div><span>Son başarılı senkronizasyon</span><b data-last-match-check>${escapeHtml(latest ? formatDate(latest, true) : "Henüz yok")}</b></div><div><span>Saat dilimi</span><b>Europe/Istanbul · TSİ</b></div></section>
  <section class="match-explorer" data-match-explorer aria-label="Maç tarihi ve durum filtreleri"><div class="match-date-nav"><a class="match-nav-button" href="/maclar/${shiftDate(date, -1)}/" data-match-date-prev aria-label="Önceki gün">←</a><div class="match-date-current"><span>Maç tarihi</span><strong data-match-date-label>${escapeHtml(dateLabel)}</strong></div><a class="match-nav-button" href="/maclar/${shiftDate(date, 1)}/" data-match-date-next aria-label="Sonraki gün">→</a><a class="match-today-button" href="/maclar/${today}/" data-match-date-today>Bugün</a><label class="match-date-picker"><span>Tarih seç</span><input type="date" value="${date}" data-match-date-input aria-label="Maç tarihi seç" /></label></div><div class="match-status-filters" aria-label="Maç durumu"><a href="./" data-match-status="all">Tümü</a><a href="./?status=live" data-match-status="live">Canlı</a><a href="./?status=finished" data-match-status="finished">Biten</a><a href="./?status=upcoming" data-match-status="upcoming">Yaklaşan</a></div></section>
  <section class="match-advanced-filters" aria-label="Hızlı maç filtreleri"><a href="./?turkish=1">Türk takımları</a><a href="./?friendly=1">Hazırlık maçları</a><a href="./?broadcast=confirmed">Yayını doğrulananlar</a><form action="./" method="get"><label for="team-filter-${date}">Takım ara</label><input id="team-filter-${date}" name="team" type="search" placeholder="Takım adı" /><button type="submit">Filtrele</button></form></section>
  <section class="competition-switcher" aria-labelledby="competition-title"><div class="competition-switcher-copy"><span>Turnuva seç</span><strong id="competition-title">Maçları turnuvaya göre süz</strong></div><div class="competition-chip-row" aria-label="Turnuvalar"><a href="./" data-competition-filter="all">Tüm maçlar</a>${competitionChips("./")}</div></section>
  <section class="grid" data-api-section="today-matches" data-api-target="matches-page" data-static-fallback="true" aria-live="polite"><!-- prerender:matches-page:start -->${body}<!-- prerender:matches-page:end --></section>
  <section class="popular-links" aria-label="İlgili maç ekranları"><span>İlgili ekranlar</span><a href="${rootPage ? "../" : "../../"}canli-skor.html">Canlı skor</a><a href="${rootPage ? "../" : "../../"}turk-takimlari-avrupada.html">Türk takımları Avrupa'da</a><a href="${rootPage ? "../" : "../../"}veri-metodolojisi.html">Veri metodolojisi</a></section></main>${footer(rootPage ? "../" : "../../")}<script src="${rootPage ? "../" : "../../"}site.js" defer></script><script src="${rootPage ? "../" : "../../"}app.js" defer></script></body></html>`;
}

function statisticsHtml(match) {
  const statistics = Array.isArray(match.statistics) ? match.statistics : [];
  if (!statistics.length) return `<article class="data-empty compact"><strong>İstatistikler bekleniyor</strong><span>Doğrulanmış maç istatistikleri geldiğinde bu alan güncellenecek.</span></article>`;
  return statistics.map((item) => `<article class="timeline-row statistic-pair"><strong>${escapeHtml(item.type)}</strong><span><b>${escapeHtml(item.home ?? "-")}</b><em>${escapeHtml(item.away ?? "-")}</em></span></article>`).join("");
}

function eventsHtml(match) {
  const events = Array.isArray(match.events) ? match.events : [];
  if (!events.length) return `<article class="data-empty compact"><strong>Maç olayları bekleniyor</strong><span>Gol, kart ve değişiklik kayıtları doğrulandığında burada görünecek.</span></article>`;
  return events.map((event) => `<article class="timeline-row"><strong>${escapeHtml(event.time || event.type || "Maç olayı")}</strong><span>${escapeHtml(event.detail || event.value || "")}</span></article>`).join("");
}

function matchPageHtml(rawMatch, slug) {
  const match = normalizeMatchRecord(rawMatch);
  const quality = contentQualityScore(match);
  const indexable = isIndexableMatch(match);
  const canonical = `${domain}/mac/${slug}/`;
  const ogImage = `${domain}/assets/og/${slug}.svg`;
  const dateLabel = match.kickoffAtUtc ? formatDate(match.kickoffAtUtc, match.kickoffPrecision === "datetime") : "Tarih doğrulanmadı";
  const timePhrase = match.kickoffPrecision === "datetime" ? `${match.time}'de` : "saat bilgisi doğrulandığında";
  const title = `${match.homeTeam} - ${match.awayTeam} Maç Detayı, ${dateLabel} | FutbolRadar`;
  const description = `${match.homeTeam} - ${match.awayTeam} maçı ${dateLabel} ${timePhrase}; skor, turnuva, yayın durumu ve doğrulanmış maç verileri FutbolRadar'da.`;
  const latest = match.lastVerifiedAt || match.fetchedAt;
  const editorialLink = match.analysisPage ? `<a class="detail-link" href="../../${escapeHtml(match.analysisPage)}">Editoryal maç analizini aç</a>` : "";
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SportsEvent",
        name: `${match.homeTeam} - ${match.awayTeam}`,
        url: canonical,
        startDate: match.kickoffAtUtc,
        eventStatus: schemaEventStatus(match.status),
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        sport: "Football",
        homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
        awayTeam: { "@type": "SportsTeam", name: match.awayTeam },
        organizer: { "@type": "SportsOrganization", name: match.league },
        location: match.venue ? { "@type": "StadiumOrArena", name: match.venue, address: match.city || undefined } : undefined,
        description
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
          { "@type": "ListItem", position: 2, name: "Maçlar", item: `${domain}/maclar/` },
          { "@type": "ListItem", position: 3, name: `${match.homeTeam} - ${match.awayTeam}`, item: canonical }
        ]
      }
    ]
  };
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}" /><link rel="canonical" href="${canonical}" /><meta name="robots" content="${indexable ? "index,follow" : "noindex,follow"}" /><meta property="og:type" content="website" /><meta property="og:locale" content="tr_TR" /><meta property="og:site_name" content="FutbolRadar" /><meta property="og:title" content="${escapeHtml(title)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:url" content="${canonical}" /><meta property="og:image" content="${ogImage}" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHtml(title)}" /><meta name="twitter:description" content="${escapeHtml(description)}" /><meta name="twitter:image" content="${ogImage}" /><script type="application/ld+json">${JSON.stringify(schema)}</script><link rel="icon" href="../../favicon.svg" type="image/svg+xml" /><link rel="manifest" href="../../site.webmanifest" /><link rel="stylesheet" href="../../page.css" /></head><body class="subpage match-analysis-page" data-match-id="${escapeHtml(match.providerId || match.id)}" data-match-date="${escapeHtml(dateInTimeZone(match.kickoffAtUtc) || "")}">${nav("../../")}<main class="container"><nav class="breadcrumb" aria-label="Sayfa yolu"><a href="../../index.html">Ana Sayfa</a><span>/</span><a href="../../maclar/${dateInTimeZone(match.kickoffAtUtc) || ""}/">${escapeHtml(dateLabel)}</a><span>/</span><span>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</span></nav><section class="hero match-analysis-hero"><div class="hero-row"><div><span class="eyebrow" data-persistent-match-status>${escapeHtml(match.league)} · ${escapeHtml(statusLabel(match.status))}</span><h1>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</h1><p class="lead">${escapeHtml(match.summary || "Maçın doğrulanmış temel bilgileri ve yaşam döngüsü aynı kalıcı sayfada güncellenir.")}</p></div><strong class="match-page-score" data-persistent-match-score>${escapeHtml(scoreText(match))}</strong></div></section><section class="match-freshness-strip" aria-label="Maç verisi durumu"><div><span>Son veri kontrolü</span><b data-last-match-check>${escapeHtml(latest ? formatDate(latest, true) : "Henüz doğrulanmadı")}</b></div><div><span>Veri durumu</span><b data-match-data-status>${escapeHtml(isStaleMatch(match) ? "Güncelleme gerekli" : "Doğrulanmış kayıt")}</b></div><div><span>Kalite kapsamı</span><b>${quality}/100${indexable ? "" : " · indeks dışı"}</b></div><div><span>Saat dilimi</span><b>Europe/Istanbul · TSİ</b></div></section><section class="match-static-overview"><article class="card"><span class="card-kicker">Maç künyesi</span><h2>${escapeHtml(dateLabel)}</h2><div class="metric-grid compact"><span>Turnuva <b>${escapeHtml(match.league)}</b></span><span>Durum <b data-persistent-match-status-label>${escapeHtml(statusLabel(match.status))}</b></span><span>Stat <b>${escapeHtml(match.venue || "Stat bilgisi doğrulanmadı")}</b></span><span>Yayın <b>${escapeHtml(broadcastLabel(match))}</b></span></div>${editorialLink}</article><article class="card"><span class="card-kicker">Radar okuması</span><h2>${escapeHtml(match.analysis && match.analysis.headline || "Analiz verisi bekleniyor")}</h2><p>${escapeHtml(match.analysis && (match.analysis.verdict || match.analysis.summary) || "Doğrulanmış form ve istatistik bileşenleri oluştuğunda temkinli maç analizi burada yer alacak.")}</p><a class="detail-link" href="../../veri-metodolojisi.html">Radar metodolojisini incele</a></article></section><section class="profile-section"><h2>Maç Olayları</h2>${eventsHtml(match)}</section><section class="profile-section"><h2>İstatistikler</h2>${statisticsHtml(match)}</section><section class="popular-links" aria-label="İlgili bağlantılar"><span>İlgili ekranlar</span><a href="../../takim-detay.html?team=${encodeURIComponent(match.homeTeam)}">${escapeHtml(match.homeTeam)} takım radarı</a><a href="../../takim-detay.html?team=${encodeURIComponent(match.awayTeam)}">${escapeHtml(match.awayTeam)} takım radarı</a><a href="../../turnuva/${escapeHtml(match.competition.slug)}/">${escapeHtml(match.league)} maçları</a><a href="../../maclar/${dateInTimeZone(match.kickoffAtUtc) || ""}/">Aynı günün maçları</a></section></main>${footer("../../")}<script src="../../site.js" defer></script><script src="../../app.js" defer></script></body></html>`;
}

const slugCounts = new Map();
for (const match of matches) {
  const base = matchSlug(match);
  slugCounts.set(base, (slugCounts.get(base) || 0) + 1);
}
const previousSlugByIdentity = new Map();
for (const item of previousManifest.matches || []) {
  if (item.providerId) previousSlugByIdentity.set(`provider:${item.providerId}`, item.slug);
  if (item.id) previousSlugByIdentity.set(`id:${item.id}`, item.slug);
}
const slugs = new Map(matches.map((match) => {
  const base = matchSlug(match);
  const suffix = slugCounts.get(base) > 1 ? String(match.providerId || match.id).slice(-8) : "";
  const previousSlug = previousSlugByIdentity.get(`provider:${match.providerId}`) || previousSlugByIdentity.get(`id:${match.id}`);
  return [match.id, previousSlug || matchSlug(match, suffix)];
}));

for (const match of matches) {
  writeMirrored(path.join("assets", "og", `${slugs.get(match.id)}.svg`), ogSvg(match.league, `${match.homeTeam} - ${match.awayTeam}`, `${dateInTimeZone(match.kickoffAtUtc) || "Tarih bekleniyor"} · ${match.time || "Saat doğrulanmadı"}`));
  const page = matchPageHtml(match, slugs.get(match.id)).replace(
    '<body class="subpage match-analysis-page"',
    `<body class="subpage match-analysis-page" data-feature-match-tabs="${flags.matchDetailTabs}" data-feature-advanced-analysis="${flags.advancedAnalysisTabs}"`
  );
  writeMirrored(path.join("mac", slugs.get(match.id), "index.html"), page);
}

const dates = new Set(matches.map((match) => dateInTimeZone(match.kickoffAtUtc)).filter(Boolean));
for (const date of previousManifest.dailyPages || []) dates.add(date);
for (let offset = -3; offset <= 7; offset += 1) dates.add(shiftDate(today, offset));
for (const date of Array.from(dates).sort()) {
  const dayMatches = matches.filter((match) => dateInTimeZone(match.kickoffAtUtc) === date);
  writeMirrored(path.join("assets", "og", `maclar-${date}.svg`), ogSvg("Günlük maç merkezi", `${formatDate(date, false)} Maçları`, `${dayMatches.length} doğrulanmış maç · Saat dilimi TSİ`));
  writeMirrored(path.join("maclar", date, "index.html"), dailyPageHtml(date, dayMatches, slugs, false));
}
const todayMatches = matches.filter((match) => dateInTimeZone(match.kickoffAtUtc) === today);
writeMirrored(path.join("maclar", "index.html"), dailyPageHtml(today, todayMatches, slugs, true));

fs.writeFileSync(path.join(root, "data", "generated-match-pages.json"), JSON.stringify({
  generatedAt: generatedAt.toISOString(),
  today,
  dailyPages: Array.from(dates).sort(),
  matches: matches.map((match) => ({
    id: match.id,
    providerId: match.providerId,
    slug: slugs.get(match.id),
    date: dateInTimeZone(match.kickoffAtUtc),
    qualityScore: contentQualityScore(match),
    indexable: isIndexableMatch(match),
    lastmod: (match.lastVerifiedAt || match.fetchedAt || "").slice(0, 10)
  }))
}, null, 2) + "\n", "utf8");
fs.copyFileSync(path.join(root, "data", "generated-match-pages.json"), path.join(root, "public", "data", "generated-match-pages.json"));

console.log(`Generated ${dates.size} daily match pages and ${matches.length} permanent match pages`);
