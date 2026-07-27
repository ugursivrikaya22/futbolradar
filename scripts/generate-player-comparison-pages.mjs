import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers, formatMarketValueEur } = require("../services/playerService.js");
const { publicPlayerView, restrictedFieldIsPublishable } = require("../services/cardCredibility.js");
const players = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")));
const outDir = path.join(root, "karsilastirma");
const publicOutDir = path.join(root, "public", "karsilastirma");
const domain = "https://www.futbolradar.com";

/**
 * Oyuncu veri kümesinin doğrulama zamanı — kayıt bazında damga bulunmayan
 * sayfalar için son çare. Derleme zamanı DEĞİL: bkz. pairLastmod().
 */
const datasetVerifiedAt = (() => {
  try {
    const freshness = JSON.parse(fs.readFileSync(path.join(root, "data", "freshness.json"), "utf8"));
    const stamp = freshness && freshness.records && freshness.records.players &&
      (freshness.records.players.verifiedAt || freshness.records.players.fetchedAt);
    if (stamp) return String(stamp).slice(0, 10);
  } catch (error) {
    // Tazelik dosyası okunamıyorsa sitemap üretimi durmamalı.
  }
  return "2026-07-13";
})();

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTags(value) {
  return String(value ?? "").replace(/<[^>]*>/g, "").trim();
}

function playerCurrentTeam(player) {
  return player.currentTeam || player.team || "Takım bilgisi yakında";
}

function playerNeedsTransferReview(player) {
  return ["transfer_needs_monitoring", "manual-review"].includes(String(player.dataStatus || ""));
}

function playerTeamDisplay(player) {
  const team = playerCurrentTeam(player);
  return playerNeedsTransferReview(player) ? `${team} (takipte)` : team;
}

function playerRating(player) {
  return Number(player.overallRating || player.aiRating || player.rating || 0);
}

function playerMarket(player) {
  return player.marketValue || formatMarketValueEur(player.marketValueEur) || "Piyasa değeri yakında";
}

function playerPositionGroup(player) {
  const source = `${player.positionGroup || ""} ${player.position || ""}`.toLocaleLowerCase("tr-TR");

  if (source.includes("kaleci") || source.includes("goal")) return "kaleci";
  if (source.includes("def") || source.includes("stoper") || source.includes("bek") || source.includes("savun")) return "defans";
  if (source.includes("orta") || source.includes("mid")) return "orta saha";
  if (source.includes("wing") || source.includes("kanat") || source.includes("forvet") || source.includes("santrfor") || source.includes("striker")) return "forvet";
  return "diger";
}

function comparisonSlug(leftId, rightId) {
  return [leftId, rightId].sort().join("-vs-");
}

function comparePeerScore(primary, candidate) {
  if (!primary || !candidate || primary.id === candidate.id) return -1;

  const sameRole = playerPositionGroup(primary) === playerPositionGroup(candidate) ? 44 : 0;
  const sameLeague = primary.league && candidate.league && primary.league === candidate.league ? 16 : 0;
  const differentTeam = playerCurrentTeam(primary) !== playerCurrentTeam(candidate) ? 10 : 0;
  const ratingCloseness = Math.max(0, 26 - Math.abs(playerRating(primary) - playerRating(candidate)));
  const marketDelta = Math.abs(Number(primary.marketValueEur || 0) - Number(candidate.marketValueEur || 0)) / 1000000;
  const marketCloseness = Math.max(0, 12 - marketDelta / 3);

  return sameRole + sameLeague + differentTeam + ratingCloseness + marketCloseness;
}

function uniqueCompareCandidates(list) {
  const used = new Set();
  return list.filter((item) => {
    if (!item || !item.player || used.has(item.player.id)) return false;
    used.add(item.player.id);
    return true;
  });
}

