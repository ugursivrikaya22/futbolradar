import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers, formatMarketValueEur } = require("../services/playerService.js");
const { publicPlayerView } = require("../services/cardCredibility.js");
const { buildPlayerProfile } = require("../services/playerProfileService.js");
const { createPlayerUrlResolver } = require("../services/playerUrl.js");
const { resolvePlayerPhoto, playerPhotoAlt } = require("../services/playerPhotoService.js");

/**
 * Profil sayfası artık sabit bir dizinde değil: tam adı bilinen oyuncu
 * `futbolcu/<tam-ad>.html`, bilinmeyen `oyuncular/<id>.html` konumunda.
 * Ön render eski yola sabitlenince taşınan sayfalar ön render EDİLMİYORDU —
 * yani tam da en çok aranan oyuncuların sayfası arama motoruna boş kabukla
 * gidiyordu.
 */
const playerUrls = createPlayerUrlResolver((() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", "player-url-slugs.json"), "utf8"));
  } catch {
    return { entries: [], aliases: [] };
  }
})());
const playerProfileView = require("../player-profile.js");
const players = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")));
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rating(player) {
  return player.overallRating || player.aiRating || player.rating || "-";
}

function team(player) {
  return player.currentTeam || player.team || "Takim bilgisi yakinda";
}

/**
 * Liste kartı. Doğrulanmamış kayıtta puan rozeti, piyasa değeri, dakika ve
 * KULÜP İDDİASI çizilmez — sıfır ya da tire de basılmaz, çünkü bunlar
 * gerçek bir ölçüm sanılabilir. Kart kalır (bağlantı ve bilgi mimarisi
 * korunur), yalnızca doğrulanamayan alanlar düşer.
 */
/**
 * Kart bağlantısı artık kimlikten TÜRETİLMEZ.
 *
 * `hrefPrefix + player.id + ".html"` kalıbı, oyuncu tam isimli adrese
 * taşındığı anda var olmayan bir dosyaya işaret ediyordu. Adres tek
 * çözücüden gelir; `rootPrefix`, kartı basan sayfadan site köküne giden
 * yoldur ("./" kök sayfalar, "../" alt dizinler).
 */
function playerCardHref(player, rootPrefix) {
  return playerUrls.playerHref(player, rootPrefix);
}

function playerCard(player, rootPrefix = "../") {
  const view = publicPlayerView(player);
  const age = player.computedAge || player.age || "Bilinmiyor";

  if (!view.verified) {
    return `<article class="card player-detail-card" data-card="player" data-player="${escapeHtml(player.id)}" data-player-verified="false">
    <div class="card-head"><div><span class="card-kicker">${escapeHtml(player.position || "Mevki bekleniyor")}</span><h2>${escapeHtml(player.name)}</h2></div></div>
    <div class="metric-grid compact"><span>Yaş <b>${escapeHtml(age)}</b></span></div>
    <p>Güncel kulüp, performans ve piyasa verileri doğrulanmış sağlayıcı kaydıyla eşleştiğinde yayımlanır.</p>
    <a class="detail-link" href="${escapeHtml(playerCardHref(player, rootPrefix))}">Oyuncu profilini aç</a>
  </article>`;
  }

  // ALANLAR KAPIDAN GEÇENLERDEN OKUNUR, ham kayıttan DEĞİL.
  //
  // Kaydın kaynağı doğrulanmış olması, üstündeki her sayının doğrulandığı
  // anlamına gelmiyor: kadro uç noktası derecelendirme, dakika ve piyasa
  // değeri göndermiyor; normalizePlayer bu alanları varsayılanla dolduruyor.
  // Burada ham kayıt okunduğu için o varsayılanlar (rating 32, dakika 0)
  // doğrulanmış kart görünümüyle basılıyordu.
  const ratingValue = view.fields.overallRating || view.fields.aiRating || view.fields.rating;
  const minutesValue = view.fields.minutesPlayed ?? view.fields.minutes;
  const marketValue = view.fields.marketValueEur !== undefined
    ? formatMarketValueEur(view.fields.marketValueEur)
    : (view.fields.marketValue || null);
  const clubValue = view.fields.currentTeam || view.fields.team;

  const kicker = [clubValue, player.position || "Mevki bekleniyor"].filter(Boolean).join(" · ");
  const badge = ratingValue
    ? `<strong class="big-value player-rating-badge">${escapeHtml(ratingValue)}</strong>`
    : "";
  const metrics = [`<span>Yaş <b>${escapeHtml(age)}</b></span>`];
  if (minutesValue !== undefined && minutesValue !== null) {
    metrics.push(`<span>Maç dakikası <b>${escapeHtml(minutesValue)}</b></span>`);
  }
  if (marketValue) metrics.push(`<span>Piyasa <b>${escapeHtml(marketValue)}</b></span>`);

  return `<article class="card player-detail-card" data-card="player" data-player="${escapeHtml(player.id)}" data-player-verified="true">
    <div class="card-head"><div><span class="card-kicker">${escapeHtml(kicker)}</span><h2>${escapeHtml(player.name)}</h2></div>${badge}</div>
    <div class="metric-grid compact">${metrics.join("")}</div>
    <p>${escapeHtml(player.summary || "Form, rol ve radar metriklerini oyuncu profilinde incele.")}</p>
    <a class="detail-link" href="${escapeHtml(playerCardHref(player, rootPrefix))}">Oyuncu profilini aç</a>
  </article>`;
}

