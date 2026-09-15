/**
 * SİTE İÇİ BİLDİRİM DAĞITIMI.
 *
 * =====================================================================
 * NEDEN AYRI BİR MODÜL, NEDEN pushNotifier'IN İÇİNE DEĞİL
 * =====================================================================
 * `services/pushNotifier.js` TARAYICI PUSH'u gönderiyor: aboneliği
 * `push_subscriptions` tablosunda, hedefi cihaz. Bu modül ise SİTE İÇİ
 * zil kutusunu dolduruyor: hedefi hesap, kaynağı `user_favorites`.
 *
 * İkisi ayrı çünkü ömürleri ayrı: push aboneliği cihaz izni kalkınca
 * ölür, favori hesapta kalır. Aynı fonksiyona sıkıştırılsalardı bir
 * gün biri "aboneliği sil" derken diğerinin favorisini de silerdi.
 *
 * İkisi de AYNI kancadan besleniyor (`liveScoreStream#onMatchEvents`),
 * bu yüzden aynı olay iki kanala da gidiyor — ve kullanıcı ikisini
 * ayrı ayrı kapatabiliyor.
 *
 * =====================================================================
 * BİLDİRİM CANLI SKORU ASLA KESMEZ
 * =====================================================================
 * Her hata yutuluyor. Bu modül canlı skor akışının içinden çağrılıyor
 * ve fırlatan bir bildirim yazıcısı, gol bildirimini kaçırmakla
 * kalmaz — SKORUN KENDİSİNİ de düşürürdü. Sitenin işi canlı skor;
 * bildirim onun üstüne bir katman, önüne bir engel değil.
 */

if (typeof window !== "undefined") {
  throw new Error("membership-notifier-is-server-only");
}

const profileStore = require("./profileStore");
const config = require("./config");
const { loadTeams, teamIdForName } = require("../teamIdentity");

/** Takım kütüğü — `teamIdForName` için; modül önbelleğinde kalır. */
function loadTeamCatalog() {
  try {
    return loadTeams();
  } catch (error) {
    return [];
  }
}

/**
 * Canlı akış olay türü → bildirim türü (ve tercih sütunu).
 *
 * `services/liveScoreStream.js#detectMatchEvents` bu adları üretiyor.
 * Eşlemede olmayan bir tür sessizce ATLANIR: tanımadığımız bir olayı
 * "herhâlde gol" diye yazmak, uydurma bildirim üretmek olurdu.
 */
const EVENT_TO_KIND = Object.freeze({
  kickoff: "match_start",
  goal: "goal",
  halftime: "half_time",
  fulltime: "match_end",
  // Canlı akış bu adı üretiyor (services/liveScoreStream.js#detectMatchEvents).
  "red-card": "red_card",
  lineups: "lineups"
});

/** Tek olayda yazılacak en fazla bildirim. */
const MAX_RECIPIENTS_PER_EVENT = 500;

function isConfigured() {
  return profileStore.isConfigured() && config.PRO_ENABLED;
}

/**
 * Olayın metni. `pushNotifier.buildPayload` ile AYNI bilgiyi verir ama
 * emoji taşımaz: zil kutusu bir liste, bildirim şeridi değil.
 *
 * Metin hiçbir yerde yorum yapmaz — ne olduğunu söyler, "iyi/kötü"
 * demez; bildirimi kimin aldığını (hangi takımı tuttuğunu) bilmiyoruz.
 */