function profileCompareCandidates(player) {
  const candidates = players.filter((candidate) => candidate.id !== player.id);
  const bestPeer = candidates.slice().sort((a, b) => comparePeerScore(player, b) - comparePeerScore(player, a))[0];
  const sameRole = candidates
    .filter((candidate) => playerPositionGroup(candidate) === playerPositionGroup(player))
    .sort((a, b) => playerRating(b) - playerRating(a))[0];
  const closeRating = candidates
    .slice()
    .sort((a, b) => Math.abs(playerRating(player) - playerRating(a)) - Math.abs(playerRating(player) - playerRating(b)))[0];
  const transferRead = candidates
    .filter((candidate) => Array.isArray(candidate.transferHistory) && candidate.transferHistory.length)
    .sort((a, b) => Number(b.marketValueEur || 0) - Number(a.marketValueEur || 0))[0];

  const baseLinks = uniqueCompareCandidates([
    { label: "Akilli eslesme", player: bestPeer, note: "Rol, rating ve piyasa yakinligi" },
    { label: "Aynı rol kıyası", player: sameRole, note: `${playerPositionGroup(player)} profili` },
    { label: "Rating sinavi", player: closeRating, note: "Overall farkini oku" },
    { label: "Transfer okuma", player: transferRead, note: "Güncel takım ve piyasa değeri" }
  ]);
  const fallbackLinks = candidates
    .slice()
    .sort((a, b) => playerRating(b) - playerRating(a))
    .map((candidate) => ({ label: "Radar alternatifi", player: candidate, note: "Profil trafiği ve kıyas akışı" }));

  return uniqueCompareCandidates(baseLinks.concat(fallbackLinks)).slice(0, 4);
}

function addPair(map, left, right, context) {
  if (!left || !right || left.id === right.id) {
    return;
  }

  const slug = comparisonSlug(left.id, right.id);
  if (!map.has(slug)) {
    const ordered = [left, right].sort((a, b) => a.id.localeCompare(b.id));
    map.set(slug, {
      slug,
      left: ordered[0],
      right: ordered[1],
      reasons: []
    });
  }

  const pair = map.get(slug);
  if (context && !pair.reasons.includes(context)) {
    pair.reasons.push(context);
  }
}

function buildPairs() {
  const map = new Map();
  const editorialPairs = [
    ["mauro-icardi", "edin-dzeko", "Super Lig gol tehdidi"],
    ["kerem-akturkoglu", "semih-kilicsoy", "Yükselen yerli hücum profili"],
    ["ugurcan-cakir", "abdulkerim-bardakci", "Savunma güveni"],
    ["sebastian-szymanski", "gedson-fernandes", "Orta saha etki kıyaslaması"]
  ];

  for (const [leftId, rightId, reason] of editorialPairs) {
    addPair(
      map,
      players.find((player) => player.id === leftId),
      players.find((player) => player.id === rightId),
      reason
    );
  }

  for (const player of players) {
    for (const item of profileCompareCandidates(player)) {
      addPair(map, player, item.player, item.note || item.label);
    }
  }

  // No cap: every profile page links to its four comparison peers, so each
  // pair collected above must get a page or those links 404. A fixed limit
  // only happened to cover the full set back when the squad was tiny.
  return Array.from(map.values());
}

/**
 * Kıyas yorumu. "X overall rating tarafında önde" cümlesi bir SAYIDAN
 * türetilmiş bir iddiadır; sayı doğrulanmamışsa cümle de doğrulanmamıştır.
 * Cümlenin sayı içermemesi onu güvenli yapmıyor.
 *
 * İki taraf da doğrulanmadıkça yalnızca rol okuması kalıyor — bu, kayıttan
 * değil mevkiden türeyen ve tartışmasız bir ifade.
 */
/**
 * KAYIT KAPISI ALAN KAPISI DEĞİLDİR — bu ayrım burada kaçmıştı.
 *
 * Yukarıdaki kural doğru yazılmıştı ama yanlış kapıya bağlanmıştı:
 * `publicPlayerView(x).verified` KAYDIN kimliğinin doğrulandığını söyler
 * (ad, kulüp, mevki, yaş — kadro uç noktasından). Derecelendirme ve piyasa
 * değeri o kayıtta HÂLÂ kısıtlı; kadro senkronu ikisini de göndermiyor.
 *
 * Sonuç, 735 sayfada şu iki cümleydi:
 *   "X overall rating tarafinda onde gorunuyor."
 *   "X piyasa değeri okumasında daha güçlü sinyal veriyor."
 *
 * İlki türetilmiş bir varsayılandan (ratingService'in ürettiği sayı)
 * hesaplanıyordu. İkincisi daha kötüsüydü: marketValueEur her iki tarafta
 * da yok, `|| 0` ikisini de sıfıra indiriyor, `0 - 0 >= 0` her zaman doğru
 * oluyor ve cümle DAİMA soldaki oyuncuyu seçiyordu. Yani iddia ölçüme değil,
 * argüman sırasına dayanıyordu.
 *
 * Artık her cümle kendi alanının ALAN kapısını ayrı ayrı geçmek zorunda.
 * Geçmeyen cümle hiç kurulmaz; yerine tire ya da "yakında" da basılmaz.
 */
