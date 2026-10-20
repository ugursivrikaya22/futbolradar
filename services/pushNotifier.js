/**
 * FAVORİ TAKIM PUSH BİLDİRİMİ — GOL VE MAÇ BAŞI.
 *
 * `services/liveScoreStream.js`teki `LiveScoreHub`, her yoklamada önceki
 * anlık görüntüyle yenisini karşılaştırıp (`detectMatchEvents`) gol ve maç
 * başı olaylarını burada tanımlı `notifyMatchEvents`e iletir
 * (`getLiveScoreHub` üzerinden bağlanır — bkz. o dosyadaki gerekçe).
 *
 * TAKIM EŞLEŞTİRMESİ İSİMLE YAPILIR, KİMLİKLE DEĞİL. Maç anlık görüntüsü
 * (`matchSnapshot`) yalnızca `homeTeam`/`awayTeam` görünen adını taşıyor,
 * sağlayıcı takım kimliğini değil — canlı skor hattı bu kimliği hiç
 * toplamıyor. `data/teams.json`daki `name` alanı aynı görünen adı
 * kullandığından (ör. "Fenerbahçe"), eşleştirme metin karşılaştırmasıyla
 * yapılıyor; 18 Süper Lig takımı için bu her zaman birebir örtüşür.
 *
 * YAPILANDIRILMAMIŞSA SESSİZCE HİÇBİR ŞEY GÖNDERMEZ. VAPID anahtarları ya
 * da abonelik deposu yoksa `notifyMatchEvents` erken döner — canlı skor
 * hattının kendisi bundan hiç etkilenmez (bkz. çağıran taraftaki
 * try/catch).
 */

const webPush = require("./webPush");
const pushSubscriptionStore = require("./pushSubscriptionStore");

/** Maç takibi abonelik anahtarının öneki; takım kimlikleriyle çakışmaz. */
const MATCH_FOLLOW_PREFIX = "match:";

// AD → KİMLİK EŞLEMESİ ARTIK TEK YERDE (services/teamIdentity.js).
// Aynı mantık ana sayfa kişiselleştirmesinde de gerekiyordu; kopyalamak
// yerine ortak yardımcıya taşındı, böylece iki yüzey aynı takım için
// farklı cevap veremez.
const { loadTeams, normalizeName, teamIdForName } = require("./teamIdentity");

function slugForTeamName(teamName, teams) {
  return teamIdForName(teamName, teams);
}

function vapidConfig() {
  return {
    publicKey: String(process.env.VAPID_PUBLIC_KEY || "").trim(),
    privateKey: String(process.env.VAPID_PRIVATE_KEY || "").trim(),
    subject: String(process.env.VAPID_SUBJECT || "").trim()
  };
}

function isConfigured() {
  const vapid = vapidConfig();
  return Boolean(vapid.publicKey && vapid.privateKey && vapid.subject) && pushSubscriptionStore.isConfigured();
}

/**
 * Bildirim metni. Aynı payload hem golü atan hem rakip takımın
 * abonelerine gider (ikisi de "kendi maçları" için haber almak ister);
 * bu yüzden metin "kim attı"yı belirtir ama "sen kazandın/kaybettin"
 * demez.
 */
/**
 * Bildirimin açacağı adres: mümkünse MAÇIN KENDİ sayfası.
 *
 * Eskiden her bildirim canlı skor listesine gidiyordu ve okuyucu bildirimi
 * gönderen maçı listede tekrar aramak zorunda kalıyordu. Sicilde kalıcı
 * sayfası olan maçta doğrudan oraya gidilir; olmayan maçta liste kalır.
 */