/**
 * TRANSFER KARTINDA FOTOĞRAF — ön render tarafı.
 *
 * Transfer kaydında görsel kimlik yok; oyuncu kaydından ödünç alınıyor
 * (önce playerId, yedek olarak ad). Karar yine services/playerPhotoService
 * kuralında: beyaz listede olmayan adres ya da yer tutucu kimlik fotoğraf
 * üretmez, baş harfler basılır. İstemci tarafı (app.js) aynı sonucu
 * ürettiği için JS yüklendiğinde kart değişmez.
 */
function normalizePhotoText(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sağlayıcı kadro kayıtları adı "V. Osimhen" biçiminde tutuyor, transfer
 * kaydında ise tam ad var. Ortak anahtar: ilk harf + soyad.
 */
function photoNameKey(name) {
  const parts = normalizePhotoText(name).split(" ").filter(Boolean);
  if (parts.length < 2) return "";
  return `${parts[0].charAt(0)}.${parts[parts.length - 1]}`;
}

const photoIndex = { byId: new Map(), byTeam: new Map(), byName: new Map(), nameCounts: new Map() };
for (const player of players) {
  const identity = { photo: player.photo || null, providerId: player.providerId || player.playerId || null };
  // Fotoğraf üretemeyecek kayıt indekse girmiyor; girseydi doğru eşleşmenin
  // önünü keser, kart boş yere baş harflere düşerdi.
  if (!identity.photo && !/^\d+$/.test(String(identity.providerId || ""))) continue;
  if (player.id) photoIndex.byId.set(String(player.id), identity);
  const nameKey = photoNameKey(player.name);
  if (!nameKey) continue;
  const teamKey = `${nameKey}@${normalizePhotoText(player.currentTeam || player.team)}`;
  if (!photoIndex.byTeam.has(teamKey)) photoIndex.byTeam.set(teamKey, identity);
  photoIndex.nameCounts.set(nameKey, (photoIndex.nameCounts.get(nameKey) || 0) + 1);
  if (!photoIndex.byName.has(nameKey)) photoIndex.byName.set(nameKey, identity);
}

function lookupTransferPhotoIdentity(transfer) {
  const byId = photoIndex.byId.get(String(transfer.playerId || ""));
  if (byId) return byId;

  const nameKey = photoNameKey(transfer.playerName);
  if (!nameKey) return null;

  // Önce kulüple birlikte: aynı soyadı taşıyan iki oyuncuyu ayıran en güçlü
  // ipucu, oyuncunun gittiği (ya da geldiği) kulüp.
  const byTeam = photoIndex.byTeam.get(`${nameKey}@${normalizePhotoText(transfer.toTeam)}`) ||
    photoIndex.byTeam.get(`${nameKey}@${normalizePhotoText(transfer.fromTeam)}`);
  if (byTeam) return byTeam;

  // Kulüp eşleşmiyorsa yalnızca anahtar TEK bir oyuncuya işaret ediyorsa
  // kabul edilir; belirsiz eşleşme, başkasının fotoğrafını basmak demektir.
  if (photoIndex.nameCounts.get(nameKey) === 1) return photoIndex.byName.get(nameKey) || null;
  return null;
}

function transferPlayerIdentity(transfer) {
  const found = lookupTransferPhotoIdentity(transfer);
  return {
    name: transfer.playerName,
    currentTeam: transfer.toTeam,
    photo: (found && found.photo) || null,
    providerId: (found && found.providerId) || null
  };
}

function transferAvatarHtml(transfer) {
  const identity = transferPlayerIdentity(transfer);
  const photo = resolvePlayerPhoto(identity);
  const initials = escapeHtml(photo.initials);
  if (photo.isPlaceholder) {
    return `<span class="player-avatar is-placeholder">${initials}</span>`;
  }
  const alt = playerPhotoAlt(identity, `${transfer.toTeam || "yeni kulüp"} transferi`);
  return `<span class="player-avatar"><img src="${escapeHtml(photo.url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" width="96" height="96" data-initials="${initials}" onerror="this.parentNode.classList.add('is-placeholder');this.replaceWith(document.createTextNode(this.dataset.initials||''))" /></span>`;
}

function transferCard(transfer) {
  const fee = transfer.fee || (Number(transfer.feeEur) > 0 ? formatMarketValueEur(transfer.feeEur) : Number(transfer.feeEur) === 0 ? "Bedelsiz" : "Açıklanmadı");
  const date = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${transfer.date}T12:00:00Z`));
  const sourceAction = transfer.sourceUrl
    ? `<a class="detail-link" href="${escapeHtml(transfer.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">Transfer detayını aç</a>`
    : "";

  return `<article class="transfer-radar-card" data-card="transfer-record" data-transfer="${escapeHtml(transfer.id || transfer.playerId)}">
    <header><div class="player-card-title">${transferAvatarHtml(transfer)}<div><span class="card-kicker">${escapeHtml(transfer.league || "Lig bilgisi yakında")} · Kesinleşti</span><h2>${escapeHtml(transfer.playerName)}</h2></div></div><strong>${escapeHtml(date)}</strong></header>
    <div class="transfer-route transfer-route-large"><b>${escapeHtml(transfer.fromTeam || "Önceki kulüp bilinmiyor")}</b><em>→</em><b>${escapeHtml(transfer.toTeam || "Yeni kulüp bilinmiyor")}</b></div>
    <div class="transfer-radar-meta"><article><span>Mevki</span><b>${escapeHtml(transfer.position || "Bilinmiyor")}</b></article><article><span>Transfer tipi</span><b>${escapeHtml(transfer.type || "Açıklanmadı")}</b></article><article><span>Bonservis</span><b>${escapeHtml(fee)}</b></article><article><span>Sezon</span><b>${escapeHtml(transfer.season || "Yakında")}</b></article></div>
    ${transfer.note ? `<p class="transfer-note">${escapeHtml(transfer.note)}</p>` : ""}
    <p class="transfer-verification">Son kontrol: ${escapeHtml(new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(transfer.lastVerifiedAt || `${transfer.date}T12:00:00Z`)))}</p>
    <div class="player-status-row"><span class="status-badge verified">Kesinleşti</span></div>
    <div class="player-actions">${sourceAction}<a class="detail-link ghost" href="./takimlar.html?team=${encodeURIComponent(transfer.toTeam || "")}">Takımı incele</a></div>
  </article>`;
}

/**
 * Oyuncu profilinin sunucu tarafında basılmış hâli.
 *
 * Aynı görünüm modülü tarayıcıda da çalışır; böylece arama motorunun gördüğü
 * HTML ile kullanıcının API tazelemesinden sonra gördüğü HTML aynı yapıdadır.
 * Kabuk (`player-profile-shell`) korunur: sayfa açıldığında modül canlı
 * veriyle içeriği tazeler, istek başarısız olursa burada basılan içerik
 * yerinde kalır.
 *
 * Kart güvenilirliği kararı profil derleyicisinin içinde verilir; doğrulanmamış
 * kayıtta ölçüm blokları hiç çizilmez, yerine gerekçe kartı basılır.
 */
function profileShell(player) {
  const view = publicPlayerView(player);
  const profile = buildPlayerProfile({ player, players, transfers, credibility: view });
  // Sayfa üstünde "Futbolcu 360" yığını var: kimlik, sezon, son maçlar,
  // form, kariyer ve transfer bölümleri orada, kapıdan geçmiş ve daha dolu
  // hâlleriyle basılıyor. Kartta ikinci kez basılmazlar; aynı anahtar
  // iskelete gömülür ki tarayıcı tazelemesi de aynı kararı uygulasın.
  const html = playerProfileView.renderProfileHtml(profile, {
    // Eş adresleri artık veriden köke göre geliyor ("futbolcu/x.html"),
    // bu yüzden önek dizin adı değil, köke çıkan yol.
    hrefPrefix: "../",
    rootPrefix: "../",
    omit: playerProfileView.P360_SUPERSEDED
  });

  return `<section class="player-profile-shell" data-api-target="player-detail" data-player-id="${escapeHtml(player.id)}" data-player-verified="${view.verified ? "true" : "false"}" data-prerendered="1" data-p360="1">${html}</section>`;
}

/**
 * Kabuğu yeniden yazar. Baştan-sona indeks aramasıyla çalışır: basılan profil
 * iç içe `<section>` düğümleri içeriyor, tembel bir regex ilk kapanış
 * etiketinde durup sayfayı bozardı.
 */
function replaceProfileShell(html, player) {
  const start = html.indexOf('<section class="player-profile-shell"');
  const end = html.indexOf('<section class="static-profile-links"');

  if (start === -1 || end === -1 || end <= start) {
    return html;
  }

  return `${html.slice(0, start)}${profileShell(player)}\n      ${html.slice(end)}`;
}

/**
 * Kulübü olmayan bir oyuncu güncel bir "en iyi" ya da "trend" listesinde
 * duramaz — serbest oyuncu ya da sözleşmesi biten oyuncunun bayat formu,
 * hâlâ oynuyormuş izlenimi verir. Kural önce yalnızca "yukselen-oyuncular"
 * için yazılmıştı; aynı sorun mevki bazlı "en iyi" sayfalarında da vardı
 * (ör. serbest kalan bir santrforun "en iyi forvetler" sayfasında görünmesi).
 */
function hasActiveClub(player) {
  const team = String(player.currentTeam || player.team || "").trim();
  return Boolean(team) && !/serbest|free agent|kulüpsüz|released/i.test(team);
}

function landingConfig(slug) {
  return {
    forvetler: (player) => /forvet|santrfor|kanat/i.test(`${player.position} ${player.positionGroup}`) && hasActiveClub(player),
    kaleciler: (player) => /kaleci|goalkeeper/i.test(`${player.position} ${player.positionGroup}`) && hasActiveClub(player),
    defanslar: (player) => /def|stoper|bek|savun/i.test(`${player.position} ${player.positionGroup}`) && hasActiveClub(player),
    "orta-sahalar": (player) => /orta|mid/i.test(`${player.position} ${player.positionGroup}`) && hasActiveClub(player),
    "genc-yetenekler": (player) => Number(player.computedAge || player.age || 99) < 23 && hasActiveClub(player),
    "en-iyi-oyuncular": (player) => Number(rating(player)) >= 80 && hasActiveClub(player)
  }[slug];
}

function rootLandingConfig(slug) {
  const configs = {
    "en-iyi-super-lig-oyunculari": (player) => /süper lig|super lig/i.test(player.league || "") && Number(rating(player)) >= 75 && hasActiveClub(player),
    "en-iyi-forvetler": (player) => ["forward", "winger"].includes(player.positionGroup) && hasActiveClub(player),
    "en-iyi-orta-sahalar": (player) => player.positionGroup === "midfielder" && hasActiveClub(player),
    "en-iyi-defanslar": (player) => player.positionGroup === "defender" && hasActiveClub(player),
    "en-iyi-kaleciler": (player) => player.positionGroup === "goalkeeper" && hasActiveClub(player),
    "yukselen-oyuncular": (player) => {
      const trend = String(player.trendDirection || player.trend || "").toLocaleLowerCase("tr-TR");
      const isTrendingUp = Number(player.formChange) > 0 || trend.includes("up") || trend.includes("yüksel") || trend.includes("yuksel");
      if (!isTrendingUp) return false;
      // Kulübü olmayan bir oyuncu "yükselişte" olamaz — güncel kulüp yoksa
      // (serbest oyuncu, sözleşmesi biten) bayat form verisi yanıltıcı olur.
      return hasActiveClub(player);
    },
    "genc-yetenekler": (player) => Number(player.computedAge || player.age || 99) < 23 && hasActiveClub(player),
    "transfer-radari": (player) => Array.isArray(player.transferHistory) && player.transferHistory.length > 0
  };
  return configs[slug];
}

function updateSitemapIndexability(file, shouldIndex) {
  if (shouldIndex) return;
  const canonical = `https://www.futbolradar.com/${file}`;
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    const xml = fs.readFileSync(sitemapPath, "utf8");
    const next = xml.replace(/\s*<url>[\s\S]*?<\/url>/g, (block) => {
      return block.includes(`<loc>${canonical}</loc>`) ? "" : block;
    });
    fs.writeFileSync(sitemapPath, next, "utf8");
  }
}