function fieldComparable(left, right, key) {
  if (!restrictedFieldIsPublishable(left, key)) return false;
  if (!restrictedFieldIsPublishable(right, key)) return false;
  const leftValue = Number(left[key]);
  const rightValue = Number(right[key]);
  return Number.isFinite(leftValue) && Number.isFinite(rightValue);
}

function comparisonInsight(left, right) {
  const roleLine = `${playerPositionGroup(left)} ve ${playerPositionGroup(right)} rolleri birlikte okunmalı; tek skor karar için yeterli değil.`;
  const lines = [];

  // Derece kıyası: her iki kayıtta da ÖLÇÜLMÜŞ derece şart.
  const ratingField = ["overallRating", "aiRating", "rating"]
    .find((key) => fieldComparable(left, right, key));
  if (ratingField) {
    const leader = Number(left[ratingField]) >= Number(right[ratingField]) ? left : right;
    lines.push(`${leader.name} overall rating tarafinda onde gorunuyor.`);
  }

  // Piyasa kıyası: ölçülmüş piyasa değeri şart. Eşitlikte kimse "önde"
  // değildir — eski hâl eşitliği soldaki oyuncunun üstünlüğü sayıyordu.
  if (fieldComparable(left, right, "marketValueEur")) {
    const leftValue = Number(left.marketValueEur);
    const rightValue = Number(right.marketValueEur);
    if (leftValue !== rightValue) {
      const marketLeader = leftValue > rightValue ? left : right;
      lines.push(`${marketLeader.name} piyasa değeri okumasında daha güçlü sinyal veriyor.`);
    }
  }

  if (!lines.length) {
    return [
      "Bu kıyasın performans ve piyasa okuması, iki oyuncunun da doğrulanmış ölçümü geldiğinde yayımlanacak.",
      roleLine
    ];
  }

  lines.push(roleLine);
  return lines;
}

/**
 * Kıyas kartı. Puan bir <dl> içinde de olsa puandır: rozet biçiminde
 * olmaması onu doğrulanmış yapmıyor. Denetimde bu yüzey neredeyse
 * kaçırılmıştı — arama kalıbı rozete bakıyordu, buradaki
 * "<dt>Overall</dt><dd>80</dd>" ise 422 sayfada duruyordu.
 *
 * Doğrulanmamış kayıtta kulüp, lig, puan ve piyasa satırları hiç
 * çizilmiyor; "Yakında" gibi bir yer tutucu da basılmıyor, çünkü ölçüm
 * bekleniyormuş izlenimi veriyor. Kart ve bağlantı kalıyor.
 */
function playerMiniCard(player) {
  const view = publicPlayerView(player);
  const verified = view.verified;

  // Satırlar tek tek kapıdan geçenlerden kurulur: doğrulanmış bir kayıtta
  // bile sağlayıcının göndermediği puan ve piyasa değeri basılmaz.
  const fields = view.fields || {};
  const rating = fields.overallRating || fields.aiRating || fields.rating;
  const market = fields.marketValue
    || (fields.marketValueEur !== undefined ? formatMarketValueEur(fields.marketValueEur) : null);

  const verifiedRows = [];
  if (fields.currentTeam || fields.team) {
    verifiedRows.push(`<div><dt>Takım</dt><dd>${escapeHtml(playerTeamDisplay(player))}</dd></div>`);
  }
  if (player.league) verifiedRows.push(`<div><dt>Lig</dt><dd>${escapeHtml(player.league)}</dd></div>`);
  if (rating) verifiedRows.push(`<div><dt>Overall</dt><dd>${escapeHtml(rating)}</dd></div>`);
  if (market) verifiedRows.push(`<div><dt>Piyasa</dt><dd>${escapeHtml(market)}</dd></div>`);

  const rows = verified && verifiedRows.length
    ? verifiedRows.join("\n      ")
    : `<div><dt>Veri durumu</dt><dd>Doğrulanmış kayıt bekleniyor</dd></div>`;

  return `<article class="comparison-mini-card" data-player-verified="${verified ? "true" : "false"}">
    <span>${escapeHtml(player.position || "Mevki yakinda")}</span>
    <h2>${escapeHtml(player.name)}</h2>
    <dl>
      ${rows}
    </dl>
    <a href="../oyuncular/${escapeHtml(player.id)}.html">Oyuncu profilini aç</a>
  </article>`;
}