function matchUrl(match) {
  try {
    // eslint-disable-next-line global-require
    const { slugForMatch, trPagePath } = require("./matchSeoPages");
    const slug = slugForMatch({
      providerIds: { apiFootball: match && match.providerId },
      providerId: match && match.providerId,
      providerName: "api-football",
      homeTeam: match && match.homeTeam,
      awayTeam: match && match.awayTeam,
      kickoff: match && match.kickoff
    });
    if (slug) return `/${trPagePath(slug).replace(/\.html$/, "")}`;
  } catch (error) {
    /* sicil okunamazsa listeye düşülür */
  }
  return "/canli-skor.html";
}

function buildPayload(event) {
  const { match, type, side } = event;
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  const scoreHome = match.score && Number.isFinite(match.score.home) ? match.score.home : null;
  const scoreAway = match.score && Number.isFinite(match.score.away) ? match.score.away : null;
  const scoreText = scoreHome !== null && scoreAway !== null ? `${scoreHome}-${scoreAway}` : "";
  const url = matchUrl(match);

  if (type === "kickoff") {
    return {
      title: "🟢 Maç başladı",
      body: `${home} - ${away} başladı.`,
      tag: `kickoff-${match.id}`,
      url
    };
  }

  if (type === "goal" || (type === "penalty" && event.outcome !== "missed")) {
    const scorer = side === "home" ? home : away;
    const minuteText = match.minute ? ` · ${match.minute}'` : "";
    const penalty = type === "penalty" || event.penalty === true;
    return {
      title: penalty ? `⚽ PENALTI GOLÜ! ${scorer}` : `⚽ GOL! ${scorer}`,
      body: `${home} ${scoreText} ${away}${minuteText}`.replace(/\s+/g, " ").trim(),
      tag: `goal-${match.id}-${scoreHome}-${scoreAway}`,
      url
    };
  }

  // DEVRE ARASI / MAÇ SONU / KIRMIZI KART.
  //
  // Üçü de yalnızca DURUM GEÇİŞİNDE üretiliyor (bkz.
  // services/liveScoreStream.js#detectMatchEvents), bu yüzden her yoklamada
  // tekrarlanmıyor. Metin hiçbir yerde yorum yapmaz: ne olduğunu söyler,
  // "iyi/kötü" demez — bildirimi kimin aldığını bilmiyoruz.
  if (type === "halftime") {
    return {
      title: "⏸ Devre arası",
      body: `${home} ${scoreText} ${away}`.replace(/\s+/g, " ").trim(),
      tag: `halftime-${match.id}`,
      url
    };
  }

  if (type === "fulltime") {
    return {
      title: "🏁 Maç sonucu",
      body: `${home} ${scoreText} ${away}`.replace(/\s+/g, " ").trim(),
      tag: `fulltime-${match.id}`,
      url
    };
  }

  if (type === "red-card") {
    return {
      title: "🟥 Kırmızı kart",
      body: `${home} ${scoreText} ${away}${match.minute ? ` · ${match.minute}'` : ""}`.replace(/\s+/g, " ").trim(),
      // Etikete dakika giriyor: aynı maçta ikinci bir kırmızı kart
      // birincinin bildirimini EZMESİN.
      tag: `red-${match.id}-${match.minute || ""}`,
      url
    };
  }

  // SARI KART / KAÇAN PENALTI — sağlayıcının olay akışındaki yeni kayıttan
  // (bkz. detectMatchEvents). Oyuncu adı yalnızca sağlayıcı verdiyse yazılır.
  if (type === "yellow-card" || type === "penalty") {
    const teamName = side === "home" ? home : side === "away" ? away : "";
    const providerEvent = event.providerEvent || {};
    const player = String(providerEvent.value || "").split(" · ")[0].trim();
    const minuteText = providerEvent.time ? ` · ${String(providerEvent.time).replace(/'$/, "")}'` : (match.minute ? ` · ${match.minute}'` : "");
    const who = player ? (teamName ? `${player} (${teamName})` : player) : teamName;
    const yellow = type === "yellow-card";
    return {
      title: yellow ? "🟨 Sarı kart" : "❌ Penaltı kaçtı",
      body: `${who ? `${who} — ` : ""}${home} ${scoreText} ${away}${minuteText}`.replace(/\s+/g, " ").trim(),
      tag: `${yellow ? "yellow" : "penalty"}-${match.id}-${String(providerEvent.time || match.minute || "").replace(/\D+/g, "")}-${side || ""}`,
      url
    };
  }

  return null;
}

