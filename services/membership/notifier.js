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
  redcard: "red_card",
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

  const titles = {
    match_start: "Maç başladı",
    goal: `Gol: ${event.side === "away" ? away : home}`,
    half_time: "İlk yarı bitti",
    match_end: "Maç bitti",
    red_card: `Kırmızı kart: ${event.side === "away" ? away : home}`,
    lineups: "Kadrolar açıklandı"
  };

  const minuteText = kind === "goal" && match.minute ? ` · ${match.minute}'` : "";

  return {
    kind,
    title: titles[kind] || fixture,
    body: `${fixture}${scoreText ? ` ${scoreText}` : ""}${minuteText}`.replace(/\s+/g, " ").trim(),
    // TEKİLLEŞTİRME ANAHTARI. Aynı gol, canlı akış onu tekrar
    // gönderdiğinde ikinci kez yazılmasın diye skoru da taşıyor
    // (şemadaki kısmi benzersiz dizin bunu uyguluyor).
    subjectKey: `${match.id || match.providerId || fixture}:${kind}${scoreText ? `:${scoreText}` : ""}`,
    href: matchHref(match)
  };
}

function matchHref(match) {
  const slug = String(match.slug || "");
  if (slug) return `/mac/${slug}.html`;
  return "/canli-skor.html";
}

/**
 * Bu maçı kimler görmeli? — favori TAKIM veya favori MAÇ üzerinden.
 *
 * Küme kullanılıyor: hem takımı hem maçı takip eden kişiye AYNI olay
 * iki kez yazılmaz (`pushNotifier`deki aynı gerekçe).
 */
async function recipientsFor(match) {
  const keys = [
    ["team", match.homeTeamId || match.homeTeamSlug],
    ["team", match.awayTeamId || match.awayTeamSlug],
    ["match", match.slug],
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
  MAX_RECIPIENTS_PER_EVENT,
  buildNotification,
  isConfigured,
  matchHref,
  notifyMatchEvents,
  recipientsFor
};