/**
 * AÇIKLAMA SAYFADA OLANI ANLATIR — olmasını istediğimizi değil.
 *
 * Sabit açıklama her sayfada "AI rating, form, gol tehdidi, yaratıcılık,
 * pres gücü, piyasa değeri ve transfer bilgileriyle analiz edilir" diyordu.
 * Bu alanların hiçbiri ölçülmediği için sayfada YOKTU: 2314 açıklamanın
 * tamamı, arama sonucunda tıklayan okuyucuya bulamayacağı şeyi vaat
 * ediyordu. Arama motoru için bu bir uyumsuzluk sinyali; okuyucu için
 * doğrudan yanlış beyan.
 *
 * Açıklama artık kıyasın GERÇEKTEN gösterdiği alanlardan kurulur.
 */
function comparisonDescription(left, right, insights) {
  const head = `${left.name} ve ${right.name} oyuncu karşılaştırması`;
  const hasMeasuredReading = insights.some((line) =>
    /overall rating|piyasa değeri okumasında/.test(line));

  if (hasMeasuredReading) {
    return `${head}; doğrulanmış sağlayıcı verisiyle rol, kulüp ve ölçülmüş performans okuması FutbolRadar'da.`;
  }

  // Kulüp de doğrulamaya tabidir. Kart yüzeyinde `verified` ile korunuyor;
  // açıklamada korunmazsa aynı iddia meta etiketine sızar — üstelik arama
  // sonucunda kartın kendisinden daha görünür bir yere.
  const clubs = [left, right]
    .filter((player) => publicPlayerView(player).verified)
    .map((player) => playerTeamDisplay(player))
    .filter(Boolean)
    .join(" - ");

  return `${head}: ${clubs ? `${clubs}, ` : ""}mevki ve rol karşılaştırması. ` +
    "Performans ve piyasa okuması, doğrulanmış ölçüm geldiğinde yayımlanır.";
}

/**
 * lastmod GERÇEK DEĞİŞİM TARİHİDİR — sabit bir dize değil.
 *
 * Sitemap'teki 2314 kıyas girdisi `2026-07-13` sabitini taşıyordu. Sayfa
 * içeriği bundan sonra defalarca değişti (kapı sertleştirmeleri, açıklama
 * düzeltmesi) ama sitemap "13 Temmuz'dan beri hiçbir şey değişmedi" demeye
 * devam etti. Donmuş bir lastmod, arama motoruna yeniden taramaya değmez
 * sinyali verir ve zamanla girdiyi tarama sırasının dibine düşürür.
 *
 * DERLEME ZAMANI DA KULLANILAMAZ: her derlemede bugünü yazmak, içerik
 * değişmediği hâlde "güncellendi" demektir — sitemap'in en çok suistimal
 * edilen alanı budur ve arama motoru bunu öğrenip alanı tamamen yok sayar.
 *
 * Dürüst kaynak, sayfanın DAYANDIĞI verinin doğrulama zamanı: kıyasın iki
 * oyuncusundan en son doğrulananı. Veri durduğunda tarih durur, veri
 * güncellendiğinde tarih ilerler.
 */