async function sendToSubscriber(subscriber, payload, vapid) {
  try {
    const result = await webPush.sendNotification(
      { endpoint: subscriber.endpoint, keys: { p256dh: subscriber.p256dh, auth: subscriber.auth } },
      payload,
      { vapidPublicKey: vapid.publicKey, vapidPrivateKey: vapid.privateKey, vapidSubject: vapid.subject }
    );
    if (result.expired) {
      await pushSubscriptionStore.removeSubscription(subscriber.endpoint).catch(() => {});
    } else if (result.ok) {
      await pushSubscriptionStore.markSent(subscriber.endpoint).catch(() => {});
    }
    return result;
  } catch (error) {
    // Tek bir aboneye gönderim hatası (ağ, geçici 5xx) diğerlerini etkilemez
    // ve canlı skor hattını asla kesmez.
    return { ok: false, error: true };
  }
}

/** Bir olayın ulaşacağı abonelik anahtarları (takım + maç takibi). */
function subscriberKeysForMatch(match, teams = loadTeams()) {
  return [...new Set([
    slugForTeamName(match.homeTeam, teams),
    slugForTeamName(match.awayTeam, teams),
    match.providerId ? `${MATCH_FOLLOW_PREFIX}${match.providerId}` : null,
    match.id ? `${MATCH_FOLLOW_PREFIX}${match.id}` : null
  ].filter(Boolean))];
}

/**
 * `LiveScoreHub`in ve zamanlanmış tikin çağırdığı kanca.
 *
 * ÖRNEKLER ARASI TEKİLLEŞTİRME: her olay göndermeden önce
 * `push_event_dedup` tablosunda talep edilir (services/pushEventStore.js);
 * satırı ekleyemeyen örnek (başka örnek zaten gönderdi) sessizce atlar.
 */
async function notifyMatchEvents(events, options = {}) {
  if (!Array.isArray(events) || !events.length || !isConfigured()) return { sent: 0, skipped: 0 };

  const vapid = vapidConfig();
  const teams = loadTeams();
  const claim = options.claimEvent || require("./pushEventStore").claimEvent;
  const { matchEventKey } = require("./liveScoreStream");
  let sent = 0;
  let skipped = 0;

  for (const event of events) {
    const payload = buildPayload(event);
    if (!payload) continue;

    const key = matchEventKey(event);
    if (!(await claim(key, { fixtureId: String(event.match.providerId || event.match.id || ""), type: event.type }))) {
      skipped += 1;
      continue;
    }

    // ABONE ANAHTARLARI: takım takipçileri + BU MAÇIN takipçileri (Set:
    // hem takımı hem maçı takip eden kişiye aynı olay iki kez gitmez).
    const seenEndpoints = new Set();
    for (const slug of subscriberKeysForMatch(event.match, teams)) {
      let subscribers = [];
      try {
        subscribers = await pushSubscriptionStore.listByTeam(slug);
      } catch (error) {
        continue;
      }
      const fresh = subscribers.filter((subscriber) => !seenEndpoints.has(subscriber.endpoint));
      fresh.forEach((subscriber) => seenEndpoints.add(subscriber.endpoint));
      if (!fresh.length) continue;
      await Promise.allSettled(fresh.map((subscriber) => sendToSubscriber(subscriber, payload, vapid)));
      sent += fresh.length;
    }
  }
  return { sent, skipped };
}

module.exports = {
  MATCH_FOLLOW_PREFIX,
  buildPayload,
  matchUrl,
  isConfigured,
  notifyMatchEvents,
  sendToSubscriber,
  subscriberKeysForMatch,
  slugForTeamName,
  vapidConfig
};
