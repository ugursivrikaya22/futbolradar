import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import {
  player360Description,
  player360FaqPage,
  player360Graph,
  player360H1,
  player360Person,
  player360Title,
  player360TransferTitle,
  renderPlayer360,
  renderPlayer360Kimdir
} from "./lib/player360.mjs";
import { turkishPlayer360 } from "./lib/player360English.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { playerNameNeedsReview } from "./lib/playerNameGate.mjs";
import { hasSubstantivePlayerContent } from "./lib/playerIndexing.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers } = require("../services/playerService.js");
const { buildPlayer360 } = require("../services/player360Service.js");
const { createPlayerUrlResolver } = require("../services/playerUrl.js");
const { resolvePlayerPhoto, playerPhotoAlt } = require("../services/playerPhotoService.js");
const { publicPlayerView, statsAreVerified, ratingIsVerified } = require("../services/cardCredibility.js");
const { annotateDuplicates } = require("../services/duplicatePlayerService.js");
const { absoluteUrl, hreflangOf } = require("../services/i18n.js");
// Kıyas eşleri ve adresleri TEK kaynaktan; kıyas sayfalarını üreten script
// de aynı listeyi okuyor, böylece buradaki her bağlantının bir sayfası var.
const { createComparisonSlugResolver, profileCompareCandidates } = require("../services/playerComparisonPairs.js");
// ÖZELLİK PUANLARI PROFİLDE DE SUNUCUDA BASILIR — karşılaştırma sayfasıyla
// aynı sekiz satır, aynı hesap, aynı şablon (services/playerRatingView.js).
// İki yüzeyin farklı sayı göstermesi, iki ayrı hesabın en kolay yoludur.
const { withStoredRatings } = require("../services/playerRatingService.js");
const { playerRatingCardHtml, ratingAdditionalProperties, ratingUpdatedAt } = require("../services/playerRatingView.js");
const { formatFreshnessDate } = require("../services/freshnessService.js");
// `readJson` bir fonksiyon bildirimi olduğu için burada zaten çağrılabilir.
const players = withStoredRatings(
  annotateDuplicates(getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")))),
  readJson("data/player-ratings.json", { players: {} })
);
const confirmedTransfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"))
  .filter((transfer) => transfer.status === "confirmed");
const transferWindows = (JSON.parse(fs.readFileSync(path.join(root, "data", "transfer-window.json"), "utf8")).windows || []);


/**
 * FUTBOLCU 360 GİRDİLERİ.
 *
 * Dosyalar bir kez okunur, 806 profilin hepsinde yeniden kullanılır: her
 * oyuncu için 1.158 arşiv kaydını diskten tekrar okumak, derlemeyi
 * gereksiz yere dakikalar uzatırdı.
 *
 * Eksik dosya derlemeyi DÜŞÜRMEZ — ilgili bölüm o koşuda sessizce boş kalır.
 * Oyuncu sayfası, yardımcı bir veri dosyasının yokluğunda 500 vermemeli.
 */
function readJson(relativePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch (error) {
    console.warn(`[futbolradar:player360] ${relativePath} okunamadı (${error.code || error.message}); bölüm boş kalacak`);
    return fallback;
  }
}

const { publishableNews } = require("../services/newsFeed.js");

/**
 * BAĞLANTI ANCAK SAYFASI VARSA BASILIR.
 *
 * Maç raporu ve haber sayfaları kendi uygunluk kurallarına göre üretiliyor:
 * her bitmiş maç rapor almıyor, her haber kaydı sayfa almıyor. Bu kuralları
 * burada yeniden yazmak (ve zamanla ayrışmalarına izin vermek) yerine
 * ÜRETİLMİŞ ÇIKTININ KENDİSİ okunuyor — derleme doğrulaması bu yüzden
 * yüzlerce "missing local target" bildiriyordu.
 *
 * Yeni eklenen bir rapor ya da haber, bir sonraki derlemede bağlanır:
 * geç bağlanan bir link, kırık bir linkten iyidir.
 */
function generatedSlugs(directory) {
  try {
    return new Set(fs.readdirSync(path.join(root, directory))
      .filter((name) => name.endsWith(".html"))
      .map((name) => name.slice(0, -5)));
  } catch {
    return new Set();
  }
}

/**
 * ADRES ÇÖZÜCÜ. Tam adı bilinen oyuncu `/futbolcu/<tam-ad>` adresine
 * taşındı; bilinmeyen eski adresinde kaldı. Tablo üretilmiş bir dosyada
 * (data/player-url-slugs.json) — çalışma zamanında hesaplanmıyor ki adres
 * bir koşudan diğerine sessizce değişmesin.
 */
const playerUrls = createPlayerUrlResolver(readJson("data/player-url-slugs.json", { entries: [], aliases: [] }));

/**
 * KIYAS HAVUZU KANONİK KAYITLARLA SINIRLI.
 *
 * Kıyas sayfalarını üreten script (generate-player-comparison-pages.mjs)
 * kopya kayıtları havuza almıyor; buradaki bağlantılar tam listeden
 * üretilseydi, üretilmemiş binlerce kıyas sayfasına bağlanırdı. İki taraf
 * AYNI havuzu görmek zorunda — kıyas eşi seçiminin tek kaynak olmasının
 * sebebi de bu.
 */
const comparablePlayers = players.filter((player) => !player.isDuplicate);
/** Kıyas adresi, sayfaları üreten scriptle AYNI kaynaktan. */
const slugForPair = createComparisonSlugResolver(players, comparablePlayers);

const matchReportSlugs = generatedSlugs("mac-raporu");
const newsSlugs = generatedSlugs("haber");

const newsItems = publishableNews(readJson("data/news.json", []));
const matchRecords = readJson("data/matches.json", []);
const archiveRecords = readJson("data/historical-match-archive.json", { records: [] }).records || [];
const squadStatuses = readJson("data/squad-statuses.json", { teams: [] });

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

// `hasSubstantivePlayerContent` (indeks kapısı) İngilizce üreticiyle ORTAK:
// scripts/lib/playerIndexing.mjs.

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

/**
 * Kıyas sayfalarını üreten script (generate-player-comparison-pages.mjs)
 * çiftleri yalnızca kopya OLMAYAN kayıtlardan kurar. Profil sayfası ise
 * playerUrls'in kanonik saydığı her kayda basılıyor; taze veride
 * annotateDuplicates bir kaydı kopya işaretleyip playerUrls hâlâ kanonik
 * sayınca o profil, hiç üretilmeyen kıyas sayfalarına bağlanıyordu (tam
 * derlemede bağlantı denetimi kırık hedef raporluyordu). İki taraf aynı
 * havuzu görmeli: kopya kaydın profili kıyas bağlantısı basmaz.
 */
function staticCompareLinks(player) {
  if (player.isDuplicate) return "";
  return profileCompareCandidates(player, comparablePlayers).map((item) => {
    const href = `../karsilastirma/${slugForPair(player, item.player)}.html`;
    return `<a class="static-profile-link-card" href="${escapeHtml(href)}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(player.name)} vs ${escapeHtml(item.player.name)}</strong><em>${escapeHtml(item.note)}</em></a>`;
  }).join("\n        ");
}

/**
 * Sayfa artık iki ayrı dizinde yayımlanıyor (`futbolcu/` ve `oyuncular/`),
 * bu yüzden bağlantılar "./" ile kurulamaz: kategori sayfaları
 * `oyuncular/` altında ve `futbolcu/` içinden "./forvetler.html" diye
 * çağrılınca kırılıyordu. Yollar köke göre yazılıp `../` ile
 * mutlaklaştırılır; oyuncu bağlantıları da tek çözücüden geçer.
 */
function relatedLinks(currentId) {
  const links = [
    ["Forvetler", "../oyuncular/forvetler.html"],
    ["Kaleciler", "../oyuncular/kaleciler.html"],
    ["Defanslar", "../oyuncular/defanslar.html"],
    ["Orta sahalar", "../oyuncular/orta-sahalar.html"],
    ["Genç yetenekler", "../oyuncular/genc-yetenekler.html"],
    ["En iyi oyuncular", "../oyuncular/en-iyi-oyuncular.html"]
  ];

  const peers = players
    .filter((player) => player.id !== currentId && playerUrls.resolveId(player.id) === player.id)
    .slice(0, 3)
    .map((player) => [playerUrls.playerDisplayName(player), playerUrls.playerHref(player, "../")]);

  return links
    .concat(peers)
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

/**
 * ÖZELLİK PUANLARI BÖLÜMÜ.
 *
 * Hiçbir kategorisi hesaplanamayan kayıtta bölüm HİÇ basılmaz: sekiz satır
 * "Veri yetersiz" yazan bir tablo, okuyucuya bilgi değil gürültü verir.
 * Profil sayfasının geri kalanı (kimlik, transfer, haber) etkilenmez.
 */
/** Person düğümüne hesaplanmış puanları ekler; düğümün geri kalanı aynen kalır. */
function personWithRatings(person, player) {
  const properties = ratingAdditionalProperties(player);
  if (!properties.length) return person;
  return {
    ...person,
    additionalProperty: (person.additionalProperty || []).concat(properties)
  };
}

function ratingSectionHtml(player) {
  const scores = player && player.ratingScores;
  if (!scores || scores.status !== "computed") return "";

  const stamp = ratingUpdatedAt(player);
  const card = playerRatingCardHtml(player, {
    updatedLabel: stamp ? formatFreshnessDate(stamp) : ""
  });
  if (!card) return "";

  return `<section class="player-rating-section" aria-label="${escapeHtml(player.name)} özellik puanları">
        <div class="profile-section-head">
          <h2>${escapeHtml(player.name)} özellik puanları</h2>
          <span>Overall, form, hücum, yaratıcılık, savunma, disiplin, süreklilik ve potansiyel</span>
        </div>
        ${card}
      </section>`;
}


function playerHreflangLinks(player, canonical) {
  const slug = playerUrls.slugFor(player.id);
  if (!slug || !playerUrls.hasCanonicalSlug(player.id)) return "";
  const trUrl = canonical;
  const enUrl = absoluteUrl(playerUrls.enPlayerPagePath(player.id));
  return `<!-- hreflang:start -->
    <link rel="alternate" hreflang="${hreflangOf("tr")}" href="${trUrl}" />
    <link rel="alternate" hreflang="${hreflangOf("en")}" href="${enUrl}" />
    <link rel="alternate" hreflang="x-default" href="${trUrl}" />
    <!-- hreflang:end -->`;
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
  // Futbolcu 360 modeli TEK yerde kurulur: aynı nesne hem görünür
  // bölümleri, hem meta açıklamasını, hem de schema.org düğümünü besler.
  // Üçünün ayrı hesaplanması, sayfada olmayan bir şeyi meta açıklamasının
  // vaat etmesine yol açıyordu.
  // Mevki ve uyruk sağlayıcıdan İngilizce gelir ("Attacker", "Nigeria");
  // TR sayfada görünen metin, meta ve Person şeması Türkçe karşılığı taşır.
  const model = turkishPlayer360(buildPlayer360({
    player,
    players: comparablePlayers,
    credibility: view,
    // YALNIZCA kesinleşmiş kayıtlar. Söylenti transferler bu listeden
    // GEÇMEZ; iddia düzeyindeki gelişmeler haber akışından, kendi güven
    // rozetleriyle gelir. İki ayrı güvenilirlik rejimini tek listede
    // karıştırmak, rozetin anlamını yok eder.
    transfers: confirmedTransfers,
    news: newsItems,
    matches: matchRecords,
    archive: archiveRecords,
    squadStatuses,
    displayName: playerUrls.playerDisplayName(player),
    comparisonSlugFor: slugForPair,
    basePrefix: "../",
    routes: {
      matchReportHref: (matchId) => (matchId && matchReportSlugs.has(matchId) ? `mac-raporu/${matchId}.html` : null),
      newsHref: (slug) => (slug && newsSlugs.has(slug) ? `haber/${slug}.html` : null)
    }
  }));
  const team = view.verified
    ? (player.currentTeam || player.team || "Takım bilgisi yakında")
    : "Kulüp bilgisi doğrulanmadı";
  const seoTeam = view.verified ? playerSeoTeamLabel(player) : "Oyuncu Profili";
  const age = player.computedAge || player.age || "Yaş yakında";
  // BAŞLIK. Varsayılan artık "Futbolcu 360" kalıbı: arama, oyuncu adının
  // yanında "istatistik", "gol", "haber" ve "son durum" kelimeleriyle
  // geliyor ve sayfa bunların dördünü de gerçekten taşıyor.
  //
  // TEK İSTİSNA, aktif tescil penceresinde kesinleşmiş bir transfer:
  // o hafta arama "Osimhen Galatasaray transferi" biçiminde geliyor ve
  // kulüp adını taşıyan başlık o niyetin birebir karşılığı. İstisna dar
  // tutuluyor (46 kayıt), çünkü genel kalıp daha geniş bir niyeti kapsıyor.
  const title = recentTransfer
    ? player360TransferTitle(model, recentTransfer.toTeam, { locale: "tr" })
    : player360Title(model, { locale: "tr" });
  // Meta her zaman kimdir niyetine uygun üretilir; cümle ortadan kesilmez.
  // Transfer kartı görünür kahraman bölümünde kalır, açıklamayı bölmez.
  const description = player360Description(model, { locale: "tr" });
  const lead = description;
  const canonical = playerUrls.playerCanonicalUrl(player.id);
  // İNDEKS KARARI: doğrulanmış oyuncu, kesinleşmiş transferi olan oyuncu ya da
  // en az bir KAYNAKLI içerik bölümü (sezon, maçlar, kariyer, transfer, haber,
  // kadro durumu, kupa) taşıyan sayfa indekslenir. Hiçbiri yoksa sayfa yalnızca
  // ad + mevkiden ibarettir: noindex,follow; `generate-static-seo-pages`
  // noindex sayfayı site haritasına zaten almaz.
  // Ad sıra bozukluğu şüphesi taşıyorsa ("Sami Bircan Ahmet") ad düzelene ya da
  // editör onaylayana kadar noindex: başlık, H1 ve kimdir cümlesi o adı basıyor.
  const indexable = !playerNameNeedsReview(player, root) && (view.verified || Boolean(recentTransfer) || hasSubstantivePlayerContent(model));
  // Sıfır ya da tire basılmaz: gerçek bir ölçüm sanılabilir. Doğrulanmamış
  // kayıtta puan rozeti HİÇ çizilmez (aşağıda view.verified ile).
  //
  // "Overall" ile aşağıdaki "Oyuncu Skoru" FARKLI ölçütlerdir: bu bir radar
  // modeli tahmini, diğeri maç verisine dayalı, kapsam yetersizse hiç
  // basılmayan bir skor. `ratingStatus` "estimated" olduğunda ikisi aynı
  // sayı sanılmasın diye "(tahmini)" eklenir — Osimhen'de "Overall 36
  // (tahmini)" yanında "Oyuncu Skoru: Hesaplanamadı" görmek, aynı oyuncu
  // için iki çelişkili KESİN sayı görmekten farklıdır.
  const overallIsEstimate = view.verified && !ratingIsVerified(player);
  const overall = view.verified
    ? (player.overallRating || player.aiRating || player.rating || "-") + (overallIsEstimate ? " (tahmini)" : "")
    : null;

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="https://www.futbolradar.com/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="https://www.futbolradar.com/assets/og-image.png" />
    <script type="application/ld+json">
      ${JSON.stringify({
        ...player360Graph(
          model,
          canonical,
          stripTags(description),
          [
            { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: "https://www.futbolradar.com/" },
            { "@type": "ListItem", position: 2, name: "Oyuncu Radarı", item: "https://www.futbolradar.com/oyuncu-radari.html" },
            { "@type": "ListItem", position: 3, name: model.identity.name, item: canonical }
          ]
        ),
        "@graph": [
          // Person düğümü, görünür bölümlerle AYNI modelden kurulur.
          // ProfilePage (WebPage alt türü) sayfanın kendisini tanımlar.
          // memberOf yalnızca doğrulanmış kayıtta basılır.
          personWithRatings(player360Person(model, canonical, stripTags(description)), player),
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: "https://www.futbolradar.com/" },
              { "@type": "ListItem", position: 2, name: "Oyuncu Radarı", item: "https://www.futbolradar.com/oyuncu-radari.html" },
              { "@type": "ListItem", position: 3, name: model.identity.name, item: canonical }
            ]
          },
          {
            "@type": "ProfilePage",
            "@id": `${canonical}#profile`,
            url: canonical,
            name: model.identity.name,
            description: stripTags(description),
            mainEntity: { "@id": `${canonical}#person` },
            isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: "https://www.futbolradar.com/" },
            inLanguage: "tr-TR"
          },
          ...(player360FaqPage(model, canonical, { locale: "tr" })
            ? [player360FaqPage(model, canonical, { locale: "tr" })]
            : [])
        ]
      }, null, 8)}
    </script>
    ${playerHreflangLinks(player, canonical)}
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
        <span>${escapeHtml(model.identity.name)}</span>
      </nav>
      <section class="hero">
        <div class="hero-row">
          ${profileAvatarHtml(player)}
          <div>
            <span class="eyebrow">${escapeHtml(recentTransfer ? `Yeni Transfer · ${recentTransfer.toTeam}` : view.verified ? playerTeamEyebrow(player) : "Oyuncu profili")}</span>
            <h1>${escapeHtml(player360H1(model, { locale: "tr" }))}</h1>
            <p class="lead">${escapeHtml(lead)}</p>
          </div>
          ${view.verified
            ? `<span class="hero-meta">Overall ${escapeHtml(overall)} · ${escapeHtml(player.position)} · ${escapeHtml(age)}</span>`
            // Doğrulanmamış kayıtta puan gösterilmez. Yaş ve mevki bağımsız
            // olarak güvenli bilgiler: kulüpten ve sezondan bağımsızlar.
            : `<span class="hero-meta">${escapeHtml(player.position || "Mevki bekleniyor")} · ${escapeHtml(age)}</span>`}
        </div>
      </section>
      ${renderPlayer360Kimdir(model, { locale: "tr" })}
      ${recentTransfer ? transferHeroHtml(player, recentTransfer, age) : ""}
      ${ratingSectionHtml(player)}
      ${renderPlayer360(model, { locale: "tr" })}
      ${/* "Doğrulanmış veri bekleniyor" yer tutucusu KALDIRILDI: sayfa yalnızca
         elindeki kaynaklı veriyi (kariyer, maçlar, haber, transfer) gösterir.
         Hiçbiri yoksa sayfa noindex olur ve site haritasından düşer
         (bkz. hasSubstantivePlayerContent). */ ""}
      <section class="player-profile-shell" data-api-target="player-detail" data-player-id="${escapeHtml(player.id)}" data-player-verified="${view.verified ? "true" : "false"}" data-p360="1">
        <article class="data-empty" data-card="empty-state">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${escapeHtml(view.verified ? "Oyuncu performans kartı yükleniyor." : "Doğrulanmış veri geldiğinde performans kartı burada yayımlanacak.")}</span>
        </article>
      </section>
      ${player.isDuplicate ? "" : `<section class="static-profile-links" aria-label="Statik oyuncu karşılaştırma bağlantıları">
        <div class="profile-section-head"><h2>Hazır Kıyas Linkleri</h2><span>Arama motorları ve hızlı gezinme için</span></div>
        <div class="static-profile-link-grid">
        ${staticCompareLinks(player)}
        </div>
      </section>`}
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