function buildNotification(event) {
  const match = (event && event.match) || {};
  const home = String(match.homeTeam || "");
  const away = String(match.awayTeam || "");
  if (!home || !away) return null;

  const kind = EVENT_TO_KIND[String(event.type || "").toLowerCase()];
  if (!kind) return null;

  const scoreHome = match.score && Number.isFinite(match.score.home) ? match.score.home : null;
  const scoreAway = match.score && Number.isFinite(match.score.away) ? match.score.away : null;
  // SKOR YOKSA SKOR YAZILMAZ. `Number(null) === 0` tuzağı bu depoda
  // bir kez "0-0" diye yayımlanmış bir uydurma skor üretti (bkz.
  // 0001_core_schema.sql birinci kural); burada da aynı ayrım korunuyor.
  const scoreText = scoreHome !== null && scoreAway !== null ? `${scoreHome}-${scoreAway}` : "";
  const fixture = `${home} - ${away}`;

  // KIRMIZI KARTTA TAKIM ADI YAZILMAZ — ÇÜNKÜ BİLİNMİYOR.
  //
  // Golde akış hangi tarafın attığını söylüyor (`side: "home"|"away"`,
  // skor artışından türetiliyor). Kırmızı kartta SÖYLEMİYOR: olay
  // yalnızca kart SAYISININ arttığını bildiriyor
  // (`{ type: "red-card", match }` — side alanı yok).
  //
  // Önceki hâli `event.side === "away" ? away : home` yazıyordu ve
  // `side` tanımsız olduğu için HER kırmızı kartı ev sahibine
  // yazıyordu. Deplasman oyuncusu atıldığında bildirim yanlış takımı
  // suçluyordu — uydurulmuş bilgi, bu deponun yasakladığı türden.
  // Bilinmeyen taraf, adı hiç yazmamakla dürüstçe ifade edilir.
  const side = event.side === "home" || event.side === "away" ? event.side : null;
  const minute = kind === "goal" && match.minute ? String(match.minute) : "";

  // DİLDEN BAĞIMSIZ PARÇALAR — metin okuma anında kuruluyor.
  //
  // Bildirim yazıldığında okuyucunun dili bilinmiyor; aynı hesap hem
  // Türkçe hem İngilizce yüzeyden okunuyor. Metni burada dondurmak,
  // /en/ okuyucusuna Türkçe başlık göstermek olurdu. `title`/`body`
  // yine yazılıyor ama YALNIZCA yedek: `renderNotification` payload'ı
  // olan satırın metnini isteğin diline göre yeniden kuruyor.
  const payload = {
    v: 1,
    home,
    away,
    score: scoreText || null,
    minute: minute || null,
    side
  };

  return {
    kind,
    payload,
    title: notificationTitle(kind, payload, "tr"),
    body: notificationBody(payload),
    // TEKİLLEŞTİRME ANAHTARI — OLAYA ÖZGÜ, TÜRE DEĞİL.
    //
    // Golde skor anahtarın parçası: aynı gol tekrar gönderilirse aynı
    // satıra düşer, İKİNCİ gol ise farklı skorla farklı satır açar.
    //
    // Kırmızı kartta skor değişmiyor; anahtar yalnızca tür olsaydı
    // maçtaki İKİNCİ kırmızı kart sessizce yutulurdu. Akış olayı kart
    // SAYISININ artışından üretiyor, dolayısıyla sayının kendisi
    // kararlı ve olaya özgü bir kimlik.
    subjectKey: `${matchKey(match) || fixture}:${kind}${eventIdentity(event, kind, scoreText)}`,
    href: matchHref(match)
  };
}

/* ------------------------------------------------------------------ */
/* OKUMA ANINDA METİN — bkz. buildNotification payload gerekçesi.       */
/* ------------------------------------------------------------------ */

const NOTIFICATION_TITLES = Object.freeze({
  tr: {
    match_start: "Maç başladı",
    goal: "Gol",
    half_time: "İlk yarı bitti",
    match_end: "Maç bitti",
    red_card: "Kırmızı kart",
    lineups: "Kadrolar açıklandı",
    team_news: "Takım haberi",
    transfer_news: "Transfer haberi"
  },
  en: {
    match_start: "Match started",
    goal: "Goal",
    half_time: "Half time",
    match_end: "Full time",
    red_card: "Red card",
    lineups: "Line-ups announced",
    team_news: "Team news",
    transfer_news: "Transfer news"
  }
});

