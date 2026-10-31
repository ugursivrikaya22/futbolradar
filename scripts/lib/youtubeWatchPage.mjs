/**
 * İZLERKEN SKOR SAYFASI — /izle/<slug>.html şablonu.
 * Yalnızca data/youtube-watch.json'daki doğrulanmış kayıtlardan üretilir.
 */
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./layout.mjs";

const require = createRequire(import.meta.url);
const yt = require("../../services/youtubeWatch.js");
const client = require("../../youtube-watch.js");
const domain = "https://www.futbolradar.com";
const SOURCE_LABEL = { kulup: "Resmi kulüp kanalı", lig: "Resmi lig kanalı", yayinci: "Resmi yayıncı kanalı", federasyon: "Resmi federasyon kanalı" };

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function dateLabel(iso) {
  return new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) + " TSİ";
}

/** JSON'u <script> içine güvenle gömer. */
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function watchPageHtml(entry, final = null, now = Date.now()) {
  const title = entry.title || `${entry.homeTeam} - ${entry.awayTeam} izlerken canlı skor`;
  const pageTitle = `${title} | FutbolRadar`;
  const description = `${entry.homeTeam} - ${entry.awayTeam} (${entry.competition}) maçını ${entry.channelName} YouTube yayınıyla izlerken canlı skor, dakika ve golleri FutbolRadar'da takip et.`;
  const canonical = `${domain}${yt.watchPath(entry.slug)}`;
  const watchUrl = yt.watchUrl(entry.youtubeId);
  const cfg = {
    slug: entry.slug, youtubeId: entry.youtubeId, homeTeam: entry.homeTeam, awayTeam: entry.awayTeam,
    kickoff: new Date(entry.kickoff).toISOString(), providerId: entry.providerId, title, watchUrl,
    final: final ? { home: final.home, away: final.away } : null
  };
  const initialState = final ? { score: cfg.final, status: "FT", final: true } : {};
  const panel = client.panelHtml(initialState, cfg, now);
  const matchLink = entry.matchPath ? `<a href="${esc(entry.matchPath)}">Maç sayfası, kadrolar ve analiz →</a>` : "";
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(pageTitle)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="video.other" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(pageTitle)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${esc(yt.thumbnailUrl(entry.youtubeId))}" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
    <link rel="stylesheet" href="../youtube-watch.css" />
  </head>
  <body class="subpage yt-watch-page">
    ${siteHeader({ base: "../" })}
    <main class="container" data-yt-watch data-match="${esc(entry.slug)}">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="../index.html">Ana Sayfa</a><span>/</span><span>İzlerken skor</span><span>/</span><span>${esc(entry.homeTeam)} - ${esc(entry.awayTeam)}</span></nav>
      <header class="ytw-head"><span class="eyebrow">${esc(entry.competition)} · ${esc(dateLabel(entry.kickoff))}</span><h1>${esc(title)}</h1></header>
      <div class="ytw-layout">
        <div>
          <div class="ytw-player">
            <button type="button" class="ytw-facade" data-ytw-facade aria-label="${esc(title)} yayınını oynat (YouTube)">
              <img src="${esc(yt.thumbnailUrl(entry.youtubeId))}" alt="" loading="lazy" decoding="async" width="480" height="360" />
              <span class="ytw-play">▶ Yayını başlat</span>
            </button>
          </div>
          <p class="ytw-source">${esc(SOURCE_LABEL[entry.source] || "Resmi kanal")}: <a href="${esc(entry.channelUrl)}" target="_blank" rel="noopener">${esc(entry.channelName)}</a> · Video YouTube'dan (youtube-nocookie.com) oynatılır ve yalnızca tıkladığında yüklenir. Gömülü oynatma kapalıysa <a href="${esc(watchUrl)}" target="_blank" rel="noopener">YouTube'da aç</a>.</p>
        </div>
        <aside class="ytw-panel" data-ytw-panel aria-label="Canlı skor">${panel}</aside>
      </div>
      <p>${matchLink}</p>
    </main>
    ${siteFooter({ base: "../" })}
    <script type="application/json" id="yt-watch-config">${safeJson(cfg)}</script>
    <script src="../site.js" defer></script>
    <script src="../youtube-watch.js" defer></script>
  </body>
</html>`;
}

/** Maç sayfasındaki bağlantı kartı; kayıt yoksa boş dize (yeni kutu yok). */
export function matchWatchCard(entry, base = "../") {
  if (!entry) return "";
  return `<a class="match-related-card match-watch-card" href="${base}izle/${esc(entry.slug)}.html"><span>YouTube · ${esc(entry.channelName)}</span><strong>İzlerken skor</strong><p>Yayını izlerken canlı skor, dakika ve golleri yan panelde takip et.</p></a>`;
}