function replaceFile(file, transform) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) return;
  const html = transform(fs.readFileSync(source, "utf8"));
  fs.writeFileSync(source, html, "utf8");
  const mirror = path.join(root, "public", file);
  fs.mkdirSync(path.dirname(mirror), { recursive: true });
  fs.writeFileSync(mirror, html, "utf8");
}

for (const player of players) {
  // Kopya kayıtların sayfası yok (kanoniğe yönlendiriyorlar).
  if (playerUrls.resolveId(player.id) !== player.id) continue;
  replaceFile(playerUrls.playerPagePath(player.id), (html) => replaceProfileShell(html, player));
}

for (const slug of ["forvetler", "kaleciler", "defanslar", "orta-sahalar", "genc-yetenekler", "en-iyi-oyuncular"]) {
  const filter = landingConfig(slug);
  const selected = players.filter(filter).sort((a, b) => Number(rating(b)) - Number(rating(a)));
  const content = selected.length
    ? selected.map((player) => playerCard(player, "../")).join("\n")
    : `<article class="data-empty"><strong>Bu listede oyuncu bulunamadi</strong><span>Yeni ve doğrulanmış oyuncu verileri geldikçe liste genişleyecek.</span></article>`;
  replaceFile(`oyuncular/${slug}.html`, (html) => html
    .replace(/<span class="hero-meta" data-landing-count>[^<]*<\/span>/, `<span class="hero-meta" data-landing-count>${selected.length} oyuncu</span>`)
    .replace(/<section class="grid" data-api-section="player-seo-landing"[\s\S]*?<\/section>/, `<section class="grid" data-api-section="player-seo-landing" data-api-target="player-seo-landing" data-player-landing="${slug}">${content}</section>`));
}

