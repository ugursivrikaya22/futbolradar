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
const { wantsEvent } = require("./pushNotificationTypes");

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

  if (type === "goal") {
    const scorer = side === "home" ? home : away;
    const minuteText = match.minute ? ` · ${match.minute}'` : "";
    return {
      title: `⚽ GOL! ${scorer}`,
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

  return null;
}

/**
 * MAÇ GÜNÜ HATIRLATMASI — "Favori takımının bugün maçı var".
 *
 * Saat ve rakip YALNIZCA `data/super-lig-fixtures.json`daki tarihi
 * kesinleşmiş maçtan gelir (bkz. services/matchDayFixtures.js); veri yoksa
 * bildirim üretilmez. Etiket `matchday-<maç>`: aynı maç için ikinci bir
 * gönderim cihazda yeni bildirim açmaz, öncekinin yerine geçer.
 * Adres: maçın kalıcı sayfası varsa o, yoksa favori takımın hub sayfası.
 */
function buildMatchDayPayload(match, { teamId, teamUrl } = {}) {
  if (!match || !match.homeTeam || !match.awayTeam || !match.time) return null;
  const isHome = teamId && match.homeTeamId === teamId;
  const isAway = teamId && match.awayTeamId === teamId;
  const favorite = isHome ? match.homeTeam : isAway ? match.awayTeam : null;
  const opponent = isHome ? match.awayTeam : isAway ? match.homeTeam : null;
  const page = matchUrl(match);
  return {
    title: favorite ? `📅 Bugün maç var: ${favorite}` : "📅 Bugün maç var",
    body: favorite
      ? `${favorite}, bugün ${match.time}'da ${opponent} ile ${isHome ? "evinde" : "deplasmanda"} oynuyor.`
      : `${match.homeTeam} - ${match.awayTeam} bugün ${match.time}'da.`,
    tag: `matchday-${match.id}`,
    type: "match-day",
    url: page !== "/canli-skor.html" ? page : (teamUrl || page)
  };
}

/** Takım kimliği → `/takimlar/<slug>` (hub slug'ı kimlikten farklı olabilir, ör. 564 → basaksehir). */
function teamPageUrls(teams) {
  const map = new Map();
  try {
    // eslint-disable-next-line global-require
    const { superLigTeamPages } = require("./superLigTeamPages");
    for (const entry of superLigTeamPages({ root: require("path").join(__dirname, ".."), teams })) {
      if (entry && entry.record && entry.slug) map.set(String(entry.record.id), `/takimlar/${entry.slug}`);
    }
  } catch (error) {
    /* hub listesi okunamazsa maç sayfası / canlı skor kalır */
  }
  return map;
}

async function sendToSubscriber(subscriber, payload, vapid) {
  try {
    const result = await webPush.sendNotification(
      { endpoint: subscriber.endpoint, keys: { p256dh: subscriber.p256dh, auth: subscriber.auth } },
      payload,
      { vapidPublicKey: vapid.publicKey, vapidPrivateKey: vapid.privateKey, vapidSubject: vapid.subject }
    );
    if (result.expired) {
      await pushSubscriptionStore.removeSubscription(subscriber.endpoint);
    } else if (result.ok) {
      await pushSubscriptionStore.markSent(subscriber.endpoint);
    }
  } catch (error) {
    // Tek bir aboneye gönderim hatası (ağ, geçici 5xx) diğerlerini etkilemez
    // ve canlı skor hattını asla kesmez.
  }
}

/** `LiveScoreHub`in çağırdığı kanca. Bkz. `services/liveScoreStream.js` `onMatchEvents`. */
async function notifyMatchEvents(events) {
  if (!Array.isArray(events) || !events.length || !isConfigured()) return;

  const vapid = vapidConfig();
  const teams = loadTeams();

  for (const event of events) {
    const payload = buildPayload(event);
    if (!payload) continue;

    // ABONE ANAHTARLARI: takım takipçileri + BU MAÇIN takipçileri.
    //
    // "Bu Maçı Takip Et" düğmesi aboneliği `match:<sağlayıcı-kimliği>`
    // anahtarıyla kaydediyor (bkz. server/pushSubscriptionRoute.js). Depo
    // sütunu serbest metin olduğu için şema değişmedi; burada yalnızca
    // aranacak anahtar listesi genişledi. Küme (`Set`) sayesinde hem
    // takımı hem maçı takip eden kişiye AYNI olay iki kez gitmez.
    const slugs = [...new Set([
      slugForTeamName(event.match.homeTeam, teams),
      slugForTeamName(event.match.awayTeam, teams),
      event.match.providerId ? `${MATCH_FOLLOW_PREFIX}${event.match.providerId}` : null,
      event.match.id ? `${MATCH_FOLLOW_PREFIX}${event.match.id}` : null
    ].filter(Boolean))];

    for (const slug of slugs) {
      let subscribers = [];
      try {
        subscribers = await pushSubscriptionStore.listByTeam(slug);
      } catch (error) {
        continue;
      }
      // Tür tercihi: aboneliği yalnızca maç günü hatırlatması için açan
      // kişiye gol gitmez. Sütunu boş (eski) abonelik her şeyi alır.
      subscribers = subscribers.filter((subscriber) => wantsEvent(subscriber.notification_types, event.type));
      if (!subscribers.length) continue;
      await Promise.allSettled(subscribers.map((subscriber) => sendToSubscriber(subscriber, payload, vapid)));
    }
  }
}

/**
 * Bugün maçı olan her takımın, maç günü hatırlatmasını isteyen abonelerine
 * TEK bildirim. `dryRun` ile hiçbir şey gönderilmez, yalnızca plan döner.
 * Zamanlayıcı yok: bunu `/api/push-match-day` (CRON_SECRET korumalı)
 * çağırır — bkz. server/pushMatchDayRoute.js.
 */
async function sendMatchDayReminders({ matches = [], today, dryRun = false, store = pushSubscriptionStore, send } = {}) {
  const teams = loadTeams();
  const urls = teamPageUrls(teams);
  const vapid = vapidConfig();
  const plan = [];
  let sent = 0;
  let skipped = 0;
  const seenEndpoints = new Set();

  for (const match of matches) {
    for (const teamId of [match.homeTeamId, match.awayTeamId].filter(Boolean)) {
      const payload = buildMatchDayPayload(match, { teamId, teamUrl: urls.get(String(teamId)) });
      if (!payload) continue;
      let subscribers = [];
      try {
        subscribers = await store.listByTeam(teamId);
      } catch (error) {
        plan.push({ matchId: match.id, teamId, error: "store" });
        continue;
      }
      const eligible = subscribers.filter((subscriber) => {
        if (!wantsEvent(subscriber.notification_types, "match-day")) return false;
        if (subscriber.last_match_day_on && String(subscriber.last_match_day_on).slice(0, 10) === today) return false;
        if (seenEndpoints.has(subscriber.endpoint)) return false;
        seenEndpoints.add(subscriber.endpoint);
        return true;
      });
      skipped += subscribers.length - eligible.length;
      plan.push({ matchId: match.id, teamId, title: payload.title, body: payload.body, tag: payload.tag, url: payload.url, recipients: eligible.length });
      if (dryRun) continue;
      await Promise.allSettled(eligible.map(async (subscriber) => {
        const result = send
          ? await send(subscriber, payload)
          : await webPush.sendNotification(
            { endpoint: subscriber.endpoint, keys: { p256dh: subscriber.p256dh, auth: subscriber.auth } },
            payload,
            { vapidPublicKey: vapid.publicKey, vapidPrivateKey: vapid.privateKey, vapidSubject: vapid.subject }
          );
        if (result && result.expired) await store.removeSubscription(subscriber.endpoint);
        else if (result && result.ok) { sent += 1; await store.markMatchDaySent(subscriber.endpoint, today); }
      }));
    }
  }
  return { today, dryRun, matches: matches.length, sent, skipped, plan };
}

module.exports = {
  MATCH_FOLLOW_PREFIX,
  buildMatchDayPayload,
  buildPayload,
  matchUrl,
  sendMatchDayReminders,
  teamPageUrls,
  isConfigured,
  notifyMatchEvents,
  slugForTeamName,
  vapidConfig
};
