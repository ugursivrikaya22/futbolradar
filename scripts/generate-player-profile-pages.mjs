import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers } = require("../services/playerService.js");
const { resolvePlayerPhoto, playerPhotoAlt } = require("../services/playerPhotoService.js");
const { publicPlayerView, statsAreVerified } = require("../services/cardCredibility.js");
const { annotateDuplicates, sameCanonicalPlayer } = require("../services/duplicatePlayerService.js");
const players = annotateDuplicates(getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"))));
const confirmedTransfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"))
  .filter((transfer) => transfer.status === "confirmed");
const transferWindows = (JSON.parse(fs.readFileSync(path.join(root, "data", "transfer-window.json"), "utf8")).windows || []);
const outDir = path.join(root, "oyuncular");
const publicOutDir = path.join(root, "public", "oyuncular");
const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

/**
 * "Yeni transfer" TFF'in resmî tescil penceresine göre tanımlanır — keyfi bir
 * gün eşiği değil. Kanté'nin Şubat 2026 (2025/26 kış) transferi bu yüzden
 * elenir: iki pencerenin de dışında kalıyor, artık "yeni" değil.
 */
function isWithinTransferWindow(dateValue) {
  const time = Date.parse(`${dateValue}T12:00:00Z`);
  if (!Number.isFinite(time)) return false;
  return transferWindows.some((windowItem) => {
    const opens = Date.parse(windowItem.opensAt);
    const closes = Date.parse(windowItem.closesAt);
    return Number.isFinite(opens) && Number.isFinite(closes) && time >= opens && time <= closes;
  });
}

/** Serbest kalma bir "yeni transfer" kutlaması değil — yalnızca gerçek bir kulübe katılım. */
function isActiveClub(teamName) {
  return Boolean(teamName) && !/serbest|free agent|kulüpsüz|released/i.test(teamName);
}

/**
 * Kaydın kaynağı bir kulüp açıklaması (transfers.json `status: "confirmed"`,
 * `sourceUrl` zorunlu) — api-football'un sayısal sağlayıcı kimliğinden
 * BAĞIMSIZ bir doğrulama. Bu yüzden burada `publicPlayerView`'in genel
 * güvenilirlik kapısı (gerçek providerId şartı) atlanır: performans/rating
 * alanları o kapıdan geçmeden yayımlanmaz, ama transfer kaydının kendisi
 * ayrıca doğrulanmış sayılır.
 */
function latestRecentTransferFor(player) {
  const matches = confirmedTransfers.filter((transfer) => transfer.playerId === player.id);
  if (!matches.length) return null;
  const latest = matches.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).at(-1);
  return isWithinTransferWindow(latest.date) && isActiveClub(latest.toTeam) ? latest : null;
}

function transferFeeLabel(transfer) {
  return transfer.fee || (Number(transfer.feeEur) === 0 ? "Bedelsiz" : "Açıklanmadı");
}

function formatTransferDateTr(dateValue) {
  const parsed = new Date(`${dateValue}`.length <= 10 ? `${dateValue}T12:00:00Z` : dateValue);
  if (Number.isNaN(parsed.getTime())) return String(dateValue || "");
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric" }).format(parsed);
}

function writeGeneratedFile(file, contents) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.writeFileSync(file, contents, "utf8");
      return;
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
}

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

function playerNeedsTransferReview(player) {
  return ["transfer_needs_monitoring", "manual-review"].includes(String(player.dataStatus || ""));
}

function playerSeoTeamLabel(player) {
  if (playerNeedsTransferReview(player)) {
    return "Transfer Durumu Takipte";
  }

  return player.currentTeam || player.team || "Takım bilgisi yakında";
}

function playerTeamEyebrow(player) {
  const team = player.currentTeam || player.team || "Takım bilgisi yakında";
  if (playerNeedsTransferReview(player)) {
    return `Takım durumu takipte: ${team}`;
  }

  return `Güncel takım: ${team}`;
}

function playerTeamMetaPhrase(player) {
  const team = player.currentTeam || player.team || "Takım bilgisi yakında";
  if (playerNeedsTransferReview(player)) {
    return `son bilinen takım ${team}, transfer durumu takipte`;
  }

  return `güncel takım ${team}`;
}