for (const slug of [
  "en-iyi-super-lig-oyunculari",
  "en-iyi-forvetler",
  "en-iyi-orta-sahalar",
  "en-iyi-defanslar",
  "en-iyi-kaleciler",
  "yukselen-oyuncular",
  "genc-yetenekler"
]) {
  const filter = rootLandingConfig(slug);
  const selected = players.filter(filter).sort((a, b) => Number(rating(b)) - Number(rating(a)));
  const shouldIndex = selected.length >= 2;
  const content = selected.length
    ? selected.map((player) => playerCard(player, "./")).join("\n")
    : `<article class="data-empty"><strong>Bu listede oyuncu bulunamadi</strong><span>Yeterli oyuncu verisi olustugunda sayfa genisleyecek.</span></article>`;

  replaceFile(`${slug}.html`, (html) => {
    const withContent = html
      .replace(/<span data-landing-count>[^<]*<\/span>/, `<span data-landing-count>${selected.length} oyuncu</span>`)
      .replace(/<section class="grid" data-api-section="player-landing"[\s\S]*?<\/section>/, `<section class="grid" data-api-section="player-landing" data-api-target="player-seo-landing" data-player-landing="${slug}">${content}</section>`);
    return shouldIndex ? withContent : withContent.replace('content="index,follow"', 'content="noindex,follow"');
  });
  updateSitemapIndexability(`${slug}.html`, shouldIndex);
}

const sortedTransfers = transfers.slice().sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
const transferContent = sortedTransfers.length
  ? sortedTransfers.map(transferCard).join("\n")
  : `<article class="data-empty"><strong>Kesinleşen transfer bulunamadı</strong><span>Yeni kulüp açıklamaları geldiğinde bu alan güncellenir.</span></article>`;

replaceFile("transfer-radari.html", (html) => html
  .replace(/<span data-landing-count>[^<]*<\/span>/, `<span data-landing-count>${sortedTransfers.length} transfer kaydı</span>`)
  .replace(/<section class="grid" data-api-section="player-landing"[\s\S]*?<\/section>/, `<section class="grid" data-api-section="player-landing" data-api-target="player-seo-landing" data-player-landing="transfer-radari">${transferContent}</section>`));
updateSitemapIndexability("transfer-radari.html", sortedTransfers.length >= 2);

console.log(`Prerendered ${players.length} player profiles and SEO landing lists`);