function pairLastmod(pair) {
  const stamps = [pair.left, pair.right]
    .map((player) => String((player && (player.lastVerifiedAt || player.lastSyncedAt)) || ""))
    .map((value) => value.slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();

  return stamps.length ? stamps[stamps.length - 1] : datasetVerifiedAt;
}

function pageHtml(pair) {
  const { left, right, slug, reasons } = pair;
  const title = `${left.name} vs ${right.name} | Oyuncu Karşılaştırması | FutbolRadar`;
  const canonical = `${domain}/karsilastirma/${slug}.html`;
  const insights = comparisonInsight(left, right);
  const description = comparisonDescription(left, right, insights);

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${domain}/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.png" />
    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Article",
            headline: title,
            description: stripTags(description),
            mainEntityOfPage: canonical,
            publisher: {
              "@type": "Organization",
              name: "FutbolRadar"
            },
            about: [left.name, right.name]
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
              { "@type": "ListItem", position: 2, name: "Oyuncu Karşılaştırmaları", item: `${domain}/oyuncu-karsilastirmalari.html` },
              { "@type": "ListItem", position: 3, name: `${left.name} vs ${right.name}`, item: canonical }
            ]
          }
        ]
      }, null, 8)}
    </script>
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base: "../" })}
    <main class="container compare-seo-page">
      <nav class="breadcrumb" aria-label="Sayfa yolu">
        <a href="../index.html">Ana Sayfa</a>
        <span>/</span>
        <a href="../oyuncu-karsilastir.html">Oyuncu Karşılaştırma</a>
        <span>/</span>
        <span>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</span>
      </nav>
      <section class="hero comparison-hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Oyuncu karşılaştırma radarı</span>
            <h1>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</h1>
            <p class="lead">${escapeHtml(description)}</p>
          </div>
          <span class="hero-meta">${escapeHtml(playerTeamDisplay(left))} - ${escapeHtml(playerTeamDisplay(right))}</span>
        </div>
      </section>

      <section class="static-comparison-summary" aria-label="Statik karşılaştırma özeti">
        ${playerMiniCard(left)}
        <article class="comparison-mini-card comparison-mini-card-accent">
          <span>Radar Notu</span>
          <h2>Kıyas Özeti</h2>
          <ul>
            ${insights.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n            ")}
          </ul>
          <p>${escapeHtml(reasons.slice(0, 3).join(" - ") || "Rol, form ve rating yakinligi")}</p>
        </article>
        ${playerMiniCard(right)}
      </section>

      <section class="compare-grid" data-api-target="player-compare" data-compare-seed="${escapeHtml(left.id)},${escapeHtml(right.id)}">
        <article class="data-empty" data-card="empty-state">
          <strong>Karşılaştırma yükleniyor</strong>
          <span>Oyuncu radar metrikleri hazırlanıyor.</span>
        </article>
      </section>

      <section class="comparison-seo-links" aria-label="İlgili karşılaştırma bağlantıları">
        <span>Devam et</span>
        <a href="../oyuncular/${escapeHtml(left.id)}.html">${escapeHtml(left.name)} profili</a>
        <a href="../oyuncular/${escapeHtml(right.id)}.html">${escapeHtml(right.name)} profili</a>
        <a href="../oyuncu-radari.html">Oyuncu Radarı</a>
        <a href="../oyuncu-karsilastir.html?players=${escapeHtml(left.id)},${escapeHtml(right.id)}">İnteraktif kıyas</a>
      </section>
    </main>
    ${siteFooter({ base: "../" })}
    <script src="../site.js" defer></script>
    <script src="../app.js" defer></script>
  </body>
</html>
`;
}

function comparisonIndexCard(pair) {
  const { left, right, slug, reasons } = pair;
  const ratingDelta = Math.abs(playerRating(left) - playerRating(right));
  const roleLabel = playerPositionGroup(left) === playerPositionGroup(right)
    ? `${playerPositionGroup(left)} eslesmesi`
    : `${playerPositionGroup(left)} / ${playerPositionGroup(right)}`;

  return `<a class="comparison-index-card" href="./karsilastirma/${escapeHtml(slug)}.html">
    <span>${escapeHtml(roleLabel)}</span>
    <strong>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</strong>
    <p>${escapeHtml((reasons && reasons[0]) || "Rating, form ve rol etkisi")}</p>
    <em>Rating farki ${escapeHtml(ratingDelta.toFixed(1))}</em>
  </a>`;
}

function comparisonIndexHtml(pairs) {
  const title = "Oyuncu Karşılaştırmaları | Statik Kıyaslar | FutbolRadar";
  const description = "FutbolRadar oyuncu karşılaştırmaları; Süper Lig oyuncularını AI rating, form, rol etkisi, piyasa değeri ve transfer sinyalleriyle yan yana inceler.";
  const canonical = `${domain}/oyuncu-karsilastirmalari.html`;
  const topPairs = pairs.slice(0, 20);

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${domain}/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.png" />
    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        url: canonical,
        mainEntity: {
          "@type": "ItemList",
          itemListElement: topPairs.map((pair, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: `${pair.left.name} vs ${pair.right.name}`,
            url: `${domain}/karsilastirma/${pair.slug}.html`
          }))
        }
      }, null, 8)}
    </script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base: "./" })}
    <main class="container comparison-index-page">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><a href="./oyuncu-radari.html">Oyuncu Radarı</a><span>/</span><span>Oyuncu Karşılaştırmaları</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Oyuncu karşılaştırma merkezi</span>
            <h1>Oyuncu Karşılaştırmaları</h1>
            <p class="lead">${escapeHtml(description)}</p>
          </div>
          <span class="hero-meta">${escapeHtml(topPairs.length)} hazır kıyas</span>
        </div>
      </section>
      <section class="comparison-index-grid" aria-label="Hazır oyuncu karşılaştırmaları">
        ${topPairs.map(comparisonIndexCard).join("\n        ")}
      </section>
      <section class="comparison-seo-links" aria-label="Oyuncu karşılaştırma gezinme">
        <span>Devam et</span>
        <a href="./oyuncu-radari.html">Oyuncu Radarı</a>
        <a href="./oyuncu-karsilastir.html">İnteraktif kıyas</a>
        <a href="./oyuncular/en-iyi-oyuncular.html">En iyi oyuncular</a>
        <a href="./transfer-radari.html">Transfer Radar</a>
      </section>
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
    <script src="./app.js" defer></script>
  </body>
</html>
`;
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(publicOutDir, { recursive: true });

const pairs = buildPairs();
const expectedFiles = new Set(pairs.map((pair) => `${pair.slug}.html`));
for (const directory of [outDir, publicOutDir]) {
  for (const file of fs.readdirSync(directory)) {
    if (file.endsWith(".html") && !expectedFiles.has(file)) {
      fs.unlinkSync(path.join(directory, file));
    }
  }
}

for (const pair of pairs) {
  const html = pageHtml(pair);
  fs.writeFileSync(path.join(outDir, `${pair.slug}.html`), html, "utf8");
  fs.writeFileSync(path.join(publicOutDir, `${pair.slug}.html`), html, "utf8");
}

const indexHtml = comparisonIndexHtml(pairs);
fs.writeFileSync(path.join(root, "oyuncu-karsilastirmalari.html"), indexHtml, "utf8");
fs.writeFileSync(path.join(root, "public", "oyuncu-karsilastirmalari.html"), indexHtml, "utf8");

/**
 * SİTE HARİTASI ARTIK BU BETİKTE YAZILMIYOR.
 *
 * Buradaki blok, site haritasını "koruyarak yeniden yazan" beş betikten
 * biriydi: kendi URL'lerini silip yeniden ekliyor, geri kalanını
 * `/  <url>[\s\S]*?  <\/url>/g` düzenli ifadesiyle taşıyordu. Bu, iki
 * boşluklu girinti sözleşmesine bağımlı bir mimariydi — girintiyi
 * değiştiren herhangi bir üretici, kendi URL'lerini sessizce kaybederdi.
 *
 * Tek yetkili üretici: scripts/generate-sitemap.mjs. URL'leri dosya
 * sisteminden türetiyor ve lastmod'u aynı şekilde her kıyasın iki
 * oyuncusunun doğrulama tarihinden hesaplıyor, yani buradaki davranış
 * korunuyor — yalnızca tek bir yerde yaşıyor.
 */

console.log(`Generated ${pairs.length} static player comparison pages and index`);