/**
 * YÖNLENDİRME SAYFASI.
 *
 * İki yerde gerekiyor ve ikisi de aynı şey: bu adres artık kanonik değil.
 *   • Eski takma adlar (`player.aliases`).
 *   • Tam isimli adrese TAŞINAN oyuncunun eski `/oyuncular/<id>.html` yolu.
 *
 * Asıl yönlendirme sunucu tarafında, kalıcı (301) olarak yapılıyor
 * (vercel.json). Buradaki dosya, doğrudan dosyaya erişen ya da
 * yönlendirmeyi izlemeyen istemciler için ikinci savunma hattı: canonical
 * yeni adresi gösterir, sayfa `noindex` işaretlidir ve içerik KOPYALANMAZ.
 *
 * @param {string} targetPath site köküne göre hedef ("futbolcu/victor-osimhen.html")
 * @param {string} relativeHref yönlendirme sayfasından hedefe giden yol
 */
function redirectHtml(player, targetPath, relativeHref) {
  // Canonical ve yönlendirme hedefi SON adrestir: `futbolcu/x.html` vercel.json'da
  // `/futbolcu/x`e 301 verir; 301 veren adresi canonical ya da bağlantı hedefi
  // yapmak gereksiz bir sıçrama (ve "canonical yönlendiriyor" uyarısı) demek.
  const finalPath = targetPath.startsWith("futbolcu/") ? targetPath.replace(/\.html$/, "") : targetPath;
  relativeHref = relativeHref.replace(/^(\.\.\/futbolcu\/[^?#]+)\.html$/, "$1");
  const canonical = `https://www.futbolradar.com/${finalPath}`;
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
    <meta name="robots" content="${ROBOTS_NOINDEX_FOLLOW}" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(relativeHref)}" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="https://www.futbolradar.com/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="https://www.futbolradar.com/assets/og-image.png" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
    <script>window.location.replace("${escapeHtml(relativeHref)}");</script>
  </head>
  <body class="subpage">
    <main class="container">
      <section class="hero alias-redirect">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Oyuncu profili taşındı</span>
            <h1>${escapeHtml(player.name)}</h1>
            <p class="lead">Bu adres güncellendi. FutbolRadar kanonik oyuncu profiline yönlendiriliyorsun.</p>
            <a class="button primary" href="${escapeHtml(relativeHref)}">Oyuncu profilini aç</a>
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

const canonicalDir = path.join(root, "futbolcu");
const publicCanonicalDir = path.join(root, "public", "futbolcu");
fs.mkdirSync(canonicalDir, { recursive: true });
fs.mkdirSync(publicCanonicalDir, { recursive: true });

/** Aynı içeriği hem kökte hem `public/` aynasında yazar. */
function writeBoth(relativePath, html) {
  for (const base of [root, path.join(root, "public")]) {
    const target = path.join(base, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeGeneratedFile(target, html);
  }
}

const slugTable = readJson("data/player-url-slugs.json", { entries: [] });
const previousSlugsById = new Map((slugTable.entries || [])
  .filter((entry) => Array.isArray(entry.previousSlugs) && entry.previousSlugs.length)
  .map((entry) => [entry.id, entry.previousSlugs]));
const currentSlugs = new Set((slugTable.entries || []).map((entry) => entry.slug));

let movedPages = 0;
let legacyPages = 0;
let redirectPages = 0;

for (const player of players) {
  // KOPYA KAYIT SAYFA ÜRETMEZ, YÖNLENDİRİR.
  //
  // Aynı gerçek oyuncunun iki kaydı vardı ve ikisi de tam sayfa basıyordu:
  // "victor-osimhen" ile "v-osimhen-galatasaray" aynı kişi için iki ayrı
  // indekslenebilir URL demekti. Adres kanonik kaydındır; kopya kayıt artık
  // ona yönlendirilir.
  const canonicalId = playerUrls.resolveId(player.id);
  if (canonicalId !== player.id) {
    const targetPath = playerUrls.playerPagePath(player.id);
    const html = redirectHtml(player, targetPath, `../${targetPath}`);
    writeBoth(path.join("oyuncular", `${player.id}.html`), html);
    redirectPages += 1;
    continue;
  }

  const pagePath = playerUrls.playerPagePath(player.id);
  const html = pageHtml(player);
  writeBoth(pagePath, html);

  if (playerUrls.hasCanonicalSlug(player.id)) {
    movedPages += 1;
    // Eski adres korunur ama kanonik değildir: yeni adrese yönlendirir.
    // Dosyanın var olmaya devam etmesi, bilgi mimarisini bozmamak için
    // (scripts/test-player-surface-enforcement.mjs bunu zorunlu kılıyor)
    // ve doğrudan dosya adresine gelen istemciler için.
    writeBoth(
      path.join("oyuncular", `${player.id}.html`),
      redirectHtml(player, pagePath, `../${pagePath}`)
    );
  } else {
    legacyPages += 1;
  }

  for (const alias of player.aliases || []) {
    const html = redirectHtml(player, pagePath, `../${pagePath}`);
    writeBoth(path.join("oyuncular", `${alias}.html`), html);
    redirectPages += 1;
  }

  // Ad düzeltmesiyle slug'ı değişen oyuncunun eski adresi yönlendirme olur
  // (scripts/generate-player-url-slugs.mjs → previousSlugs). Başka bir
  // oyuncunun güncel adresiyse dokunulmaz.
  for (const oldSlug of previousSlugsById.get(player.id) || []) {
    if (currentSlugs.has(oldSlug)) continue;
    writeBoth(path.join("futbolcu", `${oldSlug}.html`), redirectHtml(player, pagePath, `../${pagePath}`));
    redirectPages += 1;
  }
}

console.log(`Generated ${players.length} player profile pages ` +
  `(${movedPages} tam isimli adreste, ${legacyPages} eski adreste, ${redirectPages} yönlendirme).`);