function normalizeLocale(locale) {
  return String(locale || "tr").toLowerCase().indexOf("en") === 0 ? "en" : "tr";
}

function notificationTitle(kind, payload, locale) {
  const table = NOTIFICATION_TITLES[normalizeLocale(locale)];
  const base = table[kind];
  if (!base) return "";
  // Golde ATAN TARAF biliniyorsa yazılır; bilinmiyorsa uydurulmaz
  // (kırmızı kartta olduğu gibi — bkz. buildNotification gerekçesi).
  if (kind === "goal" && payload && payload.side) {
    const team = payload.side === "away" ? payload.away : payload.home;
    if (team) return `${base}: ${team}`;
  }
  return base;
}

function notificationBody(payload) {
  if (!payload || !payload.home || !payload.away) return "";
  const fixture = `${payload.home} - ${payload.away}`;
  const score = payload.score ? ` ${payload.score}` : "";
  const minute = payload.minute ? ` · ${payload.minute}'` : "";
  return `${fixture}${score}${minute}`.replace(/\s+/g, " ").trim();
}

/**
 * Saklanmış satırı OKUYANIN dilinde metne çevirir.
 *
 * Payload taşımayan satırlar (bu alan eklenmeden önce yazılanlar)
 * saklanan metinle olduğu gibi döner: eski bildirimi silmek ya da boş
 * göstermek, okunmamış bir bildirimi sessizce kaybetmek olurdu.
 */
function renderNotification(row, locale) {
  if (!row) return row;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : null;
  if (!payload) return row;
  const title = notificationTitle(row.kind, payload, locale);
  const body = notificationBody(payload);
  return {
    ...row,
    title: title || row.title || "",
    body: body || row.body || ""
  };
}

/** Olayın kendine özgü parçası — bkz. `subjectKey` gerekçesi. */
function eventIdentity(event, kind, scoreText) {
  if (kind === "goal") return scoreText ? `:${scoreText}` : "";
  if (kind === "red_card") {
    const count = countRedCards(event && event.match && event.match.events);
    return count ? `:${count}` : "";
  }
  return "";
}

/** Olay akışındaki kırmızı kart sayısı (liveScoreStream ile aynı ölçüt). */
function countRedCards(events) {
  if (!Array.isArray(events)) return 0;
  return events.filter((entry) => {
    // ÜÇ ALANIN DA OKUNMASI GEREKİYOR, İLK DOLU OLANIN DEĞİL.
    // Sağlayıcı kaydı çoğu zaman `{ type: "Card", detail: "Red Card" }`
    // biçiminde geliyor: yalnızca `type`a bakan bir ölçüt "Card" görür,
    // "red" geçmediği için kartı SAYMAZ ve tekilleştirme anahtarı
    // sabit kalırdı — yani maçtaki ikinci kırmızı kart yutulurdu.
    const text = [entry && entry.type, entry && entry.detail, entry && entry.kind]
      .map((value) => String(value || ""))
      .join(" ")
      .toLowerCase();
    return text.includes("red");
  }).length;
}

/** Maçın kararlı anahtarı. Canlı nesnede `slug` YOK; `id`/`providerId` var. */
function matchKey(match) {
  return String((match && (match.id || match.providerId)) || "");
}

/**
 * MAÇIN SİCİLDEKİ SLUG'I — canlı nesnede yok, türetilmesi gerekiyor.
 *
 * `services/pushNotifier.js#matchUrl` ile AYNI çözücü kullanılıyor;
 * iki bildirim kanalı aynı maç için farklı adres üretemesin.
 */
function matchSlug(match) {
  try {
    // eslint-disable-next-line global-require
    const { slugForMatch } = require("../matchSeoPages");
    return slugForMatch({
      providerIds: { apiFootball: match && match.providerId },
      providerId: match && match.providerId,
      providerName: "api-football",
      homeTeam: match && match.homeTeam,
      awayTeam: match && match.awayTeam,
      kickoff: match && match.kickoff
    }) || "";
  } catch (error) {
    return "";
  }
}