/**
 * Meta açıklaması, doğrulanmamış kayıtlarda kulüp ve puan İDDİA ETMEZ.
 *
 * Önceki hâli "güncel takım Schalke 04 ... overall rating 81" gibi cümleler
 * üretiyordu ve bunlar arama sonuçlarında görünüyordu. Yapılandırılmış veri
 * ve meta açıklaması, görünür HTML'den daha tehlikeli: arama motoru bunları
 * olgu olarak yutar.
 */
/**
 * Profil fotoğrafı — YALNIZCA lisanslı sağlayıcı barındırıcısından.
 *
 * resolvePlayerPhoto yalnızca media.api-sports.io adreslerini kabul ediyor;
 * kazınmış ya da lisanssız bir görsel buraya giremez. Sağlayıcı fotoğraf
 * vermiyorsa baş harfli yer tutucu basılır, uydurma bir görsel değil.
 *
 * Tembel yükleme ve alt metin zorunlu: 589 profilin her biri bir istek
 * demek, alt metin de ekran okuyucu için tek tanım.
 */
function profileAvatarHtml(player) {
  const photo = resolvePlayerPhoto(player);
  const alt = playerPhotoAlt(player);

  if (photo.isPlaceholder) {
    return `<div class="player-avatar is-placeholder profile-avatar" role="img" aria-label="${escapeHtml(alt)}">` +
      `<span aria-hidden="true">${escapeHtml(photo.initials)}</span></div>`;
  }

  return `<img class="player-avatar profile-avatar" src="${escapeHtml(photo.url)}" alt="${escapeHtml(alt)}" ` +
    `width="96" height="96" loading="lazy" decoding="async">`;
}

function playerDescription(player, view) {
  if (view && !view.verified) {
    const position = player.position ? `, mevki ${player.position}` : "";
    return `${player.name}${position}. Güncel kulüp, performans ve piyasa verileri doğrulanmış ` +
      "sağlayıcı kaydıyla eşleştiğinde bu sayfada yayımlanır.";
  }
  // Puan yalnızca KAPIDAN GEÇTİYSE cümleye girer. Kaydın kaynağının
  // doğrulanmış olması, sağlayıcının göndermediği bir dereceyi
  // doğrulamıyor; kadro senkronu derecelendirme döndürmüyor.
  const fields = (view && view.fields) || {};
  const rating = fields.overallRating || fields.aiRating || fields.rating;
  const potential = fields.potentialRating;
  const ratingPhrase = rating ? `, overall rating ${rating}` : "";
  const potentialPhrase = potential ? `, potansiyel ${potential}` : "";
  return `${player.name}; ${playerTeamMetaPhrase(player)}, mevki ${player.position}. Transfer geçmişi${ratingPhrase}${potentialPhrase} ve radar metrikleriyle FutbolRadar'da analiz edilir.`;
}

function playerCurrentTeam(player) {
  return player.currentTeam || player.team || "Takim bilgisi yakinda";
}

function playerRating(player) {
  return Number(player.overallRating || player.aiRating || player.rating || 0);
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
  // Aynı gerçek oyuncunun iki kaydı birbiriyle "karşılaştırılmaz" — bkz.
  // generate-player-comparison-pages.mjs'deki aynı karar.
  if (sameCanonicalPlayer(primary, candidate)) return -1;

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

function staticCompareLinks(player) {
  const candidates = players.filter((candidate) => candidate.id !== player.id && !sameCanonicalPlayer(player, candidate));
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
  const links = uniqueCompareCandidates(baseLinks.concat(fallbackLinks)).slice(0, 4);

  return links.map((item) => {
    const href = `../karsilastirma/${comparisonSlug(player.id, item.player.id)}.html`;
    return `<a class="static-profile-link-card" href="${escapeHtml(href)}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(player.name)} vs ${escapeHtml(item.player.name)}</strong><em>${escapeHtml(item.note)}</em></a>`;
  }).join("\n        ");
}

function relatedLinks(currentId) {
  const links = [
    ["Forvetler", "./forvetler.html"],
    ["Kaleciler", "./kaleciler.html"],
    ["Defanslar", "./defanslar.html"],
    ["Orta sahalar", "./orta-sahalar.html"],
    ["Genç yetenekler", "./genc-yetenekler.html"],
    ["En iyi oyuncular", "./en-iyi-oyuncular.html"]
  ];

  return links
    .concat(players.filter((player) => player.id !== currentId).slice(0, 3).map((player) => [player.name, `./${player.id}.html`]))
    .map(([label, href]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
    .join("\n        ");
}

/**
 * Transfer bilgi kartı — yalnızca aktif tescil penceresinde kesinleşmiş
 * (kulüp açıklamasıyla kaynaklı) bir transferi olan oyuncularda basılır.
 * Sayfanın en üstünde, hero'nun hemen altında yer alır ("belirgin" şartı).
 *
 * Sezon istatistikleri yalnızca `statsAreVerified` geçerse gerçek sayıyla
 * gösterilir; aksi hâlde "henüz toplanmadı" notu basılır — yeni transfer
 * olan bir oyuncunun 0/0/0 kadro-senkron varsayılanı, gerçek "0 maçta 0 gol"
 * ölçümü sanılmasın diye.
 */
function transferHeroHtml(player, transfer, age) {
  const statsKnown = statsAreVerified(player);
  const statsBlock = statsKnown
    ? `<div class="transfer-radar-meta">
        <article><span>Maç (güncel sezon)</span><b>${escapeHtml(player.appearances)}</b></article>
        <article><span>Gol</span><b>${escapeHtml(player.goals)}</b></article>
        <article><span>Asist</span><b>${escapeHtml(player.assists)}</b></article>
        <article><span>Dakika</span><b>${escapeHtml(player.minutesPlayed != null ? player.minutesPlayed : player.minutes)}</b></article>
      </div>`
    : `<p class="transfer-note">Güncel sezon istatistikleri henüz toplanmadı; ${escapeHtml(transfer.toTeam)} forması altındaki ilk verilerle güncellenecek.</p>`;

  return `<section class="transfer-highlight" aria-label="Transfer bilgisi">
        <article class="transfer-radar-card" data-card="transfer-record" data-transfer="${escapeHtml(transfer.id || transfer.playerId)}">
          <header>
            <div class="player-card-title"><div><span class="card-kicker">${escapeHtml(transfer.league || "Süper Lig")} · Yeni Transfer</span><h2>${escapeHtml(player.name)} — ${escapeHtml(transfer.toTeam)}</h2></div></div>
            <strong>${escapeHtml(formatTransferDateTr(transfer.date))}</strong>
          </header>
          <div class="transfer-route transfer-route-large"><b>${escapeHtml(transfer.fromTeam || "Önceki kulüp bilinmiyor")}</b><em>→</em><b>${escapeHtml(transfer.toTeam || "Yeni kulüp bilinmiyor")}</b></div>
          <div class="transfer-radar-meta">
            <article><span>Güncel kulüp</span><b>${escapeHtml(transfer.toTeam)}</b></article>
            <article><span>Eski kulüp</span><b>${escapeHtml(transfer.fromTeam)}</b></article>
            <article><span>Transfer tarihi</span><b>${escapeHtml(formatTransferDateTr(transfer.date))}</b></article>
            <article><span>Transfer bedeli</span><b>${escapeHtml(transferFeeLabel(transfer))}</b></article>
            <article><span>Mevki</span><b>${escapeHtml(player.position || "Mevki bekleniyor")}</b></article>
            <article><span>Yaş</span><b>${escapeHtml(age)}</b></article>
          </div>
          ${statsBlock}
          ${transfer.note ? `<p class="transfer-note">${escapeHtml(transfer.note)}</p>` : ""}
          <p class="transfer-verification">Kaynak: ${escapeHtml(transfer.sourceName || "Kulüp açıklaması")} · Son kontrol: ${escapeHtml(formatTransferDateTr(transfer.lastVerifiedAt || transfer.date))}</p>
          <div class="player-status-row"><span class="status-badge verified">Transfer kesinleşti</span></div>
        </article>
      </section>`;
}

function transferHeroDescription(player, transfer) {
  const feeLabel = transferFeeLabel(transfer);
  const feePhrase = feeLabel ? `, transfer bedeli ${feeLabel}` : "";
  return `${player.name}: ${transfer.fromTeam} → ${transfer.toTeam} transferi (${formatTransferDateTr(transfer.date)})${feePhrase}. ` +
    `Güncel kulüp, eski kulüp, mevki, yaş ve sezon istatistikleri FutbolRadar'da.`;
}

function pageHtml(player) {
  // TEK YETKİLİ KARAR. URL ve sayfa iskeleti korunur — 110 profilin bilgi
  // mimarisi bozulmaz. Değişen tek şey, doğrulanmamış kayıtta hangi
  // alanların yayımlandığı.
  const view = publicPlayerView(player);
  // Kulübün KENDİSİ (transfer kartı, eyebrow, başlık) transfers.json'daki
  // kesinleşmiş, kaynaklı kayıttan gösterilir — `publicPlayerView`'in genel
  // kapısından (gerçek sağlayıcı kimliği şartı) BAĞIMSIZ bir doğrulama.
  // schema.org `memberOf` ise KASITLI OLARAK bu yoldan açılmaz:
  // test-player-surface-enforcement.mjs, makine okunur kulüp iddiasının
  // tek yetkili karardan (`view.verified`) geçmesini zorunlu kılıyor.
  const recentTransfer = latestRecentTransferFor(player);
  const team = view.verified
    ? (player.currentTeam || player.team || "Takım bilgisi yakında")
    : "Kulüp bilgisi doğrulanmadı";
  const seoTeam = view.verified ? playerSeoTeamLabel(player) : "Oyuncu Profili";
  const age = player.computedAge || player.age || "Yaş yakında";
  const title = recentTransfer
    ? `${player.name} ${recentTransfer.toTeam} Transferi ve İstatistikleri | FutbolRadar`
    : view.verified
      ? `${player.name} Oyuncu Profili | ${seoTeam} | FutbolRadar`
      : `${player.name} Oyuncu Profili | FutbolRadar`;
  const description = recentTransfer ? transferHeroDescription(player, recentTransfer) : playerDescription(player, view);
  const lead = recentTransfer
    ? description
    : view.verified
      ? (playerNeedsTransferReview(player) ? description : player.summary || description)
      : description;
  const canonical = `https://www.futbolradar.com/oyuncular/${player.id}.html`;
  // Sıfır ya da tire basılmaz: gerçek bir ölçüm sanılabilir. Doğrulanmamış
  // kayıtta puan rozeti HİÇ çizilmez (aşağıda view.verified ile).
  const overall = view.verified ? (player.overallRating || player.aiRating || player.rating || "-") : null;

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="https://www.futbolradar.com/assets/og-image.svg" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="https://www.futbolradar.com/assets/og-image.svg" />
    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Person",
            name: player.name,
            nationality: player.nationality,
            height: player.height,
            // memberOf YALNIZCA doğrulanmış kayıtta. Doğrulanmamış bir
            // kulüp iddiasını schema.org ile beyan etmek, onu makine
            // okunur bir olguya dönüştürür — görünür metinden daha kalıcı
            // bir yanlış. Denetimde Dzeko "Schalke 04" olarak böyle
            // beyan ediliyordu.
            ...(view.verified ? {
              memberOf: { "@type": "SportsTeam", name: team, sport: "Football" }
            } : {}),
            jobTitle: player.position,
            url: canonical,
            description: stripTags(description)
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: "https://www.futbolradar.com/" },
              { "@type": "ListItem", position: 2, name: "Oyuncu Radarı", item: "https://www.futbolradar.com/oyuncu-radari.html" },
              { "@type": "ListItem", position: 3, name: player.name, item: canonical }
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
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu">
        <a href="../index.html">Ana Sayfa</a>
        <span>/</span>
        <a href="../oyuncu-radari.html">Oyuncu Radarı</a>
        <span>/</span>
        <span>${escapeHtml(player.name)}</span>
      </nav>
      <section class="hero">
        <div class="hero-row">
          ${profileAvatarHtml(player)}
          <div>
            <span class="eyebrow">${escapeHtml(recentTransfer ? `Yeni Transfer · ${recentTransfer.toTeam}` : view.verified ? playerTeamEyebrow(player) : "Oyuncu profili")}</span>
            <h1>${escapeHtml(player.name)}</h1>
            <p class="lead">${escapeHtml(lead)}</p>
          </div>
          ${view.verified
            ? `<span class="hero-meta">Overall ${escapeHtml(overall)} · ${escapeHtml(player.position)} · ${escapeHtml(age)}</span>`
            // Doğrulanmamış kayıtta puan gösterilmez. Yaş ve mevki bağımsız
            // olarak güvenli bilgiler: kulüpten ve sezondan bağımsızlar.
            : `<span class="hero-meta">${escapeHtml(player.position || "Mevki bekleniyor")} · ${escapeHtml(age)}</span>`}
        </div>
      </section>
      ${recentTransfer ? transferHeroHtml(player, recentTransfer, age) : ""}
      ${view.verified ? "" : `<section class="player-unverified-note" aria-label="Veri durumu">
        <article class="data-empty" data-card="empty-state" data-player-verified="false">
          <strong>${recentTransfer ? "Performans verisi bekleniyor" : "Doğrulanmış veri bekleniyor"}</strong>
          <span>${recentTransfer
            ? `${escapeHtml(player.name)} için güncel kulüp ve transfer bilgisi resmî kulüp açıklamasıyla doğrulandı. Rating, piyasa değeri ve detaylı performans metrikleri sağlayıcı kaydıyla eşleştirilip doğrulanana kadar yayımlanmıyor.`
            : `Bu oyuncunun güncel kulübü, performans metrikleri ve piyasa değeri, sağlayıcı kaydıyla
          eşleştirilip doğrulanana kadar yayımlanmıyor. Tahmini ya da eski değer gösterilmiyor.`}</span>
        </article>
      </section>`}
      <section class="player-profile-shell" data-api-target="player-detail" data-player-id="${escapeHtml(player.id)}" data-player-verified="${view.verified ? "true" : "false"}">
        <article class="data-empty" data-card="empty-state">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${escapeHtml(view.verified ? "Oyuncu performans kartı yükleniyor." : "Doğrulanmış veri geldiğinde performans kartı burada yayımlanacak.")}</span>
        </article>
      </section>
      <section class="static-profile-links" aria-label="Statik oyuncu karşılaştırma bağlantıları">
        <div class="profile-section-head"><h2>Hazır Kıyas Linkleri</h2><span>Arama motorları ve hızlı gezinme için</span></div>
        <div class="static-profile-link-grid">
        ${staticCompareLinks(player)}
        </div>
      </section>
      <section class="popular-links" aria-label="İlgili oyuncu bağlantıları">
        <span>İlgili oyuncu radarları</span>
        ${relatedLinks(player.id)}
      </section>
    </main>
    ${siteFooter({ base: "../" })}
    <script src="../player-profile.js" defer></script>
    <script src="../site.js" defer></script>
    <script src="../app.js" defer></script>
  </body>
</html>
`;
}

function aliasHtml(player, alias) {
  const canonical = `https://www.futbolradar.com/oyuncular/${player.id}.html`;
  const title = `${player.name} Oyuncu Profili | FutbolRadar`;
  const description = `${player.name} oyuncu profili FutbolRadar kanonik sayfasına yönlendirilir.`;

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="noindex,follow" />
    <meta http-equiv="refresh" content="0; url=./${escapeHtml(player.id)}.html" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="https://www.futbolradar.com/assets/og-image.svg" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="https://www.futbolradar.com/assets/og-image.svg" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
    <script>window.location.replace("./${escapeHtml(player.id)}.html");</script>
  </head>
  <body class="subpage">
    <main class="container">
      <section class="hero alias-redirect">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Oyuncu profili taşındı</span>
            <h1>${escapeHtml(player.name)}</h1>
            <p class="lead">Bu adres güncellendi. FutbolRadar kanonik oyuncu profiline yönlendiriliyorsun.</p>
            <a class="button primary" href="./${escapeHtml(player.id)}.html">Oyuncu profilini aç</a>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>
`;
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(publicOutDir, { recursive: true });

for (const player of players) {
  const html = pageHtml(player);
  writeGeneratedFile(path.join(outDir, `${player.id}.html`), html);
  writeGeneratedFile(path.join(publicOutDir, `${player.id}.html`), html);

  for (const alias of player.aliases || []) {
    const html = aliasHtml(player, alias);
    writeGeneratedFile(path.join(outDir, `${alias}.html`), html);
    writeGeneratedFile(path.join(publicOutDir, `${alias}.html`), html);
  }
}

console.log(`Generated ${players.length} player profile pages`);