function matchHref(match) {
  const slug = matchSlug(match);
  if (slug) return `/mac/${slug}.html`;
  // Sayfası çözülemeyen maçta canlı skora düşülür — uydurma adres değil.
  return "/canli-skor.html";
}

/**
 * Bu maçı kimler görmeli? — favori TAKIM veya favori MAÇ üzerinden.
 *
 * Küme kullanılıyor: hem takımı hem maçı takip eden kişiye AYNI olay
 * iki kez yazılmaz (`pushNotifier`deki aynı gerekçe).
 */
async function recipientsFor(match) {
  // TAKIM ADINDAN KİMLİĞE ÇEVİRMEK ZORUNLU.
  //
  // Favoriler kütük kimliğiyle saklanıyor ("galatasaray"), canlı maç
  // nesnesi ise yalnızca ADI taşıyor ("Galatasaray"): ölçüldü —
  // `homeTeamId`, `homeTeamSlug` ve `slug` alanlarının ÜÇÜ DE tanımsız.
  // Önceki hâli bu alanları okuduğu için hiçbir zaman alıcı bulamıyor,
  // yani bildirim kimseye ulaşmıyordu; üstelik sessizce, çünkü "alıcı
  // yok" geçerli bir durum.
  //
  // Çözüm `services/pushNotifier.js` ile AYNI yardımcıdan geçiyor
  // (`teamIdentity#teamIdForName`), böylece iki kanal aynı takım için
  // farklı cevap veremez.
  const teams = loadTeamCatalog();
  const keys = [
    ["team", teamIdForName(match.homeTeam, teams)],
    ["team", teamIdForName(match.awayTeam, teams)],
    ["match", matchSlug(match)],
    ["match", match.providerId],
    ["match", match.id]
  ].filter(([, value]) => value);

  const users = new Set();
  for (const [kind, refId] of keys) {
    try {
      for (const userId of await profileStore.listFollowers(kind, String(refId))) {
        users.add(userId);
      }
    } catch (error) {
      // Tek bir anahtarın okunamaması, diğer takipçileri düşürmez.
    }
    if (users.size >= MAX_RECIPIENTS_PER_EVENT) break;
  }

  return [...users].slice(0, MAX_RECIPIENTS_PER_EVENT);
}

/**
 * `LiveScoreHub`in kancası — `services/pushNotifier.js#notifyMatchEvents`
 * ile YAN YANA çalışır, onun yerine değil.
 */
async function notifyMatchEvents(events) {
  if (!Array.isArray(events) || !events.length || !isConfigured()) {
    return { written: 0 };
  }

  let written = 0;

  for (const event of events) {
    let notification;
    try {
      notification = buildNotification(event);
    } catch (error) {
      continue;
    }
    if (!notification) continue;

    let recipients = [];
    try {
      recipients = await recipientsFor((event && event.match) || {});
    } catch (error) {
      continue;
    }
    if (!recipients.length) continue;

    let preferences;
    try {
      preferences = await profileStore.getNotificationPrefsFor(recipients);
    } catch (error) {
      continue;
    }

    const writes = recipients
      // TERCİH KAPALIYSA BİLDİRİM YAZILMAZ — okunmamış işaretlenip
      // gizlenmez. Kullanıcı "gol bildirimi istemiyorum" dediyse o
      // satır hiç var olmamalı.
      .filter((userId) => {
        const prefs = preferences.get(userId);
        return prefs && prefs[notification.kind];
      })
      .map((userId) => profileStore.pushNotification({ userId, ...notification }));

    const settled = await Promise.allSettled(writes);
    written += settled.filter((result) => result.status === "fulfilled" && result.value).length;
  }

  return { written };
}

module.exports = {
  EVENT_TO_KIND,
  countRedCards,
  matchSlug,
  MAX_RECIPIENTS_PER_EVENT,
  buildNotification,
  isConfigured,
  matchHref,
  notifyMatchEvents,
  recipientsFor,
  renderNotification
};
